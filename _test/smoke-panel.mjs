// 面板冒烟测试：确认改完配置面板后脚本仍能正常挂载、预设/导出/导入/诊断都能用
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, startServer } from './cdp.mjs';

import { FIXTURES, PAGES, VENDOR, readUserscript } from './paths.mjs';

const USERSCRIPT = readUserscript();
const PAGE_PORT = 8760;

// 把 fixture 复制到 pages 下，保证同源
fs.mkdirSync(path.join(PAGES, 'fixtures'), { recursive: true });
fs.copyFileSync(
    path.join(FIXTURES, 'pattern.webm'),
    path.join(PAGES, 'fixtures', 'pattern.webm'));
fs.copyFileSync(
    path.join(VENDOR, 'hls.min.js'),
    path.join(PAGES, 'hls.min.js'));

// GM_* 桩：用 localStorage 做后备存储，这样刷新页面后配置仍然存在
// （真实 Tampermonkey 的 GM_setValue 也是持久化的，用内存对象测不出持久化 bug）
const PRELUDE = `
(function () {
    const KEY = '__h1sub_gm_store__';
    let store;
    try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { store = {}; }
    if (!store || typeof store !== 'object') store = {};
    // 本套件测的是面板功能，而面板**默认收成小胶囊**（见 CFG.panelOpen）。
    // 预置成"用户已选择保持展开"，否则面板是 display:none，摸不到里面的控件。
    if (store['h1sub.panelOpen'] === undefined) store['h1sub.panelOpen'] = true;
    window.__gmStore = store;
    window.__gmReqs = [];
    window.GM_getValue = function (k, d) { return (k in store) ? store[k] : d; };
    window.GM_setValue = function (k, v) {
        store[k] = v;
        try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
    };
    window.GM_registerMenuCommand = function () {};
    window.__gmResponse = null;
    window.GM_xmlhttpRequest = function (opts) {
        window.__gmReqs.push({ url: opts.url, method: opts.method, headers: opts.headers, data: opts.data });
        const resp = window.__gmResponse;
        if (!resp) { setTimeout(function () { opts.onerror && opts.onerror(new Error('no stub')); }, 0); return; }
        setTimeout(function () {
            try { opts.onload && opts.onload({ status: resp.status, responseText: resp.text }); }
            catch (e) { opts.onerror && opts.onerror(e); }
        }, 5);
    };
})();
`;

const R = [];
let suite = '';
const S = (n) => { suite = n; console.log('\n── ' + n + ' ──'); };
function check(name, pass, detail) {
    R.push({ suite, name, pass: !!pass });
    console.log(`  ${pass ? '✅' : '❌'} ${name}${pass || !detail ? '' : '  ← ' + detail}`);
    return !!pass;
}

