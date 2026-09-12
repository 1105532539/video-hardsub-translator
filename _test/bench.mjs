// 性能基准：量热路径函数的吞吐与单次耗时，以及面板挂载耗时。
// 优化前后各跑一次，用同一台机器同一份数据对比。
//
// 只测纯计算和 DOM 挂载，不发网络请求。
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, startServer } from './cdp.mjs';
import { PAGES, TEST_DIR, USERSCRIPT_PATH } from './paths.mjs';

// 支持 --script=<路径> 指定被测脚本，方便新旧两版交替跑做 A/B 对比
const SCRIPT_PATH = (process.argv.find(a => a.startsWith('--script=')) || '').slice(9)
    || USERSCRIPT_PATH;
const USERSCRIPT = fs.readFileSync(SCRIPT_PATH, 'utf8');
const PORT = Number((process.argv.find(a => a.startsWith('--port=')) || '').slice(7)) || 8796;
const CDP_PORT = PORT + 600;
const LABEL = process.argv[2] || '未标注';
const OUT = (process.argv.find(a => a.startsWith('--out=')) || '').slice(6);

const PRELUDE = `
(function () {
    const store = window.__gmStore = {};
    window.GM_getValue = function (k, d) { return (k in store) ? store[k] : d; };
    window.GM_setValue = function (k, v) { store[k] = v; };
    window.GM_registerMenuCommand = function () {};
    window.GM_xmlhttpRequest = function () {};
})();
`;

const srv = await startServer({ port: PORT, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: CDP_PORT });

const results = {};

