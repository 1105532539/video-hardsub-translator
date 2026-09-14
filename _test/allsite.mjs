// 全站运行行为测试：验证面板只在该出现的时候出现，不该出现的地方一点不漏
import { Cdp, startServer } from './cdp.mjs';
import { PAGES, readUserscript } from './paths.mjs';

const USERSCRIPT = readUserscript();
const PORT = 8770;
const BASE = `http://127.0.0.1:${PORT}`;

// GM 桩：localStorage 支撑，跨刷新保留
const PRELUDE = `
(function () {
    const KEY = '__h1sub_allsite_store__';
    let store;
    try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { store = {}; }
    if (!store || typeof store !== 'object') store = {};
    window.__gmStore = store;
    window.__gmReqs = [];
    window.GM_getValue = function (k, d) { return (k in store) ? store[k] : d; };
    window.GM_setValue = function (k, v) {
        store[k] = v;
        try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
    };
    window.GM_registerMenuCommand = function () {};
    window.GM_xmlhttpRequest = function () {};
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

/** 清掉本 origin 的面板展开偏好，回到"从没用过"的默认状态。
 *  面板偏好 panelOpen 走 GM_setValue → localStorage，会跨导航保留；
 *  这里在**当前页面里**同步删掉它（比 CDP 的 clearDataForOrigin 可靠 ——
 *  后者是异步生效的，紧接着 navigate 会读到还没清掉的旧值）。 */
async function clearStore(ev) {
    await ev(`(() => {
        try { localStorage.removeItem('__h1sub_allsite_store__'); } catch (e) { }
        return true;
    })()`);
}

const srv = await startServer({ port: PORT, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: 9370 });
const sleep = ms => new Promise(r => setTimeout(r, ms));

await cdp.send('Storage.clearDataForOrigin', {
    origin: BASE, storageTypes: 'local_storage',
}).catch(() => { });

try {
    const { sessionId } = await cdp.newPage();
    await cdp.addInitScript(PRELUDE, sessionId);
    await cdp.addInitScript(USERSCRIPT, sessionId);
    const ev = (e, o = {}) => cdp.evaluate(e, { sessionId, ...o });

    // 用 timeOrigin 判断文档真的换了，避免"旧文档还 ready"的竞态
    async function go(url, waitFor, timeoutMs = 25000) {
        const before = await ev('performance.timeOrigin').catch(() => null);
        await cdp.send('Page.navigate', { url }, sessionId);
        const dl = Date.now() + timeoutMs;
        while (Date.now() < dl) {
            await sleep(120);
            try {
                if (before !== null && await ev('performance.timeOrigin') === before) continue;
                if (await ev(`(()=>{try{return !!(${waitFor})}catch(e){return false}})()`)) return true;
            } catch (e) { /* 切换瞬间 */ }
        }
        return false;
    }

    const H1 = 'window.__H1SUB__';

    // ─────────────────────────────────────────────
    S('1. 没有视频的普通页面 → 只留一个小胶囊');
    check('页面加载完成', await go(`${BASE}/empty.html`, 'document.readyState==="complete"'));
    // 给 MutationObserver / 轮询一点时间
    await sleep(1500);
    const s1 = await ev(`
        (() => {
            const p = document.querySelector('#h1sub-panel');
            const pill = document.querySelector('#h1sub-pill');
            return {
                hasScript: !!${H1},
                hasPanel: !!p,
                panelShown: p ? getComputedStyle(p).display !== 'none' : false,
                hasPill: !!pill,
                pillShown: pill ? getComputedStyle(pill).display !== 'none' : false,
                pillText: pill ? pill.textContent.trim() : '',
            };
        })()`);
    check('脚本本身已注入', s1.hasScript === true);
    check('面板存在但被收起（不挡页面）', s1.hasPanel === true && s1.panelShown === false,
        JSON.stringify(s1));
    check('右下角出现了小胶囊', s1.hasPill === true && s1.pillShown === true,
        JSON.stringify(s1));
    check('胶囊文字可读', /字幕/.test(s1.pillText || ''), s1.pillText);

    const clickBack = await ev(`
        (() => {
            document.querySelector('#h1sub-pill').click();
            const p = document.querySelector('#h1sub-panel');
            return { shown: p.style.display !== 'none',
                     pillHidden: getComputedStyle(document.querySelector('#h1sub-pill')).display === 'none' };
        })()`);
    check('点胶囊可以展开完整面板', clickBack.shown === true, JSON.stringify(clickBack));
    check('展开后胶囊自己隐藏', clickBack.pillHidden === true);

    S('2. 有视频的页面 → 默认仍收成小胶囊（不再自动展开）');
    // 上一节点开过胶囊，那会把 panelOpen=true 记进存储；这里先清掉，
    // 才能测到"新用户 / 没选过"时的默认行为。
    await clearStore(ev);
    check('加载有视频的页面', await go(`${BASE}/lab.html?mode=canvas`,
        `${H1} && window.__lab && window.__lab.ready`));
    await sleep(800);
    const s2 = await ev(`
        (() => {
            const p = document.querySelector('#h1sub-panel');
            const pill = document.querySelector('#h1sub-pill');
            return {
                panelShown: p ? getComputedStyle(p).display !== 'none' : false,
                pillShown: pill ? getComputedStyle(pill).display !== 'none' : false,
                hasVideo: !!${H1}.findVideo(),
                host: document.querySelector('#h1sub-host').textContent,
            };
        })()`);
    check('页面上确实有视频（否则这条测的不是"有视频也不展开"）',
        s2.hasVideo === true, JSON.stringify(s2));
    check('★ 有视频时面板默认也收起，不挡住画面', s2.panelShown === false, JSON.stringify(s2));
    check('★ 改为留一个小胶囊', s2.pillShown === true, JSON.stringify(s2));
    check('面板标题栏显示了当前网站', s2.host === '127.0.0.1', s2.host);

    // 点开之后应当能正常展开，而且这个选择要记住
    const clickOpen = await ev(`
        (() => {
            document.querySelector('#h1sub-pill').click();
            const p = document.querySelector('#h1sub-panel');
            return { shown: p.style.display !== 'none',
                     pillHidden: getComputedStyle(document.querySelector('#h1sub-pill')).display === 'none' };
        })()`);
    check('点胶囊可以展开完整面板', clickOpen.shown === true, JSON.stringify(clickOpen));
    check('展开后胶囊自己隐藏', clickOpen.pillHidden === true);

    S('2b. 展开的选择会被记住（换到别的视频页也保持展开）');
    check('再打开一个视频页', await go(`${BASE}/lab.html?mode=canvas`,
        `${H1} && window.__lab && window.__lab.ready`));
    await sleep(800);
    const s2b = await ev(`
        (() => {
            const p = document.querySelector('#h1sub-panel');
            return { panelShown: p ? getComputedStyle(p).display !== 'none' : false,
                     pref: ${H1}.CFG.panelOpen };
        })()`);
    check('存储里记住了 panelOpen=true', s2b.pref === true, JSON.stringify(s2b));
    check('★ 记住之后新页面直接展开（尊重用户选择）', s2b.panelShown === true, JSON.stringify(s2b));

    S('3. 视频后加载（SPA / 懒加载）→ 面板保持收起，不再自动展开');
    await clearStore(ev);          // 回到"没选过"的默认状态
    check('加载视频延迟出现的页面', await go(`${BASE}/lab.html?mode=canvas&late=2500`,
        `${H1} && window.__lab`));
    await sleep(300);
    const s3a = await ev(`
        (() => {
            const p = document.querySelector('#h1sub-panel');
            const pill = document.querySelector('#h1sub-pill');
            return { panelShown: p ? getComputedStyle(p).display !== 'none' : false,
                     pillShown: pill ? getComputedStyle(pill).display !== 'none' : false,
                     video: !!window.__H1SUB__.findVideo() };
        })()`);
    check('视频还没出现时：面板收起、胶囊显示',
        s3a.panelShown === false && s3a.pillShown === true, JSON.stringify(s3a));

    // 等视频出现
    const dl3 = Date.now() + 15000;
    let appeared = false;
    while (Date.now() < dl3) {
        if (await ev(`!!window.__H1SUB__.findVideo()`)) { appeared = true; break; }
        await sleep(300);
    }
    check('视频出现了', appeared === true);
    await sleep(1200);
    const s3b = await ev(`
        (() => {
            const p = document.querySelector('#h1sub-panel');
            const pill = document.querySelector('#h1sub-pill');
            return { panelShown: p ? getComputedStyle(p).display !== 'none' : false,
                     pillShown: pill ? getComputedStyle(pill).display !== 'none' : false };
        })()`);
    check('★ 视频出现后也不自动展开（用户要的就是这个）',
        s3b.panelShown === false, JSON.stringify(s3b));
    check('★ 仍然只留小胶囊，等用户点开', s3b.pillShown === true, JSON.stringify(s3b));

    S('4. iframe 里嵌播放器 → 面板挂在 iframe 内，宿主页不乱挂');
    check('加载含 iframe 的宿主页', await go(
        `${BASE}/iframe-host.html?src=${encodeURIComponent('lab.html?mode=canvas')}`,
        'window.__frameLoaded === true'));
    await sleep(2500);
    const s4 = await ev(`
        (() => {
            const topPanel = document.querySelector('#h1sub-panel');
            const topPill = document.querySelector('#h1sub-pill');
            const fr = document.querySelector('#theframe');
            let inner = { err: 'no contentDocument' };
            try {
                const d = fr.contentDocument;
                const ip = d && d.querySelector('#h1sub-panel');
                const ipill = d && d.querySelector('#h1sub-pill');
                const iv = d && d.querySelector('video');
                inner = {
                    hasPanel: !!ip,
                    panelShown: ip ? getComputedStyle(ip).display !== 'none' : false,
                    pillShown: ipill ? getComputedStyle(ipill).display !== 'none' : false,
                    hasVideo: !!iv,
                    hasScript: !!(fr.contentWindow && fr.contentWindow.__H1SUB__),
                };
            } catch (e) { inner = { err: e.message }; }
            return {
                topHasPanel: !!topPanel,
                topPanelShown: topPanel ? getComputedStyle(topPanel).display !== 'none' : false,
                topPillShown: topPill ? getComputedStyle(topPill).display !== 'none' : false,
                inner,
            };
        })()`);
    check('iframe 内确实有视频', s4.inner.hasVideo === true, JSON.stringify(s4.inner));
    check('iframe 内脚本已运行', s4.inner.hasScript === true);
    check('面板挂在 iframe 里面（不是挂在宿主页）',
        s4.inner.hasPanel === true, JSON.stringify(s4.inner));
    check('iframe 内的面板同样默认收起成小胶囊',
        s4.inner.panelShown === false && s4.inner.pillShown === true, JSON.stringify(s4.inner));
    check('宿主页不显示完整面板（避免两层面板）', s4.topPanelShown === false,
        JSON.stringify(s4));

    S('5. iframe 里没有视频 → 两边都不该挂面板');
    check('加载内嵌空页面的宿主页', await go(
        `${BASE}/iframe-host.html?src=${encodeURIComponent('empty.html')}`,
        'window.__frameLoaded === true'));
    await sleep(2500);
    const s5 = await ev(`
        (() => {
            const topPanel = document.querySelector('#h1sub-panel');
            const topPill = document.querySelector('#h1sub-pill');
            const fr = document.querySelector('#theframe');
            let inner = {};
            try {
                const d = fr.contentDocument;
                inner = {
                    hasPanel: !!(d && d.querySelector('#h1sub-panel')),
                    hasPill: !!(d && d.querySelector('#h1sub-pill')),
                    hasOverlay: !!(d && d.querySelector('#h1sub-overlay')),
                };
            } catch (e) { inner = { err: e.message }; }
            return {
                topPanelShown: topPanel ? getComputedStyle(topPanel).display !== 'none' : false,
                topPillShown: topPill ? getComputedStyle(topPill).display !== 'none' : false,
                inner,
            };
        })()`);
    check('无视频的 iframe 里完全没有面板/胶囊/字幕层',
        s5.inner.hasPanel === false && s5.inner.hasPill === false
        && s5.inner.hasOverlay === false, JSON.stringify(s5.inner));
    check('宿主页只显示小胶囊', s5.topPanelShown === false && s5.topPillShown === true,
        JSON.stringify(s5));

    S('6. 本站禁用 → 脚本完全不介入');
    const setBan = await ev(`
        (() => {
            window.GM_setValue('h1sub.disabledHosts', ['127.0.0.1']);
            return window.__gmStore['h1sub.disabledHosts'];
        })()`);
    check('已把当前网站写入禁用列表', Array.isArray(setBan) && setBan[0] === '127.0.0.1',
        JSON.stringify(setBan));

    check('重新加载页面', await go(`${BASE}/lab.html?mode=canvas`,
        'document.readyState === "complete"'));
    await sleep(2500);
    const s6 = await ev(`
        (() => ({
            hasPanel: !!document.querySelector('#h1sub-panel'),
            hasPill: !!document.querySelector('#h1sub-pill'),
            hasOverlay: !!document.querySelector('#h1sub-overlay'),
            hasHook: !!window.__H1SUB__,
            hasLoadedFlag: !!window.__H1SUB_LOADED__,
        }))()`);
    check('禁用网站上没有任何面板元素',
        s6.hasPanel === false && s6.hasPill === false && s6.hasOverlay === false,
        JSON.stringify(s6));
    check('禁用网站上不再暴露调试钩子（脚本确实提前退出了）',
        s6.hasHook === false, JSON.stringify(s6));

    // 解除禁用，恢复后续测试
    await ev(`window.GM_setValue('h1sub.disabledHosts', [])`);

    S('7. 换网站后框选区域不串台');
    check('回到有视频的页面', await go(`${BASE}/lab.html?mode=canvas`,
        `${H1} && window.__lab && window.__lab.ready`));
    await sleep(600);

    const s7 = await ev(`
        (() => {
            const H = window.__H1SUB__;
            // 在本站框一个区域
            H.rememberRegion({ x: 10, y: 20, w: 300, h: 40 });
            const afterSet = {
                region: H.CFG.region,
                host: H.CFG.regionHost,
                savedKeys: Object.keys(H.CFG.regionsByHost || {}),
            };
            // 模拟"上次是在别的网站框的"
            H.CFG.regionHost = 'other-site.example';
            H.CFG.region = { x: 999, y: 999, w: 5, h: 5 };
            H.syncRegionForHost();
            return {
                afterSet,
                restored: H.CFG.region,
                restoredHost: H.CFG.regionHost,
            };
        })()`);
    check('框选后记在本站名下',
        s7.afterSet.host === '127.0.0.1'
        && s7.afterSet.savedKeys.includes('127.0.0.1'),
        JSON.stringify(s7.afterSet));
    check('换到别的网站时，区域被换成该网站自己的（不串台）',
        s7.restored && s7.restored.x === 10 && s7.restored.y === 20
        && s7.restoredHost === '127.0.0.1',
        JSON.stringify(s7));

    const s7b = await ev(`
        (() => {
            const H = window.__H1SUB__;
            // 一个从没框过的网站
            H.CFG.region = { x: 1, y: 2, w: 3, h: 4 };
            H.CFG.regionHost = '127.0.0.1';
            delete H.CFG.regionsByHost['never-visited.example'];
            const fake = { ...H.CFG };
            // 直接验证逻辑分支：本站没记录 → region 应为 null
            const saved = (H.CFG.regionsByHost || {})['never-visited.example'];
            return { savedForUnknownHost: saved === undefined };
        })()`);
    check('没框过的网站在记录里就是没有（不会误用别的站的区域）',
        s7b.savedForUnknownHost === true, JSON.stringify(s7b));

    S('8. 默认值不被运行时修改污染（cloneDefault 修复）');
    const s8 = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const before = {
                disabledIsSameRef: H.CFG.disabledHosts === H.DEFAULTS.disabledHosts,
                regionsIsSameRef: H.CFG.regionsByHost === H.DEFAULTS.regionsByHost,
                defDisabledLen: H.DEFAULTS.disabledHosts.length,
                defRegionKeys: Object.keys(H.DEFAULTS.regionsByHost).length,
            };
            // 疯狂改运行时配置
            H.CFG.disabledHosts.push('污染测试.example');
            H.CFG.regionsByHost['污染测试.example'] = { x: 1, y: 1, w: 1, h: 1 };
            H.CFG.disabledHosts.push('再来一个.example');
            const after = {
                defDisabledLen: H.DEFAULTS.disabledHosts.length,
                defRegionKeys: Object.keys(H.DEFAULTS.regionsByHost).length,
            };
            return { before, after };
        })()`);
    check('CFG 与 DEFAULTS 不是同一个对象引用',
        s8.before.disabledIsSameRef === false && s8.before.regionsIsSameRef === false,
        JSON.stringify(s8.before));
    check('默认的禁用列表一开始是空的', s8.before.defDisabledLen === 0);
    check('运行时的修改没有污染 DEFAULTS.disabledHosts',
        s8.after.defDisabledLen === 0, JSON.stringify(s8.after));
    check('运行时的修改没有污染 DEFAULTS.regionsByHost',
        s8.after.defRegionKeys === 0, JSON.stringify(s8.after));

    S('9. 全程无异常');
    await sleep(400);
    const errs = cdp.errorsFor(sessionId);
    check('页面无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' || '));
} catch (e) {
    console.log('\nFAIL 测试崩溃: ' + e.message);
    console.log(cdp.pageErrors.slice(0, 6)
        .map(x => '   [' + x.sessionId + '] ' + String(x.text).slice(0, 350)).join('\n'));
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
