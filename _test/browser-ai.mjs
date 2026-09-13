// 浏览器内置 AI（离线引擎）测试
//
// 真实的内置 AI 模型需要下载（几百 MB，且必须在用户手势里触发），
// 不适合放进每次都要跑的测试里。所以这里给 Translator / LanguageModel
// 打一套**行为一致**的替身：availability / create / translate /
// translateStreaming / prompt / promptStreaming / destroy 都有，
// 并且故意模仿真实实现里三个容易踩坑的细节：
//   · 分片既有"增量"式也有"累计"式（Chrome 现在是累计，规范讨论过改增量）
//   · 模型没下载时 create() 会拒绝并报 "Requires a user gesture…"
//   · 坏语言对是 create() 成功、translate() 才抛 UnknownError（Edge 的 ja→中文）
//
// 于是能覆盖到：语言映射、内核版本门槛、能力探测、全离线链路（不发出任何
// 网络请求）、会话复用、多模态读图、流式拼接与节流、经英语中转、准备阶段
// 自检、回退与错误提示、面板联动、诊断报告。
import { Cdp, startServer } from './cdp.mjs';
import { PAGES, readUserscript } from './paths.mjs';

const USERSCRIPT = readUserscript();
const PORT = 8781;
const BASE = `http://127.0.0.1:${PORT}`;

const PRELUDE = `
(function () {
    /* ---------------- GM_* 桩 ---------------- */
    const store = window.__gmStore = {};
    window.__gmReqs = [];
    window.GM_getValue = function (k, d) { return (k in store) ? store[k] : d; };
    window.GM_setValue = function (k, v) { store[k] = v; };
    window.GM_registerMenuCommand = function () {};
    window.__gmResponse = null;
    window.__umiText = 'おはようございます';
    window.GM_xmlhttpRequest = function (opts) {
        let body = null;
        try { body = JSON.parse(opts.data); } catch (e) { body = opts.data; }
        window.__gmReqs.push({
            url: opts.url, method: opts.method || 'POST',
            headers: opts.headers, body: body, raw: opts.data,
        });
        // Umi-OCR：按 URL 回一条识别结果，走真实的 callUmiOCR 代码路径
        if (/\\/api\\/ocr/.test(opts.url)) {
            const text = window.__umiText;
            setTimeout(function () {
                opts.onload && opts.onload({
                    status: 200,
                    responseText: JSON.stringify({ code: 100, data: text, time: 0.1 }),
                });
            }, 3);
            return;
        }
        // 离线引擎不该打任何别的接口 —— 打到了就让用例失败
        setTimeout(function () {
            opts.onerror && opts.onerror(new Error('离线引擎不该请求 ' + opts.url));
        }, 0);
    };

    /* ---------------- 内置 AI 替身 ---------------- */
    const B = window.__bai = {
        state: {
            gestureFail: false,      // 模拟"模型没下载、需要用户手势"
            lmUnavailable: false,    // 模拟多模态不可用
            transPair: {},           // 'ja>zh' -> 'unavailable'
            transReply: null,        // null = 回显式回复 '译:' + 原文
            ocrReply: 'おはようございます',
            replyMap: {},            // 'ja>en' -> 'Hello'（按语言对定制回复）
            brokenPairs: {},         // 'ja>zh' -> true（模拟 Edge 那种"直连必失败"）
            abortAll: false,         // 让所有 translate() 报 AbortError（模拟会话被销毁）
        },
        translatorCreated: 0,
        translatorDestroyed: 0,
        lmCreated: 0,
        lmDestroyed: 0,
        translatorTexts: [],
        translateCalls: {},          // 'ja>zh' -> 调了几次 translate
        lmInputs: [],
        lastTranslatorOpts: null,
        lastLmOpts: null,
        reset: function () {
            this.translatorCreated = 0;
            this.translatorDestroyed = 0;
            this.lmCreated = 0;
            this.lmDestroyed = 0;
            this.translatorTexts.length = 0;
            this.translateCalls = {};
            this.lmInputs.length = 0;
            this.lastTranslatorOpts = null;
            this.lastLmOpts = null;
        },
    };

    function asyncIterable(chunks) {
        let i = 0;
        return {
            [Symbol.asyncIterator]: function () {
                return {
                    next: function () {
                        if (i >= chunks.length) return Promise.resolve({ done: true });
                        return Promise.resolve({ done: false, value: chunks[i++] });
                    },
                };
            },
        };
    }

    function gestureError() {
        return new DOMException(
            'Requires a user gesture when availability is "downloadable".',
            'NotAllowedError');
    }

    window.Translator = {
        availability: function (opts) {
            const k = opts && (opts.sourceLanguage + '>' + opts.targetLanguage);
            return Promise.resolve(B.state.transPair[k] || 'downloadable');
        },
        create: function (opts) {
            if (B.state.gestureFail) return Promise.reject(gestureError());
            B.translatorCreated++;
            const key = opts.sourceLanguage + '>' + opts.targetLanguage;
            B.lastTranslatorOpts = {
                sourceLanguage: opts.sourceLanguage,
                targetLanguage: opts.targetLanguage,
            };
            const reply = function (text) {
                if (B.state.replyMap && B.state.replyMap[key] !== undefined) {
                    return B.state.replyMap[key];
                }
                return (B.state.transReply === null || B.state.transReply === undefined)
                    ? ('译:' + text) : B.state.transReply;
            };
            // 模拟"这个语言对是坏的"：create() 成功，translate() 才抛
            // （Edge 的 ja→中文 就是这样 —— 只探测 availability 看不出来）
            const guard = function () {
                return (B.state.brokenPairs && B.state.brokenPairs[key])
                    ? new DOMException('Other generic failures occurred.', 'UnknownError')
                    : null;
            };
            // 真实实现里 destroy() 会把在飞的 translate() 直接打断（AbortError），
            // 之后这个会话也不能再用了。替身必须照做 —— 否则"拿一个已经销毁的
            // 会话去翻译"这种 bug 在测试里根本看不出来（真机上就是这么炸的）。
            let dead = false;
            const guardDead = function () {
                if (B.state.abortAll) {
                    return new DOMException('signal is aborted without reason', 'AbortError');
                }
                return dead
                    ? new DOMException('signal is aborted without reason', 'AbortError')
                    : null;
            };
            return Promise.resolve({
                key: key,
                translate: function (text) {
                    B.translatorTexts.push(text);
                    B.translateCalls[key] = (B.translateCalls[key] || 0) + 1;
                    const gone = guardDead();
                    if (gone) return Promise.reject(gone);
                    const bad = guard();
                    if (bad) return Promise.reject(bad);
                    return Promise.resolve(reply(text));
                },
                translateStreaming: function (text) {
                    B.translatorTexts.push(text);
                    B.translateCalls[key] = (B.translateCalls[key] || 0) + 1;
                    const bad = guardDead() || guard();
                    if (bad) {
                        // 真实实现里流式也是走到取结果时才抛
                        return {
                            [Symbol.asyncIterator]: function () {
                                return { next: function () { return Promise.reject(bad); } };
                            },
                        };
                    }
                    // 增量式：每次只吐一个字
                    return asyncIterable(reply(text).split(''));
                },
                destroy: function () {
                    dead = true;
                    B.translatorDestroyed++;
                },
            });
        },
    };

    window.LanguageModel = {
        availability: function () {
            return Promise.resolve(B.state.lmUnavailable ? 'unavailable' : 'downloadable');
        },
        create: function (opts) {
            if (B.state.gestureFail) return Promise.reject(gestureError());
            B.lmCreated++;
            const inputs = (opts && opts.expectedInputs) || [];
            B.lastLmOpts = {
                expectedInputs: opts && opts.expectedInputs,
                initialPrompts: opts && opts.initialPrompts,
            };
            const isOcr = inputs.some(function (x) { return x.type === 'image'; });
            const reply = function () {
                return isOcr ? B.state.ocrReply : (B.state.transReply || '大模型译文');
            };
            return Promise.resolve({
                isOcr: isOcr,
                prompt: function (input) {
                    B.lmInputs.push(input);
                    return Promise.resolve(reply());
                },
                promptStreaming: function (input) {
                    B.lmInputs.push(input);
                    // 累计式：每块都从头开始（Chrome 当前的行为）
                    const full = reply();
                    const chunks = [];
                    for (let i = 1; i <= full.length; i++) chunks.push(full.slice(0, i));
                    return asyncIterable(chunks);
                },
                destroy: function () { B.lmDestroyed++; },
            });
        },
    };

    window.LanguageDetector = {
        availability: function () { return Promise.resolve('downloadable'); },
        create: function () { return Promise.resolve({}); },
    };
})();
`;

