// 布局体检：我看不了截图，就用 DOM 几何量测代替肉眼检查
import { Cdp, startServer } from './cdp.mjs';
import { PAGES, readUserscript } from './paths.mjs';

const USERSCRIPT = readUserscript();
const PAGE_PORT = 8764;

const PRELUDE = `
(function () {
    // 本套件测的是「面板展开时的布局」，而面板**默认是收成小胶囊的**
    // （见 CFG.panelOpen）。所以这里预置成"用户已选择保持展开"，
    // 否则量到的全是 display:none 下的零尺寸。
    const store = { 'h1sub.panelOpen': true };
    window.__gmStore = store;
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

const srv = await startServer({ port: PAGE_PORT, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: 9364, extraArgs: ['--window-size=1500,1000'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
    const { sessionId } = await cdp.newPage();
    await cdp.addInitScript(PRELUDE, sessionId);
    await cdp.addInitScript(USERSCRIPT, sessionId);
    await cdp.navigate(sessionId, `http://127.0.0.1:${PAGE_PORT}/lab.html?mode=canvas`,
        { waitFor: 'window.__H1SUB__ && window.__lab && window.__lab.ready', timeoutMs: 25000 });
    const ev = (e, o = {}) => cdp.evaluate(e, { sessionId, ...o });
    await sleep(400);

    S('1. 面板整体位置');
    const box = await ev(`
        (() => {
            const p = document.querySelector('#h1sub-panel');
            const r = p.getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                     w: r.width, h: r.height,
                     vw: window.innerWidth, vh: window.innerHeight,
                     bodyScroll: document.querySelector('#h1sub-body').scrollHeight,
                     bodyClient: document.querySelector('#h1sub-body').clientHeight,
                     // 主要操作是不是不用滚动就能点到
                     region: (() => { const b = document.querySelector('#h1sub-region').getBoundingClientRect();
                                      const v = document.querySelector('#h1sub-body').getBoundingClientRect();
                                      return b.top >= v.top - 1 && b.bottom <= v.bottom + 1; })(),
                     run: (() => { const b = document.querySelector('#h1sub-run').getBoundingClientRect();
                                   const v = document.querySelector('#h1sub-body').getBoundingClientRect();
                                   return b.top >= v.top - 1 && b.bottom <= v.bottom + 1; })() };
        })()`);
    check(`面板在视口内（${Math.round(box.w)}x${Math.round(box.h)} @ ${Math.round(box.left)},${Math.round(box.top)}）`,
        box.left >= 0 && box.top >= 0 && box.right <= box.vw + 1 && box.bottom <= box.vh + 1,
        JSON.stringify(box));
    check('面板没有超出视口高度', box.h <= box.vh, box.h + ' > ' + box.vh);

    // 真正影响可用性的不是"设置项总高度"，而是"开始按钮要不要翻半天才能点到"。
    // 之前这里用的是任意的总高度阈值，结果每加一个设置项就误报一次。
    check('「框选字幕区」和「开始」无需滚动即可看到',
        box.region === true && box.run === true,
        JSON.stringify({ region: box.region, run: box.run }));
    check(`设置项总高度没有失控（内容 ${box.bodyScroll}px）`,
        box.bodyScroll < 4200, '内容高达 ' + box.bodyScroll + 'px');

    S('2. 控件尺寸与边界');
    const ctrls = await ev(`
        (() => {
            const p = document.querySelector('#h1sub-panel');
            const pr = p.getBoundingClientRect();
            const out = [];
            p.querySelectorAll('input,select,button,textarea,summary').forEach(el => {
                // 跳过被隐藏区块里的控件（比如没选有道引擎时，有道的输入框本来就该看不见）
                if (el.offsetParent === null && el.tagName !== 'SUMMARY') return;
                const r = el.getBoundingClientRect();
                const id = el.id || el.tagName.toLowerCase();
                if (r.width < 1 || r.height < 1) {
                    out.push({ id, why: 'zero-size', w: r.width, h: r.height });
                } else if (r.right > pr.right + 2 || r.left < pr.left - 2) {
                    out.push({ id, why: 'overflow-x', left: Math.round(r.left), right: Math.round(r.right), pr: Math.round(pr.right) });
                }
            });
            return out;
        })()`);
    check('所有控件都有可见尺寸且不横向溢出',
        ctrls.length === 0, JSON.stringify(ctrls).slice(0, 400));

    const ctrlCount = await ev(`document.querySelectorAll('#h1sub-panel input,#h1sub-panel select,#h1sub-panel button,#h1sub-panel textarea').length`);
    check(`面板控件总数合理（${ctrlCount} 个）`, ctrlCount >= 25);

    const labeled = await ev(`
        (() => {
            const bad = [];
            document.querySelectorAll('#h1sub-panel label').forEach(l => {
                if (!l.textContent.trim()) bad.push(l.innerHTML.slice(0, 60));
            });
            return bad;
        })()`);
    check('每个 label 都有文字说明（不会出现无标签输入框）',
        labeled.length === 0, JSON.stringify(labeled).slice(0, 300));

    S('2b. 切换引擎后对应控件要真的显示出来');
    const yd = await ev(`
        (() => {
            const e = document.querySelector('#h1sub-engine');
            e.value = 'youdao-img';
            e.dispatchEvent(new Event('change'));
            const out = {};
            for (const i of ['youdaoAppKey','youdaoAppSecret','youdaoFrom','youdaoTo','youdaoLLM']) {
                const el = document.querySelector('#h1sub-' + i);
                const r = el.getBoundingClientRect();
                out[i] = r.width > 10 && r.height > 5;
            }
            out.openaiHidden = document.querySelector('#h1sub-openai').style.display === 'none';
            out.umiHidden = document.querySelector('#h1sub-umionly').style.display === 'none';
            return out;
        })()`);
    check('切到有道引擎 → 有道输入框全部可见',
        yd.youdaoAppKey && yd.youdaoAppSecret && yd.youdaoFrom && yd.youdaoTo && yd.youdaoLLM,
        JSON.stringify(yd));
    check('切到有道引擎 → OpenAI 输入区隐藏', yd.openaiHidden === true);
    check('切到有道引擎 → Umi-OCR 区也隐藏', yd.umiHidden === true);

    const txt = await ev(`
        (() => {
            const e = document.querySelector('#h1sub-engine');
            e.value = 'umi-ocr';
            e.dispatchEvent(new Event('change'));
            const ub = document.querySelector('#h1sub-umiBase').getBoundingClientRect();
            const ul = document.querySelector('#h1sub-umiLang').getBoundingClientRect();
            return { baseVisible: ub.width > 10 && ub.height > 5,
                     langVisible: ul.width > 10 && ul.height > 5,
                     langCount: document.querySelector('#h1sub-umiLang').options.length,
                     openaiVisible: document.querySelector('#h1sub-openai').style.display !== 'none' };
        })()`);
    check('切到 Umi-OCR → 服务地址框出现',
        txt.baseVisible === true, JSON.stringify(txt));
    check('切到 Umi-OCR → 识别语言下拉出现且有选项',
        txt.langVisible === true && txt.langCount >= 6, JSON.stringify(txt));
    check('该引擎下 OpenAI 地址区仍可见（要用文本模型出译文）', txt.openaiVisible === true);

    await ev(`
        (() => {
            const e = document.querySelector('#h1sub-engine');
            e.value = 'openai-vision';
            e.dispatchEvent(new Event('change'));
        })()`);

    S('3. 使用说明折叠块');
    const help = await ev(`
        (() => {
            const d = document.querySelector('#h1sub-help');
            const s = d.querySelector('summary');
            const before = d.open;
            const sr = s.getBoundingClientRect();
            d.open = true;
            const hOpen = d.getBoundingClientRect().height;
            d.open = false;
            const hClosed = d.getBoundingClientRect().height;
            d.open = true;
            return { before, sr: { w: sr.width, h: sr.height }, hOpen, hClosed,
                     text: d.textContent.length };
        })()`);
    check('使用说明可折叠（展开比收起高）', help.hOpen > help.hClosed + 50,
        help.hClosed + ' -> ' + help.hOpen);
    check('使用说明标题可见', help.sr.w > 50 && help.sr.h > 10, JSON.stringify(help.sr));
    check('使用说明内容充実（' + help.text + ' 字）', help.text > 400);

    S('4. 诊断弹窗是否超出视口');
    const diag = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const bx = H.getContentBox(v);
            H.CFG.region = { x: bx.left + 40, y: bx.top + bx.height * 0.7, w: bx.width * 0.6, h: 40 };
            H.UI.syncRegion();
            H.Diag.open();
            const m = H.Diag.modal;
            const inner = m.querySelector('div');
            const r = inner.getBoundingClientRect();
            const ta = m.querySelector('#h1sub-diag-report');
            return { w: r.width, h: r.height, top: r.top, left: r.left,
                     vw: window.innerWidth, vh: window.innerHeight,
                     taH: ta.getBoundingClientRect().height,
                     reportChars: ta.value.length };
        })()`);
    check(`诊断弹窗在视口内（${Math.round(diag.w)}x${Math.round(diag.h)}）`,
        diag.left >= 0 && diag.top >= 0
        && diag.left + diag.w <= diag.vw + 1 && diag.top + diag.h <= diag.vh + 1,
        JSON.stringify(diag));
    check('报告文本框有足够高度', diag.taH > 150, 'height=' + diag.taH);
    check('报告非空', diag.reportChars > 300);

    const canv = await ev(`
        (() => {
            const f = document.querySelector('#h1sub-diag-frame');
            const c = document.querySelector('#h1sub-diag-crop');
            const fr = f.getBoundingClientRect(), cr = c.getBoundingClientRect();
            return { fw: f.width, fh: f.height, cw: c.width, ch: c.height,
                     fDisplayW: fr.width, cDisplayW: cr.width,
                     same: Math.abs(fr.width - cr.width) < 60 };
        })()`);
    check('两个预览画布宽度接近（左右对称布局）', canv.same,
        JSON.stringify(canv));
    await ev(`document.querySelector('#h1sub-diag-close').click()`);

    S('5. 字幕悬浮层位置');
    const ov = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.CFG.fontSize = 24; H.CFG.offsetY = 0; H.CFG.overlayTop = true;
            H.UI.loadToUI();
            H.Overlay.show('お前はもう死んでいる', '你已经死了');
            const d = document.querySelector('#h1sub-overlay');
            const r = d.getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                     w: r.width, h: r.height,
                     regionY: H.CFG.region.y,
                     vw: window.innerWidth, vh: window.innerHeight };
        })()`);
    check('字幕在视口内',
        ov.left >= 0 && ov.top >= 0 && ov.right <= ov.vw + 1 && ov.bottom <= ov.vh + 1,
        JSON.stringify(ov));
    check('字幕显示在字幕区上方', ov.bottom <= ov.regionY + 2,
        'overlay bottom=' + Math.round(ov.bottom) + ' region y=' + Math.round(ov.regionY));
    check('字幕没有超出面板宽度（不会撑爆）', ov.w < ov.vw * 0.92, 'w=' + Math.round(ov.w));

    S('6. 大字号 / 极端设置下的鲁棒性');
    const big = await ev(`
        (() => {
            const H = window.__H1SUB__;
            H.CFG.fontSize = 48;
            H.CFG.offsetY = 200;
            H.Overlay.show('这是一段很长很长的译文用来测试换行与边界处理是否会溢出视口或者把布局撑坏',
                           '这是一段很长很长的译文用来测试换行与边界处理是否会溢出视口或者把布局撑坏');
            const d = document.querySelector('#h1sub-overlay');
            const r = d.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
                     vw: window.innerWidth, vh: window.innerHeight };
        })()`);
    check('48px 大字号 + 长文本 + 极端偏移，仍在视口内',
        big.left >= 0 && big.right <= big.vw + 1 && big.top >= 0 && big.bottom <= big.vh + 1,
        JSON.stringify(big));

    // ── 弹窗按钮可见性 ──
    // 弹窗挂在 body 上，不在 #h1sub-panel 里，面板那套按钮样式作用不到它们。
    // 漏配时按钮会退化成"透明背景 + 继承文字色"，在深色弹窗上几乎看不见
    // —— 这正是用户实际遇到的情况，所以这里先注入一份常见的网站 button
    // 重置样式来复现，再检查按钮还看不看得清。
    S('7. 弹窗按钮可见性（诊断模式 / 导入导出）');
    const modalBtns = await ev(`
        (() => {
            const H = window.__H1SUB__;

            // 复现真实网站常见的 button 重置（不加 !important，靠优先级竞争）
            const host = document.createElement('style');
            host.id = '__host_button_reset';
            host.textContent = 'button{background:transparent;border:0;color:inherit;'
                + 'font:inherit;padding:0;border-radius:0}';
            document.head.appendChild(host);

            const parse = (s) => {
                const m = String(s || '').match(/[\\d.]+/g);
                if (!m || m.length < 3) return null;
                return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
            };
            const lum = (c) => {
                const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
                return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
            };
            const ratio = (a, b) => {
                const l1 = lum(a), l2 = lum(b);
                return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            };
            // 往上找第一个真正画了背景色的祖先 —— 不依赖任何类名，量的是真实观感
            const paintedBg = (el) => {
                let n = el;
                while (n && n !== document.documentElement) {
                    const c = parse(getComputedStyle(n).backgroundColor);
                    if (c && c.a > 0.5) return c;
                    n = n.parentElement;
                }
                return null;
            };
            const inspect = (sel) => {
                const btn = document.querySelector(sel);
                if (!btn) return null;
                const cs = getComputedStyle(btn);
                const box = btn.getBoundingClientRect();
                const bg = parse(cs.backgroundColor);
                const fg = parse(cs.color);
                const behind = btn.parentElement ? paintedBg(btn.parentElement) : null;
                return {
                    bg: cs.backgroundColor, fg: cs.color,
                    bgAlpha: bg ? bg.a : 0,
                    textRatio: (bg && fg && bg.a > 0.05) ? +ratio(bg, fg).toFixed(2) : 0,
                    vsBehind: (bg && behind && bg.a > 0.05) ? +ratio(bg, behind).toFixed(2) : 0,
                    borderW: parseFloat(cs.borderTopWidth) || 0,
                    w: Math.round(box.width), h: Math.round(box.height),
                };
            };
            const cleanup = () => {
                document.querySelectorAll('.h1sub-modal').forEach(el => {
                    const outer = el.parentElement;
                    if (outer && outer !== document.body) outer.remove();
                });
                H.Diag.modal = null;
            };

            const out = {};
            try {
                cleanup();
                H.Diag.open();
                out.refresh = inspect('#h1sub-diag-refresh');
                out.copy = inspect('#h1sub-diag-copy');
                cleanup();

                H.UI.exportCfg();
                out.exp = inspect('#h1sub-exp-copy');
                cleanup();

                H.UI.importCfg();
                out.imp = inspect('#h1sub-imp-ok');
                cleanup();
            } catch (e) { out.err = String(e && e.message); }
            host.remove();
            return out;
        })()`);

    if (modalBtns.err) check('打开弹窗不报错', false, modalBtns.err);
    for (const [name, b] of [
        ['诊断「刷新」', modalBtns.refresh],
        ['诊断「复制报告」', modalBtns.copy],
        ['导出「复制」', modalBtns.exp],
        ['导入「导入」', modalBtns.imp],
    ]) {
        check(name + ' 在网站重置了 button 样式的情况下依然看得清',
            !!b && b.bgAlpha > 0.5 && b.textRatio >= 4.5 && b.vsBehind >= 1.15,
            JSON.stringify(b));
        check(name + ' 有可见边框且尺寸正常',
            !!b && b.borderW >= 1 && b.w > 40 && b.h > 20,
            JSON.stringify(b));
    }

    await sleep(300);
    const errs = cdp.errorsFor(sessionId);
    console.log('');
    check('全程无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' || '));
} catch (e) {
    console.log('\nFAIL ' + e.message);
    console.log(cdp.pageErrors.slice(0, 5).map(x => '   ' + String(x.text).slice(0, 300)).join('\n'));
    process.exitCode = 1;
} finally {
    cdp.close();
    await srv.close();
}

const pass = R.filter(x => x.pass).length;
const fail = R.length - pass;
console.log('\n' + '='.repeat(50));
console.log(`  总计 ${R.length} 项  ·  通过 ${pass}  ·  失败 ${fail}`);
if (fail) R.filter(x => !x.pass).forEach(x => console.log('  BAD [' + x.suite + '] ' + x.name));
console.log('='.repeat(50));
if (fail) process.exitCode = 1;
