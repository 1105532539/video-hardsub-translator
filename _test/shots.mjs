// 截取面板实际样子，用于人工确认视觉效果
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, startServer } from './cdp.mjs';

import { PAGES, SHOTS as OUT, readUserscript } from './paths.mjs';

const USERSCRIPT = readUserscript();
const PAGE_PORT = 8762;

fs.mkdirSync(OUT, { recursive: true });

const PRELUDE = `
(function () {
    const store = {};
    window.__gmStore = store;
    window.GM_getValue = function (k, d) { return (k in store) ? store[k] : d; };
    window.GM_setValue = function (k, v) { store[k] = v; };
    window.GM_registerMenuCommand = function () {};
    window.GM_xmlhttpRequest = function () {};
})();
`;

const srv = await startServer({ port: PAGE_PORT, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: 9362, extraArgs: ['--window-size=1500,1000'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
    const { sessionId } = await cdp.newPage();
    await cdp.addInitScript(PRELUDE, sessionId);
    await cdp.addInitScript(USERSCRIPT, sessionId);
    await cdp.navigate(sessionId, `http://127.0.0.1:${PAGE_PORT}/lab.html?mode=canvas`,
        { waitFor: 'window.__H1SUB__ && window.__lab && window.__lab.ready', timeoutMs: 25000 });

    const ev = (e, o = {}) => cdp.evaluate(e, { sessionId, ...o });

    // 面板默认样子（展开使用说明，并造两条识别记录让「最近识别」有内容）
    await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.CFG.apiKey = 'sk-demo-1234567890';
            H.CFG.engine = 'openai-vision';
            H.CFG.apiBase = 'https://generativelanguage.googleapis.com/v1beta/openai';
            H.CFG.model = 'gemini-2.5-flash';
            H.UI.loadToUI();
            const v = H.findVideo();
            const box = H.getContentBox(v);
            const P = window.__PATTERN__;
            const cr = P.cellRect(0, 0);
            H.CFG.region = {
                x: box.left + (cr.x / v.videoWidth) * box.width,
                y: box.top + (cr.y / v.videoHeight) * box.height,
                w: (cr.w / v.videoWidth) * box.width,
                h: (cr.h / v.videoHeight) * box.height,
            };
            H.UI.syncRegion();
            H.Diag.records = [];
            H.Diag.record({ engine: 'openai-vision@element', ms: 1180,
                original: 'お前はもう死んでいる', translation: '你已经死了' });
            H.Diag.record({ engine: 'openai-vision@element', ms: 960,
                original: '何だこの程度か', translation: '就这种程度吗' });
            H.Overlay.show('お前はもう死んでいる', '你已经死了');
        })()`);
    await sleep(500);
    await cdp.screenshot(path.join(OUT, '1-panel.png'), sessionId);

    // 诊断模式
    await ev(`window.__H1SUB__.Diag.open()`);
    await sleep(700);
    await cdp.screenshot(path.join(OUT, '2-diag.png'), sessionId);
    await ev(`document.querySelector('#h1sub-diag-close').click()`);

    // 收起说明、加宽面板，看完整布局
    await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.CFG.panelWidth = 430;
            H.UI.applyLayout();
            document.querySelector('#h1sub-help').open = false;
        })()`);
    await sleep(400);
    await cdp.screenshot(path.join(OUT, '3-wide.png'), sessionId);

    console.log('OK 截图完成:');
    for (const f of fs.readdirSync(OUT)) {
        const p = path.join(OUT, f);
        console.log('   ' + p + '  (' + Math.round(fs.statSync(p).size / 1024) + ' KB)');
    }
} catch (e) {
    console.log('FAIL ' + e.message);
    console.log(cdp.pageErrors.slice(0, 5).map(x => '   ' + String(x.text).slice(0, 300)).join('\n'));
    process.exitCode = 1;
} finally {
    cdp.close();
    await srv.close();
}