const R = [];
let suite = '';
const S = n => { suite = n; console.log('\n── ' + n + ' ──'); };
function check(name, pass, detail) {
    R.push({ suite, name, pass: !!pass });
    console.log(`  ${pass ? 'OK  ' : 'BAD '} ${name}${pass || !detail ? '' : '  <- ' + detail}`);
    return !!pass;
}

const srv = await startServer({ port: PORT, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: 9381 });

try {
    const { sessionId } = await cdp.newPage();
    await cdp.addInitScript(PRELUDE, sessionId);
    await cdp.addInitScript(USERSCRIPT, sessionId);
    await cdp.navigate(sessionId, `${BASE}/lab.html?mode=canvas`,
        { waitFor: 'window.__H1SUB__ && window.__lab && window.__lab.ready', timeoutMs: 25000 });

    const ev = (e, o = {}) => cdp.evaluate(e, { sessionId, ...o });
    const evAsync = (e) => cdp.evaluate(e, { sessionId, awaitPromise: true });

    // ─────────────────────────────────────────────
    S('1. 语言名 → BCP-47 标签');
    const lang = await ev(`
        (() => {
            const H = window.__H1SUB__;
            return {
                ja: H.langCode('日语'),
                zh: H.langCode('简体中文'),
                hant: H.langCode('繁体中文'),
                en: H.langCode('英文'),
                ko: H.langCode('韩语'),
                code: H.langCode('zh-Hant'),
                upper: H.langCode('JA'),
                bad: H.langCode('火星文'),
                empty: H.langCode(''),
                pair: H.baiPair(),
            };
        })()`);
    check('日语 → ja', lang.ja === 'ja', lang.ja);
    check('简体中文 → zh', lang.zh === 'zh', lang.zh);
    check('繁体中文 → zh-Hant', lang.hant === 'zh-Hant', lang.hant);
    check('英文 → en', lang.en === 'en', lang.en);
    check('韩语 → ko', lang.ko === 'ko', lang.ko);
    check('已经是语言标签时原样使用（大小写也不敏感）',
        lang.code === 'zh-Hant' && lang.upper === 'ja', JSON.stringify([lang.code, lang.upper]));
    check('认不出来的语言名返回空（绝不瞎猜）', lang.bad === '' && lang.empty === '', JSON.stringify(lang.bad));

    S('2. 能力探测与内核版本门槛');
    const sup = await ev(`(() => {
        const H = window.__H1SUB__;
        const s = H.baiSupport();
        return { tr: s.translator, lm: s.lm, ld: s.detector, secure: window.isSecureContext };
    })()`);
    check('探测到 Translator', sup.tr === true);
    check('探测到 LanguageModel', sup.lm === true);
    check('探测到 LanguageDetector', sup.ld === true);
    check('测试页处于安全上下文（localhost）', sup.secure === true);

    // 版本门槛是这一切的前提：内核不够时这两个 API 压根不存在
    const ver = await ev(`(() => {
        const H = window.__H1SUB__;
        const mk = (ua) => { const b = H.baiBrowser(ua); return { brand: b.brand, major: b.major, ok: b.ok, text: b.text, required: b.required }; };
        return {
            min: H.BAI_MIN_VERSION,
            real: mk(undefined),
            chrome138: mk('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'),
            chrome137: mk('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'),
            edge148: mk('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0'),
            edge145: mk('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0'),
            firefox: mk('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'),
        };
    })()`);
    check('门槛常量写明 Chrome ≥ 138 / Edge ≥ 148',
        ver.min.chrome === 138 && ver.min.edge === 148, JSON.stringify(ver.min));
    check('Edge 的版本号取自 Edg/ 而不是 Chrome/（两者在 UA 里同时出现）',
        ver.edge145.brand === 'edge' && ver.edge145.major === 145, JSON.stringify(ver.edge145));
    check('Chrome 138 满足要求', ver.chrome138.ok === true && ver.chrome138.major === 138,
        JSON.stringify(ver.chrome138));
    check('Chrome 137 不满足要求', ver.chrome137.ok === false, JSON.stringify(ver.chrome137));
    check('Edge 148 满足要求', ver.edge148.ok === true, JSON.stringify(ver.edge148));
    check('Edge 145 不满足要求（实测这个版本确实残缺）',
        ver.edge145.ok === false && /Edge ≥ 148/.test(ver.edge145.required), JSON.stringify(ver.edge145));
    check('非 Chromium 内核给出明确提示',
        ver.firefox.brand === 'other' && ver.firefox.ok === false
        && /Chrome ≥ 138 \/ Edge ≥ 148/.test(ver.firefox.required), JSON.stringify(ver.firefox));
    check('本机（headless Chrome）判为满足要求',
        ver.real.ok === true && ver.real.brand === 'chrome', JSON.stringify(ver.real));

    const verNote = await ev(`window.__H1SUB__.baiVersionNote()`);
    check('版本达标时不显示警告', verNote === '', JSON.stringify(verNote));

    const rows = await evAsync(`(async () => {
        const H = window.__H1SUB__;
        Object.assign(H.CFG, { engine: 'browser-ai', baiOcr: 'umi', baiTrans: 'auto',
            srcLang: '日语', tgtLang: '简体中文' });
        return await H.baiProbe();
    })()`);
    const rowText = (rows || []).map(r => r.label + '=' + r.value).join(' | ');
    check('探测结果是一组带标签的行', Array.isArray(rows) && rows.length >= 7, rowText.slice(0, 200));
    check('探测结果第一项就是内核版本',
        (rows[0] || {}).label === '浏览器内核' && /Chrome \d+/.test((rows[0] || {}).value || ''),
        JSON.stringify(rows[0]));
    check('探测报告语言方向 ja → zh', /ja → zh/.test(rowText), rowText.slice(0, 200));
    check('探测报告内置翻译模型可用', /内置翻译模型/.test(rowText) && /downloadable|已就绪|需要下载/.test(rowText),
        rowText.slice(0, 200));

    S('3. 全离线链路：Umi-OCR 识别 + 端侧翻译');
    const run = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            Object.assign(H.CFG, {
                engine: 'browser-ai', baiOcr: 'umi', baiTrans: 'translator',
                baiStream: false, srcLang: '日语', tgtLang: '简体中文',
            });
            H.baiReset();
            window.__bai.reset();
            window.__bai.state.transReply = null;
            window.__gmReqs.length = 0;
            window.__umiText = 'おはようございます';

            const c = document.createElement('canvas');
            c.width = 200; c.height = 60;
            const out = await H.recognizeAndTranslate(c);

            const reqs = window.__gmReqs;
            return {
                out: out,
                ocrReqs: reqs.filter(q => /\\/api\\/ocr$/.test(q.url)).length,
                otherReqs: reqs.filter(q => !/\\/api\\/ocr$/.test(q.url)).length,
                texts: window.__bai.translatorTexts.slice(),
                opts: window.__bai.lastTranslatorOpts,
            };
        })()`);
    check('识别 + 翻译都跑通', run.out && run.out.original === 'おはようございます'
        && run.out.translation === '译:おはようございます', JSON.stringify(run.out));
    check('识别确实走的是本机 Umi-OCR', run.ocrReqs === 1, JSON.stringify({ ocr: run.ocrReqs }));
    check('整条链路没有发出任何联网请求', run.otherReqs === 0,
        '额外的请求数 = ' + run.otherReqs);
    check('交给端侧翻译模型的是识别出的原文',
        run.texts.length === 1 && run.texts[0] === 'おはようございます', JSON.stringify(run.texts));
    check('端侧会话按配置的语言对创建',
        run.opts && run.opts.sourceLanguage === 'ja' && run.opts.targetLanguage === 'zh',
        JSON.stringify(run.opts));

    S('4. 端侧会话复用与缓存');
    const reuse = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            H.CFG.baiTrans = 'translator';
            H.baiReset();
            window.__bai.reset();
            const a = await H.baiTranslate('第一句');
            const b = await H.baiTranslate('第二句');
            const c = await H.baiTranslate('第一句');
            return {
                a: a, b: b, c: c,
                created: window.__bai.translatorCreated,
                texts: window.__bai.translatorTexts.slice(),
            };
        })()`);
    check('两句不同原文各自翻译',
        reuse.a === '译:第一句' && reuse.b === '译:第二句', JSON.stringify(reuse));
    check('两句只创建了一个端侧会话（会话被复用）',
        reuse.created === 1, 'create 次数 = ' + reuse.created);
    check('重复的句子命中翻译缓存，不再调模型',
        reuse.texts.length === 2, JSON.stringify(reuse.texts));

    S('5. 内置多模态读图（零安装路线）');
    const builtin = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            Object.assign(H.CFG, { engine: 'browser-ai', baiOcr: 'builtin', baiTrans: 'translator' });
            H.baiReset();
            window.__bai.reset();
            window.__bai.state.ocrReply = 'おはよう、いい天気ですね。';

            const c = document.createElement('canvas');
            c.width = 200; c.height = 60;
            const cx = c.getContext('2d');
            cx.fillStyle = '#000'; cx.fillRect(0, 0, 200, 60);
            cx.fillStyle = '#fff'; cx.font = '20px sans-serif'; cx.fillText('TEST', 10, 35);

            const out = await H.recognizeAndTranslate(c);
            const last = window.__bai.lmInputs[window.__bai.lmInputs.length - 1];
            const msg = Array.isArray(last) ? last[0] : null;
            const content = (msg && Array.isArray(msg.content)) ? msg.content : [];
            const img = content.filter(x => x.type === 'image')[0];
            const inputs = (window.__bai.lastLmOpts && window.__bai.lastLmOpts.expectedInputs) || [];
            return {
                out: out,
                lmCreated: window.__bai.lmCreated,
                role: msg && msg.role,
                types: content.map(x => x.type),
                imgIsBlob: !!(img && typeof Blob !== 'undefined' && img.value instanceof Blob),
                imgSize: img && img.value && img.value.size,
                expectsImage: inputs.some(x => x.type === 'image'),
                hasSystem: !!(window.__bai.lastLmOpts && window.__bai.lastLmOpts.initialPrompts),
                texts: window.__bai.translatorTexts.slice(),
            };
        })()`);
    check('多模态读图能出原文并完成翻译',
        builtin.out && builtin.out.original === 'おはよう、いい天気ですね。'
        && builtin.out.translation === '译:おはよう、いい天気ですね。', JSON.stringify(builtin.out));
    check('按多模态方式创建了端侧会话', builtin.lmCreated === 1, 'lm create = ' + builtin.lmCreated);
    check('会话声明了图片输入能力', builtin.expectsImage === true);
    check('带上了系统提示词（限定只抄字、不翻译）', builtin.hasSystem === true);
    check('图片作为 user 消息的 image 内容块发出',
        builtin.role === 'user' && builtin.types.indexOf('image') >= 0
        && builtin.types.indexOf('text') >= 0, JSON.stringify(builtin.types));
    check('图片是一个真实的 Blob（而不是空值）',
        builtin.imgIsBlob === true && builtin.imgSize > 0,
        JSON.stringify({ blob: builtin.imgIsBlob, size: builtin.imgSize }));
    check('读出的原文交给了端侧翻译模型',
        builtin.texts.length === 1 && builtin.texts[0] === 'おはよう、いい天気ですね。',
        JSON.stringify(builtin.texts));

    S('6. 流式显示');
    const stream = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            const inc = [];
            H.CFG.baiTrans = 'translator';
            H.baiReset();
            window.__bai.reset();
            window.__bai.state.transReply = '早上好';
            const t1 = await H.baiTranslate('增量式分片', { onDelta: p => inc.push(p) });

            const cum = [];
            H.CFG.baiTrans = 'prompt';
            H.baiReset();
            window.__bai.state.transReply = '你好世界';
            const t2 = await H.baiTranslate('累计式分片', { onDelta: p => cum.push(p) });

            // 节流：同一个 tick 里连发多次，只该落一次
            // （partialSink 只在"运行中"才生效，这里手动置上运行标志）
            H.CFG.baiStream = true;
            const wasRunning = H.Pipeline.running;
            H.Pipeline.running = true;
            let calls = 0;
            const orig = H.Overlay.show;
            H.Overlay.show = function () { calls++; return orig.apply(this, arguments); };
            const sink = H.Pipeline.partialSink(H.Pipeline.gen);
            sink('第一', '原文'); sink('第二', '原文'); sink('第三', '原文');
            H.Overlay.show = orig;
            H.Pipeline.running = wasRunning;
            H.CFG.baiStream = false;
            const off = H.Pipeline.partialSink(H.Pipeline.gen);

            return {
                t1: t1, t2: t2,
                incLast: inc[inc.length - 1], incCount: inc.length,
                cumLast: cum[cum.length - 1], cumCount: cum.length,
                joined1: H.baiJoinChunk('早上', '早上好'),
                joined2: H.baiJoinChunk('早上', '好'),
                throttleCalls: calls,
                offIsUndefined: off === undefined,
            };
        })()`);
    check('增量式分片能拼成完整译文',
        stream.t1 === '早上好' && stream.incLast === '早上好' && stream.incCount > 1,
        JSON.stringify({ t: stream.t1, last: stream.incLast, n: stream.incCount }));
    check('累计式分片不会重复叠加',
        stream.t2 === '你好世界' && stream.cumLast === '你好世界',
        JSON.stringify({ t: stream.t2, last: stream.cumLast }));
    check('两种分片风格都能正确拼接',
        stream.joined1 === '早上好' && stream.joined2 === '早上好',
        JSON.stringify([stream.joined1, stream.joined2]));
    check('流式回调按时间节流（连发三次只落一次）',
        stream.throttleCalls === 1, '落点次数 = ' + stream.throttleCalls);
    check('关掉流式开关后不再回调', stream.offIsUndefined === true);

    S('6b. 退化重复的压制（端侧模型遇到纯拟声句会失控）');
    const repFix = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const distinct = Array.from({ length: 200 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('');
            return {
                // 实测：一句 18 字拟声原文会让 ja→en 吐 971 字的 "Oh, oh, oh…"
                longCjk: H.baiCollapseRepeat('哦,'.repeat(300)),
                longEn: H.baiCollapseRepeat('"Oh, '.repeat(200)),
                normal: H.baiCollapseRepeat('这是什么?我不能说什么,我无法恢复我的声音。'),
                fourTimes: H.baiCollapseRepeat('谢谢谢谢'),
                short: H.baiCollapseRepeat('哦,哦,哦'),
                polishQuote: H.baiPolish('"哦,哦,哦', 'ああっ'),
                polishPairQuote: H.baiPolish('"早上好"', 'おはよう'),
                polishTrailing: H.baiPolish('哦,'.repeat(300), 'ああっ'),
                polishCap: H.baiPolish(distinct, 'ああっ'),
                polishNormal: H.baiPolish('早上好', 'おはよう'),
            };
        })()`);
    check('几百次重复被压成两遍（语义保住、画面不糊）',
        repFix.longCjk === '哦,哦,' && repFix.longEn === '"Oh, "Oh, ',
        JSON.stringify([repFix.longCjk, repFix.longEn]));
    check('正常句子一个字都不动',
        repFix.normal === '这是什么?我不能说什么,我无法恢复我的声音。', repFix.normal);
    check('四连重复属于正常范围，不误伤', repFix.fourTimes === '谢谢谢谢', repFix.fourTimes);
    check('本来就短的重复不动', repFix.short === '哦,哦,哦', repFix.short);
    check('单边残留的引号也去掉（模型常常只加一头）',
        repFix.polishQuote === '哦,哦,哦', repFix.polishQuote);
    check('两头都有的引号去掉', repFix.polishPairQuote === '早上好', repFix.polishPairQuote);
    check('压完留下的尾逗号也去掉', repFix.polishTrailing === '哦,哦', repFix.polishTrailing);
    check('压完仍超长时截断', repFix.polishCap.length <= 81 && /…$/.test(repFix.polishCap),
        '长度 = ' + repFix.polishCap.length);
    check('正常译文原样返回', repFix.polishNormal === '早上好', repFix.polishNormal);

    S('7. 回退与错误提示');
    const errs7 = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            const out = {};
            // 这一组专门测"没有中转可用"时的兜底，所以先把中转关掉
            H.CFG.baiPivot = false;

            // ① auto：翻译模型不支持这个语言对 → 自动退回端侧大模型
            H.CFG.baiTrans = 'auto';
            H.baiReset();
            window.__bai.reset();
            window.__bai.state.transPair['ja>zh'] = 'unavailable';
            window.__bai.state.transReply = '大模型译文';
            out.autoFallback = await H.baiTranslate('自动回退');
            out.lmCreated = window.__bai.lmCreated;
            out.translatorCreated = window.__bai.translatorCreated;

            // ② 强制只用翻译模型 → 报错要说人话
            H.CFG.baiTrans = 'translator';
            H.baiReset();
            window.__bai.state.transReply = null;
            try { await H.baiTranslate('强制翻译模型'); out.forced = 'no-error'; }
            catch (e) { out.forced = e.message; }

            // ③ 模型没下载（需要用户手势）→ 提示去点「准备离线模型」
            window.__bai.state.transPair['ja>zh'] = 'downloadable';
            window.__bai.state.gestureFail = true;
            H.baiReset();
            try { await H.baiTranslate('手势测试'); out.gesture = 'no-error'; }
            catch (e) { out.gesture = e.message; }
            window.__bai.state.gestureFail = false;

            // ④ 语言名认不出来 → 明确让用户改「语言」
            H.CFG.srcLang = '火星文';
            H.baiReset();
            try { await H.baiTranslate('语言测试'); out.lang = 'no-error'; }
            catch (e) { out.lang = e.message; }
            H.CFG.srcLang = '日语';
            H.CFG.baiPivot = true;

            return out;
        })()`);
    check('auto 模式：无中转可用时退回端侧大模型',
        errs7.autoFallback === '大模型译文' && errs7.lmCreated >= 1 && errs7.translatorCreated === 0,
        JSON.stringify(errs7));
    check('强制只用翻译模型时报错并指出改哪里',
        /不支持/.test(errs7.forced || '') && /翻译方式|中转/.test(errs7.forced || ''), errs7.forced);
    check('模型没下载时报错并指向「准备离线模型」',
        /准备离线模型/.test(errs7.gesture || ''), errs7.gesture);
    check('语言名认不出来时给出可操作的提示',
        /语言/.test(errs7.lang || '') && /标准/.test(errs7.lang || ''), errs7.lang);

    S('7b. Edge 式坏语言对：自动经英语中转');
    const pivot = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            const out = {};
            // 还原成 Edge 的情形：ja→zh 直连必失败，ja→en 与 en→zh 都正常
            Object.assign(H.CFG, { engine: 'browser-ai', baiOcr: 'umi', baiTrans: 'translator',
                baiPivot: true, baiStream: false, srcLang: '日语', tgtLang: '简体中文' });
            H.baiReset();
            window.__bai.reset();
            window.__bai.state.transPair = {};
            window.__bai.state.transReply = null;
            window.__bai.state.replyMap = { 'ja>en': 'Hello, nice weather.', 'en>zh': '你好，天气真好。' };
            window.__bai.state.brokenPairs = { 'ja>zh': true };

            out.first = await H.baiTranslate('こんにちは、いい天気ですね。');
            out.broken = Object.assign({}, H.baiBrokenPairs);
            out.calls1 = Object.assign({}, window.__bai.translateCalls);
            out.createdAfterFirst = window.__bai.translatorCreated;
            out.destroyedAfterFirst = window.__bai.translatorDestroyed;

            // 再来一句：应该直接走中转，不再去撞 ja→zh，
            // 而且**不该重建会话**（否则每句都重新加载模型，还会把在飞的翻译打断）
            out.second = await H.baiTranslate('おはよう');
            out.calls2 = Object.assign({}, window.__bai.translateCalls);
            out.createdAfterSecond = window.__bai.translatorCreated;
            out.destroyedAfterSecond = window.__bai.translatorDestroyed;
            out.texts = window.__bai.translatorTexts.slice();

            // 直连好使的时候不该启用中转（换一个两边都不是英语、且能直连的语言对）
            H.CFG.srcLang = '日语';
            H.CFG.tgtLang = '韩语';
            H.baiReset();
            window.__bai.reset();
            window.__bai.state.replyMap = { 'ja>ko': '안녕하세요' };
            window.__bai.state.transReply = null;
            out.direct = await H.baiTranslate('こんにちは');
            out.directCalls = Object.assign({}, window.__bai.translateCalls);
            out.jaKoBroken = !!H.baiBrokenPairs['ja>ko'];
            out.jaZhStillKnown = !!H.baiBrokenPairs['ja>zh'];

            // 关掉中转：坏语言对要给出可操作的报错，而不是把英文原文丢出来
            H.CFG.srcLang = '日语';
            H.CFG.tgtLang = '简体中文';
            H.CFG.baiPivot = false;
            H.baiReset();
            window.__bai.state.brokenPairs = { 'ja>zh': true };
            try { await H.baiTranslate('ありがとう'); out.noPivot = 'no-error'; }
            catch (e) { out.noPivot = e.message; }
            H.CFG.baiPivot = true;

            return out;
        })()`);
    check('直连报 Generic failures 时自动改走经英语中转',
        pivot.first === '你好，天气真好。', JSON.stringify(pivot.first));
    check('坏语言对被记住了', pivot.broken['ja>zh'] !== undefined, JSON.stringify(pivot.broken));
    check('中转确实是两段：原文先译成英语，再译成中文',
        pivot.first === '你好，天气真好。' && pivot.texts.indexOf('Hello, nice weather.') >= 0,
        JSON.stringify(pivot.texts));
    check('已经知道坏了就不再重复去撞直连',
        (pivot.calls1['ja>zh'] || 0) === 1 && (pivot.calls2['ja>zh'] || 0) === 1,
        JSON.stringify({ c1: pivot.calls1, c2: pivot.calls2 }));
    check('第二句仍然走中转并给出译文', pivot.second === '你好，天气真好。', pivot.second);
    // ↓ 这两条是「AbortError: signal is aborted without reason」的回归测试：
    //   中转要同时用 ja→en 和 en→zh 两个会话，早先的实现每用途只有一个槽位，
    //   建第二个就把刚拿到的第一个 destroy 掉，于是 translate() 直接被中断。
    //   首句会建 3 个会话：直连的 ja→zh（撞一次确认坏了）+ 中转的 ja→en、en→zh。
    check('中转的两个会话同时存在，没有互相销毁',
        pivot.createdAfterFirst === 3 && pivot.destroyedAfterFirst === 0,
        JSON.stringify({ created: pivot.createdAfterFirst, destroyed: pivot.destroyedAfterFirst }));
    check('第二句复用会话，不重建也不销毁（否则会打断在飞的翻译）',
        pivot.createdAfterSecond === 3 && pivot.destroyedAfterSecond === 0,
        JSON.stringify({ created: pivot.createdAfterSecond, destroyed: pivot.destroyedAfterSecond }));
    check('直连正常时不启用中转，也不把它记成坏语言对',
        pivot.direct === '안녕하세요' && (pivot.directCalls['ja>en'] || 0) === 0
        && pivot.jaKoBroken === false,
        JSON.stringify({ out: pivot.direct, calls: pivot.directCalls, broken: pivot.jaKoBroken }));
    check('坏语言对按语言对分别记忆（换语言对不会误判）',
        pivot.jaZhStillKnown === true, JSON.stringify(pivot.jaZhStillKnown));
    check('关掉中转后给出可操作的报错',
        /中转/.test(pivot.noPivot || '') && /语言对/.test(pivot.noPivot || ''),
        pivot.noPivot);

    S('7c. 「准备离线模型」的自检能提前发现坏语言对');
    const prep = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            const out = {};
            Object.assign(H.CFG, { engine: 'browser-ai', baiOcr: 'umi', baiTrans: 'translator',
                baiPivot: true, srcLang: '日语', tgtLang: '简体中文' });
            H.baiReset();
            window.__bai.reset();
            window.__bai.state.replyMap = { 'ja>en': 'Hello', 'en>zh': '你好' };
            window.__bai.state.brokenPairs = { 'ja>zh': true };
            out.ready = await H.baiPrepare();
            out.created = window.__bai.translatorCreated;

            // 关掉中转时，自检应当直接报错而不是"准备成功"
            H.CFG.baiPivot = false;
            H.baiReset();
            window.__bai.reset();
            try { await H.baiPrepare(); out.off = 'no-error'; }
            catch (e) { out.off = e.message; }
            H.CFG.baiPivot = true;
            return out;
        })()`);
    check('准备阶段就试出坏语言对，并列明改走中转',
        Array.isArray(prep.ready) && prep.ready.join(' ').indexOf('经英语中转') >= 0,
        JSON.stringify(prep.ready));
    check('中转需要的两个会话都建好了',
        prep.created >= 3, 'create 次数 = ' + prep.created);
    check('中转关掉时准备阶段直接报错（不假装就绪）',
        /中转/.test(prep.off || ''), prep.off);

    S('7d. 会话被销毁时的报错要说人话');
    const abort = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            const out = {};
            // 换一个干净的语言对（ja>ko 没被前面的用例标记成坏语言对），
            // 并且把 availability 恢复成正常，这样才会真的走到 translate()
            Object.assign(H.CFG, { engine: 'browser-ai', baiOcr: 'umi', baiTrans: 'translator',
                baiPivot: false, srcLang: '日语', tgtLang: '韩语' });
            H.baiReset();
            window.__bai.reset();
            window.__bai.state.transPair = {};
            window.__bai.state.transReply = null;

            // ① 替身本身要如实模拟：create → destroy → translate 必报 AbortError
            const inst = await window.Translator.create({ sourceLanguage: 'ja', targetLanguage: 'ko' });
            inst.destroy();
            try { await inst.translate('销毁后翻译'); out.raw = 'no-error'; }
            catch (e) { out.raw = (e && e.name) + ': ' + (e && e.message); }

            // ② 这种错误抛到用户面前时应该被翻成人话
            window.__bai.state.abortAll = true;
            try { await H.baiTranslate('中断测试句'); out.nice = 'no-error'; }
            catch (e) { out.nice = e.message; }
            window.__bai.state.abortAll = false;
            // ③ 恢复路径：AbortError 之后那个会话应该被丢掉，下一次能重建成功
            window.__bai.state.replyMap = { 'ja>ko': '안녕하세요' };
            out.recovered = await H.baiTranslate('中断测试句');
            out.createdAfterRecover = window.__bai.translatorCreated;
            return out;
        })()`);
    check('替身如实模拟了 destroy() 之后的 AbortError',
        /^AbortError/.test(abort.raw || '') && /aborted without reason/.test(abort.raw || ''),
        abort.raw);
    check('AbortError 被翻成可操作的提示（不再直接甩英文）',
        /中断/.test(abort.nice || '') && /准备离线模型|开始/.test(abort.nice || ''), abort.nice);
    check('中断后会丢掉坏掉的会话，下一句能重建成功',
        abort.recovered === '안녕하세요', JSON.stringify({ out: abort.recovered, created: abort.createdAfterRecover }));

    S('7e. 中转第一段失控时不会放大到第二段');
    const mid = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            Object.assign(H.CFG, { engine: 'browser-ai', baiOcr: 'umi', baiTrans: 'translator',
                baiPivot: true, baiStream: false, srcLang: '日语', tgtLang: '简体中文' });
            H.baiReset();
            window.__bai.reset();
            window.__bai.state.transPair = {};
            window.__bai.state.brokenPairs = { 'ja>zh': true };
            // 第一段失控（真机实测 971 字），第二段照常
            window.__bai.state.replyMap = { 'ja>en': '"Oh, '.repeat(200), 'en>zh': '哦,哦,哦' };
            const out = await H.baiTranslate('ああっああっ');
            const calls = window.__bai.translatorTexts.slice();
            return {
                out: out,
                firstStage: calls[0] ? calls[0].length : 0,
                toSecondStage: calls[1] ? calls[1].length : 0,
                secondStageText: calls[1] || '',
            };
        })()`);
    check('第一段的失控输出被压掉后才交给第二段（否则会被放大一轮）',
        mid.firstStage === 6 && mid.toSecondStage <= 20,
        JSON.stringify({ src: mid.firstStage, mid: mid.toSecondStage, note: '第一段原本 1000 字' }));
    check('最终译文是压过的短文本', mid.out === '哦,哦,哦', JSON.stringify(mid.out));

    S('8. 面板联动');
    const ui = await ev(`
        (() => {
            const out = {};
            const eng = document.querySelector('#h1sub-engine');
            const bocr = document.querySelector('#h1sub-baiOcr');
            const btrans = document.querySelector('#h1sub-baiTrans');

            out.optionExists = [...eng.options].some(o => o.value === 'browser-ai');
            out.controlsExist = !!bocr && !!btrans && !!document.querySelector('#h1sub-bai-probe')
                && !!document.querySelector('#h1sub-bai-prepare') && !!document.querySelector('#h1sub-baiStream');

            eng.value = 'browser-ai';
            eng.dispatchEvent(new Event('change'));
            out.baiShown = document.querySelector('#h1sub-browserai').style.display !== 'none';
            out.openaiHidden = document.querySelector('#h1sub-openai').style.display === 'none';
            out.streamChecked = document.querySelector('#h1sub-baiStream').checked;
            out.pivotChecked = document.querySelector('#h1sub-baiPivot').checked;
            out.verText = (document.querySelector('#h1sub-bai-ver').textContent || '');

            // 识别方式：先选 Umi-OCR，再选内置读图，Umi-OCR 配置区要跟着显隐
            bocr.value = 'umi';
            bocr.dispatchEvent(new Event('change'));
            out.umiShownWithUmi = document.querySelector('#h1sub-umionly').style.display !== 'none';

            bocr.value = 'builtin';
            bocr.dispatchEvent(new Event('change'));
            out.umiHiddenWithBuiltin = document.querySelector('#h1sub-umionly').style.display === 'none';
            out.cfgOcr = window.__H1SUB__.CFG.baiOcr;

            btrans.value = 'translator';
            btrans.dispatchEvent(new Event('change'));
            out.cfgTrans = window.__H1SUB__.CFG.baiTrans;

            out.configured = window.__H1SUB__.isConfigured();

            // 切回视觉引擎，面板要恢复原样
            eng.value = 'openai-vision';
            eng.dispatchEvent(new Event('change'));
            out.backToOpenai = document.querySelector('#h1sub-openai').style.display !== 'none';
            out.baiHidden = document.querySelector('#h1sub-browserai').style.display === 'none';
            return out;
        })()`);
    check('引擎下拉里有「浏览器内置 AI」选项', ui.optionExists === true);
    check('离线区块的控件都在', ui.controlsExist === true);
    check('切到离线引擎 → 区块出现、API 配置区隐藏',
        ui.baiShown === true && ui.openaiHidden === true, JSON.stringify(ui));
    check('识别方式选 Umi-OCR 时显示 Umi-OCR 配置区', ui.umiShownWithUmi === true);
    check('识别方式选内置读图时隐藏 Umi-OCR 配置区', ui.umiHiddenWithBuiltin === true,
        JSON.stringify({ hidden: ui.umiHiddenWithBuiltin, cfg: ui.cfgOcr }));
    check('流式开关默认打开', ui.streamChecked === true);
    check('经英语中转默认打开', ui.pivotChecked === true);
    check('面板上标出了内核版本门槛与当前版本',
        /Chrome/.test(ui.verText) && /138/.test(ui.verText), ui.verText);
    check('下拉框改动会写回配置', ui.cfgOcr === 'builtin' && ui.cfgTrans === 'translator',
        JSON.stringify({ ocr: ui.cfgOcr, trans: ui.cfgTrans }));
    check('离线引擎不需要 API Key 也算已配置', ui.configured === true, JSON.stringify(ui));
    check('切回视觉引擎后面板恢复', ui.backToOpenai === true && ui.baiHidden === true,
        JSON.stringify(ui));

    S('9. 诊断报告');
    const rep = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            Object.assign(H.CFG, { engine: 'browser-ai', baiOcr: 'umi', baiTrans: 'auto', apiKey: '',
                srcLang: '日语', tgtLang: '简体中文' });
            window.__bai.state.transPair['ja>zh'] = 'downloadable';
            H.Diag.baiProbe = await H.baiProbe();
            const t = H.Diag.build();
            H.Diag.baiProbe = null;
            return t;
        })()`);
    check('报告里有浏览器内置 AI 段', /浏览器内置 AI/.test(rep), rep.slice(0, 80));
    check('报告写出内核版本与门槛', /浏览器内核/.test(rep) && /Chrome \d+/.test(rep) && /Chrome ≥ 138/.test(rep),
        rep.slice(0, 200));
    check('报告说明不需要 API Key', /不需要（完全离线/.test(rep));
    check('报告写明中转开关与坏语言对', /经英语中转/.test(rep), rep.slice(0, 120));
    check('报告列出识别 / 翻译方式', /识别方式/.test(rep) && /翻译方式/.test(rep));
    check('报告列出语言代码映射', /ja -> zh/.test(rep));
    check('报告带上了探测结果', /Translator/.test(rep) && /内置翻译模型/.test(rep));

    S('10. 无异常');
    const pageErrs = cdp.errorsFor(sessionId);
    check('页面无 JS 异常', pageErrs.length === 0, pageErrs.slice(0, 2).join(' || '));
} catch (e) {
    console.log('\nFAIL 崩溃: ' + e.message);
    console.log(cdp.pageErrors.slice(0, 6).map(x => '   ' + String(x.text).slice(0, 350)).join('\n'));
    R.push({ suite: '崩溃', name: '测试执行中断: ' + e.message, pass: false });
    process.exitCode = 1;
} finally {
    cdp.close();
    await srv.close();
}

const pass = R.filter(x => x.pass).length;
const fail = R.length - pass;
console.log('\n' + '='.repeat(54));
console.log(`  总计 ${R.length} 项  ·  通过 ${pass}  ·  失败 ${fail}`);
if (fail) R.filter(x => !x.pass).forEach(x => console.log('  BAD [' + x.suite + '] ' + x.name));
console.log('='.repeat(54));
if (fail) process.exitCode = 1;
