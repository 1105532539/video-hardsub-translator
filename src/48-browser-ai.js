    // ═══════════════════════════════════════════════════════════════
    //  48-browser-ai.js — 浏览器内置 AI：免 Key 的识别 / 翻译
    //
    //  路线：直接调用浏览器**自带**的模型，不要 API Key、不产生任何 API 费用。
    //
    //    Translator（Translation API）  —— 端侧翻译模型，快，专为翻译训练
    //    LanguageModel（Prompt API）    —— Gemini Nano，可看图（多模态）
    //
    //  ⚠️ 隐私边界（别把两家的实现混为一谈）：
    //    · Chrome：端侧模型，语言包下载到本机，**不联网、原文不出设备**；
    //    · Edge：同名 API 但是**另一套实现**，是否完全本地未经证实
    //      （实测断网后 create() 直接挂死，说明它会去联网）——
    //      **不要把它当作隐私保证**。详见 README 的 browser-ai 一节。
    //
    //  于是有两条组合（面板里「识别方式」自己选）：
    //    umi     ：Umi-OCR 认出原文 → Translator 翻译      （识别率最高，推荐）
    //    builtin ：LanguageModel 直接读图得到原文 → Translator 翻译（零安装）
    //
    //  ⚠️ 前提：这是**内核功能**，版本不够时 API 根本不存在 ——
    //     Chrome ≥ 138 / Edge ≥ 148（见 BAI_MIN_VERSION 与 baiVersionNote）。
    //
    //  ⚠️ 四条实测得出的硬约束（Chrome 153 / Edge 145，见 docs/ARCHITECTURE.md）：
    //   1. 会话创建会触发模型下载，而「下载」必须发生在**用户手势**里。
    //      所以下载一律由面板上的「准备离线模型」按钮发起（baiPrepare），
    //      主循环里只用已经建好的会话，绝不自己 create() 一个待下载的模型。
    //   2. 端侧模型**声明支持**的语言里没有中文（zh / ko / ru … 都会让
    //      availability() 直接返回 "unavailable"）。所以：
    //        · 要求它输出中文时**不能**写 expectedOutputs，只能靠提示词引导；
    //        · 多模态读图时按「源语言」声明（日语 OK），中文源语言要用 Umi-OCR。
    //   3. 跨域 iframe 默认拿不到这两个 API（Permissions Policy），
    //      而本脚本经常正好挂在播放器的 iframe 里 —— 探测结果里要说清楚。
    //   4. **Edge 和 Chrome 不是同一套实现**（Edge 145 实测）：
    //        · Edge 没有 LanguageModel（没有 Prompt API），只有 Translator，
    //          所以「内置多模态读图」在 Edge 上根本用不了，语言对一旦不支持
    //          也没有端侧大模型可以兜底；
    //        · Edge 的 Translator 对 **日语 → 中文** 这个语言对必报
    //          `UnknownError: Other generic failures occurred.`
    //          （zh / zh-Hans / zh-Hant / zh-CN / zh-TW 全试过，全挂；
    //           而 ja→en、ja→ko、ja→fr、en→zh 都正常 —— 是这一对坏了）。
    //          注意它 create() 会成功、到 translate() 才抛，所以只探测
    //          availability() 是看不出问题的，必须真跑一句（baiPrepare 里的自检）。
    //        · 绕法：经英语中转（ja→en 再 en→zh），两条腿在 Edge 上都是好的。
    //          见 baiPivotTranslate。
    //
    //  对外提供：BAI_OCR_MODES、BAI_TRANS_MODES、BAI_AVAIL_TEXT、
    //              BAI_MIN_VERSION、BAI_OCR_SYSTEM、baiApi、baiSupport、
    //              baiBrowser、baiVersionNote、baiPair、
    //              baiFrameNote、baiAvailability、baiAvailText、baiProbe、
    //              baiPrepare、baiReset、baiJoinChunk、baiTranslate、
    //              baiOcrByBuiltin、recognizeByBrowserAI、baiCollapseRepeat、baiPolish、
    //              baiPairKey、baiMayPivot、baiIsPairFailure、baiBrokenPairs
    //  依赖：CFG、isTopFrame、log、warn、cacheGet、cachePut、stripWrappingQuotes、
    //              canvasToJpeg、callUmiOCR、langCode
    // ═══════════════════════════════════════════════════════════════
    const BAI_OCR_MODES = ['umi', 'builtin'];

    const BAI_TRANS_MODES = ['auto', 'translator', 'prompt'];

    /** 内置 AI 的**内核版本门槛**：低于门槛时这两个 API 根本不存在（连 `typeof` 都拿不到），门槛附近
     *  则可能"API 在、但能力不全"（实测 Edge 145 有 Translator 无 LanguageModel，且 ja→中文 必失败）。 */
    const BAI_MIN_VERSION = { chrome: 138, edge: 148 };

    /**
     * 认浏览器内核与版本：优先 `navigator.userAgentData`（UA 字符串会被简化/冻结，版本号不可靠），
     * 拿不到再退回正则解析 UA。
     * @param {string} [uaOverride] 只在测试里用：直接喂一串 UA 验证解析
     */
    function baiBrowser(uaOverride) {
        let s = typeof uaOverride === 'string' ? uaOverride : '';
        let brand = 'other';
        let major = 0;

        if (uaOverride === undefined) {
            try {
                const d = navigator.userAgentData;
                if (d && Array.isArray(d.brands)) {
                    for (let i = 0; i < d.brands.length; i++) {
                        const b = d.brands[i] || {};
                        const v = parseInt(b.version, 10) || 0;
                        if (/Microsoft Edge/i.test(b.brand)) { brand = 'edge'; major = v; }
                        else if (/Google Chrome/i.test(b.brand) && brand !== 'edge') { brand = 'chrome'; major = v; }
                    }
                }
            } catch (e) { /* 沙箱里可能没有 userAgentData */ }
            if (brand === 'other') {
                try { s = String(navigator.userAgent || ''); } catch (e2) { s = ''; }
            }
        }

        if (brand === 'other') {
            const mEdge = /Edg(?:e|A|iOS)?\/(\d+)/.exec(s);
            const mChrome = /(?:Chrome|Chromium)\/(\d+)/.exec(s);
            if (mEdge) { brand = 'edge'; major = Number(mEdge[1]); }
            else if (mChrome) { brand = 'chrome'; major = Number(mChrome[1]); }
        }

        const min = BAI_MIN_VERSION[brand] || 0;
        const name = brand === 'edge' ? 'Edge' : (brand === 'chrome' ? 'Chrome' : '非 Chromium 内核');
        const known = brand !== 'other';
        return {
            brand: brand,
            major: major,
            min: min,
            name: name,
            known: known,
            ok: known && major >= min,
            text: known ? (name + ' ' + major) : name,
            required: known ? (name + ' ≥ ' + min) : 'Chrome ≥ 138 / Edge ≥ 148',
        };
    }

    /** 版本门槛的提示语；满足要求时返回空串。低于门槛但 API 还在时**不禁止使用**
     *  （某些语言对可能照样能用），只警告。 */
    function baiVersionNote() {
        const b = baiBrowser();
        if (!b.known) {
            return '⚠️ 当前不是 Chromium 内核的浏览器（' + b.text + '）—— 内置 AI 只在 Chrome ≥ 138 / Edge ≥ 148 上提供，请改用其它引擎';
        }
        if (b.major < b.min) {
            return '⚠️ 当前 ' + b.text + ' 低于要求（' + b.required + '）：内置 AI 的 API 在这个版本上不存在或不完整'
                + '（实测 Edge 145 缺少多模态大模型、且「日语 → 中文」必失败）。'
                + '请升级浏览器，或改用 Chrome / 其它引擎。';
        }
        return '';
    }

    //  语言名 → 语言码的映射表在 32-util.js（langCode），49-web-translate.js 用的是同一张表。
    const BAI_AVAIL_TEXT = {
        available: '✅ 已就绪（不用再下载）',
        downloadable: '⬇️ 需要下载（点「准备离线模型」）',
        downloading: '⏳ 正在下载…',
        unavailable: '❌ 不支持（语言对或能力不够）',
        unsupported: '❌ 这台浏览器没有这个 API',
        error: '❌ 探测出错',
    };

    /** 多模态读图用的系统提示词。要足够严，否则模型会"顺手翻译"或加上解说。 */
    const BAI_OCR_SYSTEM = '你是视频字幕 OCR 引擎。用户给你一张字幕区域的截图，'
        + '你只把图中出现的文字原样抄出来：不翻译、不解释、不加标点、不要引号、不要换行。'
        + '图中没有文字时，只回复「无文字」四个字。';

    /** 取内置 AI 的全局构造器。不能直接写 `Translator`：不支持时它是未声明标识符，会抛
     *  ReferenceError 而不是给出 undefined（脚本会在 boot 阶段直接崩掉）。 */
    function baiApi(kind) {
        const n = kind === 'translator' ? 'Translator'
            : (kind === 'lm' ? 'LanguageModel' : 'LanguageDetector');
        try {
            if (typeof window !== 'undefined' && window[n]) return window[n];
            if (typeof self !== 'undefined' && self[n]) return self[n];
        } catch (e) { /* 沙箱里取不到就当不支持 */ }
        return null;
    }

    /** 三个内置 API 在不在（只看有没有，不看模型下没下） */
    function baiSupport() {
        return {
            translator: !!baiApi('translator'),
            lm: !!baiApi('lm'),
            detector: !!baiApi('detector'),
        };
    }

    function baiPair() {
        const src = langCode(CFG.srcLang);
        const tgt = langCode(CFG.tgtLang);
        if (!src || !tgt) return null;
        return { src: src, tgt: tgt };
    }

    function baiPairOrThrow() {
        const p = baiPair();
        if (p) return p;
        throw new Error('认不出「' + (CFG.srcLang || '空') + ' / ' + (CFG.tgtLang || '空')
            + '」对应的语言代码 —— 请在面板「语言」里填标准写法，'
            + '例如 日语 / 简体中文 / 英语 / 韩语');
    }

    /** 内置 AI 只对顶层窗口和同源 iframe 开放，这里给出一句人话说明 */
    function baiFrameNote() {
        if (isTopFrame()) return '';
        try {
            // 能读到 top 的 location 就是同源 iframe，权限和顶层一样
            void window.top.location.href;
            return '';
        } catch (e) {
            return '当前页面是跨域 iframe —— 浏览器默认不允许在这里使用内置 AI，'
                + '请把视频页面单独打开（或改用 Umi-OCR 引擎）';
        }
    }

    /** availability() 包一层：API 不存在或抛错都不该让调用方崩掉 */
    async function baiAvailability(kind, opts) {
        const api = baiApi(kind);
        if (!api || typeof api.availability !== 'function') return 'unsupported';
        try {
            return await api.availability(opts || {});
        } catch (e) {
            warn('内置 AI availability 探测失败：', e);
            return 'error';
        }
    }

    function baiAvailText(v) {
        return BAI_AVAIL_TEXT[v] || String(v || '未知');
    }

    function baiNiceError(e, pair) {
        const m = String((e && e.message) || e || '');
        const name = String((e && e.name) || '');
        // 会话被 destroy() 会把在飞的 translate() 打断。正常路径不该发生（见 baiCache 的说明），
        if (baiIsAbort(e)) {
            return '翻译被中断了（端侧会话被重建：多半是刚改过语言/引擎设置，或页面正在切走）'
                + '—— 重新点「准备离线模型」，或重新点「开始」即可';
        }
        if (/generic failures occurred/i.test(m)) {
            return '这个浏览器的内置翻译不支持「' + baiPairText(pair) + '」这个语言对'
                + '（Edge 上「日语 → 中文」必报 Generic failures）。'
                + '三条出路：勾选「语言对不可用时经英语中转」、改用 Chrome、或换其它翻译引擎';
        }
        if (/user gesture/i.test(m)) {
            return '离线模型还没下载好 —— 请点面板上的「准备离线模型」'
                + '（浏览器只在用户点击时允许下载模型）';
        }
        if (/permissions policy|disallowed by permissions|not allowed/i.test(m)) {
            return '这个页面不允许使用内置 AI（跨域 iframe 默认被禁）'
                + '—— 请把视频页面单独打开，或改用其它引擎';
        }
        if (/NetworkError/i.test(m)) return '模型下载失败，请检查网络后重试：' + m;
        if (/EncodingError|SecurityError/i.test(m)) {
            return '截图喂不进端侧模型（画布跨域或被污染）：' + m;
        }
        return m || '浏览器内置 AI 调用失败';
    }

    function baiPairText(pair) {
        if (!pair) return (CFG.srcLang || '?') + ' → ' + (CFG.tgtLang || '?');
        return (CFG.srcLang || pair.src) + ' → ' + (CFG.tgtLang || pair.tgt);
    }

    // ── 语言对直连是否可用 ────────────────────────────────────
    //  有些语言对是**坏的**：availability() 说 downloadable/available、create() 也成功，真去 translate()
    //  才抛 UnknownError（Edge 的 ja→中文 就是这样）—— 只能"撞一次才知道"，撞到就记下来，别每帧再撞。

    /** 记录「哪些语言对直连是坏的」：{ 'ja>zh': '错误原文' } */
    const baiBrokenPairs = {};

    function baiPairKey(pair) {
        return pair.src + '>' + pair.tgt;
    }

    /** 这个错误是不是"语言对本身不可用"，而不是网络 / 权限 / 手势问题 */
    function baiIsPairFailure(e) {
        const m = String((e && e.message) || e || '');
        if (/generic failures occurred/i.test(m)) return true;
        // Edge 抛的是 UnknownError，但网络类错误也是 UnknownError，所以限定在没有网络/权限字样时才算
        const name = String((e && e.name) || '');
        return name === 'UnknownError' && !/network|permission|gesture|quota/i.test(m);
    }

    /** 能不能经英语中转：开关开着、且两边都不是英语（英语↔x 不需要中转） */
    function baiMayPivot(pair) {
        return !!CFG.baiPivot && pair.src !== 'en' && pair.tgt !== 'en';
    }

    // ── 会话缓存 ──────────────────────────────────────────────
    //  必须复用：每次翻译都 create() 一遍等于把模型反复加载，单句耗时会从几十毫秒涨到几百毫秒。
    //  ⚠️ 按「用途 + 语言对」存**多个**会话，而不是每用途一个槽位：「经英语中转」要同时用到 ja→en 和
    //     en→zh，只留一个槽位时建第二个会把第一个 destroy() 掉，而 destroy() 会**打断在飞的 translate()**，
    //     真机上直接报 AbortError（Edge 上 ja→中文 必须走中转，所以这个问题在 Edge 上是必现的）。
    const baiCache = new Map();          // '用途|语言对' -> 会话实例
    const BAI_CACHE_MAX = 8;             // 兜底上限；换配置时 baiReset() 会全部清掉

    function baiDrop(inst) {
        try { if (inst && typeof inst.destroy === 'function') inst.destroy(); } catch (e) { }
    }

    /** 按「用途 + key」复用会话；不同 key 各存各的，不会互相销毁 */
    function baiReuse(slot, key, make) {
        const id = slot + '|' + key;
        if (baiCache.has(id)) {
            const inst = baiCache.get(id);
            // 命中的挪到队尾（Map 迭代顺序 = 插入顺序），淘汰时丢最久没用的
            baiCache.delete(id);
            baiCache.set(id, inst);
            return Promise.resolve(inst);
        }
        return Promise.resolve().then(make).then((inst) => {
            baiCache.set(id, inst);
            // 实际到不了这个上限：一个配置下最多同时存在 3 个会话（直连 1 个 + 中转 2 个）
            while (baiCache.size > BAI_CACHE_MAX) {
                const oldest = baiCache.keys().next().value;
                baiDrop(baiCache.get(oldest));
                baiCache.delete(oldest);
            }
            return inst;
        });
    }

    /** 关掉所有会话，下次用的时候重建。换语言 / 换模式 / 用户点「重置」时调 */
    function baiReset() {
        for (const inst of baiCache.values()) baiDrop(inst);
        baiCache.clear();
        log('已释放浏览器内置 AI 会话');
    }

    function baiForget(slot, key) {
        const id = slot + '|' + key;
        if (!baiCache.has(id)) return;
        const inst = baiCache.get(id);
        baiCache.delete(id);
        baiDrop(inst);
    }

    /** 把某个语言对相关的翻译会话全丢掉（直连那个 + 中转那两个） */
    function baiForgetPair(pair) {
        baiForget('translator', pair.src + '>' + pair.tgt);
        if (pair.src !== 'en') baiForget('translator', pair.src + '>en');
        if (pair.tgt !== 'en') baiForget('translator', 'en>' + pair.tgt);
    }

    function baiIsAbort(e) {
        return String((e && e.name) || '') === 'AbortError'
            || /aborted without reason/i.test(String((e && e.message) || ''));
    }

    /** 下载进度事件 → 面板上的进度条（tag 决定文案） */
    const BAI_TAG_NAME = { trans: '内置翻译模型', text: '内置大模型', ocr: '多模态读图模型' };

    function baiMonitorFor(tag, done) {
        return (m) => {
            try {
                m.addEventListener('downloadprogress', (e) => {
                    const pct = Math.max(0, Math.min(1, Number(e.loaded) || 0));
                    done((BAI_TAG_NAME[tag] || '模型') + ' 下载中 ' + Math.round(pct * 100) + '%', pct);
                });
            } catch (e) { /* 监控器不是必须的，加不上就算了 */ }
        };
    }

    // ── 三种会话 ──────────────────────────────────────────────

    /** 内置翻译模型（Translator）。语言对不支持时返回 null，由调用方决定是退回大模型还是直接报错。 */
    async function baiTranslatorSession(pair, opts) {
        const tr = baiApi('translator');
        if (!tr) return null;
        const avail = await baiAvailability('translator', {
            sourceLanguage: pair.src, targetLanguage: pair.tgt,
        });
        if (avail === 'unavailable' || avail === 'unsupported' || avail === 'error') return null;

        const done = (opts && opts.onProgress) || null;
        const key = pair.src + '>' + pair.tgt;
        return await baiReuse('translator', key, async () => {
            try {
                return await tr.create({
                    sourceLanguage: pair.src,
                    targetLanguage: pair.tgt,
                    monitor: done ? baiMonitorFor('trans', done) : undefined,
                });
            } catch (e) {
                throw new Error(baiNiceError(e));
            }
        });
    }

    /** 内置大模型（Prompt API）做**文本**翻译。刻意不写 expectedOutputs：端侧模型声明支持的语言里
     *  没有中文，一旦声明 zh 就会让 availability() 变成 unavailable（Chrome 153 实测），只能靠提示词引导。 */
    async function baiTextSession(pair, opts) {
        const lm = baiApi('lm');
        if (!lm) {
            throw new Error('这台浏览器没有内置大模型（Prompt API）—— 请改用别的翻译引擎');
        }
        const done = (opts && opts.onProgress) || null;
        return await baiReuse('text', 'text|' + pair.src + '>' + pair.tgt, async () => {
            const options = {
                initialPrompts: [{
                    role: 'system',
                    content: '你是专业的影视字幕翻译。把用户给出的' + (CFG.srcLang || pair.src)
                        + '字幕翻译成' + (CFG.tgtLang || pair.tgt) + '。'
                        + '只输出译文本身：不要解释、不要注音、不要重复原文、不要加引号。'
                        + '译文要简洁口语化，符合字幕阅读习惯。',
                }],
            };
            if (done) options.monitor = baiMonitorFor('text', done);
            try {
                return await lm.create(options);
            } catch (e) {
                throw new Error(baiNiceError(e));
            }
        });
    }

    /** 多模态读图会话：直接把截图交给端侧模型认字（不翻译），按「源语言」声明输入语言。
     *  中文不在端侧模型支持列表里，所以源语言是中文时这条路走不通，报错让用户换 Umi-OCR。 */
    async function baiOcrSession(opts) {
        const lm = baiApi('lm');
        if (!lm) {
            throw new Error('这台浏览器没有内置多模态模型（Prompt API）—— '
                + '「浏览器内置读图」用不了，请把「识别方式」改成 Umi-OCR 本地识别');
        }
        const src = langCode(CFG.srcLang) || 'ja';
        const expectedInputs = [{ type: 'text', languages: [src] }, { type: 'image' }];

        const avail = await baiAvailability('lm', { expectedInputs: expectedInputs });
        if (avail === 'unavailable' || avail === 'unsupported' || avail === 'error') {
            throw new Error('端侧模型不支持「看图 + ' + src + '」这种输入 —— '
                + '请把「识别方式」改成 Umi-OCR 本地识别');
        }
        const done = (opts && opts.onProgress) || null;
        return await baiReuse('ocr', 'img|' + src, async () => {
            const options = {
                expectedInputs: expectedInputs,
                initialPrompts: [{ role: 'system', content: BAI_OCR_SYSTEM }],
            };
            if (done) options.monitor = baiMonitorFor('ocr', done);
            try {
                return await lm.create(options);
            } catch (e) {
                throw new Error(baiNiceError(e));
            }
        });
    }

    // ── 准备 / 探测 ───────────────────────────────────────────

    /**
     * 把当前设置需要的会话全部建好（该下载的顺便下载）。
     * ⚠️ 必须在**用户点击的调用栈**里调用：模型还没下载时 Chrome 只在有用户手势时允许 create()。
     * @param {(msg:string, ratio:number)=>void} [onProgress] 进度回调，ratio 到 1 表示结束
     * @returns {Promise<string[]>} 准备好的东西，用于在面板上汇报
     */
    async function baiPrepare(onProgress) {
        const done = (msg, ratio) => { try { onProgress && onProgress(msg, ratio); } catch (e) { } };
        const api = baiSupport();
        if (!api.translator && !api.lm) {
            const ver = baiBrowser();
            throw new Error('这台浏览器没有内置 AI —— 需要 ' + ver.required
                + '（当前 ' + ver.text + '），且页面必须是 HTTPS 或 localhost');
        }
        const verNote = baiVersionNote();

        const pair = baiPairOrThrow();
        const ready = [];
        // 版本不达标时先说清楚（下面照样继续准备：某些语言对可能还能用）
        if (verNote) ready.push(verNote);

        if (CFG.baiOcr === 'builtin') {
            done('正在准备多模态读图模型…', 0);
            await baiOcrSession({ onProgress: done });
            ready.push('多模态读图');
        }

        if (pair.src === pair.tgt) {
            done('', 1);
            ready.push('源语言与目标语言相同（不需要模型）');
            return ready;
        }

        const trans = CFG.baiTrans || 'auto';
        let gotTranslator = false;
        if (trans !== 'prompt' && api.translator) {
            done('正在准备内置翻译模型…', 0);
            const t = await baiTranslatorSession(pair, { onProgress: done });
            gotTranslator = !!t;
            if (gotTranslator) ready.push('内置翻译模型（' + pair.src + ' → ' + pair.tgt + '）');
            else if (trans === 'translator') {
                throw new Error('内置翻译模型不支持 ' + pair.src + ' → ' + pair.tgt
                    + ' 这个语言对 —— 请把「翻译方式」改成「自动」或别的引擎');
            }
        }

        // 会话建好不等于能翻：Edge 上「日语 → 中文」是 create() 成功、translate() 才抛
        // UnknownError。所以在这里真跑一句自检（此刻还在用户手势里，主循环里就没有手势了）。
        if (gotTranslator) {
            const pk = baiPairKey(pair);
            let usable = true;
            try {
                await (await baiTranslatorSession(pair)).translate('Test');
                delete baiBrokenPairs[pk];
            } catch (e) {
                usable = false;
                if (!baiIsPairFailure(e)) throw new Error(baiNiceError(e, pair));
                baiBrokenPairs[pk] = String((e && e.message) || e);

                if (!baiMayPivot(pair)) {
                    throw new Error('这个浏览器的内置翻译不支持「' + baiPairText(pair) + '」这个语言对'
                        + '（' + baiBrokenPairs[pk] + '）。'
                        + '请勾选「语言对不可用时经英语中转」，或改用 Chrome / 其它翻译引擎');
                }
                done('直连不可用，正在准备经英语中转的模型…', 0);
                const toEn = await baiTranslatorSession({ src: pair.src, tgt: 'en' }, { onProgress: done });
                const fromEn = await baiTranslatorSession({ src: 'en', tgt: pair.tgt }, { onProgress: done });
                if (!toEn || !fromEn) {
                    throw new Error('「' + baiPairText(pair) + '」直连不可用，经英语中转的模型也备不齐'
                        + ' —— 请改用 Chrome 或其它翻译引擎');
                }
                ready.push('⚠️ 直连不可用，已改走经英语中转（'
                    + pair.src + ' → en → ' + pair.tgt + '），译文质量会略降');
            }
            if (usable) ready[ready.length - 1] = '内置翻译模型（' + pair.src + ' → ' + pair.tgt + '）✅ 自检通过';
        }

        if (!gotTranslator) {
            done('正在准备内置大模型…', 0);
            await baiTextSession(pair, { onProgress: done });
            ready.push('内置大模型（文本翻译）');
        }

        done('', 1);
        return ready;
    }

    /** 环境探测：一次问清「能不能用、缺什么、要不要下载」；只查询可用性，不下载、不建会话。 */
    async function baiProbe() {
        const rows = [];
        const add = (label, value, kind) => rows.push({ label: label, value: value, kind: kind || 'info' });
        const api = baiSupport();

        const ver = baiBrowser();
        add('浏览器内核', ver.known
            ? (ver.text + (ver.ok ? '（满足 ' + ver.required + '）' : '（⚠️ 低于 ' + ver.required + '）'))
            : (ver.text + '（内置 AI 只在 ' + ver.required + ' 上提供）'),
            ver.ok ? 'ok' : 'bad');

        add('Translator（端侧翻译）', api.translator ? '支持' : '不支持', api.translator ? 'ok' : 'bad');
        add('LanguageModel（端侧多模态）', api.lm ? '支持' : '不支持', api.lm ? 'ok' : 'bad');
        add('LanguageDetector（语种检测）', api.detector ? '支持' : '不支持', api.detector ? 'ok' : 'warn');

        let secure = false;
        try { secure = !!window.isSecureContext; } catch (e) { }
        add('安全上下文', secure ? '是' : '否（需要 HTTPS 或 localhost）', secure ? 'ok' : 'bad');

        const frameNote = baiFrameNote();
        add('顶层 / 同源框架', frameNote ? '跨域 iframe' : '是', frameNote ? 'bad' : 'ok');

        const pair = baiPair();
        if (!pair) {
            add('语言方向', '认不出「' + (CFG.srcLang || '空') + ' / ' + (CFG.tgtLang || '空')
                + '」，请填标准语言名', 'bad');
            return rows;
        }
        add('语言方向', pair.src + ' → ' + pair.tgt, 'info');

        // 坏语言对只有真跑一句才知道（见 baiBrokenPairs），这里只汇报"已经试出来"的结果，不偷偷发翻译请求。
        const broken = baiBrokenPairs[baiPairKey(pair)];
        if (broken) {
            add('语言对直连', baiMayPivot(pair)
                ? '❌ 不支持（已改走经英语中转）'
                : '❌ 不支持（可勾选「经英语中转」绕过）', 'warn');
        }

        if (api.translator) {
            const a = await baiAvailability('translator', {
                sourceLanguage: pair.src, targetLanguage: pair.tgt,
            });
            add('内置翻译模型', baiAvailText(a), a === 'available' || a === 'downloadable' || a === 'downloading' ? 'ok' : 'bad');
        }
        if (api.lm) {
            const a = await baiAvailability('lm', {});
            add('内置大模型（文本）', baiAvailText(a), a === 'available' || a === 'downloadable' || a === 'downloading' ? 'ok' : 'bad');

            const srcCode = langCode(CFG.srcLang) || 'ja';
            const ai = await baiAvailability('lm', {
                expectedInputs: [{ type: 'text', languages: [srcCode] }, { type: 'image' }],
            });
            add('内置多模态读图（' + srcCode + '）', baiAvailText(ai),
                ai === 'available' || ai === 'downloadable' || ai === 'downloading' ? 'ok' : 'bad');
        } else if (api.translator) {
            // Edge 就是这样：只有 Translator，没有 Prompt API
            add('兜底能力', '没有 Prompt API —— 语言对一旦不支持就没有端侧大模型可退', 'warn');
        }
        return rows;
    }

    // ── 翻译 ─────────────────────────────────────────────────

    /** 流式分片拼接：Chrome 现在给的是「累计文本」（每块都从头开始），但规范讨论过改成「增量」，
     *  两种都认，免得哪天升级就串字。 */
    function baiJoinChunk(acc, chunk) {
        const c = String(chunk == null ? '' : chunk);
        if (!c) return acc;
        if (c.indexOf(acc) === 0) return c;
        return acc + c;
    }

    /** 会话支持流式且有回调时走流式，返回累计文本；否则返回 null（调用方走一次性调用） */
    async function baiStreamTo(session, method, input, onDelta) {
        if (!onDelta || typeof session[method] !== 'function') return null;
        let it;
        try { it = session[method](input); } catch (e) { return null; }
        if (!it || typeof it[Symbol.asyncIterator] !== 'function') return null;
        let acc = '';
        for await (const chunk of it) {
            acc = baiJoinChunk(acc, chunk);
            if (acc) onDelta(acc);
        }
        return acc;
    }

    /**
     * 压掉「同一个短片段连续重复很多次」的退化输出：端侧模型遇到「ああっああっああっ」这种纯拟声字幕会失控 ——
     * 实测 18 字原文 `ja→en` 吐 971 字 `"Oh, oh, oh…"`，再过一遍 `en→zh` 被放大成 3613 字、耗时 5.6 秒，
     * 悬浮层直接被刷满整屏。压成两遍既保住语义又不糊满画面（阈值「单元 1~6 字符 + 重复 ≥5 次」，
     * 「谢谢谢谢」这种正常四连重复不会误伤）。
     */
    function baiCollapseRepeat(text) {
        const s = String(text == null ? '' : text);
        if (s.length < 24) return s;      // 短文本不可能构成「超长重复」
        return s.replace(/([\s\S]{1,6}?)\1{4,}/g, '$1$1');
    }

    /** 译文收尾：去残留引号 → 压退化重复 → 长度兜底（三条都是针对端侧模型的坏习惯，正常输出原样返回）。 */
    function baiPolish(out, source) {
        let s = String(out == null ? '' : out).trim();
        // 模型常常只在一头加引号（"哦,哦,哦…），stripWrappingQuotes 要求两头都有，所以这里也去掉单边残留
        s = s.replace(/^["“”'‘’「『]+/, '').replace(/["“”'‘’」』]+$/, '').trim();
        s = baiCollapseRepeat(s);
        // 压完常常留一个尾逗号（"哦,哦,"），显示出来很别扭
        s = s.replace(/[,，、;；:：]+$/, '').trim();
        // 压完仍长得离谱就截断：字幕放不下，再长也没意义
        const cap = Math.max(80, String(source == null ? '' : source).length * 4);
        if (s.length > cap) {
            s = s.slice(0, cap).replace(/[,，、;；:：\s]+$/, '') + '…';
        }
        return s.trim();
    }

    /** 只用内置翻译模型翻一句。语言对不支持（或没有 Translator）时返回 null。 */
    async function baiViaTranslator(text, pair, onDelta) {
        const t = await baiTranslatorSession(pair);
        if (!t) return null;
        const s = await baiStreamTo(t, 'translateStreaming', text, onDelta);
        return (s === null) ? await t.translate(text) : s;
    }

    /**
     * 经英语中转：原文 → 英语 → 目标语言。Edge 上「日语 → 中文」直连必失败，但 ja→en 和 en→zh 两条腿都是
     * 好的，中转就成了唯一还能离线跑通的路；代价是过两道翻译，语气和专有名词会比直连差，所以只在直连
     * 确认失败后才用（不是默认路径）。流式只用在第二段：第一段的英语产物没有显示价值。
     */
    async function baiPivotTranslate(text, pair, onDelta) {
        const toEn = await baiTranslatorSession({ src: pair.src, tgt: 'en' });
        const fromEn = await baiTranslatorSession({ src: 'en', tgt: pair.tgt });
        if (!toEn || !fromEn) return null;

        const midRaw = await toEn.translate(text);
        if (!midRaw || !String(midRaw).trim()) return null;
        // 第一段同样会失控（实测 18 字原文 → 971 字的 "Oh, oh, oh…"），
        // 不在这里压掉的话，它会被第二段**放大一轮**（→ 3613 字、5.6 秒）
        const mid = baiCollapseRepeat(String(midRaw).trim());

        const s = await baiStreamTo(fromEn, 'translateStreaming', mid, onDelta);
        return (s === null) ? await fromEn.translate(mid) : s;
    }

    /** 把一句原文翻成目标语言（全离线）。
     *  @param {{onDelta?:(partial:string)=>void}} [opts] onDelta 收到的是**累计**译文 */
    async function baiTranslate(text, opts) {
        const clean = String(text == null ? '' : text).trim();
        if (!clean) return '';
        const onDelta = opts && opts.onDelta;

        const pair = baiPairOrThrow();
        if (pair.src === pair.tgt) return clean;

        const trans = CFG.baiTrans || 'auto';
        const pivot = !!CFG.baiPivot;
        // 中转开关也进 key：关掉之后不该命中"中转出来的"旧译文
        const key = 'bai|' + trans + '|' + (pivot ? 'p' : 'd') + '|' + baiPairKey(pair) + '|' + clean;
        const hit = cacheGet(key);
        if (hit !== undefined) {
            if (onDelta) onDelta(hit);
            return hit;
        }

        const pk = baiPairKey(pair);
        let out = null;

        if (trans !== 'prompt') {
            // 已经知道这个语言对直连是坏的，就别每帧再去撞一次同样的错
            if (!baiBrokenPairs[pk]) {
                try {
                    out = await baiViaTranslator(clean, pair, onDelta);
                } catch (e) {
                    // 会话被销毁过（AbortError）→ 丢掉重建，否则后面每一句都会继续失败
                    if (baiIsAbort(e)) baiForgetPair(pair);
                    if (!baiIsPairFailure(e) || !baiMayPivot(pair)) {
                        throw new Error(baiNiceError(e, pair));
                    }
                    baiBrokenPairs[pk] = String((e && e.message) || e);
                    warn('内置翻译不支持语言对 ' + pk + '（' + baiBrokenPairs[pk] + '），改用经英语中转');
                    out = null;
                }
            }
            if (out !== null) {
                // 直连这次成功了，说明之前记的"坏了"已经过期
                if (baiBrokenPairs[pk]) delete baiBrokenPairs[pk];
            } else if (baiMayPivot(pair)) {
                try {
                    out = await baiPivotTranslate(clean, pair, onDelta);
                } catch (e) {
                    if (baiIsAbort(e)) baiForgetPair(pair);
                    throw new Error(baiNiceError(e, pair));
                }
                if (out === null) {
                    throw new Error('「' + baiPairText(pair) + '」在经英语中转后仍然失败'
                        + '—— 请改用 Chrome 或其它翻译引擎');
                }
            } else if (trans === 'translator') {
                throw new Error('内置翻译不支持「' + baiPairText(pair) + '」这个语言对'
                    + '（Edge 上「日语 → 中文」就是这样）。'
                    + '请勾选「语言对不可用时经英语中转」，或改用 Chrome / 其它引擎');
            }
        }

        if (out === null) {
            const s = await baiTextSession(pair);
            const prompt = '把下面这句' + (CFG.srcLang || pair.src) + '字幕翻译成'
                + (CFG.tgtLang || pair.tgt) + '，只输出译文：\n' + clean;
            out = await baiStreamTo(s, 'promptStreaming', prompt, onDelta);
            if (out === null) out = await s.prompt(prompt);
        }

        const result = baiPolish(out, clean);
        cachePut(key, result);
        return result;
    }

    // ── 识别 ─────────────────────────────────────────────────

    /** 画布 → Blob。转一手是为了**快照**：captureMode 下画布是复用的，直接把 canvas 交给异步的
     *  模型调用，像素可能已经被下一帧盖掉。⚠️ 调用方必须在 await 任何东西**之前**调用它
     *  （见 baiOcrByBuiltin 里的说明），否则这个快照本身就失去意义。
     *  质量取 0.9：产物只喂给端侧模型，**不经过网络、不按字节计费**，所以不必像
     *  上传云端那几条路一样压到 0.85（详见 32-util.js 的 canvasToJpeg）。 */
    function baiCanvasBlob(canvas) {
        return new Promise((resolve, reject) => {
            let done = false;
            const fail = (msg) => { if (!done) { done = true; reject(new Error(msg)); } };
            const timer = setTimeout(() => fail('截图编码超时'), 8000);
            try {
                canvas.toBlob((b) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (b) resolve(b);
                    else reject(new Error('截图编码失败（画布是空的？）'));
                }, 'image/jpeg', 0.9);
            } catch (e) {
                clearTimeout(timer);
                fail('读不到截图像素（视频跨域？）：' + (e && e.message || e));
            }
        });
    }

    /** 模型偶尔会附带解说 / 代码块 / 引号，这里清干净 */
    function baiCleanOcr(txt) {
        let s = String(txt == null ? '' : txt).trim();
        s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
        s = s.replace(/^(?:图中(?:的)?文字(?:是|为)?|识别结果|文字内容|字幕内容)\s*[:：]\s*/, '');
        s = stripWrappingQuotes(s);
        s = s.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (/^(?:无文字|没有文字|无|空|none|n\/a|\(无\)|（无）)$/i.test(s)) return '';
        return s;
    }

    async function baiOcrByBuiltin(canvas) {
        // ⚠️ 顺序很重要：必须**先**把画布转成 blob（= 快照），再 await 会话。
        //    captureMode 下 canvas 是复用画布（Capturer._out），而 baiOcrSession()
        //    首次调用可能要去初始化/加载模型、耗时数秒；在它让出事件循环期间，
        //    UI.manualShot() 或框选拖拽的预览截图会把同一张画布的像素盖掉 ——
        //    那样识别到的就是**另一帧**，属于静默出错（本项目最忌讳的那类）。
        //    原来这两行是反的，与 baiCanvasBlob 上方"转一手是为了快照"的注释自相矛盾。
        const blob = await baiCanvasBlob(canvas);
        const session = await baiOcrSession();
        let out;
        try {
            out = await session.prompt([{
                role: 'user',
                content: [
                    { type: 'text', value: '请把这张字幕截图里的文字原样抄出来。' },
                    // 图片必须以内容块的形式放在 user 消息里
                    { type: 'image', value: blob },
                ],
            }]);
        } catch (e) {
            throw new Error(baiNiceError(e));
        }
        return baiCleanOcr(out);
    }

    /** 离线引擎的统一入口：识别（Umi-OCR 或端侧多模态）→ 端侧翻译，返回值与其它引擎一致。 */
    async function recognizeByBrowserAI(canvas, opts) {
        const onDelta = opts && opts.onDelta;
        const useBuiltin = CFG.baiOcr === 'builtin';

        const original = useBuiltin
            ? await baiOcrByBuiltin(canvas)
            : await callUmiOCR(canvasToJpeg(canvas, 0.92));

        if (!original) return { original: '', translation: '' };

        // 把原文一并交给流式回调，好让悬浮层在"边生成边出字"时也能显示原文
        const wrapped = onDelta ? (partial) => onDelta(partial, original) : undefined;
        return { original: original, translation: await baiTranslate(original, { onDelta: wrapped }) };
    }
