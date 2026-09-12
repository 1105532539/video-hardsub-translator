// 全屏适配测试
//
// 背景：浏览器进全屏时只渲染「全屏元素及其子树」，挂在 body 上的 UI 会被
// 整个隐藏掉。所以全屏时要把 UI 搬进全屏容器；如果全屏的就是 <video> 本身
// （替换元素，子节点不渲染），只能改用原生字幕轨。
import { Cdp, startServer } from './cdp.mjs';
import { PAGES, readUserscript } from './paths.mjs';

const USERSCRIPT = readUserscript();
const PORT = 8822;

const PRELUDE = `
(function () {
    const store = window.__gmStore = {};
    window.GM_getValue = function (k, d) { return (k in store) ? store[k] : d; };
    window.GM_setValue = function (k, v) { store[k] = v; };
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

const srv = await startServer({ port: PORT, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: 9422 });
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
    const { sessionId } = await cdp.newPage();
    await cdp.addInitScript(PRELUDE, sessionId);
    await cdp.addInitScript(USERSCRIPT, sessionId);
    await cdp.navigate(sessionId, `http://127.0.0.1:${PORT}/lab.html?mode=canvas`,
        { waitFor: 'window.__H1SUB__ && window.__lab && window.__lab.ready', timeoutMs: 25000 });
    const ev = (e, o = {}) => cdp.evaluate(e, { sessionId, ...o });
    const evAsync = (e, o = {}) => cdp.evaluate(e, { sessionId, awaitPromise: true, ...o });
    const gesture = (e) => cdp.evaluate(e, { sessionId, awaitPromise: true, userGesture: true });

    // 页面内的探针：一次性装好，后面反复用
    await ev(`
        (() => {
            window.__fs = {
                // UI 的三个元素现在各自挂在谁下面
                parents() {
                    const H = window.__H1SUB__;
                    const tag = (el) => {
                        if (!el) return '(不存在)';
                        const p = el.parentNode;
                        if (!p) return '(无父节点)';
                        return p === document.body ? 'BODY' : (p.tagName + (p.id ? '#' + p.id : ''));
                    };
                    return {
                        overlay: tag(H.Overlay.el),
                        panel: tag(H.UI.root),
                        pill: tag(H.UI.pillEl),
                    };
                },
                // 是否落在全屏元素的子树里（不在的话浏览器根本不会画它）
                inFsTree(el) {
                    const fs = document.fullscreenElement;
                    return !!(el && fs && (fs === el || fs.contains(el)));
                },
                status() {
                    const s = document.querySelector('#h1sub-status');
                    return s ? s.textContent : '';
                },
            };
            return true;
        })()`);

    // ─────────────────────────────────────────────
    S('1. 全屏前：UI 挂在 body 上');

    const before = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const b = H.getContentBox(v);
            const P = window.__PATTERN__;
            H.CFG.region = H.anchorRegion(
                b.left, b.top + (P.BAND_Y / v.videoHeight) * b.height,
                b.width, (P.BAND_H / v.videoHeight) * b.height, v);
            H.CFG.showOriginal = true;
            H.Overlay.show('テスト字幕', '测试字幕');
            return { parents: window.__fs.parents(), fs: document.fullscreenElement };
        })()`);

    check('没有全屏元素', before.fs === null, String(before.fs));
    check('字幕层挂在 body', before.parents.overlay === 'BODY', JSON.stringify(before.parents));
    check('面板挂在 body', before.parents.panel === 'BODY', JSON.stringify(before.parents));

    // ─────────────────────────────────────────────
    S('2. 播放器容器全屏：UI 搬进全屏子树');

    const enter = await gesture(`
        (async () => {
            const v = document.querySelector('video');
            const wrap = v.parentElement;
            await wrap.requestFullscreen();
            return { ok: true };
        })()`);
    await sleep(400);

    const during = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const fs = document.fullscreenElement;
            const v = H.findVideo();
            return {
                enterOk: ${JSON.stringify(enter.ok)},
                fsTag: fs ? fs.tagName : null,
                overlayInFs: window.__fs.inFsTree(H.Overlay.el),
                panelInFs: window.__fs.inFsTree(H.UI.root),
                parents: window.__fs.parents(),
                // 全屏后截图还得是对的
                grab: (() => {
                    try { const c = H.Capturer.grab(H.CFG.region, v); return c ? c.width + '×' + c.height : null; }
                    catch (e) { return 'ERR ' + e.message; }
                })(),
                // 字幕层得有实际尺寸，才谈得上"看得见"
                overlayBox: (() => {
                    const r = H.Overlay.el ? H.Overlay.el.getBoundingClientRect() : null;
                    return r ? Math.round(r.width) + '×' + Math.round(r.height) : null;
                })(),
                status: window.__fs.status(),
            };
        })()`);

    check('容器全屏成功', during.enterOk === true && during.fsTag === 'DIV',
        JSON.stringify(during));
    check('★ 字幕层在全屏子树内（不会被隐藏）', during.overlayInFs === true,
        JSON.stringify(during));
    check('★ 面板在全屏子树内（还能操作）', during.panelInFs === true,
        JSON.stringify(during));
    check('字幕层有实际尺寸', during.overlayBox === '124×73', during.overlayBox);
    check('全屏后截图仍然正常（区域自动重锚定）',
        /^\d+×\d+$/.test(String(during.grab)), String(during.grab));
    check('状态栏提示已跟随全屏', /全屏/.test(during.status), during.status);

    // 全屏期间字幕还能更新
    const updated = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.Overlay.show('別の字幕', '另一句字幕');
            const ov = document.querySelector('#h1sub-overlay');
            return { text: ov ? ov.textContent : '', inFs: window.__fs.inFsTree(ov) };
        })()`);
    check('全屏期间字幕能正常更新，而且仍在全屏子树内',
        /另一句字幕/.test(updated.text) && updated.inFs === true,
        JSON.stringify(updated));

    // ─────────────────────────────────────────────
    S('3. 退出全屏：UI 搬回 body');

    await gesture(`document.exitFullscreen().catch(() => {})`);
    await sleep(400);

    const after = await ev(`
        (() => {
            const H = window.__H1SUB__;
            return {
                fs: document.fullscreenElement,
                parents: window.__fs.parents(),
                overlayBox: (() => {
                    const r = H.Overlay.el ? H.Overlay.el.getBoundingClientRect() : null;
                    return r ? Math.round(r.width) + '×' + Math.round(r.height) : null;
                })(),
            };
        })()`);

    check('已退出全屏', after.fs === null, String(after.fs));
    check('★ 字幕层搬回了 body（否则会跟全屏元素一起消失）',
        after.parents.overlay === 'BODY', JSON.stringify(after.parents));
    check('★ 面板也搬回了 body', after.parents.panel === 'BODY', JSON.stringify(after.parents));
    check('退出后字幕层依然有实际尺寸（不是被藏起来了）',
        /^\d+×\d+$/.test(String(after.overlayBox))
        && !/^0×/.test(String(after.overlayBox)), after.overlayBox);

    // ─────────────────────────────────────────────
    S('4. <video> 自己全屏：改用原生字幕轨');

    // 先把 UI 收起来，避免干扰
    await ev(`(() => { window.__H1SUB__.Overlay.clear(); return true; })()`);

    const vEnter = await gesture(`
        (async () => {
            const v = document.querySelector('video');
            await v.requestFullscreen();
            return { ok: true };
        })()`);
    await sleep(400);

    const onVideoFs = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            return {
                enterOk: ${JSON.stringify(vEnter.ok)},
                fsTag: document.fullscreenElement ? document.fullscreenElement.tagName : null,
                // <video> 是替换元素：塞进去的子节点不参与渲染（已实测）
                probeHasBox: (() => {
                    const d = document.createElement('div');
                    d.style.cssText = 'position:fixed;width:50px;height:50px';
                    document.fullscreenElement.appendChild(d);
                    const r = d.getBoundingClientRect();
                    d.remove();
                    return r.width > 0;
                })(),
                trackCountBefore: v.textTracks.length,
            };
        })()`);

    check('<video> 全屏成功', onVideoFs.enterOk === true && onVideoFs.fsTag === 'VIDEO',
        JSON.stringify(onVideoFs));
    check('证实 <video> 的子节点确实不渲染（所以不能靠 appendChild）',
        onVideoFs.probeHasBox === false, JSON.stringify(onVideoFs));

    // 触发一次显示，看有没有建出字幕轨
    const track = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.CFG.showOriginal = false;
            H.Overlay.show('日本語の字幕', '中文字幕');
            const v = H.findVideo();
            const t = v.textTracks[v.textTracks.length - 1];
            const cue = (t && t.cues && t.cues.length) ? t.cues[0] : null;
            return {
                trackCount: v.textTracks.length,
                mode: t ? t.mode : null,
                kind: t ? t.kind : null,
                cueCount: t && t.cues ? t.cues.length : 0,
                cueText: cue ? cue.text : null,
                hasFullscreen: !!H.Fullscreen.track,
            };
        })()`);

    check('★ 建出了原生字幕轨', track.trackCount >= 1 && track.hasFullscreen === true,
        JSON.stringify(track));
    check('字幕轨处于显示状态', track.mode === 'showing', JSON.stringify(track));
    check('★ 轨道里有一条带译文的 cue', track.cueText === '中文字幕',
        JSON.stringify(track));

    // 再更新一次：应该复用同一条 cue，而不是越堆越多
    const track2 = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.Overlay.show('次の字幕', '下一句字幕');
            const v = H.findVideo();
            const t = v.textTracks[v.textTracks.length - 1];
            return {
                cueCount: t && t.cues ? t.cues.length : 0,
                cueText: (t && t.cues && t.cues.length) ? t.cues[0].text : null,
            };
        })()`);

    check('★ 更新时复用同一条 cue（不会越堆越多）', track2.cueCount === 1,
        JSON.stringify(track2));
    check('cue 内容已更新为最新译文', track2.cueText === '下一句字幕',
        JSON.stringify(track2));

    // 原文一起显示时，cue 里两行都有
    const both = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.CFG.showOriginal = true;
            H.Overlay.show('原文です', '译文在此');
            const v = H.findVideo();
            const t = v.textTracks[v.textTracks.length - 1];
            return { cueText: (t && t.cues && t.cues.length) ? t.cues[0].text : null };
        })()`);
    check('同时显示原文时，两行都在 cue 里',
        /原文です/.test(String(both.cueText)) && /译文在此/.test(String(both.cueText)),
        JSON.stringify(both));

    // 退出后字幕轨要收掉
    await gesture(`document.exitFullscreen().catch(() => {})`);
    await sleep(400);

    const trackGone = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const t = v.textTracks[v.textTracks.length - 1];
            return {
                fs: document.fullscreenElement,
                trackCount: v.textTracks.length,
                mode: t ? t.mode : null,
                cueCount: (t && t.cues) ? t.cues.length : 0,
                overlayParent: window.__fs.parents().overlay,
                // 这个 API 在实测的 Chrome 里不存在，所以清理不能依赖它
                hasRemoveApi: typeof v.removeTextTrack === 'function',
            };
        })()`);

    check('退出 <video> 全屏后字幕轨停止显示（mode=disabled）',
        trackGone.mode === 'disabled', JSON.stringify(trackGone));
    check('字幕轨里的 cue 已清空', trackGone.cueCount === 0, JSON.stringify(trackGone));
    check('退出后字幕层仍在 body', trackGone.overlayParent === 'BODY',
        JSON.stringify(trackGone));

    // ─────────────────────────────────────────────
    // 这条专门盯一个踩过的坑：清理时若调用不存在的 removeTextTrack，
    // try/catch 会把 TypeError 吞掉，轨道留在原地，于是每进一次全屏
    // 就多挂一条 —— 进出几次就堆一堆。
    S('4b. 反复进出全屏不能累积字幕轨');

    const cycles = [];
    for (let i = 0; i < 3; i++) {
        await gesture(`
            (async () => { await document.querySelector('video').requestFullscreen(); })()`);
        await sleep(250);
        const n = await ev(`
            (() => {
                const H = window.__H1SUB__;
                H.Overlay.show('第${i}轮', '第${i}轮译文');
                return H.findVideo().textTracks.length;
            })()`);
        await gesture(`document.exitFullscreen().catch(() => {})`);
        await sleep(250);
        cycles.push(n);
    }

    const cycleFinal = await ev(`
        (() => {
            const v = window.__H1SUB__.findVideo();
            return { count: v.textTracks.length,
                     modes: Array.from(v.textTracks).map(t => t.mode) };
        })()`);

    check('★ 进出 3 次全屏后字幕轨仍然只有 1 条',
        cycleFinal.count === 1, JSON.stringify({ cycles, final: cycleFinal }));
    check('所有字幕轨都已停止显示',
        cycleFinal.modes.every(m => m === 'disabled'), JSON.stringify(cycleFinal));

    // ─────────────────────────────────────────────
    S('5. 全屏期间才挂载 UI：应直接挂进全屏元素');

    // 先把面板整个拆掉，再进全屏，然后重新挂载
    await gesture(`
        (async () => {
            document.querySelector('video').parentElement.requestFullscreen();
        })()`);
    await sleep(400);

    const lateMount = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.UI.destroy();
            H.Overlay.el = null;                 // 连字幕层一起清掉
            H.UI.mount();                        // ← 此时已经处于全屏状态
            H.Overlay.show('遅れて作った字幕', '后建的字幕');
            return {
                panelInFs: window.__fs.inFsTree(H.UI.root),
                overlayInFs: window.__fs.inFsTree(H.Overlay.el),
                parents: window.__fs.parents(),
            };
        })()`);

    check('★ 全屏期间新建的面板直接挂进全屏元素', lateMount.panelInFs === true,
        JSON.stringify(lateMount));
    check('★ 全屏期间新建的字幕层也直接挂进去', lateMount.overlayInFs === true,
        JSON.stringify(lateMount));

    await gesture(`document.exitFullscreen().catch(() => {})`);
    await sleep(400);

    const afterLate = await ev(`
        (() => ({ parents: window.__fs.parents() }))()`);
    check('退出全屏后新建的 UI 也搬回 body',
        afterLate.parents.panel === 'BODY' && afterLate.parents.overlay === 'BODY',
        JSON.stringify(afterLate));

    // ─────────────────────────────────────────────
    S('6. 结束后无异常');

    const errs = cdp.errorsFor(sessionId);
    check('页面无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' || '));
} catch (e) {
    console.log('\nFAIL 崩溃: ' + e.message);
    console.log(cdp.pageErrors.slice(0, 6).map(x => '   ' + String(x.text).slice(0, 300)).join('\n'));
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
