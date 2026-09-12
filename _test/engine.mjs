// 引擎层功能测试：检查请求体构造、思考模式参数、响应解析、错误提示
// 用 GM_xmlhttpRequest 桩拦截真实请求并断言其内容，不需要真 API Key
import { Cdp, startServer } from './cdp.mjs';
import { PAGES, readUserscript } from './paths.mjs';

const USERSCRIPT = readUserscript();
const PORT = 8780;
const BASE = `http://127.0.0.1:${PORT}`;

const PRELUDE = `
(function () {
    const store = window.__gmStore = {};
    window.__gmReqs = [];
    window.GM_getValue = function (k, d) { return (k in store) ? store[k] : d; };
    window.GM_setValue = function (k, v) { store[k] = v; };
    window.GM_registerMenuCommand = function () {};
    window.GM_addElement = function (tag, attrs) {
        const el = document.createElement(tag);
        for (const k in (attrs || {})) el.setAttribute(k, attrs[k]);
        (document.head || document.documentElement).appendChild(el);
        return el;
    };
    window.__gmResponse = null;
    window.__gmResponseQueue = null;
    window.GM_xmlhttpRequest = function (opts) {
        let body = null;
        try { body = JSON.parse(opts.data); } catch (e) { body = opts.data; }
        window.__gmReqs.push({
            url: opts.url, method: opts.method || 'POST',
            headers: opts.headers, body: body, raw: opts.data,
        });

        // Umi-OCR 接口：按 URL 自动回一条识别结果，这样测试才能走真实的
        // callUmiOCR 代码路径（覆盖 window.__H1SUB__.callUmiOCR 是没用的，
        // recognizeByUmi 引用的是闭包里的那个函数）
        if (/\\/api\\/ocr\\/get_options/.test(opts.url)) {
            setTimeout(function () {
                opts.onload && opts.onload({ status: 200, responseText: JSON.stringify({
                    'ocr.language': { optionsList: [['models/config_japan.txt', '日本語']] },
                }) });
            }, 3);
            return;
        }
        if (/\\/api\\/ocr/.test(opts.url)) {
            const text = (window.__umiText !== undefined) ? window.__umiText : 'おはようございます';
            const code = (window.__umiCode !== undefined) ? window.__umiCode : 100;
            setTimeout(function () {
                opts.onload && opts.onload({
                    status: 200,
                    responseText: JSON.stringify({ code: code, data: text, time: 0.12 }),
                });
            }, 3);
            return;
        }

        let resp = window.__gmResponse;
        if (window.__gmResponseQueue && window.__gmResponseQueue.length) {
            resp = window.__gmResponseQueue.shift();
        }
        if (!resp) { setTimeout(function () { opts.onerror && opts.onerror(new Error('no stub')); }, 0); return; }
        setTimeout(function () {
            try { opts.onload && opts.onload({ status: resp.status, responseText: resp.text }); }
            catch (e) { opts.onerror && opts.onerror(e); }
        }, window.__gmDelay || 3);
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

const okResp = (content, extra = {}) => ({
    status: 200,
    text: JSON.stringify({
        model: 'deepseek-flash',
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop', ...extra }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
});

const srv = await startServer({ port: PORT, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: 9380 });
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
    const { sessionId } = await cdp.newPage();
    await cdp.addInitScript(PRELUDE, sessionId);
    await cdp.addInitScript(USERSCRIPT, sessionId);
    await cdp.navigate(sessionId, `${BASE}/lab.html?mode=canvas`,
        { waitFor: 'window.__H1SUB__ && window.__lab && window.__lab.ready', timeoutMs: 25000 });
    const ev = (e, o = {}) => cdp.evaluate(e, { sessionId, ...o });
    // 异步 IIFE 必须 awaitPromise，否则拿回来的是 Promise 对象而不是结果
    const evAsync = (e) => cdp.evaluate(e, { sessionId, awaitPromise: true });

    // 辅助：设置配置
    const setCfg = (obj) => ev(`
        (() => {
            const H = window.__H1SUB__;
            Object.assign(H.CFG, ${JSON.stringify(obj)});
            return true;
        })()`);

    // 辅助：直接调 buildChatBody 看产物
    const bodyFor = (cfg, messages) => ev(`
        (() => {
            const H = window.__H1SUB__;
            Object.assign(H.CFG, ${JSON.stringify(cfg)});
            return H.buildChatBody(${JSON.stringify(messages)}, { temperature: 0.2 });
        })()`);

    // ─────────────────────────────────────────────
    S('1. 思考模式参数：只在 DeepSeek 接口上关闭');
    const b1 = await bodyFor(
        { apiBase: 'https://api.deepseek.com', thinkingMode: 'auto', maxTokens: 1024 },
        [{ role: 'user', content: 'hi' }]);
    check('DeepSeek + auto → 发送 thinking.type = disabled',
        b1.thinking && b1.thinking.type === 'disabled', JSON.stringify(b1));
    check('关闭思考模式时不发送 temperature（发了也无效）',
        b1.temperature === undefined, 'temperature=' + b1.temperature);
    check('max_tokens 跟随配置', b1.max_tokens === 1024, 'max_tokens=' + b1.max_tokens);

    const b2 = await bodyFor(
        { apiBase: 'https://api.openai.com/v1', thinkingMode: 'auto', maxTokens: 512 },
        [{ role: 'user', content: 'hi' }]);
    check('OpenAI + auto → 不发送 thinking（免得被 400 拒绝）',
        b2.thinking === undefined, JSON.stringify(b2));
    check('非 DeepSeek 平台照常发送 temperature',
        b2.temperature === 0.2, 'temperature=' + b2.temperature);

    const b3 = await bodyFor(
        { apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai', thinkingMode: 'off' },
        [{ role: 'user', content: 'hi' }]);
    check('别的平台 + off → 强制发送 thinking（用户显式要求）',
        b3.thinking && b3.thinking.type === 'disabled', JSON.stringify(b3));

    const b4 = await bodyFor(
        { apiBase: 'https://api.deepseek.com', thinkingMode: 'on' },
        [{ role: 'user', content: 'hi' }]);
    check('DeepSeek + on → 不发送 thinking（跟随平台默认）',
        b4.thinking === undefined, JSON.stringify(b4));
    check('on 模式下把 temperature 发出去', b4.temperature === 0.2);

    const b5 = await bodyFor({ apiBase: 'https://api.deepseek.com/v1', thinkingMode: 'auto' },
        [{ role: 'user', content: 'hi' }]);
    check('/v1 结尾的 DeepSeek 地址也能识别出来',
        b5.thinking && b5.thinking.type === 'disabled', JSON.stringify(b5.thinking));

    S('2. 视觉请求格式（DeepSeek 只接受 user 消息里的图片）');
    await setCfg({
        engine: 'openai-vision',
        apiBase: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        apiKey: 'sk-test',
        thinkingMode: 'auto',
    });
    await ev(`
        (() => {
            window.__gmReqs.length = 0;
            window.__gmResponse = ${JSON.stringify(okResp('{"original":"おはよう","translation":"早上好"}'))};
        })()`);
    await ev(`window.__H1SUB__.translateByVision('data:image/jpeg;base64,/9j/TESTIMAGE')`);
    await sleep(300);

    const vreq = await ev(`window.__gmReqs[0]`);
    check('确实发出了请求', !!vreq, JSON.stringify(vreq).slice(0, 200));
    check('请求地址是 /chat/completions',
        /\/chat\/completions$/.test(vreq.url), vreq.url);
    check('带了 Authorization 头',
        vreq.headers && /^Bearer sk-test$/.test(vreq.headers.Authorization || ''),
        JSON.stringify(vreq.headers));
    check('模型名正确', vreq.body.model === 'deepseek-flash', vreq.body.model);
    check('请求体带上了 thinking 关闭参数',
        vreq.body.thinking && vreq.body.thinking.type === 'disabled',
        JSON.stringify(vreq.body.thinking));

    const msgs = vreq.body.messages;
    const userMsg = (msgs || []).find(m => m.role === 'user');
    const sysMsg = (msgs || []).find(m => m.role === 'system');
    check('有 system 提示词和 user 消息', !!sysMsg && !!userMsg);
    check('图片放在 user 消息的内容块里（DeepSeek 硬性要求）',
        userMsg && Array.isArray(userMsg.content)
        && userMsg.content.some(b => b.type === 'image_url'),
        JSON.stringify(userMsg).slice(0, 220));
    check('system 消息是纯文本、不含图片',
        sysMsg && typeof sysMsg.content === 'string'
        && !/image_url/.test(JSON.stringify(sysMsg)),
        JSON.stringify(sysMsg).slice(0, 150));
    const imgPart = userMsg.content.find(b => b.type === 'image_url');
    check('图片用 data URL 内联传输',
        imgPart && /^data:image\/jpeg;base64,/.test(imgPart.image_url.url),
        imgPart && imgPart.image_url.url.slice(0, 40));

    S('3. 响应解析的各种情况');
    const parseCases = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const out = {};
            const run = (fn) => { try { return { ok: fn() }; } catch (e) { return { err: e.message }; } };

            out.normal = run(() => H.extractContent({ content: 'hello' }, 'stop'));
            out.blocks = run(() => H.extractContent(
                { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }, 'stop'));
            out.emptyNoReasoning = run(() => H.extractContent({ content: '' }, 'stop'));
            out.lengthLimited = run(() => H.extractContent(
                { content: '', reasoning_content: '让我想想…' }, 'length'));
            out.reasoningOnly = run(() => H.extractContent(
                { content: null, reasoning_content: '思考中' }, 'stop'));
            out.badShape = run(() => H.extractContent({ content: 123 }, 'stop'));
            return out;
        })()`);
    check('普通字符串 content 正常取出',
        parseCases.normal.ok === 'hello', JSON.stringify(parseCases.normal));
    check('内容块数组 content 能拼接',
        parseCases.blocks.ok === 'ab', JSON.stringify(parseCases.blocks));
    check('空字符串当作"没识别到"，不报错',
        parseCases.emptyNoReasoning.ok === '', JSON.stringify(parseCases.emptyNoReasoning));
    check('finish_reason=length → 提示调思考模式/输出上限',
        parseCases.lengthLimited.err && /思考模式/.test(parseCases.lengthLimited.err)
        && /最大输出/.test(parseCases.lengthLimited.err),
        parseCases.lengthLimited.err);
    check('只返回推理没有正文 → 明确指向思考模式',
        parseCases.reasoningOnly.err && /思考模式/.test(parseCases.reasoningOnly.err),
        parseCases.reasoningOnly.err);
    check('结构异常 → 有明确报错',
        parseCases.badShape.err && /返回结构异常/.test(parseCases.badShape.err),
        parseCases.badShape.err);

    S('4. HTTP 错误翻成人话');
    const errCases = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            const out = {};
            const tryCall = async (status, text) => {
                window.__gmResponse = { status, text };
                try {
                    await H.callChat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
                    return '(没报错)';
                } catch (e) { return e.message; }
            };
            out.e401 = await tryCall(401, JSON.stringify({ error: { message: 'Authentication Fails' } }));
            out.e402 = await tryCall(402, JSON.stringify({ error: { message: 'Insufficient Balance' } }));
            out.e404 = await tryCall(404, JSON.stringify({ error: { message: 'Model Not Exist' } }));
            out.e429 = await tryCall(429, JSON.stringify({ error: { message: 'Rate limit' } }));
            out.e500 = await tryCall(500, 'server exploded');
            return out;
        })()`);
    check('401 → 提示 API Key 问题', /API Key/.test(errCases.e401), errCases.e401);
    check('402 → 提示余额不足', /余额/.test(errCases.e402), errCases.e402);
    check('404 → 提示地址或模型不对', /地址|模型/.test(errCases.e404), errCases.e404);
    check('429 → 提示频率/额度', /频繁|额度/.test(errCases.e429), errCases.e429);
    check('500 → 原样带出服务端信息', /500/.test(errCases.e500), errCases.e500);

    S('5. 端到端：走完整管线，字幕能出中文');
    await ev(`
        (() => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const bx = H.getContentBox(v);
            const P = window.__PATTERN__;
            // 把字幕带（含文字的黑色横条）框出来
            H.rememberRegion({
                x: bx.left,
                y: bx.top + (P.BAND_Y / v.videoHeight) * bx.height,
                w: bx.width,
                h: (P.BAND_H / v.videoHeight) * bx.height,
            });
            H.UI.syncRegion();
            window.__gmReqs.length = 0;
            window.__gmResponse = ${JSON.stringify(okResp('{"original":"SUBTITLE TEST 01","translation":"字幕测试 01"}'))};
            H.CFG.interval = 400;
            H.CFG.smartSkip = false;
            H.CFG.textSimThreshold = 0.9;
        })()`);
    await ev(`window.__H1SUB__.Pipeline.start()`);
    await sleep(2600);

    // 先读悬浮层再停止 —— 现在 stop() 会把字幕收掉（这是对的：
    // 停止后还挂着一句译文会让人以为仍在翻译）。先 stop 再读的话
    // 读到的必然是"已清空"，这条断言就永远为假了。
    const e2e = await ev(`
        (() => {
            const ov = document.querySelector('#h1sub-overlay');
            const H = window.__H1SUB__;
            return {
                apiCalls: H.Pipeline.stats.apiCalls,
                shots: H.Pipeline.stats.shots,
                errors: H.Pipeline.stats.errors,
                overlayText: ov ? ov.textContent : '',
                overlayShown: ov ? getComputedStyle(ov).display !== 'none' : false,
                lastReqHasImage: !!(window.__gmReqs[0] && JSON.stringify(window.__gmReqs[0].body).includes('data:image')),
                imgLen: (function () {
                    const r = window.__gmReqs[0];
                    if (!r) return 0;
                    const um = r.body.messages.find(m => m.role === 'user');
                    const ip = Array.isArray(um.content) ? um.content.find(b => b.type === 'image_url') : null;
                    return ip ? ip.image_url.url.length : 0;
                })(),
                lastError: H.Diag.lastError ? H.Diag.lastError.msg : null,
            };
        })()`);

    await ev(`window.__H1SUB__.Pipeline.stop()`);
    check('管线确实调用了 API', e2e.apiCalls >= 1, JSON.stringify(e2e));
    check('没有报错', e2e.errors === 0, 'errors=' + e2e.errors + ' ' + (e2e.lastError || ''));
    check('发出的请求里带了真实截图（base64 有内容）',
        e2e.lastReqHasImage && e2e.imgLen > 500,
        'base64 长度=' + e2e.imgLen);
    check('悬浮字幕显示了中文译文',
        /字幕测试 01/.test(e2e.overlayText) && e2e.overlayShown === true,
        JSON.stringify({ text: e2e.overlayText, shown: e2e.overlayShown }));

    S('5b. 停止 / 换区域后，迟到回来的识别结果必须作废');
    // 之前 step() 在 await 之后没检查运行状态：请求飞在路上时点「停止」，
    // 结果回来照样画到字幕层上，还写进历史。SPA 跳页时最明显
    // —— Overlay.clear() 之后旧字幕又冒出来。
    const stale = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            const P = H.Pipeline;
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));

            const v = H.findVideo();
            const bx = H.getContentBox(v);
            const PA = window.__PATTERN__;
            H.CFG.region = {
                x: bx.left,
                y: bx.top + (PA.BAND_Y / v.videoHeight) * bx.height,
                w: bx.width,
                h: (PA.BAND_H / v.videoHeight) * bx.height,
            };
            H.CFG.engine = 'openai-vision';
            H.CFG.apiBase = 'https://api.deepseek.com';
            H.CFG.apiKey = 'sk-abc';
            H.CFG.smartSkip = false;
            H.CFG.textSimThreshold = 0.99;
            window.__gmResponse = ${JSON.stringify(okResp('{"original":"SUBTITLE TEST 01","translation":"字幕测试 01"}'))};

            const reset = () => {
                P.stop();
                P.lastThumb = null;
                P.lastOriginal = '';
                P.lastTranslation = '';
                P.emptyStreak = 0;
            };

            // ---- 对照组：不打断，结果应该正常显示 ----
            // 没有这一组的话，下面那条"没显示"可能只是因为压根没跑通
            reset();
            window.__gmDelay = 0;
            P.running = true;
            await P.step();
            await P.step();
            const control = {
                calls: P.stats.apiCalls,
                lastOriginal: P.lastOriginal,
            };

            // ---- 实验组 A：请求飞在路上时点「停止」----
            reset();
            const callsBefore = P.stats.apiCalls;
            window.__gmDelay = 700;          // 把响应拖住
            P.running = true;
            const flying = P.step();
            await sleep(150);                // 确认请求已经发出去了
            const sentBeforeStop = P.stats.apiCalls;
            P.stop();                        // ← 用户在此时点了停止
            await flying;                    // 等那个迟到的响应回来
            window.__gmDelay = 0;
            const afterStop = {
                lastOriginal: P.lastOriginal,
                sentBeforeStop: sentBeforeStop > callsBefore,
            };

            // ---- 实验组 B：请求飞在路上时重选区域 ----
            reset();
            window.__gmDelay = 700;
            P.running = true;
            const flying2 = P.step();
            await sleep(150);
            P.invalidate();                  // ← 相当于用户重选了区域
            await flying2;
            window.__gmDelay = 0;
            const afterInvalidate = { lastOriginal: P.lastOriginal };

            reset();
            return { control, afterStop, afterInvalidate };
        })()`);

    check('对照组：不打断时结果能正常显示（证明这条测试不是空转）',
        stale.control.lastOriginal === 'SUBTITLE TEST 01',
        JSON.stringify(stale.control));
    check('实验组确实把请求发出去了才点的停止',
        stale.afterStop.sentBeforeStop === true,
        JSON.stringify(stale.afterStop));
    check('停止后迟到的结果被丢弃，不会画到字幕上',
        stale.afterStop.lastOriginal === '',
        JSON.stringify(stale.afterStop));
    check('重选区域后迟到的结果也被丢弃',
        stale.afterInvalidate.lastOriginal === '',
        JSON.stringify(stale.afterInvalidate));

    S('6. Umi-OCR 路径（本机识别 + 文本模型翻译）');
    const localBody = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            H.CFG.engine = 'umi-ocr';
            H.CFG.apiBase = 'https://api.deepseek.com';
            H.CFG.umiBase = 'http://127.0.0.1:1224';
            H.CFG.umiLang = 'models/config_japan.txt';
            // 识别结果由 GM 桩按 URL 返回，这里走的是真实的 callUmiOCR
            window.__umiText = 'おはようございます';
            window.__umiCode = 100;
            window.__gmReqs.length = 0;
            window.__gmResponse = ${JSON.stringify(okResp('早上好'))};

            const c = document.createElement('canvas');
            c.width = 200; c.height = 60;
            const r = await H.recognizeAndTranslate(c);

            const ocrReq = window.__gmReqs.find(q => /\\/api\\/ocr$/.test(q.url));
            const chatReq = window.__gmReqs.find(q => /chat\\/completions/.test(q.url));
            return {
                result: r,
                ocrUrl: ocrReq ? ocrReq.url : null,
                ocrMethod: ocrReq ? ocrReq.method : null,
                ocrLang: ocrReq && ocrReq.body && ocrReq.body.options
                    ? ocrReq.body.options['ocr.language'] : null,
                ocrHasBase64: !!(ocrReq && ocrReq.body && ocrReq.body.base64),
                ocrBase64HasPrefix: !!(ocrReq && ocrReq.body
                    && /^data:/.test(String(ocrReq.body.base64))),
                chatBody: chatReq ? chatReq.body : null,
                userContent: chatReq
                    ? chatReq.body.messages.find(m => m.role === 'user').content : null,
                hasImage: chatReq ? JSON.stringify(chatReq.body).includes('image_url') : null,
            };
        })()`);
    check('Umi-OCR 路径能跑通', localBody.result && localBody.result.translation === '早上好',
        JSON.stringify(localBody.result));
    check('识别出的原文回传正确', localBody.result && localBody.result.original === 'おはようございます',
        JSON.stringify(localBody.result));
    check('请求打到了 /api/ocr', /\/api\/ocr$/.test(localBody.ocrUrl || ''), localBody.ocrUrl);
    check('按配置指定了识别语言',
        localBody.ocrLang === 'models/config_japan.txt', String(localBody.ocrLang));
    check('传了 base64 且不带 data: 前缀（接口要求）',
        localBody.ocrHasBase64 === true && localBody.ocrBase64HasPrefix === false,
        JSON.stringify({ has: localBody.ocrHasBase64, prefix: localBody.ocrBase64HasPrefix }));
    check('翻译走的是纯文本请求（不带图片）',
        localBody.hasImage === false, 'hasImage=' + localBody.hasImage);
    check('原文作为纯文本 user 消息发出',
        typeof localBody.userContent === 'string' && /おはよう/.test(localBody.userContent),
        String(localBody.userContent));
    check('本地路径同样关闭了思考模式',
        localBody.chatBody.thinking && localBody.chatBody.thinking.type === 'disabled',
        JSON.stringify(localBody.chatBody && localBody.chatBody.thinking));

    S('7. 诊断报告包含错误与思考模式信息');
    const rep = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.CFG.engine = 'openai-vision';
            H.CFG.apiBase = 'https://api.deepseek.com';
            H.CFG.apiKey = 'sk-abc';
            H.Diag.lastError = { time: '12:00:00', msg: 'HTTP 401　Authentication Fails　→ API Key 不对或没填', stack: '' };
            const t = H.Diag.build();
            H.Diag.lastError = null;
            return t;
        })()`);
    check('报告含思考模式配置', /思考模式/.test(rep), rep.slice(0, 100));
    check('报告含最大输出配置', /最大输出/.test(rep));
    check('报告含最近错误段', /最近一次错误/.test(rep));
    check('报告里能看到具体错误内容', /401/.test(rep));

    S('8. 无异常');
    const errs = cdp.errorsFor(sessionId);
    check('页面无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' || '));
} catch (e) {
    console.log('\nFAIL 崩溃: ' + e.message);
    console.log(cdp.pageErrors.slice(0, 6).map(x => '   ' + String(x.text).slice(0, 350)).join('\n'));
    // 记进 R，否则总结会打印"失败 0"和退出码 1 自相矛盾，看着像全过了
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
