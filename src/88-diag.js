    // ═══════════════════════════════════════════════════════════════
    //  88-diag.js — 诊断模式（区域对齐检查 + 报告导出）
    //
    //  既是给用户自查用的取证工具，也是自动化测试的观察窗口。
    //
    //  对外提供：SCRIPT_VERSION、Diag
    //  依赖：CFG、findVideo、getContentBox、Capturer、Pipeline、UI、openModal、
    //              shouldDisableThinking、baiSupport、baiPair、baiBrokenPairs、
    //              baiPairKey、baiMayPivot、baiBrowser、wtOrder、wtStats、isTopFrame
    // ═══════════════════════════════════════════════════════════════
    const SCRIPT_VERSION = '1.13.1';

    const Diag = {
        modal: null,
        records: [],        // 最近识别记录（新→旧）
        tainted: false,     // 是否触发过画布污染
        lastYoudao: null,   // 最近一次有道的返回摘要
        lastError: null,    // 最近一次报错（会进诊断报告）
        baiProbe: null,     // 最近一次「检测浏览器 AI」的结果（build() 是同步的，只能存现成的）
        wtSelftest: null,   // 最近一次「测试各接口」的结果
        wtLastError: '',    // 免费接口最近一次全挂的原因

        record(entry) {
            entry.time = new Date().toLocaleTimeString();
            this.records.unshift(entry);
            if (this.records.length > 40) this.records.pop();
        },

        /** 生成纯文本诊断报告，用户可直接复制发出来 */
        build() {
            const L = [];
            const p = (s) => L.push(s);
            const v = findVideo();

            p('===== 硬字幕翻译 诊断报告 =====');
            p('时间     : ' + new Date().toLocaleString());
            p('脚本版本 : ' + SCRIPT_VERSION);
            p('页面     : ' + location.href.slice(0, 120));
            p('');

            p('--- 视频环境 ---');
            if (!v) {
                p('视频元素 : ❌ 未找到');
            } else {
                const r = v.getBoundingClientRect();
                const box = getContentBox(v);
                let fit = '?';
                try { fit = getComputedStyle(v).objectFit; } catch (e) { }
                p('视频元素 : ✅ 找到（页面共 ' + document.querySelectorAll('video').length + ' 个）');
                p('  videoWidth x videoHeight : ' + v.videoWidth + ' x ' + v.videoHeight);
                p('  元素矩形(l,t,w,h)        : ' + [r.left, r.top, r.width, r.height].map(Math.round).join(', '));
                p('  object-fit               : ' + fit);
                p('  推算的画面区(l,t,w,h)    : ' + [box.left, box.top, box.width, box.height].map(Math.round).join(', '));
                p('  paused / ended           : ' + v.paused + ' / ' + v.ended);
                p('  readyState               : ' + v.readyState);
                p('  currentSrc               : ' + String(v.currentSrc || '(空)').slice(0, 100));
                p('  视口 / DPR               : ' + window.innerWidth + 'x' + window.innerHeight
                    + ' / ' + window.devicePixelRatio);
            }
            p('');

            p('--- 截图后端 ---');
            p('  当前模式       : ' + Capturer.mode);
            p('  曾触发画布污染 : ' + (this.tainted ? '是（已切到标签页捕获）' : '否'));
            p('');

            p('--- 字幕区域 ---');
            if (!CFG.region) {
                p('  ❌ 尚未设定');
            } else {
                const g = CFG.region;
                p('  region(页面坐标 x,y,w,h) : ' + [g.x, g.y, g.w, g.h].map(Math.round).join(', '));
                if (v && v.videoWidth) {
                    const box = getContentBox(v);
                    const vw = v.videoWidth, vh = v.videoHeight;
                    const sx = Math.round(((g.x - box.left) / box.width) * vw);
                    const sy = Math.round(((g.y - box.top) / box.height) * vh);
                    const sw = Math.round((g.w / box.width) * vw);
                    const sh = Math.round((g.h / box.height) * vh);
                    p('  换算到视频像素坐标       : x=' + sx + ' y=' + sy + ' w=' + sw + ' h=' + sh);
                }
            }
            p('');

            p('--- 引擎配置 ---');
            p('  engine       : ' + CFG.engine);
            if (CFG.engine === 'youdao-img') {
                p('  有道 appKey  : ' + (CFG.youdaoAppKey ? CFG.youdaoAppKey : '❌ 未填'));
                p('  appSecret    : ' + (CFG.youdaoAppSecret ? '已填(' + CFG.youdaoAppSecret.length + '字符)' : '❌ 未填'));
                p('  语言方向     : ' + CFG.youdaoFrom + ' -> ' + CFG.youdaoTo);
                p('  大模型pro版  : ' + (CFG.youdaoLLM ? '开' : '关'));
            } else if (CFG.engine === 'web-translate') {
                p('  识别         : Umi-OCR 本机识别（' + CFG.umiBase + '）');
                p('  翻译接口     : ' + (CFG.wtEngine || 'auto') + '（降级链 ' + wtOrder().join(' → ') + '）');
                p('  最小间隔     : ' + CFG.wtMinInterval + 'ms');
                p('  API Key      : 不需要（逆向免费网页接口）');
                p('  ⚠️ 注意      : 非公开接口，随时可能失效');
            } else if (CFG.engine === 'browser-ai') {
                p('  识别方式     : ' + (CFG.baiOcr === 'builtin'
                    ? '浏览器内置多模态读图'
                    : 'Umi-OCR 本机识别（' + CFG.umiBase + '）'));
                p('  翻译方式     : ' + (CFG.baiTrans || 'auto')
                    + '（流式显示 ' + (CFG.baiStream ? '开' : '关')
                    + '，经英语中转 ' + (CFG.baiPivot ? '开' : '关') + '）');
                p('  语言方向     : ' + CFG.srcLang + ' -> ' + CFG.tgtLang);
                p('  API Key      : 不需要（完全离线，不产生费用）');
            } else {
                p('  apiBase      : ' + CFG.apiBase);
                p('  model        : ' + CFG.model);
                p('  apiKey       : ' + (CFG.apiKey ? '已填(' + CFG.apiKey.length + '字符)' : '❌ 未填'));
                p('  思考模式     : ' + (CFG.thinkingMode || 'auto')
                    + (shouldDisableThinking() ? '（本次会发送"关闭"参数）' : '（不发送该参数）'));
                p('  最大输出     : ' + CFG.maxTokens + ' tokens');
            }
            p('  参数         : 间隔 ' + CFG.interval + 'ms, 智能跳过 ' + CFG.smartSkip
                + ', 切后台暂停 ' + (CFG.pauseWhenHidden ? '开' : '关')
                + ', 相似度阈值 ' + CFG.textSimThreshold);
            p('');

            if (CFG.engine === 'browser-ai' || this.baiProbe) {
                p('--- 浏览器内置 AI（离线）---');
                const sup = baiSupport();
                const ver = baiBrowser();
                p('  浏览器内核   : ' + ver.text + (ver.known
                    ? (ver.ok ? '（满足 ' + ver.required + '）' : '（⚠️ 低于 ' + ver.required + '）')
                    : '（内置 AI 只在 ' + ver.required + ' 上提供）'));
                p('  可用 API     : Translator ' + (sup.translator ? '有' : '无')
                    + ' / LanguageModel ' + (sup.lm ? '有' : '无')
                    + ' / LanguageDetector ' + (sup.detector ? '有' : '无'));
                let secure = false;
                try { secure = !!window.isSecureContext; } catch (e) { }
                p('  安全上下文   : ' + (secure ? '是' : '否（需要 HTTPS 或 localhost）'));
                p('  框架位置     : ' + (isTopFrame() ? '顶层窗口' : 'iframe 内'));
                const bpair = baiPair();
                p('  语言代码     : ' + (bpair ? bpair.src + ' -> ' + bpair.tgt
                    : '❌ 认不出「' + CFG.srcLang + ' / ' + CFG.tgtLang + '」'));
                // 已经试出来的"坏语言对"。Edge 的 ja→中文 就在这里现形
                const brokenKeys = Object.keys(baiBrokenPairs);
                if (brokenKeys.length) {
                    for (const k of brokenKeys) {
                        p('  直连失败的语言对: ' + k + '（' + baiBrokenPairs[k] + '）');
                    }
                    if (bpair && baiBrokenPairs[baiPairKey(bpair)]) {
                        p('  当前方向     : ' + (baiMayPivot(bpair)
                            ? '已改走经英语中转（' + bpair.src + ' -> en -> ' + bpair.tgt + '）'
                            : '⚠️ 未开启经英语中转 —— 请勾选该项或改用其它引擎'));
                    }
                }
                if (this.baiProbe) {
                    p('  上次检测结果 ：');
                    for (const r of this.baiProbe) p('    ' + r.label + ' : ' + r.value);
                } else {
                    p('  （还没点过「检测浏览器 AI」，这里只有同步能拿到的信息）');
                }
                p('');
            }

            p('--- 运行统计 ---');
            const s = Pipeline.stats;
            p('  截图 ' + s.shots + ' / 调API ' + s.apiCalls + ' / 跳过 ' + s.skipped + ' / 错误 ' + s.errors);
            p('  运行中 : ' + Pipeline.running);
            // 这两项是新加入的"为什么会慢/会停"的线索：退避中或后台暂停时，
            // 用户看到的是"什么都没发生"，没有这两行就只能猜
            p('  连续失败 : ' + (Pipeline.failStreak || 0)
                + (Pipeline.failStreak ? '（正在退避重试）' : ''));
            p('  后台暂停 : ' + (Pipeline.hiddenPaused ? '是（切回该标签页自动继续）' : '否'));
            p('  状态行 : ' + (UI.els.status ? UI.els.status.textContent : '-'));
            p('');

            if (this.lastYoudao) {
                p('--- 最近一次有道返回 ---');
                p('  errorCode : ' + this.lastYoudao.errorCode);
                p('  识别区域数: ' + this.lastYoudao.regionCount);
                p('  boundingBox: ' + (this.lastYoudao.boxes.join(' | ') || '(无)'));
                p('');
            }

            if (CFG.engine === 'web-translate' || this.wtSelftest) {
                p('--- 免费网页接口（逆向）---');
                const ids = Object.keys(wtStats);
                if (!ids.length) p('  （还没有调用记录）');
                for (const id of ids) {
                    const s = wtStats[id];
                    p('  ' + id.padEnd(8) + ' 成功 ' + s.ok + ' / 失败 ' + s.fail
                        + (s.lastError ? '　最近错误: ' + s.lastError : ''));
                }
                if (this.wtSelftest) {
                    p('  上次测活结果：');
                    for (const r of this.wtSelftest) {
                        p('    ' + (r.ok ? '✅ ' : '❌ ') + r.label + '（' + r.ms + 'ms）'
                            + (r.ok ? '：' + r.out : '：' + r.err));
                    }
                } else {
                    p('  （还没点过「测试各接口」）');
                }
                p('');
            }

            if (this.lastError) {
                p('--- 最近一次错误（重点看这里）---');
                p('  时间: ' + this.lastError.time);
                p('  内容: ' + this.lastError.msg);
                if (this.lastError.stack) {
                    p('  位置: ' + this.lastError.stack.split('\n').slice(1).join(' | '));
                }
                p('');
            }

            p('--- 最近识别记录（新→旧）---');
            if (!this.records.length) p('  (无)');
            for (const r of this.records) {
                p('  [' + r.time + '] ' + r.engine + (r.ms != null ? ' ' + r.ms + 'ms' : ''));
                p('        原文: ' + (r.original || '(空)'));
                p('        译文: ' + (r.translation || '(空)'));
            }
            return L.join('\n');
        },

        open() {
            if (this.modal) { this.refresh(); return; }
            const ui = openModal({
                title: '诊断模式 — 字幕区域对齐检查',
                closeId: 'h1sub-diag-close',
                width: 'min(900px,95vw)',
                z: 2147483640,
                modalStyle: 'max-height:93vh;display:flex;flex-direction:column',
                headStyle: 'padding:10px 12px;border-bottom:1px solid #2c313a',
                bodyStyle: 'padding:10px 12px;overflow:auto',
                buttons: [
                    { id: 'h1sub-diag-refresh', label: '刷新' },
                    { id: 'h1sub-diag-copy', label: '复制报告' },
                ],
                body: [
                    '<div style="display:flex;gap:10px;flex-wrap:wrap">',
                    '  <div style="flex:1;min-width:290px">',
                    '    <div style="color:#7dd3fc;margin-bottom:4px">① 视频画面 + 红框 = 脚本实际截取范围</div>',
                    '    <canvas id="h1sub-diag-frame" style="width:100%;background:#000;border:1px solid #2c313a;border-radius:6px"></canvas>',
                    '  </div>',
                    '  <div style="flex:1;min-width:290px">',
                    '    <div style="color:#7dd3fc;margin-bottom:4px">② 脚本实际截到的图（OCR 的输入）</div>',
                    '    <canvas id="h1sub-diag-crop" style="width:100%;background:#000;border:1px solid #2c313a;border-radius:6px"></canvas>',
                    '  </div>',
                    '</div>',
                    '<div id="h1sub-diag-hint" style="margin:9px 0;color:#fbbf24"></div>',
                    '<div style="color:#7dd3fc;margin:6px 0 4px">③ 诊断报告（点「复制报告」即可发出来）</div>',
                    '<textarea id="h1sub-diag-report" readonly style="width:100%;height:230px;background:#0f1116;',
                    'color:#cbd5e1;border:1px solid #2c313a;border-radius:6px;padding:8px;',
                    'font:11px/1.5 Consolas,monospace;box-sizing:border-box"></textarea>',
                ].join(''),
            });
            this.modal = ui.root;
            ui.$('#h1sub-diag-close').onclick = () => { ui.close(); this.modal = null; };
            ui.$('#h1sub-diag-refresh').onclick = () => this.refresh();
            ui.$('#h1sub-diag-copy').onclick = () => this.copy();
            this.refresh();
        },

        refresh() {
            if (!this.modal) return;
            const v = findVideo();

            // ① 整帧 + 红框（即使画布被污染也能显示，因为我们不读它的像素）
            const fc = this.modal.querySelector('#h1sub-diag-frame');
            if (v && v.videoWidth) {
                fc.width = v.videoWidth;
                fc.height = v.videoHeight;
                const x = fc.getContext('2d');
                x.fillStyle = '#000';
                x.fillRect(0, 0, fc.width, fc.height);
                try { x.drawImage(v, 0, 0); } catch (e) { /* 忽略 */ }
                if (CFG.region) {
                    const box = getContentBox(v);
                    const g = CFG.region;
                    const sx = ((g.x - box.left) / box.width) * fc.width;
                    const sy = ((g.y - box.top) / box.height) * fc.height;
                    const sw = (g.w / box.width) * fc.width;
                    const sh = (g.h / box.height) * fc.height;
                    x.strokeStyle = '#ff2d55';
                    x.lineWidth = Math.max(2, fc.width / 400);
                    x.strokeRect(sx, sy, sw, sh);
                    x.fillStyle = 'rgba(255,45,85,.16)';
                    x.fillRect(sx, sy, sw, sh);
                }
            } else {
                fc.width = 320; fc.height = 180;
            }

            // ② 实际截图
            const cc = this.modal.querySelector('#h1sub-diag-crop');
            let cropErr = null;
            try {
                const crop = CFG.region ? Capturer.grab(CFG.region) : null;
                if (crop) {
                    cc.width = crop.width;
                    cc.height = crop.height;
                    cc.getContext('2d').drawImage(crop, 0, 0);
                } else {
                    cc.width = 320; cc.height = 40;
                    const x = cc.getContext('2d');
                    x.fillStyle = '#000'; x.fillRect(0, 0, 320, 40);
                }
            } catch (e) {
                cropErr = e;
                if (e.code === 'TAINTED') this.tainted = true;
                cc.width = 420; cc.height = 44;
                const x = cc.getContext('2d');
                x.fillStyle = '#1a0505'; x.fillRect(0, 0, 420, 44);
                x.fillStyle = '#f87171'; x.font = '13px sans-serif';
                x.fillText('截图失败: ' + String(e.message).slice(0, 46), 8, 27);
            }

            const hint = this.modal.querySelector('#h1sub-diag-hint');
            if (!CFG.region) hint.textContent = '⚠️ 还没框选字幕区域 —— 请先点面板上的「框选字幕区」';
            else if (!v) hint.textContent = '⚠️ 没找到视频元素 —— 请确认播放页已打开、视频已加载';
            else if (cropErr && cropErr.code === 'TAINTED') {
                hint.textContent = '⚠️ 视频跨域且未发 CORS 头，画布被污染 → 点「开始」会自动请求「共享此标签页」授权';
            } else {
                hint.textContent = '👀 检查①里的红框是否正好套住原字幕文字。红框偏了 = 框选时框偏了，重新框一次。'
                    + '再对比②，确认 OCR 拿到的是字幕而不是背景画面。';
            }

            this.modal.querySelector('#h1sub-diag-report').value = this.build();
        },

        async copy() {
            const txt = this.build();
            try {
                await navigator.clipboard.writeText(txt);
                UI.setStatus('✅ 诊断报告已复制到剪贴板', 'ok');
            } catch (e) {
                const ta = this.modal.querySelector('#h1sub-diag-report');
                ta.removeAttribute('readonly');
                ta.focus(); ta.select();
                let ok = false;
                try { ok = document.execCommand('copy'); } catch (e2) { }
                ta.setAttribute('readonly', 'readonly');
                UI.setStatus(ok ? '✅ 已复制' : '⚠️ 自动复制失败，请手动全选报告文本复制', ok ? 'ok' : 'warn');
            }
        },
    };
