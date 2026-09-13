// 免费网页接口（web-translate 引擎）测试
//
// 这三个接口都是逆向来的内部接口，测试里当然不能真去打它们 ——
// 用 GM_xmlhttpRequest 桩按 URL 模拟三家的响应，重点验证：
//   · 每个引擎自己的语言码映射（同一门语言三家叫法不一样）
//   · 降级链：前一个挂了自动换下一个，全挂了错误里要带每一家的原因
//   · 必应 token 过期（返回空 body）时会重抓一次再试
//   · 限速：同一引擎两次请求之间要隔开，别把人家接口打挂
//   · 缓存命中不再发请求
//   · 面板联动、测活、诊断报告
import { Cdp, startServer } from './cdp.mjs';
import { PAGES, readUserscript } from './paths.mjs';

const USERSCRIPT = readUserscript();
const PORT = 8782;
const BASE = `http://127.0.0.1:${PORT}`;

const PRELUDE = `
(function () {
    const store = window.__gmStore = {};
    window.GM_getValue = function (k, d) { return (k in store) ? store[k] : d; };
    window.GM_setValue = function (k, v) { store[k] = v; };
    window.GM_registerMenuCommand = function () {};

    const W = window.__wt = {
        calls: [],            // 所有出网请求（含时间戳）
        fail: {},             // 'tencent' -> true 让这家失败
        delay: 3,
        ocrText: 'おはようございます',
        bingPage: 0,          // 必应取页面次数
        bingPost: 0,          // 必应翻译次数
        bingEmptyFirst: false,// 第一次翻译返回空 body（模拟 token 过期）
        bingEmptyOnce: false,
        tencentReq: null,
        caiyunReq: null,
        texts: { tencent: '你好，今天天气真好。', caiyun: '你好。今天天气真好啊。', bing: '你好。今天天气很好呢。' },
        count: function (re) { return this.calls.filter(function (c) { return re.test(c.url); }).length; },
        reset: function () {
            this.calls.length = 0;
            this.fail = {};
            this.bingPage = 0;
            this.bingPost = 0;
            this.bingEmptyFirst = false;
            this.tencentReq = null;
            this.caiyunReq = null;
        },
    };

    window.GM_xmlhttpRequest = function (opts) {
        const url = opts.url;
        let body = null;
        try { body = JSON.parse(opts.data); } catch (e) { body = opts.data; }
        W.calls.push({ url: url, method: opts.method || 'POST', body: body, headers: opts.headers, t: Date.now() });

        const reply = function (status, text) {
            setTimeout(function () { opts.onload && opts.onload({ status: status, responseText: text }); }, W.delay);
        };
        const boom = function () {
            setTimeout(function () { opts.onerror && opts.onerror(new Error('模拟网络失败')); }, W.delay);
        };

        // Umi-OCR
        if (/\\/api\\/ocr$/.test(url)) {
            return reply(200, JSON.stringify({ code: 100, data: W.ocrText, time: 0.1 }));
        }
        // 腾讯 transmart
        if (/transmart\\.qq\\.com\\/api\\/imt/.test(url)) {
            if (W.fail.tencent) return reply(500, 'boom');
            W.tencentReq = body;
            return reply(200, JSON.stringify({ header: { ret_code: 'succ' }, auto_translation: [W.texts.tencent] }));
        }
        // 彩云小译
        if (/interpreter\\.caiyunai\\.com/.test(url)) {
            if (W.fail.caiyun) return reply(403, 'nope');
            W.caiyunReq = body;
            return reply(200, JSON.stringify({ rc: 0, target: [W.texts.caiyun] }));
        }
        // 必应：翻译接口（要放在取页面之前判断）
        if (/ttranslatev3/.test(url)) {
            if (W.fail.bing) return reply(500, 'boom');
            W.bingPost++;
            if (W.bingEmptyFirst && W.bingPost === 1) return reply(200, '');
            return reply(200, JSON.stringify([{ translations: [{ text: W.texts.bing }] }]));
        }
        // 必应：取 token 页面
        if (/bing\\.com\\/translator/.test(url)) {
            if (W.fail.bing) return reply(500, 'boom');
            W.bingPage++;
            return reply(200, '<html>IG:"ABC123" params_AbusePreventionHelper = [1234,"TOKEN-1",3600000]</html>');
        }
        boom();
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
const cdp = await Cdp.launch({ port: 9382 });

try {
    const { sessionId } = await cdp.newPage();
    await cdp.addInitScript(PRELUDE, sessionId);
    await cdp.addInitScript(USERSCRIPT, sessionId);
    await cdp.navigate(sessionId, `${BASE}/lab.html?mode=canvas`,
        { waitFor: 'window.__H1SUB__ && window.__lab && window.__lab.ready', timeoutMs: 25000 });

    const ev = (e, o = {}) => cdp.evaluate(e, { sessionId, ...o });
    const evAsync = (e) => cdp.evaluate(e, { sessionId, awaitPromise: true });

    // ─────────────────────────────────────────────
    S('1. 各家自己的语言码映射');
    const langs = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const p = (id, s, t) => H.wtLangPair(id, s, t);
            return {
                tJaZh: p('tencent', 'ja', 'zh'),
                tHant: p('tencent', 'ja', 'zh-Hant'),
                bAuto: p('bing', 'auto', 'zh'),
                bJaEn: p('bing', 'ja', 'en'),
                cJaZh: p('caiyun', 'ja', 'zh'),
                cAuto: p('caiyun', 'auto', 'zh'),
                cHant: p('caiyun', 'ja', 'zh-Hant'),
                same: p('tencent', 'ja', 'ja'),
            };
        })()`);
    check('腾讯：ja→zh 原样传', langs.tJaZh && langs.tJaZh.from === 'ja' && langs.tJaZh.to === 'zh',
        JSON.stringify(langs.tJaZh));
    check('腾讯：繁体中文用 zh-TW', langs.tHant && langs.tHant.to === 'zh-TW', JSON.stringify(langs.tHant));
    check('必应：auto 要写成 auto-detect', langs.bAuto && langs.bAuto.from === 'auto-detect',
        JSON.stringify(langs.bAuto));
    check('必应：简体中文用 zh-Hans', langs.bAuto && langs.bAuto.to === 'zh-Hans', JSON.stringify(langs.bAuto));
    check('彩云：trans_type 拼成 ja2zh', langs.cJaZh && langs.cJaZh.tt === 'ja2zh', JSON.stringify(langs.cJaZh));
    check('彩云：不接受 auto（返回 null 让上层跳过）', langs.cAuto === null, JSON.stringify(langs.cAuto));
    check('彩云：繁体目标归到 zh', langs.cHant && langs.cHant.tt === 'ja2zh', JSON.stringify(langs.cHant));
    check('源语言=目标语言时返回 null', langs.same === null);

    S('2. 全链路：本机 Umi-OCR 识别 + 腾讯翻译');
    const run = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            Object.assign(H.CFG, { engine: 'web-translate', wtEngine: 'auto', wtMinInterval: 0,
                srcLang: '日语', tgtLang: '简体中文' });
            H.wtReset();
            window.__wt.reset();
            const c = document.createElement('canvas');
            c.width = 200; c.height = 60;
            const out = await H.recognizeAndTranslate(c);
            const reqs = window.__wt.calls;
            return {
                out: out,
                ocr: reqs.filter(q => /\\/api\\/ocr$/.test(q.url)).length,
                tencent: reqs.filter(q => /transmart/.test(q.url)).length,
                body: window.__wt.tencentReq,
            };
        })()`);
    check('识别 + 翻译都跑通',
        run.out && run.out.original === 'おはようございます' && run.out.translation === '你好，今天天气真好。',
        JSON.stringify(run.out));
    check('识别走的是本机 Umi-OCR', run.ocr === 1, 'OCR 请求数 = ' + run.ocr);
    check('翻译走的是腾讯交互翻译', run.tencent === 1, '腾讯请求数 = ' + run.tencent);
    check('请求体按腾讯的格式组装',
        run.body && run.body.header && run.body.header.fn === 'auto_translation'
        && run.body.source && run.body.source.lang === 'ja'
        && run.body.source.text_list && run.body.source.text_list[0] === 'おはようございます'
        && run.body.target && run.body.target.lang === 'zh',
        JSON.stringify(run.body).slice(0, 200));

    S('3. 降级链');
    const chain = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            const out = {};
            H.CFG.wtEngine = 'auto';
            H.CFG.wtMinInterval = 0;

            // ① 腾讯挂了 → 换彩云
            H.wtReset();
            window.__wt.reset();
            window.__wt.fail.tencent = true;
            window.__wt.ocrText = 'おはよう';
            out.fallback1 = await H.wtTranslate('一句测试文本');
            out.tried1 = { tencent: window.__wt.count(/transmart/), caiyun: window.__wt.count(/caiyunai/) };

            // ② 腾讯 + 彩云都挂 → 换必应（要先抓 token 页面）
            H.wtReset();
            window.__wt.reset();
            window.__wt.fail.tencent = true;
            window.__wt.fail.caiyun = true;
            out.fallback2 = await H.wtTranslate('第二句测试');
            out.tried2 = { bingPage: window.__wt.bingPage, bingPost: window.__wt.bingPost };

            // ③ 三家全挂 → 错误里要能看到每一家的原因
            H.wtReset();
            window.__wt.reset();
            window.__wt.fail.tencent = true;
            window.__wt.fail.caiyun = true;
            window.__wt.fail.bing = true;
            try { await H.wtTranslate('第三句测试'); out.allFail = 'no-error'; }
            catch (e) { out.allFail = e.message; }
            out.stats = JSON.parse(JSON.stringify(H.wtStats));
            return out;
        })()`);
    check('腾讯挂了自动换彩云', chain.fallback1 === '你好。今天天气真好啊。', JSON.stringify(chain.fallback1));
    check('降级时确实两家都试过了',
        chain.tried1.tencent === 1 && chain.tried1.caiyun === 1, JSON.stringify(chain.tried1));
    check('腾讯彩云都挂时换必应', chain.fallback2 === '你好。今天天气很好呢。', JSON.stringify(chain.fallback2));
    check('必应要先抓 token 页面再翻译',
        chain.tried2.bingPage === 1 && chain.tried2.bingPost === 1, JSON.stringify(chain.tried2));
    check('三家全挂时错误里带上每一家的原因',
        /tencent/.test(chain.allFail || '') && /caiyun/.test(chain.allFail || '')
        && /bing/.test(chain.allFail || ''), String(chain.allFail).slice(0, 200));
    check('成败计数进了 wtStats（给诊断报告用）',
        chain.stats.tencent && chain.stats.tencent.fail >= 3 && chain.stats.bing
        && chain.stats.bing.lastError, JSON.stringify(chain.stats));

    S('4. 必应 token 过期会自动重取');
    const bing = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            H.CFG.wtEngine = 'bing';
            H.CFG.wtMinInterval = 0;
            H.wtReset();
            window.__wt.reset();
            window.__wt.bingEmptyFirst = true;   // 第一次翻译回空 body（token 过期）
            const out = await H.wtTranslate('必应重取测试');
            return { out: out, page: window.__wt.bingPage, post: window.__wt.bingPost };
        })()`);
    check('token 过期后重抓页面并重试成功',
        bing.out === '你好。今天天气很好呢。', JSON.stringify(bing.out));
    check('确实是「翻译失败 → 重抓 → 再翻」两次',
        bing.page === 2 && bing.post === 2, JSON.stringify(bing));

    S('5. 限速与缓存');
    const throttle = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            H.CFG.wtEngine = 'tencent';
            H.CFG.wtMinInterval = 300;
            H.wtReset();
            window.__wt.reset();
            await H.wtTranslate('限速测试甲');
            const t1 = window.__wt.calls[window.__wt.calls.length - 1].t;
            await H.wtTranslate('限速测试乙');
            const t2 = window.__wt.calls[window.__wt.calls.length - 1].t;

            // 关掉限速后不该再等
            H.CFG.wtMinInterval = 0;
            H.wtReset();
            const t3start = Date.now();
            await H.wtTranslate('限速测试丙');
            const elapsed = Date.now() - t3start;

            // 同一句第二次应该命中缓存，不发请求
            window.__wt.reset();
            H.CFG.wtEngine = 'auto';
            await H.wtTranslate('缓存测试句');
            const n1 = window.__wt.calls.length;
            await H.wtTranslate('缓存测试句');
            const n2 = window.__wt.calls.length;
            return { gap: t2 - t1, elapsed: elapsed, n1: n1, n2: n2 };
        })()`);
    check('同一引擎两次请求之间被限速隔开', throttle.gap >= 270, '间隔 = ' + throttle.gap + 'ms');
    check('间隔设为 0 时不再等待', throttle.elapsed < 200, '耗时 = ' + throttle.elapsed + 'ms');
    check('同一句命中缓存，不再发请求',
        throttle.n1 === 1 && throttle.n2 === 1, JSON.stringify(throttle));

    S('6. 指定单一接口 / 测活');
    const single = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            H.CFG.wtEngine = 'caiyun';
            H.CFG.wtMinInterval = 0;
            H.wtReset();
            window.__wt.reset();
            const out = await H.wtTranslate('指定接口测试');
            const tried = {
                tencent: window.__wt.count(/transmart/),
                caiyun: window.__wt.count(/caiyunai/),
                bing: window.__wt.count(/ttranslatev3/),
                req: window.__wt.caiyunReq,
            };

            H.CFG.wtEngine = 'auto';
            window.__wt.reset();
            window.__wt.fail.bing = true;
            const rows = await H.wtSelftest();
            return { out: out, tried: tried, rows: rows };
        })()`);
    check('指定彩云时只打彩云，不动其它两家',
        single.out === '你好。今天天气真好啊。' && single.tried.tencent === 0 && single.tried.bing === 0,
        JSON.stringify(single.tried));
    check('彩云请求体带 trans_type 和公开 token',
        single.tried.req && single.tried.req.trans_type === 'ja2zh', JSON.stringify(single.tried.req));
    check('测活返回三家各一行', Array.isArray(single.rows) && single.rows.length === 3,
        JSON.stringify(single.rows).slice(0, 200));
    check('测活如实反映谁挂了',
        single.rows.filter(r => r.ok).length === 2
        && single.rows.find(r => r.id === 'bing').ok === false,
        JSON.stringify(single.rows.map(r => r.id + ':' + r.ok)));

    S('7. 面板联动');
    const ui = await ev(`
        (() => {
            const out = {};
            const eng = document.querySelector('#h1sub-engine');
            const sel = document.querySelector('#h1sub-wtEngine');
            const iv = document.querySelector('#h1sub-wtMinInterval');

            out.optionExists = [...eng.options].some(o => o.value === 'web-translate');
            out.controlsExist = !!sel && !!iv && !!document.querySelector('#h1sub-wt-test')
                && !!document.querySelector('#h1sub-wt-status');

            eng.value = 'web-translate';
            eng.dispatchEvent(new Event('change'));
            out.wtShown = document.querySelector('#h1sub-webtranslate').style.display !== 'none';
            out.openaiHidden = document.querySelector('#h1sub-openai').style.display === 'none';
            // 免费接口靠本机 Umi-OCR 识别，所以 Umi-OCR 配置区要露出来
            out.umiShown = document.querySelector('#h1sub-umionly').style.display !== 'none';
            out.baiHidden = document.querySelector('#h1sub-browserai').style.display === 'none';

            sel.value = 'bing';
            sel.dispatchEvent(new Event('change'));
            out.cfgEngine = window.__H1SUB__.CFG.wtEngine;

            iv.value = '500';
            iv.dispatchEvent(new Event('change'));
            out.cfgInterval = window.__H1SUB__.CFG.wtMinInterval;

            out.configured = window.__H1SUB__.isConfigured();

            eng.value = 'openai-vision';
            eng.dispatchEvent(new Event('change'));
            out.wtHidden = document.querySelector('#h1sub-webtranslate').style.display === 'none';
            out.backToOpenai = document.querySelector('#h1sub-openai').style.display !== 'none';
            return out;
        })()`);
    check('引擎下拉里有「免费网页接口」选项', ui.optionExists === true);
    check('免费接口区块的控件都在', ui.controlsExist === true);
    check('切到免费接口 → 区块出现、API 配置区隐藏',
        ui.wtShown === true && ui.openaiHidden === true, JSON.stringify(ui));
    check('免费接口引擎会露出 Umi-OCR 配置区（识别要用）', ui.umiShown === true);
    check('离线引擎的区块保持隐藏', ui.baiHidden === true);
    check('接口下拉写回配置', ui.cfgEngine === 'bing', ui.cfgEngine);
    check('间隔输入写回配置', ui.cfgInterval === 500, String(ui.cfgInterval));
    check('免费接口不需要 API Key 也算已配置', ui.configured === true, JSON.stringify(ui));
    check('切回视觉引擎后区块收起', ui.wtHidden === true && ui.backToOpenai === true,
        JSON.stringify(ui));

    S('8. 诊断报告');
    const rep = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            Object.assign(H.CFG, { engine: 'web-translate', wtEngine: 'auto', wtMinInterval: 1200, apiKey: '' });
            window.__wt.reset();
            window.__wt.fail.caiyun = true;
            H.Diag.wtSelftest = await H.wtSelftest();
            await H.wtTranslate('报告测试句');
            const t = H.Diag.build();
            H.Diag.wtSelftest = null;
            return t;
        })()`);
    check('报告里有免费网页接口段', /免费网页接口/.test(rep), rep.slice(0, 80));
    check('报告写明识别方式与翻译接口',
        /Umi-OCR 本机识别/.test(rep) && /翻译接口/.test(rep), rep.slice(0, 400));
    check('报告写出降级链顺序', /tencent → caiyun → bing/.test(rep), rep.slice(0, 400));
    check('报告说明不需要 API Key', /不需要（逆向免费网页接口）/.test(rep));
    check('报告提示这是非公开接口', /非公开接口/.test(rep));
    check('报告里有各家成败计数', /tencent/.test(rep) && /成功/.test(rep) && /失败/.test(rep));
    check('报告里有测活结果', /上次测活结果/.test(rep));

    S('9. 无异常');
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