try {
    const { sessionId } = await cdp.newPage();
    await cdp.addInitScript(PRELUDE, sessionId);

    // ── 量面板挂载 + 脚本解析的耗时 ──
    const t0 = Date.now();
    await cdp.addInitScript(USERSCRIPT, sessionId);
    await cdp.navigate(sessionId, `http://127.0.0.1:${PORT}/lab.html?mode=canvas`,
        { waitFor: 'window.__H1SUB__ && window.__lab && window.__lab.ready', timeoutMs: 30000 });
    results.启动到面板可用 = Date.now() - t0;

    const ev = (e) => cdp.evaluate(e, { sessionId });
    const evAsync = (e) => cdp.evaluate(e, { sessionId, awaitPromise: true });

    // ── 造一份真实尺寸的截图（和 grabFromElement 的产物同量级）──
    await ev(`
        (() => {
            const v = window.__H1SUB__.findVideo();
            const b = window.__H1SUB__.getContentBox(v);
            const P = window.__PATTERN__;
            const c = document.createElement('canvas');
            c.width = 900; c.height = 120;            // 典型字幕带放大后的尺寸
            const g = c.getContext('2d');
            g.fillStyle = '#101010'; g.fillRect(0, 0, 900, 120);
            g.fillStyle = '#fff';
            g.font = 'bold 46px "Microsoft YaHei", sans-serif';
            g.fillText('こんな感じの字幕が入っています', 20, 76);
            window.__benchCanvas = c;
            window.__benchBox = b;
            window.__benchPattern = P;
            return true;
        })()`);

    // 统计辅助：跑 N 次取总耗时，再算单次。
    // 旧版本可能没有某个接口（钩子是后来才加的），那就跳过这一项而不是整体崩掉。
    const bench = async (name, expr, iters) => {
        let r;
        try {
            r = await evAsync(`
                (async () => {
                    const H = window.__H1SUB__;
                    const f = ${expr};
                    // 预热，避开 JIT 冷启动
                    for (let i = 0; i < Math.min(200, ${iters}); i++) f(i);
                    const t0 = performance.now();
                    for (let i = 0; i < ${iters}; i++) f(i);
                    const dt = performance.now() - t0;
                    return { total: dt, per: dt / ${iters} };
                })()`);
        } catch (e) {
            r = { skipped: true };
        }
        results[name] = r;
        return r;
    };

    // 迭代次数按"总耗时至少跨过 100ms"来定。
    // performance.now() 在 Chrome 里被 Spectre 缓解量化到 100µs 左右，
    // 只跑几毫秒的话总共才几十个刻度，量出来的差异基本是噪声。
    const ITERS = {
        simSame: 60000,
        simDiff: 60000,
        escape: 120000,
        thumb: 20000,
        edge: 10000,
        grab: 600,
        encode: 600,
        step: 20000,
        overlay: 6000,
    };

    // ── 热路径 1：相同串的相似度比较（最常见的场景：整帧没变、OCR 结果一样）──
    await bench('textSimilarity·相同串', `(i) => {
        H.textSimilarity('こんな感じの字幕が入っています', 'こんな感じの字幕が入っています');
    }`, ITERS.simSame);

    // ── 热路径 2：不同串（真正要算编辑距离）──
    await bench('textSimilarity·不同串', `(i) => {
        H.textSimilarity('こんな感じの字幕が入っています', 'これは別の字幕テキストになっています');
    }`, ITERS.simDiff);

    // ── 热路径 3：escapeHtml ──
    await bench('escapeHtml', `(i) => {
        H.escapeHtml('こんな感じの字幕 & <b>強調</b> "引用" が入っています');
    }`, ITERS.escape);

    // ── 热路径 4：缩略图（变化检测）──
    await bench('thumbnail', `(i) => { H.thumbnail(window.__benchCanvas); }`, ITERS.thumb);

    // ── 热路径 5：边缘密度（智能跳过）──
    await bench('edgeDensity', `(i) => { H.edgeDensity(window.__benchCanvas); }`, ITERS.edge);

    // ── 热路径 6：截图（裁剪 + 缩放 + 编码探测）──
    await ev(`
        (() => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const b = H.getContentBox(v);
            H.CFG.region = H.anchorRegion(b.left, b.top, b.width, 80, v);
            H.CFG.captureMode = 'element';
            return true;
        })()`);
    await bench('Capturer.grab', `(i) => { H.Capturer.grab(H.CFG.region); }`, ITERS.grab);

    // ── 热路径 6b：JPEG 编码 —— 每次调 API 都要做，很可能是最大的一块 ──
    const grabSize = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const g = H.Capturer.grab(H.CFG.region);
            window.__grabbed = g;
            return g ? { w: g.width, h: g.height } : null;
        })()`);
    results['截图产物尺寸'] = grabSize
        ? { total: 1, per: 1, note: grabSize.w + '×' + grabSize.h } : null;
    if (!grabSize) throw new Error('截图失败，后面的编码基准没法做');

    await bench('canvas.toDataURL(jpeg)', `(i) => {
        window.__grabbed.toDataURL('image/jpeg', 0.92);
    }`, ITERS.encode);

    await bench('canvas.toDataURL(png)', `(i) => {
        window.__grabbed.toDataURL('image/png');
    }`, Math.round(ITERS.encode / 2));

    // ── 热路径 7：一次完整的 step（不含 API：暂停视频让它早退）──
    await bench('Pipeline.step·空转', `(i) => {
        H.Pipeline.running = true;
        H.CFG.region = null;                 // 走到"没框选"的早退分支
        H.Pipeline.step();
        H.CFG.region = window.__benchRegion || null;
    }`, ITERS.step);

    // ── 热路径 8：字幕悬浮层渲染 ──
    await ev(`
        (() => {
            const H = window.__H1SUB__;
            const v = H.findVideo();
            const b = H.getContentBox(v);
            H.CFG.region = H.anchorRegion(b.left, b.top + b.height - 100, b.width, 80, v);
            H.CFG.showOriginal = true;
            return true;
        })()`);
    await bench('Overlay.show+定位', `(i) => {
        H.Overlay.show('こんな感じの字幕 & <b>x</b>', '大概是这样的字幕内容');
    }`, ITERS.overlay);

    // ── 面板挂载耗时：单次只有 1ms 量级，一次测量基本是量化噪声，
    //    改成在页内跑 20 次取中位数 ──
    const mount = await ev(`
        (() => {
            const H = window.__H1SUB__;
            const samples = [];
            for (let i = 0; i < 20; i++) {
                H.UI.destroy();
                const t0 = performance.now();
                H.UI.mount();
                samples.push(performance.now() - t0);
            }
            samples.sort((a, b) => a - b);
            return { mountMs: samples[10] };     // 中位数
        })()`);
    results['UI.mount'] = { total: mount.mountMs, per: mount.mountMs };

    // ── 内存：跑 300 轮热路径看堆增长 ──
    let mem;
    try {
        mem = await ev(`
            (() => {
                const H = window.__H1SUB__;
                const c = window.__benchCanvas;
                if (!performance.memory) return { unsupported: true };
                // 旧版本不一定有 escapeHtml 这个钩子，缺了就少跑一项
                const esc = typeof H.escapeHtml === 'function'
                    ? () => H.escapeHtml('こんな感じの字幕 & <b>強調</b> "引用"')
                    : () => '';
                const before = performance.memory.usedJSHeapSize;
                for (let i = 0; i < 300; i++) {
                    H.thumbnail(c);
                    H.edgeDensity(c);
                    H.textSimilarity('こんな感じの字幕が入っています', 'これは別の字幕テキストです');
                    esc();
                }
                const after = performance.memory.usedJSHeapSize;
                return { deltaKB: (after - before) / 1024, beforeMB: before / 1048576 };
            })()`);
    } catch (e) {
        mem = { skipped: true };
    }
    results['300 轮热路径堆增长'] = mem;

    console.log('\n' + '='.repeat(66));
    console.log('  性能基准  ·  ' + LABEL);
    console.log('='.repeat(66));
    for (const [k, v] of Object.entries(results)) {
        if (v == null) { console.log(`  ${k.padEnd(26)} ${v}`); continue; }
        if (typeof v === 'number') { console.log(`  ${k.padEnd(26)} ${v} ms`); continue; }
        if (v.unsupported) { console.log(`  ${k.padEnd(26)} (浏览器不支持 performance.memory)`); continue; }
        if (v.skipped) { console.log(`  ${k.padEnd(26)} (该版本无此接口，跳过)`); continue; }
        if (v.note) { console.log(`  ${k.padEnd(26)} ${v.note}`); continue; }
        if (v.deltaKB !== undefined) {
            console.log(`  ${k.padEnd(26)} ${v.deltaKB >= 0 ? '+' : ''}${v.deltaKB.toFixed(0)} KB`);
            continue;
        }
        console.log(`  ${k.padEnd(26)} 单次 ${v.per.toFixed(4)} ms   总 ${v.total.toFixed(1)} ms`);
    }
    console.log('='.repeat(66));

    // 机器可读，便于前后对比
    const dest = OUT || path.join(TEST_DIR, '_bench-last.json');
    fs.writeFileSync(dest,
        JSON.stringify({ label: LABEL, script: SCRIPT_PATH, when: new Date().toISOString(), results }, null, 2),
        'utf8');
} catch (e) {
    console.log('基准失败: ' + e.message);
    console.log(cdp.pageErrors.slice(0, 4).map(x => '   ' + String(x.text).slice(0, 250)).join('\n'));
    process.exitCode = 1;
} finally {
    cdp.close();
    await srv.close();
}