const srv = await startServer({ port: PAGE_PORT, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: 9360 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 清掉上一次运行残留的 localStorage，保证从干净状态开始
await cdp.send('Storage.clearDataForOrigin', {
    origin: `http://127.0.0.1:${PAGE_PORT}`,
    storageTypes: 'local_storage',
}).catch(() => { });

try {
    const { targetId, sessionId } = await cdp.newPage();
    await cdp.addInitScript(PRELUDE, sessionId);
    await cdp.addInitScript(USERSCRIPT, sessionId);
    await cdp.navigate(sessionId,
        `http://127.0.0.1:${PAGE_PORT}/lab.html?mode=canvas`,
        { waitFor: 'window.__H1SUB__ && window.__lab && window.__lab.ready', timeoutMs: 25000 });

    const ev = (expr, o = {}) => cdp.evaluate(expr, { sessionId, ...o });
    const errs = () => cdp.errorsFor(sessionId);

    // ─────────────────────────────────────────────
    S('1. 脚本挂载');
    check('脚本 IIFE 执行成功（window.__H1SUB__ 存在）',
        await ev('!!window.__H1SUB__'));
    check('boot 跑完，面板已挂载到 DOM',
        await ev(`!!document.querySelector('#h1sub-panel')`));
    check('页面无 JS 异常', errs().length === 0, errs()[0]);

    S('2. 面板元素引用完整性');
    const nullEls = await ev(`
        (() => {
            const els = window.__H1SUB__.UI.els;
            return Object.keys(els).filter(k => !els[k]);
        })()`);
    check('所有 id 都解析到了真实元素（无 null）',
        nullEls.length === 0, '找不到的元素: ' + JSON.stringify(nullEls));

    const idCount = await ev(`Object.keys(window.__H1SUB__.UI.els).length`);
    check(`绑定元素数量正常（${idCount} 个）`, idCount >= 45, '只有 ' + idCount + ' 个');

    S('3. 平台预设下拉');
    const optCount = await ev(`document.querySelectorAll('#h1sub-preset option').length`);
    check(`预设选项已填充（${optCount} 项）`, optCount >= 8);

    const gemini = await ev(`
        (() => {
            const sel = document.querySelector('#h1sub-preset');
            const o = [...sel.options].find(x => /Gemini/.test(x.textContent));
            if (!o) return { err: '找不到 Gemini 选项' };
            sel.value = o.value;
            sel.dispatchEvent(new Event('change'));
            return {
                base: document.querySelector('#h1sub-apiBase').value,
                model: document.querySelector('#h1sub-model').value,
                engine: document.querySelector('#h1sub-engine').value,
                note: document.querySelector('#h1sub-preset-note').textContent,
            };
        })()`);
    check('选 Gemini 预设 → API 地址被填入',
        /generativelanguage\.googleapis\.com/.test(gemini.base || ''), JSON.stringify(gemini));
    check('选 Gemini 预设 → 模型被填入',
        /gemini/.test(gemini.model || ''), JSON.stringify(gemini));
    check('预设提示文字已显示', (gemini.note || '').length > 0);

    // DeepSeek 现在有两个预设：deepseek-flash 支持图片，deepseek-v4-pro 不支持。
    // 旧版本曾让所有 DeepSeek 预设都自动切到本地 OCR，那是错的（flash 能看图），已改正。
    const ds = await ev(`
        (() => {
            const sel = document.querySelector('#h1sub-preset');
            const eng = document.querySelector('#h1sub-engine');
            const pick = (re) => {
                const o = [...sel.options].find(x => re.test(x.textContent));
                sel.value = o.value;
                sel.dispatchEvent(new Event('change'));
                return {
                    engine: document.querySelector('#h1sub-engine').value,
                    model: document.querySelector('#h1sub-model').value,
                    note: document.querySelector('#h1sub-preset-note').textContent,
                    umiShown: document.querySelector('#h1sub-umionly').style.display !== 'none',
                };
            };
            // 先把引擎设回视觉，验证 flash 预设不会把它改掉
            eng.value = 'openai-vision';
            eng.dispatchEvent(new Event('change'));
            const flash = pick(/deepseek-flash/);
            const pro = pick(/deepseek-v4-pro/);
            return { flash, pro };
        })()`);
    check('deepseek-flash 预设 → 模型名填对',
        ds.flash.model === 'deepseek-flash', JSON.stringify(ds.flash));
    check('deepseek-flash 支持图片 → 引擎保持视觉大模型（不再乱切）',
        ds.flash.engine === 'openai-vision', JSON.stringify(ds.flash));
    check('deepseek-flash 不显示 Umi-OCR 配置区',
        ds.flash.umiShown === false, JSON.stringify(ds.flash));
    check('deepseek-v4-pro 不支持图片 → 自动切到「Umi-OCR 本地识别」',
        ds.pro.engine === 'umi-ocr', JSON.stringify(ds.pro));
    check('切引擎后面板区块跟着切换（Umi-OCR 配置区出现）',
        ds.pro.umiShown === true, JSON.stringify(ds.pro));
    check('deepseek-v4-pro 提示里有警告文字',
        /不支持图片/.test(ds.pro.note || ''), ds.pro.note);

    // 切回视觉引擎，方便后面测诊断
    await ev(`
        (() => {
            const e = document.querySelector('#h1sub-engine');
            e.value = 'openai-vision';
            e.dispatchEvent(new Event('change'));
        })()`);

    S('4. 滑块与外观配置');
    const sliders = await ev(`
        (() => {
            const set = (id, v) => {
                const el = document.querySelector(id);
                el.value = v;
                el.dispatchEvent(new Event('input'));
                el.dispatchEvent(new Event('change'));
            };
            set('#h1sub-fontSize', 36);
            set('#h1sub-bgOpacity', 0.3);
            set('#h1sub-offsetY', -40);
            const H = window.__H1SUB__;
            return {
                fontSize: H.CFG.fontSize,
                bgOpacity: H.CFG.bgOpacity,
                offsetY: H.CFG.offsetY,
                fontLabel: document.querySelector('#h1sub-fontVal').textContent,
                opLabel: document.querySelector('#h1sub-opacityVal').textContent,
                offLabel: document.querySelector('#h1sub-offsetVal').textContent,
            };
        })()`);
    check('字号滑块 → CFG.fontSize 更新', sliders.fontSize === 36, JSON.stringify(sliders));
    check('背景不透明度滑块 → CFG.bgOpacity 更新', Math.abs(sliders.bgOpacity - 0.3) < 0.001);
    check('垂直微调滑块 → CFG.offsetY 更新', sliders.offsetY === -40);
    check('滑块标签实时显示数值',
        sliders.fontLabel === '36 px' && /30%/.test(sliders.opLabel) && /-40/.test(sliders.offLabel),
        JSON.stringify(sliders));

    const persisted = await ev(`
        (() => {
            const s = window.__gmStore;
            return { fs: s['h1sub.fontSize'], op: s['h1sub.bgOpacity'], oy: s['h1sub.offsetY'] };
        })()`);
    check('滑块改动已落盘到 GM 存储（刷新后不丢）',
        persisted.fs === 36 && Math.abs(persisted.op - 0.3) < 0.001 && persisted.oy === -40,
        JSON.stringify(persisted));

    S('5. 运行状态与截图方式');
    const capUi = await ev(`
        (() => {
            const sel = document.querySelector('#h1sub-captureMode');
            sel.value = 'element';
            sel.dispatchEvent(new Event('change'));
            return {
                cfg: window.__H1SUB__.CFG.captureMode,
                hint: document.querySelector('#h1sub-capture-hint').textContent,
            };
        })()`);
    check('截图方式可切换且写入 CFG', capUi.cfg === 'element');
    check('截图方式下方有状态说明', (capUi.hint || '').length > 4, capUi.hint);

    S('6. 导入 / 导出配置');
    const exp = await ev(`
        (() => {
            document.querySelector('#h1sub-export').click();
            const ta = document.querySelector('#h1sub-exp-ta');
            if (!ta) return { err: '导出弹窗没打开' };
            let obj = null, parseErr = null;
            try { obj = JSON.parse(ta.value); } catch (e) { parseErr = e.message; }
            return {
                hasTa: true,
                parseErr,
                keys: obj ? Object.keys(obj).length : 0,
                hasFontSize: obj ? obj.fontSize : null,
                text: ta.value,
            };
        })()`);
    check('导出弹窗打开且内容是合法 JSON',
        exp.hasTa && !exp.parseErr, exp.parseErr || exp.err);
    check('导出内容包含全部配置项（' + exp.keys + ' 项）', exp.keys >= 20);
    check('导出内容反映了刚才的改动', exp.hasFontSize === 36, 'fontSize=' + exp.hasFontSize);
    await ev(`document.querySelector('#h1sub-exp-close').click()`);

    const imp = await ev(`
        (() => {
            document.querySelector('#h1sub-import').click();
            const ta = document.querySelector('#h1sub-imp-ta');
            if (!ta) return { err: '导入弹窗没打开' };
            ta.value = JSON.stringify({ fontSize: 18, bgOpacity: 0.9, engine: 'openai-vision' });
            document.querySelector('#h1sub-imp-ok').click();
            const H = window.__H1SUB__;
            return {
                fontSize: H.CFG.fontSize,
                bgOpacity: H.CFG.bgOpacity,
                uiFont: document.querySelector('#h1sub-fontSize').value,
                modalClosed: !document.querySelector('#h1sub-imp-ta'),
                status: document.querySelector('#h1sub-status').textContent,
            };
        })()`);
    check('导入配置 → CFG 被覆盖', String(imp.fontSize) === '18', JSON.stringify(imp));
    check('导入配置 → 面板 UI 同步刷新', String(imp.uiFont) === '18');
    check('导入成功后弹窗自动关闭', imp.modalClosed === true);
    check('导入成功状态提示', /导入/.test(imp.status || ''), imp.status);

    const badImp = await ev(`
        (() => {
            document.querySelector('#h1sub-import').click();
            const ta = document.querySelector('#h1sub-imp-ta');
            ta.value = '{ 这不是合法json ';
            document.querySelector('#h1sub-imp-ok').click();
            const msg = document.querySelector('#h1sub-imp-msg').textContent;
            document.querySelector('#h1sub-imp-close').click();
            return { msg };
        })()`);
    check('导入非法 JSON → 给出错误提示而不是崩溃',
        /JSON 解析失败/.test(badImp.msg || ''), badImp.msg);

    S('7. 诊断模式');
    const diag = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const box = H.getContentBox(v);
            const P = window.__PATTERN__;
            // 用第一个色块当"字幕区"
            const cr = P.cellRect(1, 1);
            H.CFG.region = {
                x: box.left + (cr.x / v.videoWidth) * box.width,
                y: box.top + (cr.y / v.videoHeight) * box.height,
                w: (cr.w / v.videoWidth) * box.width,
                h: (cr.h / v.videoHeight) * box.height,
            };
            H.UI.syncRegion();
            H.Diag.open();
            const rep = document.querySelector('#h1sub-diag-report');
            const frame = document.querySelector('#h1sub-diag-frame');
            const crop = document.querySelector('#h1sub-diag-crop');
            return {
                opened: !!document.querySelector('#h1sub-diag-frame'),
                reportLen: rep ? rep.value.length : 0,
                report: rep ? rep.value : '',
                frameW: frame ? frame.width : 0,
                frameH: frame ? frame.height : 0,
                cropW: crop ? crop.width : 0,
                cropH: crop ? crop.height : 0,
            };
        })()`);
    check('诊断弹窗能打开', diag.opened === true, JSON.stringify(diag).slice(0, 200));
    check('① 整帧画面已绘制（640x360）',
        diag.frameW === 640 && diag.frameH === 360, diag.frameW + 'x' + diag.frameH);
    check('② 裁剪图已绘制（有尺寸）', diag.cropW > 10 && diag.cropH > 10,
        diag.cropW + 'x' + diag.cropH);
    check('③ 报告有内容（' + diag.reportLen + ' 字符）', diag.reportLen > 300);
    check('报告含视频信息段', /videoWidth x videoHeight/.test(diag.report));
    check('报告含截图后端段', /截图后端/.test(diag.report));
    check('报告含区域坐标换算', /换算到视频像素坐标/.test(diag.report));
    check('报告含引擎配置段', /引擎配置/.test(diag.report));
    check('报告含运行统计段', /运行统计/.test(diag.report));

    await ev(`document.querySelector('#h1sub-diag-close').click()`);

    S('8. 字幕悬浮层外观');
    const ov = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.CFG.bgOpacity = 0.25;
            H.CFG.textColor = '#ffcc00';
            H.CFG.outline = false;
            H.CFG.offsetY = 12;
            H.Overlay.show('原文テスト', '中文测试');
            const d = document.querySelector('#h1sub-overlay');
            const cs = getComputedStyle(d);
            return {
                display: cs.display,
                bg: cs.backgroundColor,
                color: cs.color,
                textShadow: cs.textShadow,
                html: d.innerHTML,
                visible: d.style.display,
            };
        })()`);
    check('悬浮字幕能显示', ov.display === 'block', JSON.stringify(ov).slice(0, 200));
    check('背景不透明度生效（0.25）', /rgba\(0,\s*0,\s*0,\s*0\.25\)/.test(ov.bg), ov.bg);
    check('译文颜色生效（#ffcc00 → rgb(255,204,0)）',
        /rgb\(255,\s*204,\s*0\)/.test(ov.color), ov.color);
    check('关闭描边后只剩柔和阴影',
        !/1px 1px 0px/.test(ov.textShadow), ov.textShadow);
    check('原文和译文都渲染出来了',
        /原文テスト/.test(ov.html) && /中文测试/.test(ov.html));

    const outlineOn = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.CFG.outline = true;
            H.Overlay.show('a', 'b');
            return getComputedStyle(document.querySelector('#h1sub-overlay')).textShadow;
        })()`);
    check('开启描边后 text-shadow 变复杂（多方向描边）',
        (outlineOn.match(/rgb\(0,\s*0,\s*0\)/g) || []).length >= 4,
        outlineOn.slice(0, 120));

    S('9. reposition 修复验证（之前 this.last 从未赋值）');
    const rep = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const before = document.querySelector('#h1sub-overlay').style.top;
            // 挪动区域，触发重新定位
            H.CFG.region = { ...H.CFG.region, y: H.CFG.region.y + 100 };
            H.Overlay.reposition();
            const after = document.querySelector('#h1sub-overlay').style.top;
            return { before, after, hasLast: !!H.Overlay.last };
        })()`);
    check('Overlay.last 已被记录（bug 修复）', rep.hasLast === true, JSON.stringify(rep));
    check('reposition 真的重算了位置（top 变化）',
        rep.before !== rep.after, JSON.stringify(rep));

    S('10. 多套 API 配置档案（保存 / 切换 / 覆盖 / 删除）');
    const prof = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const E = H.UI.els;

            // 从干净状态开始
            H.CFG.apiProfiles = [];
            H.renderProfiles();

            // 第一套
            H.CFG.apiBase = 'https://api.deepseek.com';
            H.CFG.apiKey = 'sk-aaa111';
            H.CFG.model = 'deepseek-flash';
            H.upsertProfile('DeepSeek');
            const afterFirst = {
                count: H.CFG.apiProfiles.length,
                opts: [...E.profile.options].map(o => o.value),
                selected: E.profile.value,
            };

            // 第二套
            H.CFG.apiBase = 'https://open.bigmodel.cn/api/paas/v4';
            H.CFG.apiKey = 'zzz-bbb222';
            H.CFG.model = 'glm-4v-plus';
            H.upsertProfile('智谱');
            const afterSecond = {
                count: H.CFG.apiProfiles.length,
                opts: [...E.profile.options].map(o => o.value),
            };

            // 切回第一套
            H.applyProfile('DeepSeek');
            const switched = {
                base: H.CFG.apiBase, key: H.CFG.apiKey, model: H.CFG.model,
                uiBase: E.apiBase.value, uiKey: E.apiKey.value, uiModel: E.model.value,
                selected: E.profile.value,
            };

            // 同名再存 → 应覆盖而非新增
            H.CFG.apiKey = 'sk-aaa111-updated';
            H.upsertProfile('DeepSeek');
            const afterOverwrite = {
                count: H.CFG.apiProfiles.length,
                key: (H.CFG.apiProfiles.find(p => p.name === 'DeepSeek') || {}).apiKey,
            };

            // 手动改动 → 对不上任何档案，下拉回占位
            H.CFG.apiKey = 'sk-manual-edit';
            H.syncProfileSelection();
            const afterManualEdit = E.profile.value;

            // 删除：第一次只进入待确认
            H.applyProfile('智谱');
            const del1 = H.deleteProfile('智谱');
            const armed = E.profile_del.textContent;
            const survived = H.CFG.apiProfiles.some(p => p.name === '智谱');
            const del2 = H.deleteProfile('智谱');
            const afterDelete = {
                del1, armed, survived, del2,
                count: H.CFG.apiProfiles.length,
                names: H.CFG.apiProfiles.map(p => p.name),
            };

            // 给后面的「刷新后持久化」留一套配置
            H.applyProfile('DeepSeek');

            return { afterFirst, afterSecond, switched, afterOverwrite,
                     afterManualEdit, afterDelete };
        })()`);
    check('保存第一套配置 → 下拉框出现该档案',
        prof.afterFirst.count === 1 && prof.afterFirst.opts.includes('DeepSeek'),
        JSON.stringify(prof.afterFirst));
    check('保存后自动选中刚存的档案',
        prof.afterFirst.selected === 'DeepSeek', prof.afterFirst.selected);
    check('保存第二套 → 两套并存',
        prof.afterSecond.count === 2 && prof.afterSecond.opts.includes('DeepSeek')
        && prof.afterSecond.opts.includes('智谱'),
        JSON.stringify(prof.afterSecond));
    check('切换到档案 → 地址 / Key / 模型全部还原',
        prof.switched.base === 'https://api.deepseek.com'
        && prof.switched.key === 'sk-aaa111'
        && prof.switched.model === 'deepseek-flash',
        JSON.stringify(prof.switched));
    check('切换后输入框也同步更新',
        prof.switched.uiBase === 'https://api.deepseek.com'
        && prof.switched.uiKey === 'sk-aaa111'
        && prof.switched.uiModel === 'deepseek-flash',
        JSON.stringify(prof.switched));
    check('同名保存是覆盖而不是新增',
        prof.afterOverwrite.count === 2 && prof.afterOverwrite.key === 'sk-aaa111-updated',
        JSON.stringify(prof.afterOverwrite));
    check('手动改动后下拉回到占位（表示当前有未保存的改动）',
        prof.afterManualEdit === '', JSON.stringify(prof.afterManualEdit));
    check('第一次点「删除」不真删（防误触丢掉 Key）',
        prof.afterDelete.del1 === false && prof.afterDelete.survived === true
        && /再点一次/.test(prof.afterDelete.armed),
        JSON.stringify(prof.afterDelete));
    check('再点一次才真的删掉，且另一套不受影响',
        prof.afterDelete.del2 === true && prof.afterDelete.count === 1
        && prof.afterDelete.names.join(',') === 'DeepSeek',
        JSON.stringify(prof.afterDelete));

    S('11. 刷新后配置持久化（配置面板的核心承诺）');
    await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.CFG.panelPos = { left: 40, top: 60 };
            H.CFG.panelWidth = 400;
            H.UI.saveCfg ? H.UI.saveCfg() : null;
            H.saveCfg();
        })()`);
    const beforeReload = await ev(`JSON.stringify({
        fontSize: window.__H1SUB__.CFG.fontSize,
        engine: window.__H1SUB__.CFG.engine,
        captureMode: window.__H1SUB__.CFG.captureMode,
        textColor: window.__H1SUB__.CFG.textColor,
    })`);

    // 真正等文档换掉：比对 performance.timeOrigin，
    // 否则会踩到"旧文档仍然 ready，轮询立刻返回"的竞态
    const originBefore = await ev('performance.timeOrigin');
    await cdp.send('Page.navigate',
        { url: `http://127.0.0.1:${PAGE_PORT}/lab.html?mode=canvas&r=${Date.now()}` }, sessionId);
    let reloaded = false;
    const dl = Date.now() + 25000;
    while (Date.now() < dl) {
        await sleep(150);
        try {
            if (await ev('performance.timeOrigin') !== originBefore
                && await ev('!!(window.__H1SUB__ && window.__lab && window.__lab.ready)')) {
                reloaded = true;
                break;
            }
        } catch (e) { /* 文档切换瞬间会抛错，忽略 */ }
    }
    check('页面已真正重新加载', reloaded);

    const afterReload = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const root = document.querySelector('#h1sub-panel');
            return {
                fontSize: H.CFG.fontSize,
                engine: H.CFG.engine,
                captureMode: H.CFG.captureMode,
                textColor: H.CFG.textColor,
                width: root.style.width,
                left: root.style.left,
                top: root.style.top,
                uiFontSize: document.querySelector('#h1sub-fontSize').value,
                uiColor: document.querySelector('#h1sub-textColor').value,
                uiCapture: document.querySelector('#h1sub-captureMode').value,
                profiles: (H.CFG.apiProfiles || []).map(p => p.name),
                profileOpts: [...document.querySelector('#h1sub-profile').options].map(o => o.value),
                profileSelected: document.querySelector('#h1sub-profile').value,
                apiKey: H.CFG.apiKey,
            };
        })()`);

    const before = JSON.parse(beforeReload);
    check('刷新后字号保留（导入的 18）', String(afterReload.fontSize) === String(before.fontSize),
        before.fontSize + ' → ' + afterReload.fontSize);
    check('刷新后引擎选择保留', afterReload.engine === before.engine,
        before.engine + ' → ' + afterReload.engine);
    check('刷新后截图方式保留', afterReload.captureMode === before.captureMode,
        before.captureMode + ' → ' + afterReload.captureMode);
    check('刷新后译文颜色保留', afterReload.textColor === before.textColor,
        before.textColor + ' → ' + afterReload.textColor);
    check('刷新后面板宽度恢复（400px）', afterReload.width === '400px', afterReload.width);
    check('刷新后面板位置恢复（left:40 top:60）',
        afterReload.left === '40px' && afterReload.top === '60px',
        afterReload.left + ' / ' + afterReload.top);
    check('刷新后 UI 控件值也跟着恢复',
        String(afterReload.uiFontSize) === '18'
        && afterReload.uiCapture === before.captureMode
        && !!afterReload.uiColor,
        JSON.stringify(afterReload));
    check('刷新后 API 配置档案仍然在，且下拉框已重建',
        afterReload.profiles.join(',') === 'DeepSeek'
        && afterReload.profileOpts.includes('DeepSeek'),
        JSON.stringify({ p: afterReload.profiles, o: afterReload.profileOpts }));
    check('刷新后自动选中当前生效的那套配置',
        afterReload.profileSelected === 'DeepSeek', afterReload.profileSelected);
    check('刷新后 API Key 没有丢（不然等于白存）',
        afterReload.apiKey === 'sk-aaa111-updated', afterReload.apiKey);

    S('12. Trusted Types 严格站点（YouTube / Gmail / Google 搜索这类）');
    // 这些站点用 CSP 的 require-trusted-types-for 'script' 禁掉了 innerHTML 赋值。
    // 之前脚本在 YouTube 上直接抛 TypeError，面板和字幕都建不出来。
    const ttOrigin = await ev('performance.timeOrigin');
    await cdp.send('Page.navigate',
        { url: `http://127.0.0.1:${PAGE_PORT}/tt.html?mode=canvas&r=${Date.now()}` }, sessionId);
    let ttReady = false;
    const ttDl = Date.now() + 25000;
    while (Date.now() < ttDl) {
        await sleep(150);
        try {
            if (await ev('performance.timeOrigin') !== ttOrigin
                && await ev('!!(window.__H1SUB__ && window.__lab && window.__lab.ready)')) {
                ttReady = true; break;
            }
        } catch (e) { /* 文档切换瞬间会抛错 */ }
    }
    check('Trusted Types 测试页已加载', ttReady);

    const tt = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const out = {};

            // 先确认这个页面真的启用了 Trusted Types。
            // 不确认的话，一旦测试页配置失效，下面几条会"空转通过"，等于没测。
            try {
                const d = document.createElement('div');
                d.innerHTML = '<b>x</b>';
                out.cspEnforced = false;
            } catch (e) { out.cspEnforced = (e.name === 'TypeError'); }

            out.hasPolicy = !!H.TT_POLICY;
            const panel = document.querySelector('#h1sub-panel');
            out.panel = !!panel;
            if (panel) {
                const r = panel.getBoundingClientRect();
                out.panelW = Math.round(r.width);
                out.panelH = Math.round(r.height);
            }
            out.controls = document.querySelectorAll(
                '#h1sub-panel input, #h1sub-panel select, #h1sub-panel button').length;
            return out;
        })()`);

    check('这个测试页确实启用了 Trusted Types（否则本节等于没测）',
        tt.cspEnforced === true, JSON.stringify(tt));
    check('脚本拿到了可用的 Trusted Types 策略', tt.hasPolicy === true, JSON.stringify(tt));
    check('面板仍然建出来了（修复前这里是直接崩掉）', tt.panel === true, JSON.stringify(tt));
    check('面板尺寸正常', tt.panelW > 200 && tt.panelH > 100, JSON.stringify(tt));
    check('面板里的控件都渲染出来了', tt.controls > 20, '控件数 ' + tt.controls);

    // 字幕悬浮层同样走 innerHTML —— 只修面板不修它的话，面板出来了却没字幕
    const ttOv = await ev(`
        (() => {
            const H = window.__H1SUB__;
            // show() 开头就是 if (!CFG.region) return —— 不先设区域的话
            // 它直接返回，这条断言就变成"测了个寂寞"
            H.CFG.region = { x: 100, y: 100, w: 400, h: 70 };
            H.CFG.showOriginal = true;
            H.Overlay.show('おはようございます', '早上好');
            const el = document.querySelector('#h1sub-overlay');
            const txt = el ? el.textContent : '';
            return { exists: !!el, text: txt,
                     hasOriginal: /おはよう/.test(txt),
                     hasTranslation: /早上好/.test(txt) };
        })()`);
    check('字幕悬浮层能渲染译文（修复前这里也会崩）',
        ttOv.exists && ttOv.hasTranslation, JSON.stringify(ttOv));
    check('字幕悬浮层同时渲染了原文', ttOv.hasOriginal, JSON.stringify(ttOv));

    // 三个弹窗也都用 innerHTML
    const ttModals = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const out = {};
            const cleanup = () => {
                document.querySelectorAll('.h1sub-modal').forEach(el => {
                    const outer = el.parentElement;
                    if (outer && outer !== document.body) outer.remove();
                });
                H.Diag.modal = null;
            };
            try {
                cleanup(); H.Diag.open();
                out.diag = !!document.querySelector('#h1sub-diag-refresh');
                cleanup();
                H.UI.exportCfg();
                out.exp = !!document.querySelector('#h1sub-exp-copy');
                cleanup();
                H.UI.importCfg();
                out.imp = !!document.querySelector('#h1sub-imp-ok');
                cleanup();
                out.err = null;
            } catch (e) { out.err = String(e && e.message); }
            return out;
        })()`);
    check('诊断模式弹窗能打开', ttModals.diag === true, JSON.stringify(ttModals));
    check('导出配置弹窗能打开', ttModals.exp === true, JSON.stringify(ttModals));
    check('导入配置弹窗能打开', ttModals.imp === true, JSON.stringify(ttModals));

    S('13. 结束后无异常');
    await sleep(400);
    const finalErrs = errs();
    check('整个流程跑完页面无 JS 异常',
        finalErrs.length === 0, finalErrs.slice(0, 2).join(' || '));

    cdp.closePage(targetId);
} catch (e) {
    console.log('\n💥 测试崩溃: ' + e.message);
    console.log(cdp.pageErrors.slice(0, 6).map(x => '   ' + String(x.text).slice(0, 400)).join('\n'));
    process.exitCode = 1;
} finally {
    cdp.close();
    await srv.close();
}

const pass = R.filter(x => x.pass).length;
const fail = R.length - pass;
console.log('\n' + '═'.repeat(52));
console.log(`  总计 ${R.length} 项  ·  ✅ 通过 ${pass}  ·  ❌ 失败 ${fail}`);
if (fail) {
    console.log('\n  失败项：');
    R.filter(x => !x.pass).forEach(x => console.log('   ❌ [' + x.suite + '] ' + x.name));
    process.exitCode = 1;
}
console.log('═'.repeat(52));
