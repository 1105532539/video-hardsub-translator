    // ═══════════════════════════════════════════════════════════════
    //  70-pipeline.js — 主循环
    //
    //  跑一轮 = 看看画面 → 该跳过就跳过 → 调引擎 → 显示译文。
    //  每一步都拆成了具名方法（ensureReady / grabFrame / shouldSkipFrame /
    //  recognize / present），哪个分支什么时候返回从名字就能读出来。
    //
    //  gen 计数器负责作废"飞在路上"的结果：用户点停止、重选区域、页面跳走之后，
    //  迟到的识别结果不能画到字幕上。
    //
    //  对外提供：Pipeline
    //  依赖：CFG、Capturer、UI、Overlay、Diag、recognizeAndTranslate、thumbnail、
    //              thumbDiff、edgeDensity、textSimilarity、classifyError、findVideo、
    //              log、warn、NO_CHANGE_DIFF、EDGE_MIN
    // ═══════════════════════════════════════════════════════════════
    const Pipeline = {
        running: false,
        busy: false,
        timer: null,
        // 每次 start / stop / 换区域都 +1；异步结果回来时对不上就说明这次识别已作废，直接丢掉。
        gen: 0,
        lastThumb: null,
        // 「上一次**实际送出去识别**的那一帧」。两者的区别很关键：
        //   lastThumb      = 上一次**进到「该不该跳过」判断**的帧，用于比对画面有没有变
        //   lastSentThumb  = 上一次**花了钱识别过**的帧
        // 注意 lastThumb 只在「没被跳过」时更新（见 shouldSkipFrame 末尾），
        // 跳过的那一轮不刷新 —— 否则每次都拿刚存下的自己跟自己比，变化检测会失效。
        //
        // 跳过的判据用 lastSentThumb，才能覆盖「画面静止但识别不出文字」的情况：
        // 那种情况下 lastOriginal 恒为空，用它会让同一张图被反复送去付费识别（见 P0-1）。
        lastSentThumb: null,
        lastOriginal: '',
        lastTranslation: '',
        emptyStreak: 0,
        // 后台标签页暂停期间为 true；用来区分「用户按了停止」和「只是切走了」
        hiddenPaused: false,
        // 连续失败次数，用于指数退避（成功一次即清零）
        failStreak: 0,
        stats: { shots: 0, apiCalls: 0, skipped: 0, errors: 0 },

        invalidate() { this.gen++; },

        /** 把「与上一帧有关」的状态一次清干净：换区域 / SPA 跳页 / 改配置后都该调它。
         *  以前这段是手工复制在 4 个调用点上的，容易漏（漏了会把新句当成重复句吞掉）。 */
        resetFrameState() {
            this.lastThumb = null;
            this.lastSentThumb = null;
            this.lastOriginal = '';
            this.lastTranslation = '';
            this.emptyStreak = 0;
            this.invalidate();
        },

        start() {
            if (this.running) return;
            if (!CFG.region) {
                UI.setStatus('请先框选字幕区域', 'warn');
                return;
            }
            this.invalidate();
            this.running = true;
            this.lastThumb = null;
            this.emptyStreak = 0;
            this.failStreak = 0;      // 重开就重置退避，别继承上一次的惩罚
            UI.setRunning(true);
            UI.setStatus('运行中…', 'ok');
            this.tick();
        },

        stop() {
            this.running = false;
            this.invalidate();
            if (this.timer) { clearTimeout(this.timer); this.timer = null; }
            // 清 busy：否则在飞请求返回前（最长一次 GM 超时）重新点「开始」会被
            // ensureReady 里的 busy 判断静默吞掉，表现成"点了没反应"。
            // 安全性由 gen 保证 —— 迟到的结果对不上代，本来就会被丢弃。
            this.busy = false;
            // 停止要收掉字幕：不然最后一句一直挂着，用户以为还在翻译（换集 / 暂停时尤其容易误会）。
            // 「上一句」也得清 —— 否则重开后与停之前相同的首句会被当成重复句直接吞掉。
            Overlay.clear();
            this.lastOriginal = '';
            this.lastTranslation = '';
            // ⚠️ lastSentThumb 必须跟着一起清：它标记的是"这一帧已经买过了"，
            // 而上面刚把结果（lastOriginal / lastTranslation）丢掉。若保留它，
            // 重开后遇到静止画面会被判成"已买过"而跳过 —— 结果就是既不识别、
            // 悬浮层也没内容可显示，用户看到一片空白。（这是本轮引入又修掉的回归。）
            this.lastSentThumb = null;
            this.emptyStreak = 0;
            UI.setRunning(false);
            UI.setStatus('已停止', 'idle');
        },

        toggle() { this.running ? this.stop() : this.start(); },

        /**
         * 切到后台：暂停主循环，但**不算停止** —— 保留 running 与 lastSentThumb，
         * 这样切回来能接着跑，且画面没变时不必重新花钱。
         * 之所以必须专门处理：视频在后台标签页会继续播放，`video.paused` 是 false，
         * 现有那道闸门拦不住 —— 会一直截图并调用付费接口，而没人看得到结果。
         */
        pauseForHidden() {
            if (!this.running || this.hiddenPaused) return;
            this.hiddenPaused = true;
            this.invalidate();                 // 作废在飞结果
            if (this.timer) { clearTimeout(this.timer); this.timer = null; }
            UI.setStatus('已切到后台，暂停翻译（切回本标签页自动继续）', 'idle');
        },

        /** 切回前台：接着跑。没在运行、或不是被后台暂停的，都不动。 */
        resumeFromHidden() {
            if (!this.hiddenPaused) return;
            this.hiddenPaused = false;
            if (!this.running) return;
            this.invalidate();
            UI.setStatus('已回到前台，继续翻译…', 'ok');
            if (!this.timer) this.tick();
        },

        /** 本次失败后应该等多久再试（按错误类型区分；见 P0-3） */
        backoffDelay(e) {
            const kind = classifyError(e);
            // 配置类错误重试没有意义：退避到很慢，避免一直刷屏烧请求
            if (kind === 'config') return 60000;
            const base = (kind === 'ratelimit' || kind === 'quota') ? 1000 : 500;
            const cap = (kind === 'ratelimit' || kind === 'quota') ? 60000 : 15000;
            const n = Math.min(this.failStreak, 6);          // 1s→2s→4s…→32s（封顶见 cap）
            return Math.min(cap, base * Math.pow(2, n));
        },

        async tick() {
            if (!this.running || this.hiddenPaused) return;
            if (this.timer) { clearTimeout(this.timer); this.timer = null; }

            let wait = Math.max(300, CFG.interval);
            try {
                await this.step();
                this.failStreak = 0;              // 这一轮没抛错 → 退避清零
            } catch (e) {
                this.stats.errors++;
                this.failStreak++;
                warn('step 出错：', e);
                Diag.lastError = {
                    time: new Date().toLocaleTimeString(),
                    msg: String(e && e.message || e),
                    stack: e && e.stack ? String(e.stack).split('\n').slice(0, 3).join('\n') : '',
                };
                const kind = classifyError(e);
                if (kind === 'config') {
                    // 模型名 / 地址 / Key 写错这类问题，重试永远好不了：停下来让用户去改
                    UI.setStatus('出错：' + e.message, 'err');
                    UI.setStatus('配置有问题，已自动停止：' + e.message, 'err');
                    this.stop();
                    return;
                }
                const ms = this.backoffDelay(e);
                wait = Math.max(wait, ms);
                UI.setStatus('出错（' + (kind === 'ratelimit' ? '被限流' : kind === 'quota' ? '额度不足' : '请求失败')
                    + '），' + Math.round(ms / 1000) + 's 后重试：' + e.message, 'err');
            }

            if (this.running && !this.hiddenPaused) {
                this.timer = setTimeout(() => this.tick(), wait);
            }
        },

        /** 跑一轮：看看画面 → 该跳过就跳过 → 调引擎 → 显示译文；细节在各自的具名方法里 */
        async step() {
            const myGen = this.gen;

            const video = findVideo();
            if (!this.ensureReady(video)) return;

            const canvas = await this.grabFrame(video);
            if (!canvas) return;

            this.stats.shots++;
            if (this.shouldSkipFrame(canvas)) return;

            const res = await this.recognize(canvas, myGen);
            if (!res) return;              // 结果已作废（停止 / 换了区域 / 页面跳走）

            this.present(res);
        },

        /** 前置检查：有没有视频、有没有框选、能不能截、上一轮回来没有；true = 可以继续这一轮 */
        ensureReady(video) {
            if (!video || !CFG.region) {
                // 什么都不说会让人以为卡死了：状态栏一直停在"运行中…"
                this.missVideo = (this.missVideo || 0) + 1;
                if (!video) {
                    // 连续 30 轮（默认间隔下约 36 秒）找不到就收手，免得在没视频的页面上一直空转
                    if (this.missVideo >= 30) {
                        UI.setStatus('一直没找到视频，已自动停止（可再点「开始」重试）', 'err');
                        this.stop();
                    } else {
                        UI.setStatus('没找到视频元素（换集 / 换页后常见）', 'warn');
                    }
                } else {
                    UI.setStatus('还没框选字幕区域', 'warn');
                }
                return false;
            }
            this.missVideo = 0;

            // 视频暂停时不截图，省 API
            if (video.paused || video.ended) {
                UI.setStatus('视频已暂停', 'idle');
                return false;
            }

            // 上一轮还没回来就跳过，防止请求堆积
            if (this.busy) return false;

            return true;
        },

        /** 截一帧；画布被污染（视频跨域）走 handleTainted 岔路（中断运行并引导改用标签页捕获）；null 表示这一轮不用继续 */
        async grabFrame(video) {
            let canvas = null;
            try {
                canvas = Capturer.grab(CFG.region, video);
            } catch (e) {
                if (e.code === 'TAINTED' || e.code === 'NO_DISPLAY') {
                    await this.handleTainted(e);
                    return null;
                }
                throw e;                       // 其他异常交给 tick() 的错误处理
            }
            if (!canvas) {
                // 区域跑到视频画面外了（滚动 / 播放器重排 / 换集）时 grab 会返回 null；
                // 不提示的话用户只会看到"运行中…"不动。
                UI.setStatus('截不到画面 —— 区域可能已不在视频上，请重新框选（① 框选字幕区）', 'warn');
                return null;
            }
            return canvas;
        },

        /** 画布被跨域污染时的善后：能切标签页捕获就切，切不了就告诉用户怎么办 */
        async handleTainted(e) {
            if (CFG.captureMode === 'element') {
                UI.setStatus('视频跨域且画布被污染 —— 请把「截图方式」改成「自动」或「标签页捕获」', 'err');
                this.stop();
                return;
            }
            warn('需要标签页捕获：' + e.message);
            if (e.code === 'TAINTED') Diag.tainted = true;
            UI.setStatus('正在请求「共享此标签页」授权，请在弹窗里选当前标签页…', 'warn');
            this.stop();                       // 换模式后让用户自己重新点开始，避免状态错乱
            try {
                await Capturer.startDisplayCapture();
                UI.applyCaptureMode('display', '✅ 已切换为标签页捕获，请重新点「开始」');
            } catch (e2) {
                UI.setStatus('共享授权失败：' + e2.message, 'err');
            }
        },

        /** 画面没变、或区域里根本没文字 → 这一轮不用花 API 钱；true = 跳过 */
        shouldSkipFrame(canvas) {
            // ---- 变化检测 ----
            const thumb = thumbnail(canvas);
            // ⚡ 优化：lastThumb 为 null（第一帧）时直接短路 —— thumbDiff 内部本来也会返回 1，
            //    但那样要先白跑一遍 512 个样本的循环；结果是 null 而非 false，下面只当条件用，语义不变。
            const noChange = this.lastThumb
                && thumbDiff(thumb, this.lastThumb) < NO_CHANGE_DIFF;

            // 判据用 lastSentThumb（上一次**花钱识别过**的那一帧），而不是 lastOriginal。
            //
            // 为什么不能用 lastOriginal：识别结果为空时 present() 会把它清成 ''，于是
            // 「画面静止 + 边缘密度够高 + 识别不出文字」这个组合会让本判断永远不成立 ——
            // 每隔一个间隔就重新识别一张逐像素相同的图，每次钱照扣、结果都是空。
            // 静止空镜 / 风景 / 标题卡都会命中这条路。
            //
            // lastSentThumb 在 recognize() 真正发起请求前更新，与「识别结果是否为空」解耦：
            // 同一张图只买一次，无论买回来的答案是什么。
            if (noChange && this.lastSentThumb) {
                this.stats.skipped++;
                UI.setStatus('画面未变化，跳过', 'idle');
                return true;
            }
            this.lastThumb = thumb;
            UI.setPreview(canvas);

            // ---- 智能跳过：区域里没有文字就不调 API ----
            if (CFG.smartSkip) {
                const ed = edgeDensity(canvas);
                UI.setEdge(ed);
                if (ed < EDGE_MIN) {
                    this.stats.skipped++;
                    this.emptyStreak++;
                    if (this.emptyStreak >= 2) {
                        Overlay.clear();
                        this.lastOriginal = '';
                    }
                    // 这里也更新 lastSentThumb：这一帧（含它的边缘特征）已经判过，
                    // 就算它后来变得"像有文字"，也得等画面真的变化才会重判。
                    // 注意存的是**已经算出来的 thumb**，不额外截图。
                    this.lastSentThumb = thumb;
                    UI.setStatus('未检测到文字，跳过（边缘密度 ' + ed.toFixed(3) + '）', 'idle');
                    return true;
                }
            }
            return false;
        },

        /** 调识别 / 翻译引擎；返回 null 表示结果已作废 */
        async recognize(canvas, myGen) {
            // 记下「这一帧已经买过了」——放在 await 之前，成功失败都算买过。
            // 空结果同样要记：否则下一轮又会对同一张图再买一次（这正是 P0-1 的漏钱点）。
            this.lastSentThumb = this.lastThumb;
            this.busy = true;
            UI.setStatus('识别中…', 'busy');
            const t0 = performance.now();
            let res;
            try {
                this.stats.apiCalls++;
                res = await recognizeAndTranslate(canvas, { onDelta: this.partialSink(myGen) });
            } catch (e) {
                // 失败不保留「买过了」的标记：让下一轮能重试同一帧。
                // 否则一次网络抖动会让这张图在整个静止期间都不再被识别。
                this.lastSentThumb = null;
                throw e;
            } finally {
                this.busy = false;
            }

            // 请求飞在路上时用户可能点了停止 / 重选区域 / 页面跳走：结果是给"上一轮"的，
            // 画上去就是过期字幕（SPA 跳页时尤其明显：Overlay.clear() 之后旧字幕又冒出来）。
            if (myGen !== this.gen || !this.running) {
                log('丢弃作废的识别结果');
                return null;
            }

            return {
                original: res.original,
                translation: res.translation,
                ms: Math.round(performance.now() - t0),
            };
        },

        /**
         * 流式译文的落点：端侧模型一边生成，这里一边把已生成的部分盖到字幕上。
         * 三层保护：① 没开 CFG.baiStream 就返回 undefined，引擎退回一次性调用；② 用**本次调用的代**
         * 校验，中途停止 / 重选区域后迟到的分片不能再往画面上画（同 recognize() 那道校验）；
         * ③ 按时间节流 —— 模型一秒吐几十个分片，每个都写一次 innerHTML 加一次强制重排，纯属浪费。
         * @param {number} myGen 本次识别所属的代
         * @returns {((partial:string, original:string)=>void)|undefined}
         */
        partialSink(myGen) {
            if (!CFG.baiStream) return undefined;
            let last = 0;
            return (partial, original) => {
                if (myGen !== this.gen || !this.running) return;
                const now = performance.now();
                if (now - last < 80) return;
                last = now;
                const t = String(partial || '').trim();
                if (!t) return;
                Overlay.show(original || '', t);
            };
        },

        present(res) {
            const dt = res.ms;

            // ① 这帧确实没字幕。连续两帧都没有才清掉悬浮层，避免字幕一闪一闪
            if (!res.original && !res.translation) {
                this.emptyStreak++;
                if (this.emptyStreak >= 2) {
                    Overlay.clear();
                    this.lastOriginal = '';
                    this.lastTranslation = '';
                }
                UI.setStatus('本帧无字幕（' + dt + 'ms）', 'idle');
                return;
            }
            this.emptyStreak = 0;

            // ② 认出了原文但没拿到译文（模型返回空、接口抽风）：不能往下走 —— Overlay 渲染的是
            //    `translation || original`，放行会把没翻译的外文原文当译文显示，状态还报"已翻译"。
            if (res.original && !res.translation) {
                UI.setStatus('只认出原文、没拿到译文，保持上一句', 'warn');
                return;
            }

            // ③ 文本相似度阈值：和上一句太像就不刷新，避免字幕抖动
            const sim = textSimilarity(res.original || res.translation, this.lastOriginal);
            if (this.lastOriginal && sim > (1 - CFG.textSimThreshold)) {
                UI.setStatus('与上句相似，保持（' + dt + 'ms）', 'idle');
                return;
            }

            // ④ 正常显示
            this.lastOriginal = res.original || res.translation;
            this.lastTranslation = res.translation;
            Overlay.show(res.original, res.translation);
            UI.pushHistory(res.original, res.translation);
            Diag.record({
                engine: CFG.engine + '@' + Capturer.mode,
                ms: dt,
                original: res.original,
                translation: res.translation,
            });
            UI.setStatus('已翻译（' + dt + 'ms）', 'ok');
            log('识别：', res.original, '→', res.translation);
        },
    };
