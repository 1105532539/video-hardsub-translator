// 优化批次的专项测试
//
// 覆盖这一轮改动的每一条，重点在「验证测试本身不是空转」：
// 凡是修 bug 的，都要能证明关掉修复就会红。
import { Cdp, startServer } from './cdp.mjs';
import { PAGES, readUserscript } from './paths.mjs';

const USERSCRIPT = readUserscript();
const PORT = 8790;
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
    window.__umiText = 'おはようございます';
    window.__gmResponse = null;
    window.GM_xmlhttpRequest = function (opts) {
        let body = null;
        try { body = JSON.parse(opts.data); } catch (e) { body = opts.data; }
        window.__gmReqs.push({ url: opts.url, body: body, raw: opts.data });

        if (/\\/api\\/ocr\\/get_options/.test(opts.url)) {
            setTimeout(function () {
                opts.onload && opts.onload({ status: 200, responseText: JSON.stringify({
                    'ocr.language': { optionsList: [['models/config_japan.txt', '日本語']] },
                }) });
            }, 3);
            return;
        }
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

        const resp = window.__gmResponse;
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

const okResp = (content) => ({
    status: 200,
    text: JSON.stringify({
        model: 'deepseek-flash',
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }),
});

const srv = await startServer({ port: PORT, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: 9390 });
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
    const { sessionId } = await cdp.newPage();
    await cdp.addInitScript(PRELUDE, sessionId);
    await cdp.addInitScript(USERSCRIPT, sessionId);
    await cdp.navigate(sessionId, `${BASE}/lab.html?mode=canvas`,
        { waitFor: 'window.__H1SUB__ && window.__lab && window.__lab.ready', timeoutMs: 25000 });
    const ev = (e, o = {}) => cdp.evaluate(e, { sessionId, ...o });
    const evAsync = (e) => cdp.evaluate(e, { sessionId, awaitPromise: true });

    // ─────────────────────────────────────────────
    S('1. H1 视觉模型不能被误判成"不支持图片"');

    const vision = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const names = [
                'moonshot-v1-8k-vision-preview',   // 脚本自己的 Kimi 视觉预设
                'glm-4v-plus',                     // 智谱视觉
                'qwen-vl-max',                     // 通义视觉
                'deepseek-flash',
                'gpt-4o-mini',
            ];
            const plain = ['deepseek-v4-pro', 'gpt-3.5-turbo', 'qwen-max',
                           'glm-4-plus', 'moonshot-v1-8k', 'deepseek-chat'];
            return {
                vision: names.map(n => [n, H.isNoVisionModel(n)]),
                plain: plain.map(n => [n, H.isNoVisionModel(n)]),
            };
        })()`);

    const missed = vision.vision.filter(([, v]) => v !== false);
    check('视觉模型全部判为"能看图"', missed.length === 0,
        '被误判: ' + JSON.stringify(missed));
    const wrong = vision.plain.filter(([, v]) => v !== true);
    check('纯文本模型仍然判为"不能看图"（前缀规则没被破坏）', wrong.length === 0,
        '漏判: ' + JSON.stringify(wrong));

    // 最强的一条：直接驱动真实的预设下拉框，而不是只测函数
    const presetRun = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const sel = document.querySelector('#h1sub-preset');
            const opts = Array.from(sel.options);
            const kimi = opts.findIndex(o => /Kimi/.test(o.textContent));
            const pro = opts.findIndex(o => /deepseek-v4-pro/.test(o.textContent));

            const run = (idx) => {
                H.CFG.engine = 'openai-vision';
                document.querySelector('#h1sub-engine').value = 'openai-vision';
                sel.value = String(idx);
                sel.dispatchEvent(new Event('change'));
                return {
                    engine: H.CFG.engine,
                    model: H.CFG.model,
                    note: document.querySelector('#h1sub-preset-note').textContent,
                };
            };
            return { kimi, pro, kimiRes: run(kimi), proRes: run(pro) };
        })()`);

    check('预设列表里确实有 Kimi 那项', presetRun.kimi > 0, JSON.stringify(presetRun.kimi));
    check('选中 Kimi（视觉）预设后引擎仍是视觉引擎，没被偷偷切走',
        presetRun.kimiRes.engine === 'openai-vision',
        JSON.stringify(presetRun.kimiRes));
    check('而且提示里不该出现"已自动切到 Umi-OCR"',
        !/自动切到/.test(presetRun.kimiRes.note),
        presetRun.kimiRes.note);
    check('对照：deepseek-v4-pro 仍然会被自动切到 Umi-OCR（原功能没坏）',
        presetRun.proRes.engine === 'umi-ocr' && /自动切到/.test(presetRun.proRes.note),
        JSON.stringify(presetRun.proRes));

    // ─────────────────────────────────────────────
    S('2. L9/M11 配置规整：坏引擎名与注入型 fontSize');

    const san = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const t = (o) => JSON.parse(JSON.stringify(H.sanitizeCfg(o)));
            return {
                // 老版本残留的引擎名 → 下拉框会空白，要兜回默认值
                oldLocal: t({ engine: 'local' }).engine,
                oldText: t({ engine: 'openai-text' }).engine,
                oldLocalOnly: t({ engine: 'localonly' }).engine,
                goodEngine: t({ engine: 'umi-ocr' }).engine,
                // 注入：fontSize 是唯一被直接拼进 innerHTML 的配置值
                inject: t({ fontSize: '24px;background:url(javascript:alert(1))' }).fontSize,
                inject2: t({ fontSize: '<img src=x onerror=alert(1)>' }).fontSize,
                clamped: t({ fontSize: 9999 }).fontSize,
                clampedLow: t({ fontSize: -5 }).fontSize,
                opacity: t({ bgOpacity: 50 }).bgOpacity,
                badColor: t({ textColor: 'red;x:url(1)' }).textColor,
                okColor: t({ textColor: '#ff00ff' }).textColor,
                badRegion: t({ region: { x: 'a', y: 0, w: 100, h: 50 } }).region,
                okRegion: t({ region: { x: 1, y: 2, w: 100, h: 50 } }).region,
                negRegion: t({ region: { x: 1, y: 2, w: -5, h: 50 } }).region,
            };
        })()`);

    check('引擎名 local → 兜回默认视觉引擎', san.oldLocal === 'openai-vision', san.oldLocal);
    check('引擎名 openai-text → 兜回默认', san.oldText === 'openai-vision', san.oldText);
    check('引擎名 localonly → 兜回默认', san.oldLocalOnly === 'openai-vision', san.oldLocalOnly);
    check('合法引擎名原样保留', san.goodEngine === 'umi-ocr', san.goodEngine);
    check('fontSize 注入被拦下（不可能把尖括号带出去）',
        typeof san.inject === 'number' && typeof san.inject2 === 'number',
        JSON.stringify([san.inject, san.inject2]));
    check('fontSize 越界被夹到 12~48',
        san.clamped === 48 && san.clampedLow === 12,
        JSON.stringify([san.clamped, san.clampedLow]));
    check('bgOpacity 夹到 0~1', san.opacity === 1, String(san.opacity));
    check('非法 textColor 兜回默认，合法的保留',
        san.badColor === '#ffffff' && san.okColor === '#ff00ff',
        JSON.stringify([san.badColor, san.okColor]));
    check('坐标坏掉的 region 被丢弃（避免后面算出 NaN）',
        san.badRegion === null && san.negRegion === null,
        JSON.stringify([san.badRegion, san.negRegion]));
    check('正常 region 原样保留', san.okRegion && san.okRegion.w === 100,
        JSON.stringify(san.okRegion));

    // 真正走一遍导入弹窗，确认注入值到不了 innerHTML
    const imported = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.UI.importCfg();
            const ta = document.querySelector('#h1sub-imp-ta');
            ta.value = JSON.stringify({
                engine: 'local',
                fontSize: '24px"><img src=x onerror=window.__pwned=1>',
                tgtLang: '简体中文',
            });
            document.querySelector('#h1sub-imp-ok').click();
            const overlay = document.querySelector('#h1sub-overlay');
            const payload = { fontSize: H.CFG.fontSize, engine: H.CFG.engine };
            // 清掉弹窗，别影响后面的用例
            const m = ta.closest('div[style*="z-index:2147483641"]');
            if (m) m.remove();
            return { payload, pwned: !!window.__pwned,
                     hasImg: overlay ? !!overlay.querySelector('img') : false };
        })()`);

    check('导入恶意配置后 fontSize 是数字', typeof imported.payload.fontSize === 'number',
        JSON.stringify(imported.payload));
    check('导入恶意配置后引擎被兜回合法值', imported.payload.engine === 'openai-vision',
        JSON.stringify(imported.payload));
    check('注入的 payload 没有执行', imported.pwned === false);

    // ─────────────────────────────────────────────
    S('3. H2 视频移动后，框选区域跟着重新锚定');

    const anchor = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const box = H.getContentBox(v);

            // 框选时：视频在 box 位置，区域取中间一条
            const r = H.anchorRegion(box.left + 40, box.top + 100, box.width - 80, 60, v);
            const anchored = !!(r.box && r.box.width > 0);

            // 同一个位置换算，应该基本不动
            const same = H.resolveRegion(r, v);

            return {
                anchored,
                sameDx: Math.abs(same.x - r.x),
                sameW: Math.abs(same.w - r.w),
                // 伪造成"视频整个下移 120px、宽度放大一倍"，看区域跟不跟
                moved: (() => {
                    const fake = { ...r, box: { left: box.left, top: box.top, width: box.width / 2, height: box.height } };
                    return H.resolveRegion(fake, v);
                })(),
                baseW: r.w,
                baseX: r.x,
                boxLeft: box.left,
            };
        })()`);

    check('框选时会记下当时视频的位置', anchor.anchored === true, JSON.stringify(anchor));
    check('视频没动时，换算结果和原区域一致',
        anchor.sameDx < 0.5 && anchor.sameW < 0.5, JSON.stringify(anchor));
    check('视频尺寸变化时区域跟着缩放（不再钉死视口坐标）',
        Math.abs(anchor.moved.w - anchor.baseW * 2) < 1,
        JSON.stringify({ movedW: anchor.moved.w, expect: anchor.baseW * 2 }));

    // 老配置（没有 box 字段）必须还能用
    const legacy = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const old = { x: 100, y: 200, w: 300, h: 60 };   // 旧版存的格式
            const got = H.resolveRegion(old, v);
            return { same: got.x === 100 && got.y === 200 && got.w === 300 && got.h === 60 };
        })()`);
    check('旧版配置（无锚点）仍按原样使用，不会被搞坏', legacy.same === true,
        JSON.stringify(legacy));

    const badBox = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            // 锚点字段可能是导入进来的垃圾值
            const r = { x: 10, y: 20, w: 100, h: 40,
                        box: { left: 'x', top: null, width: 0, height: 5 } };
            const got = H.resolveRegion(r, v);
            return { ok: got.x === 10 && got.y === 20 && got.w === 100 && got.h === 40 };
        })()`);
    check('锚点本身是坏值时安全退回原区域（不会算出 NaN 传进 canvas）',
        badBox.ok === true, JSON.stringify(badBox));

    // ─────────────────────────────────────────────
    S('4. M1 改了目标语言后，翻译缓存必须失效');

    const cacheTest = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const sel = document.querySelector('#h1sub-tgtLang') || document.querySelector('#h1sub-tgt');
            if (!sel) return { noEl: true };
            H.CFG.engine = 'umi-ocr';
            H.CFG.apiBase = 'https://api.deepseek.com';
            H.CFG.apiKey = 'sk-abc';
            return { noEl: false, tag: sel.tagName, id: sel.id, cur: sel.value };
        })()`);

    if (cacheTest.noEl) {
        check('找得到目标语言控件', false, JSON.stringify(cacheTest));
    } else {
        // 用 GM 桩统计真实发出的翻译请求数：同一条原文换语言后必须重译
        const cacheRun = await evAsync(`
            (async () => {
                const H = window.__H1SUB__;
                const sel = document.querySelector('#${cacheTest.id}');
                window.__gmResponse = ${JSON.stringify(okResp('早上好'))};
                H.CFG.tgtLang = '简体中文';
                // 先翻译一次，把结果灌进缓存
                await H.translateText('キャッシュ確認');
                const afterFirst = window.__gmReqs.filter(r => !/api\\/ocr/.test(r.url)).length;
                // 同一句再翻一次：命中缓存，不该再发请求
                await H.translateText('キャッシュ確認');
                const afterSecond = window.__gmReqs.filter(r => !/api\\/ocr/.test(r.url)).length;
                // 换目标语言，然后走真实控件触发 change
                sel.value = (sel.tagName === 'SELECT')
                    ? Array.from(sel.options).map(o => o.value).find(v => v !== sel.value)
                    : 'English';
                sel.dispatchEvent(new Event('change'));
                await H.translateText('キャッシュ確認');
                const afterLangChange = window.__gmReqs.filter(r => !/api\\/ocr/.test(r.url)).length;
                return { afterFirst, afterSecond, afterLangChange };
            })()`);

        check('第一次翻译发了请求', cacheRun.afterFirst === 1, JSON.stringify(cacheRun));
        check('同一句第二次命中缓存，不再发请求',
            cacheRun.afterSecond === cacheRun.afterFirst, JSON.stringify(cacheRun));
        check('改了目标语言后缓存失效，会重新翻译',
            cacheRun.afterLangChange > cacheRun.afterSecond, JSON.stringify(cacheRun));
    }

    // ─────────────────────────────────────────────
    S('5. M4 只认出原文、没拿到译文时，不能把原文当译文显示');

    await ev(`
        (() => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const b = H.getContentBox(v);
            const P = window.__PATTERN__;
            H.CFG.region = H.anchorRegion(
                b.left, b.top + (P.BAND_Y / v.videoHeight) * b.height,
                b.width, (P.BAND_H / v.videoHeight) * b.height, v);
            H.CFG.engine = 'umi-ocr';
            H.CFG.apiBase = 'https://api.deepseek.com';
            H.CFG.apiKey = 'sk-abc';
            H.CFG.smartSkip = false;
            H.CFG.showOriginal = false;
            window.__umiText = 'おはようございます';
            window.__gmResponse = ${JSON.stringify(okResp(''))};   // 译文故意留空

            // 记下这一轮出现过的所有状态 —— 只读最后一帧的话，
            // 读到哪一轮的状态是有偶然性的，断言会飘
            window.__statuses = [];
            const orig = H.UI.setStatus;
            H.UI.setStatus = function (msg, kind) {
                window.__statuses.push(String(msg));
                return orig.call(this, msg, kind);
            };
        })()`);

    await ev(`window.__H1SUB__.Pipeline.start()`);
    await sleep(2200);

    const emptyTr = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const ov = document.querySelector('#h1sub-overlay');
            const out = {
                text: ov ? ov.textContent : '(无悬浮层)',
                shown: ov ? getComputedStyle(ov).display !== 'none' : false,
                statuses: window.__statuses.slice(),
                calls: window.__gmReqs.filter(r => !/api\\/ocr/.test(r.url)).length,
            };
            H.Pipeline.stop();
            return out;
        })()`);

    check('确实调用了翻译接口（说明流程真的走到了那一步）',
        emptyTr.calls >= 1, JSON.stringify(emptyTr));
    check('没拿到译文时，不会把日文原文当作译文显示',
        !/おはようございます/.test(emptyTr.text), JSON.stringify(emptyTr));
    check('这一轮里出现过"没拿到译文"的提示',
        emptyTr.statuses.some(s => /没拿到译文/.test(s)),
        JSON.stringify(emptyTr.statuses.slice(0, 6)));
    check('这一轮里从没谎报过"已翻译"',
        !emptyTr.statuses.some(s => /^已翻译/.test(s)),
        JSON.stringify(emptyTr.statuses.slice(0, 6)));

    // ─────────────────────────────────────────────
    S('6. M12 框选遮罩不再吞掉页面点击');

    const maskTest = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.RegionSelector.begin();
            const divs = Array.from(document.body.children)
                .filter(d => d.style.position === 'fixed' && d.style.inset === '0px');
            const mask = divs[0];
            const r = mask ? {
                pe: getComputedStyle(mask).pointerEvents,
                z: getComputedStyle(mask).zIndex,
                bg: getComputedStyle(mask).backgroundColor,
            } : null;
            H.RegionSelector.active = false;
            divs.forEach(d => d.remove());
            return r;
        })()`);

    check('遮罩存在且仍然负责变暗', !!maskTest && maskTest.bg !== 'rgba(0, 0, 0, 0)',
        JSON.stringify(maskTest));
    check('遮罩设了 pointer-events:none（mouseup 丢了也不会卡死页面）',
        maskTest && maskTest.pe === 'none', JSON.stringify(maskTest));

    // 真实场景：用户点完面板上的「框选字幕区」按钮，按钮处于聚焦状态；
    // 等他移到视频上按下左键，浏览器会把焦点从按钮移走 → 按钮上派发 blur。
    // 如果 blur 监听挂在捕获阶段，这个"页内失焦"会被当成"窗口失焦"，
    // 框选还没开始就被取消掉了。
    const blurBug = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.RegionSelector.active = false;
            const countMask = () => Array.from(document.body.children)
                .filter(d => d.style.position === 'fixed' && d.style.inset === '0px').length;
            const drag = (x, y) => {
                document.dispatchEvent(new MouseEvent('mousedown',
                    { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
                document.dispatchEvent(new MouseEvent('mousemove',
                    { bubbles: true, cancelable: true, clientX: x + 200, clientY: y + 60 }));
            };

            const btn = document.createElement('button');
            document.body.appendChild(btn);
            btn.focus();                       // ← 刚点完面板按钮的状态

            H.RegionSelector.begin();
            // 抓住遮罩本体，用 isConnected 判断，别靠样式筛选（会误伤别的元素）
            const maskEl = Array.from(document.body.children).find(d =>
                d.style.position === 'fixed' && d.style.inset === '0px'
                && d.style.background.indexOf('rgba(0') === 0);
            const afterBegin = !!maskEl;

            // 用户按下左键准备拖 → 按钮失焦
            drag(100, 100);
            btn.dispatchEvent(new FocusEvent('blur', { bubbles: false }));

            const boxEl = Array.from(document.body.children).find(d =>
                d.style.borderColor === 'rgb(34, 211, 238)'
                || d.style.border === '2px solid rgb(34, 211, 238)');
            const boxW = boxEl ? boxEl.style.width : null;

            const stillActive = H.RegionSelector.active;
            const maskConnected = maskEl ? maskEl.isConnected : false;

            // 收尾：按 Esc 取消，别把监听留给后面的用例
            document.dispatchEvent(new KeyboardEvent('keydown',
                { key: 'Escape', bubbles: true }));
            btn.remove();
            const afterEsc = (maskEl ? maskEl.isConnected : true);
            return { afterBegin, maskConnected, stillActive, boxW,
                     boxShown: !!boxEl && boxEl.style.display === 'block', afterEsc };
        })()`);

    check('框选开始时遮罩已挂上', blurBug.afterBegin === true, JSON.stringify(blurBug));
    check('页内元素失焦（从按钮上移开）不会取消框选',
        blurBug.maskConnected === true && blurBug.stillActive === true,
        JSON.stringify(blurBug));
    check('按下左键后选区框真的跟着拖出来了',
        blurBug.boxShown === true && blurBug.boxW === '200px',
        JSON.stringify(blurBug));
    check('Esc 仍能正常取消框选', blurBug.afterEsc === false,
        JSON.stringify(blurBug));

    // 反过来：窗口真的失去焦点时，仍然要能兜底取消
    const winBlur = await ev(`
        (() => {
            const H = window.__H1SUB__;
            // 每次都重新数，不要用之前抓到的元素引用 ——
            // 引用即使已经脱离文档也还是真值，判断会飘
            const countMasks = () => Array.from(document.body.children).filter(d =>
                d.style.position === 'fixed' && d.style.inset === '0px'
                && d.style.background.indexOf('rgba(0') === 0).length;

            // 先按 Esc 收干净，保证这条用例的起点不受上一条残留状态影响
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            H.RegionSelector.active = false;
            const stale = countMasks();

            H.RegionSelector.begin();
            const before = countMasks();

            // 顺带确认 bubble 阶段的 window 监听确实收得到"窗口级 blur"
            let sawWindowBlur = 0;
            const probe = () => { sawWindowBlur++; };
            window.addEventListener('blur', probe, false);
            window.dispatchEvent(new FocusEvent('blur'));
            window.removeEventListener('blur', probe, false);

            return { stale, before, sawWindowBlur, after: countMasks(), active: H.RegionSelector.active };
        })()`);

    check('对照用例起点干净（没有上一条留下的遮罩）', winBlur.stale === 0,
        JSON.stringify(winBlur));
    check('窗口级 blur 事件确实会被 window 的非捕获监听收到', winBlur.sawWindowBlur === 1,
        JSON.stringify(winBlur));
    check('对照：窗口真的失焦时仍会兜底取消（原意图没丢）',
        winBlur.before === 1 && winBlur.after === 0 && winBlur.active === false,
        JSON.stringify(winBlur));

    // 端到端：真的去点面板上那个按钮，走完整条路径
    const viaButton = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.RegionSelector.active = false;
            const btn = document.querySelector('#h1sub-region');
            if (!btn) return { noBtn: true };

            // 按钮必须先看得见点得到
            const r = btn.getBoundingClientRect();
            const cs = getComputedStyle(btn);
            const clickable = r.width > 0 && r.height > 0
                && cs.display !== 'none' && cs.visibility !== 'hidden'
                && cs.pointerEvents !== 'none';

            btn.click();                      // ← 用户的操作

            const maskEl = Array.from(document.body.children).find(d =>
                d.style.position === 'fixed' && d.style.inset === '0px'
                && d.style.background.indexOf('rgba(0') === 0);
            const started = !!maskEl && H.RegionSelector.active === true;

            // 拖一下，看看选区框出没出来
            document.dispatchEvent(new MouseEvent('mousedown',
                { bubbles: true, clientX: 60, clientY: 60, button: 0 }));
            document.dispatchEvent(new MouseEvent('mousemove',
                { bubbles: true, clientX: 360, clientY: 140 }));
            const boxEl = Array.from(document.body.children).find(d =>
                d.style.borderColor === 'rgb(34, 211, 238)'
                || d.style.border === '2px solid rgb(34, 211, 238)');

            document.dispatchEvent(new MouseEvent('mouseup',
                { bubbles: true, clientX: 360, clientY: 140, button: 0 }));
            const region = H.CFG.region;

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return {
                clickable, started,
                boxW: boxEl ? boxEl.style.width : null,
                gotRegion: !!(region && region.w > 0 && region.h > 0),
                w: region ? Math.round(region.w) : 0,
                anchored: !!(region && region.box),
            };
        })()`);

    check('面板上的「框选字幕区」按钮可见可点', viaButton.clickable === true,
        JSON.stringify(viaButton));
    check('点下去真的进入框选状态（遮罩挂上、active 为真）',
        viaButton.started === true, JSON.stringify(viaButton));
    check('拖拽后选区框跟着画出来', viaButton.boxW === '300px', JSON.stringify(viaButton));
    check('松开鼠标后区域被记录下来并带上锚点',
        viaButton.gotRegion === true && viaButton.w === 300 && viaButton.anchored === true,
        JSON.stringify(viaButton));

    // ─────────────────────────────────────────────
    S('7. M5/M10 离屏画布复用、面板隐藏时不画预览');

    const bufTest = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const c = document.createElement('canvas');
            c.width = 400; c.height = 80;
            const g = c.getContext('2d');
            g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 80);
            g.fillStyle = '#000'; g.font = '20px sans-serif';
            g.fillText('あいうえお', 10, 45);

            // 连做两次，拿到的应该是同一个离屏 context
            H.thumbnail(c);
            const a = H.__thumbBuf;                       // 可能没暴露，用兜底判断
            const t1 = H.thumbnail(c);
            const t2 = H.thumbnail(c);
            const reused = (t1 !== t2) && (t1.length === t2.length);

            // 预览：正常时应该画，收成胶囊后不该画
            let drew = 0;
            const p = H.UI.els.preview;
            const ctx = p.getContext('2d');
            const origDraw = ctx.drawImage.bind(ctx);
            ctx.drawImage = function () { drew++; return origDraw.apply(null, arguments); };

            H.UI.pillMode = false;
            H.UI.collapsed = false;
            H.UI.setPreview(c);
            const whenVisible = drew;

            H.UI.pillMode = true;
            H.UI.setPreview(c);
            const whenPill = drew;

            H.UI.pillMode = false;
            H.UI.collapsed = true;
            H.UI.setPreview(c);
            const whenCollapsed = drew;

            H.UI.collapsed = false;
            ctx.drawImage = origDraw;
            return { reused, whenVisible, whenPill, whenCollapsed, hasA: !!a };
        })()`);

    check('缩略图每次返回独立数组（lastThumb 要留着做对比）', bufTest.reused === true,
        JSON.stringify(bufTest));
    check('面板可见时会画预览', bufTest.whenVisible === 1, JSON.stringify(bufTest));
    check('收成小胶囊后不再画预览（省掉一次缩放绘制）',
        bufTest.whenPill === bufTest.whenVisible, JSON.stringify(bufTest));
    check('面板折叠后也不再画预览',
        bufTest.whenCollapsed === bufTest.whenPill, JSON.stringify(bufTest));

    // ─────────────────────────────────────────────
    S('8. M3 截不到画面时要有提示，而不是永远"运行中…"');
    const silent = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const b = H.getContentBox(v);
            H.CFG.engine = 'openai-vision';

            const run = async (region) => {
                H.CFG.region = region;
                H.Pipeline.lastThumb = null;
                H.Pipeline.lastOriginal = '';
                H.Pipeline.running = true;
                await H.Pipeline.step();
                const t = document.querySelector('#h1sub-status').textContent;
                H.Pipeline.stop();
                return t;
            };

            return {
                // 跑到视频正上方（以前会被 Math.max(0,…) 夹到 0，截出无关画面）
                above: await run({ x: b.left + 10, y: b.top - 4000, w: 200, h: 40 }),
                // 跑到视频正右方（sx 超出 vw，本来就返回 null）
                right: await run({ x: b.left + b.width + 3000, y: b.top + 10, w: 200, h: 40 }),
            };
        })()`);

    check('区域跑到视频上方时不再静默截错画面',
        /截不到画面|重新框选/.test(silent.above), JSON.stringify(silent));
    check('区域跑到视频右方时也会提示',
        /截不到画面|重新框选/.test(silent.right), JSON.stringify(silent));

    // ─────────────────────────────────────────────
    S('9. resize 监听：rAF 合并 + 可被 destroy 摘掉');

    const resizeTest = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            const registered = !!H.UI._onResize;

            let called = 0;
            const orig = H.Overlay.position;
            // 存下原值：这个用例会临时替换 Overlay.el / last，
            // 不还原的话后面的用例会对着一个已脱离文档的节点操作
            const savedEl = H.Overlay.el;
            const savedLast = H.Overlay.last;
            H.Overlay.position = function () { called++; };

            // reposition 被调了几次：能区分"两个监听各调一次"
            // 和"一个监听但内部重复定位"
            let repos = 0;
            const origRepos = H.Overlay.reposition;
            H.Overlay.reposition = function () { repos++; return origRepos.apply(this, arguments); };

            // 旁观 window 上到底发生了多少次 resize 事件
            let windowResizes = 0;
            const probe = () => { windowResizes++; };
            window.addEventListener('resize', probe);

            // position() 的另一个调用者是 show()，把它也数上
            let shows = 0;
            let showStack = '';
            const origShow = H.Overlay.show;
            H.Overlay.show = function () {
                shows++;
                if (!showStack) {
                    // 用 fromCharCode(10) 而不是转义写法：这段代码本身住在
                    // 模板字符串里，转义序列会先被外层解释掉，连注释里写都不行
                    showStack = String(new Error().stack || '')
                        .split(String.fromCharCode(10)).slice(1, 4).join(' | ');
                }
                return origShow.apply(this, arguments);
            };

            // 造一个"正在显示"的悬浮层，reposition 才会真的去定位
            H.Overlay.last = { o: 'あ', t: '啊' };
            const el = document.createElement('div');
            el.style.display = 'block';
            document.body.appendChild(el);
            H.Overlay.el = el;

            // 拖窗口边缘会连发几十次 resize，这里发 5 次
            for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('resize'));
            // 同步阶段就不该有任何定位 —— 说明它被推迟到了帧里，而不是每次都做
            const immediate = called;
            // 只等一帧：等两帧的话，期间浏览器万一自发的 resize 会多算一次，
            // 这条断言就变成了掷骰子
            await new Promise(r => requestAnimationFrame(r));
            const afterOneFrame = called;

            window.removeEventListener('resize', probe);
            H.Overlay.position = orig;
            H.Overlay.reposition = origRepos;
            H.Overlay.show = origShow;
            H.Overlay.el = savedEl;          // ← 还原
            H.Overlay.last = savedLast;
            el.remove();
            return { registered, immediate, afterOneFrame, repos, windowResizes, shows, showStack,
                     running: H.Pipeline.running, hasTimer: !!H.Pipeline.timer };
        })()`);

    check('resize 监听已注册（原来是匿名函数，destroy 摘不掉）',
        resizeTest.registered === true, JSON.stringify(resizeTest));
    check('连发 5 次 resize 在同步阶段一次定位都不做（推迟到帧里）',
        resizeTest.immediate === 0, JSON.stringify(resizeTest));
    // 断言 reposition 的次数，而不是 position 的次数：
    // position() 还有一个调用者 Overlay.show()，别的异步流程（比如框完自动
    // 截一帧）随时可能插进来一次，拿它当观测量就成了掷骰子。
    // resize 处理器只会调 reposition，所以它才是"5 次合并成几次"的直接答案。
    check('★ 连发 5 次 resize 只触发 1 次重新定位',
        resizeTest.repos === 1 && resizeTest.afterOneFrame >= 1,
        JSON.stringify(resizeTest));

    // ─────────────────────────────────────────────
    S('10. 停止后字幕必须消失');

    // 先造一句正在显示的字幕
    const stopState = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const b = H.getContentBox(v);
            const P = window.__PATTERN__;
            H.CFG.region = H.anchorRegion(
                b.left, b.top + (P.BAND_Y / v.videoHeight) * b.height,
                b.width, (P.BAND_H / v.videoHeight) * b.height, v);
            H.CFG.engine = 'openai-vision';
            H.CFG.apiBase = 'https://api.deepseek.com';
            H.CFG.apiKey = 'sk-abc';
            H.CFG.smartSkip = false;
            H.CFG.interval = 400;
            window.__gmResponse = ${JSON.stringify(okResp('{"original":"字幕テスト","translation":"字幕测试"}'))};
            H.UI.syncRegion();

            H.UI.setRunning(true);
            H.Pipeline.lastThumb = null;
            H.Pipeline.lastOriginal = '';
            H.Pipeline.running = true;
            await H.Pipeline.step();          // 直接跑一轮，确定性地出一句字幕

            const ov = document.querySelector('#h1sub-overlay');
            const shown = {
                display: ov ? getComputedStyle(ov).display : null,
                text: ov ? ov.textContent : '',
                lastOriginal: H.Pipeline.lastOriginal,
            };

            // 用户点了「停止」
            document.querySelector('#h1sub-run').click();
            await new Promise(r => setTimeout(r, 60));

            return {
                shown,
                after: {
                    display: ov ? getComputedStyle(ov).display : null,
                    running: H.Pipeline.running,
                    lastOriginal: H.Pipeline.lastOriginal,
                    lastTranslation: H.Pipeline.lastTranslation,
                    status: document.querySelector('#h1sub-status').textContent,
                },
            };
        })()`);

    check('停止前确实有一句字幕在显示',
        stopState.shown.display === 'block' && /字幕测试/.test(stopState.shown.text),
        JSON.stringify(stopState.shown));
    check('★ 停止后字幕从画面上消失',
        stopState.after.display === 'none', JSON.stringify(stopState.after));
    check('停止后管线状态是已停止',
        stopState.after.running === false && /已停止/.test(stopState.after.status),
        JSON.stringify(stopState.after));
    check('★ 停止后「上一句」也清掉了（否则重开第一句会被当重复句吞掉）',
        stopState.after.lastOriginal === '' && stopState.after.lastTranslation === '',
        JSON.stringify(stopState.after));

    // ─────────────────────────────────────────────
    S('11. 框选时面板和预览不能被压暗');

    const frameUi = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            H.CFG.region = null;                     // 模拟"第一次框选，还没有区域"
            H.UI.syncRegion();
            const wrapBefore = document.querySelector('#h1sub-preview-wrap');
            const before = getComputedStyle(wrapBefore).display;

            document.querySelector('#h1sub-region').click();   // ← 真实按钮
            await new Promise(r => setTimeout(r, 50));

            const maskEl = Array.from(document.body.children).find(d =>
                d.style.position === 'fixed' && d.style.inset === '0px'
                && d.style.background.indexOf('rgba(0') === 0);
            const panel = document.querySelector('#h1sub-panel');
            const wrap = document.querySelector('#h1sub-preview-wrap');

            const zMask = maskEl ? parseInt(getComputedStyle(maskEl).zIndex) : -1;
            const zPanel = parseInt(getComputedStyle(panel).zIndex);

            const boxEl = Array.from(document.body.children).find(d =>
                d.style.borderColor === 'rgb(34, 211, 238)'
                || d.style.border === '2px solid rgb(34, 211, 238)');

            // 拖一把，看看预览有没有跟着实时更新
            const c = document.querySelector('#h1sub-preview');
            const g = c.getContext('2d');
            const sample = () => {
                const d = g.getImageData(0, 0, Math.min(30, c.width), Math.min(20, c.height)).data;
                let s = 0;
                for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
                return s;
            };
            const canvasBefore = c.width + 'x' + c.height + ':' + sample();

            const v = H.findVideo();
            const vb = H.getContentBox(v);
            const x0 = Math.round(vb.left + 10), y0 = Math.round(vb.top + 10);
            document.dispatchEvent(new MouseEvent('mousedown',
                { bubbles: true, clientX: x0, clientY: y0, button: 0 }));
            document.dispatchEvent(new MouseEvent('mousemove',
                { bubbles: true, clientX: x0 + 300, clientY: y0 + 70 }));
            // 等两帧，让 rAF 里的实时预览跑完
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const canvasAfterDrag = c.width + 'x' + c.height + ':' + sample();
            const boxShown = boxEl ? boxEl.style.display === 'block' : false;

            // 收尾
            document.dispatchEvent(new MouseEvent('mouseup',
                { bubbles: true, clientX: x0 + 300, clientY: y0 + 70, button: 0 }));
            await new Promise(r => setTimeout(r, 60));

            return {
                before, during: getComputedStyle(wrap).display,
                zMask, zPanel, maskBelowPanel: zMask < zPanel,
                boxShown, canvasBefore, canvasAfterDrag,
                regionSet: !!H.CFG.region,
            };
        })()`);

    check('没有区域时，预览默认是藏起来的', frameUi.before === 'none', JSON.stringify(frameUi));
    check('★ 一进框选就把预览露出来（不然第一次框选根本没得对照）',
        frameUi.during === 'block', JSON.stringify(frameUi));
    check('★ 遮罩层级低于面板 —— 面板和预览不会被压暗',
        frameUi.maskBelowPanel === true, `遮罩z=${frameUi.zMask} 面板z=${frameUi.zPanel}`);
    check('拖拽时选区框正常显示', frameUi.boxShown === true, JSON.stringify(frameUi));
    check('★ 拖拽时预览实时跟着更新（不是一直显示旧区域）',
        frameUi.canvasBefore !== frameUi.canvasAfterDrag,
        JSON.stringify({ before: frameUi.canvasBefore, after: frameUi.canvasAfterDrag }));
    check('松手后区域被记下来', frameUi.regionSet === true, JSON.stringify(frameUi));

    // ─────────────────────────────────────────────
    S('12. 框完立刻截一帧：预览要显示"新框的区域"');

    const afterFrame = await evAsync(`
        (async () => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const b = H.getContentBox(v);
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));

            // 抓预览画布的一片像素当指纹
            const fp = () => {
                const c = document.querySelector('#h1sub-preview');
                const g = c.getContext('2d');
                const d = g.getImageData(0, 0, Math.min(60, c.width), Math.min(40, c.height)).data;
                let s = 0;
                for (let i = 0; i < d.length; i += 4) s += d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7;
                return c.width + 'x' + c.height + ':' + s;
            };
            // 直接按某个区域截一张，作为"标准答案"的指纹
            const fpOf = (region) => {
                const c = H.Capturer.grab(region, v);
                if (!c) return null;
                const g = c.getContext('2d');
                const d = g.getImageData(0, 0, Math.min(60, c.width), Math.min(40, c.height)).data;
                let s = 0;
                for (let i = 0; i < d.length; i += 4) s += d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7;
                return c.width + 'x' + c.height + ':' + s;
            };

            // 先框"上方"一条，再框"下方"一条 —— 两块画面内容不同
            const up = { x: b.left, y: b.top, w: b.width, h: 80 };
            const down = { x: b.left, y: b.top + b.height - 120, w: b.width, h: 80 };

            const results = {};

            // 拖拽时的实时预览本来就会截图，光比对预览画面分辨不出
            // "框完之后有没有再截一帧"。所以直接数 Capturer.grab 的调用：
            // 先让实时预览的 rAF 跑完，再清零，然后才松手 ——
            // 这样数到的就纯粹是"松手触发"的那几次。
            let grabs = 0;
            const origGrab = H.Capturer.grab;
            H.Capturer.grab = function () { grabs++; return origGrab.apply(this, arguments); };

            const dragTo = async (region) => {
                document.querySelector('#h1sub-region').click();      // 进框选
                await sleep(40);
                const x0 = Math.round(region.x), y0 = Math.round(region.y);
                const x1 = x0 + Math.round(region.w), y1 = y0 + Math.round(region.h);
                document.dispatchEvent(new MouseEvent('mousedown',
                    { bubbles: true, clientX: x0, clientY: y0, button: 0 }));
                document.dispatchEvent(new MouseEvent('mousemove',
                    { bubbles: true, clientX: x1, clientY: y1 }));
                // 冲掉实时预览挂着的 rAF，免得它混进后面的计数
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

                grabs = 0;
                document.dispatchEvent(new MouseEvent('mouseup',
                    { bubbles: true, clientX: x1, clientY: y1, button: 0 }));
                const onRelease = grabs;                              // 同步读，onUp 是同步处理的
                await sleep(200);                                     // 等截图/识别跑完
                return onRelease;
            };

            // ── 分支 A：没配密钥 → 只截不认 ──
            H.CFG.apiKey = '';
            H.CFG.engine = 'openai-vision';
            // 取增量：__gmReqs 是全局累积的，用绝对值会把前面用例的请求也数进来
            const callsBeforeNoKey = window.__gmReqs.length;
            const grabsNoKey = await dragTo(up);
            const noKey = {
                region: H.CFG.region ? Math.round(H.CFG.region.y) : null,
                preview: fp(),
                expected: fpOf(H.CFG.region),
                calls: window.__gmReqs.length - callsBeforeNoKey,
                grabsOnRelease: grabsNoKey,
                status: document.querySelector('#h1sub-status').textContent,
            };
            results.noKey = noKey;

            // ── 分支 B：配了密钥 → 顺带识别一次 ──
            H.CFG.apiKey = 'sk-abc';
            H.CFG.apiBase = 'https://api.deepseek.com';
            window.__gmResponse = ${JSON.stringify(okResp('{"original":"上のは字幕","translation":"上面的字幕"}'))};
            const callsBefore = window.__gmReqs.length;
            const grabsWithKey = await dragTo(down);
            const withKey = {
                region: H.CFG.region ? Math.round(H.CFG.region.y) : null,
                preview: fp(),
                expected: fpOf(H.CFG.region),
                calls: window.__gmReqs.length - callsBefore,
                grabsOnRelease: grabsWithKey,
                overlay: (() => {
                    const ov = document.querySelector('#h1sub-overlay');
                    return ov ? ov.textContent : '';
                })(),
                status: document.querySelector('#h1sub-status').textContent,
            };
            results.withKey = withKey;

            H.Capturer.grab = origGrab;
            results.differentRegions = noKey.preview !== withKey.preview;
            return results;
        })()`);

    check('★ 没配密钥时，松手会立刻再截一帧',
        afterFrame.noKey.grabsOnRelease >= 1, JSON.stringify(afterFrame.noKey));
    check('截出来的画面就是新框的区域',
        afterFrame.noKey.preview === afterFrame.noKey.expected,
        JSON.stringify(afterFrame.noKey));
    check('没配密钥时不该去调接口（免得刚框完就弹 401）',
        afterFrame.noKey.calls === 0, JSON.stringify(afterFrame.noKey));

    check('★ 配了密钥时，松手也会截一帧',
        afterFrame.withKey.grabsOnRelease >= 1, JSON.stringify(afterFrame.withKey));
    check('★ 并且自动识别一次（整条链路一起验证）',
        afterFrame.withKey.calls >= 1, JSON.stringify(afterFrame.withKey));
    check('识别结果直接显示在悬浮层上',
        /上面的字幕/.test(afterFrame.withKey.overlay), JSON.stringify(afterFrame.withKey));
    check('★ 预览显示的是这次新框的区域，不是上一次的',
        afterFrame.withKey.preview === afterFrame.withKey.expected
        && afterFrame.differentRegions === true,
        JSON.stringify({ preview: afterFrame.withKey.preview,
                         expected: afterFrame.withKey.expected,
                         different: afterFrame.differentRegions }));
    check('两次框的区域确实不同（说明上面那条不是巧合）',
        afterFrame.noKey.region !== afterFrame.withKey.region,
        JSON.stringify({ up: afterFrame.noKey.region, down: afterFrame.withKey.region }));

    // ─────────────────────────────────────────────
    // destroy() 会把面板整个拆掉、els 清空，所以必须放在最后
    S('13. H3 destroy() 会停止标签页共享');

    const destroyTest = await ev(`
        (() => {
            const H = window.__H1SUB__;
            let stopped = 0;
            const orig = H.Capturer.stopDisplayCapture;
            H.Capturer.stopDisplayCapture = function () { stopped++; return orig.apply(this, arguments); };
            H.UI.destroy();
            H.Capturer.stopDisplayCapture = orig;
            return {
                stopped,
                root: H.UI.root === null,
                resizeOff: H.UI._onResize === null,
                timerOff: !H.UI._hrefTimer,
            };
        })()`);

    check('destroy() 调用了 stopDisplayCapture（不会留下偷偷跑着的共享）',
        destroyTest.stopped === 1, JSON.stringify(destroyTest));
    check('destroy() 把 root 置空（否则挂载判断会一直失效）',
        destroyTest.root === true, JSON.stringify(destroyTest));
    check('destroy() 摘掉了 resize 监听', destroyTest.resizeOff === true,
        JSON.stringify(destroyTest));
    check('destroy() 清掉了 SPA 轮询定时器', destroyTest.timerOff === true,
        JSON.stringify(destroyTest));

    // ─────────────────────────────────────────────
    S('14. 结束后无异常');

    const errs = cdp.errorsFor(sessionId);
    check('页面无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' || '));
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
