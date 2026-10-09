// 采样模式对比：字幕「出现 → 被发现」的延迟，interval（固定间隔）vs frame（跟随视频帧）。
//
// 为什么单独做这个基准：bench.mjs 量的是单次函数耗时（微秒级），而 P1-1 要证明的是
// **端到端延迟**——用固定间隔轮询时，一句字幕出现后平均要等 interval/2 才可能被截到；
// 改成跟随视频帧、但把付费调用仍然按 interval 卡住之后，这个等待应该降到"一帧 + 节流"。
//
// 场景选择（重要，决定了这个数字该怎么读）：
//   测的是「上一句已经过去一会儿、画面里暂时没有字幕，然后新的一句出现」这种情况 ——
//   也就是追剧时最常见的那种节奏。此时两次**付费调用**之间的最小间隔早已过期，
//   frame 模式可以立刻花钱，而 interval 模式只能干等下一次轮询。
//   如果画面一直在变、每一轮都在花钱，那么两种模式都会被 interval 卡住（这是设计如此：
//   花钱的上限不变），这也是本基准不拿那种场景做对比的原因。
//
// ⚠️ 环境限制：本套件跑的是无头 Chrome，它**存在 requestVideoFrameCallback 却从不回调**
//   （已实测：2 秒内回调 0 次，同时 rAF 跑了 122 次）。所以 frame 模式这一侧装了一个
//   按 30fps 泵帧的替身，走的仍是同一段产品代码（arm / 节流 / 最小间隔 / 看门狗），
//   只是帧源可预测。换成有真实渲染的浏览器时，帧源就是视频本身。
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, startServer } from './cdp.mjs';
import { PAGES, TEST_DIR } from './paths.mjs';
import { readUserscript } from './paths.mjs';

const USERSCRIPT = readUserscript();
const PORT = Number((process.argv.find(a => a.startsWith('--port=')) || '').slice(7)) || 8806;
const TRIALS = Number(process.argv.find(a => a.startsWith('--trials='))?.slice(9)) || 8;
const INTERVAL = 1200;
const API_DELAY = 150;          // 模拟一次视觉模型往返

const PRELUDE = `
(function () {
    const store = window.__gmStore = { 'h1sub.panelOpen': false };
    window.GM_getValue = function (k, d) { return (k in store) ? store[k] : d; };
    window.GM_setValue = function (k, v) { store[k] = v; };
    window.GM_registerMenuCommand = function () {};
    window.__gmReqs = [];
    window.__gmResponse = null;
    window.__gmDelay = 3;
    window.GM_xmlhttpRequest = function (opts) {
        window.__gmReqs.push({ url: opts.url, data: opts.data });
        const resp = window.__gmResponse;
        setTimeout(function () {
            if (!resp) { opts.onerror && opts.onerror(new Error('no stub')); return; }
            opts.onload && opts.onload({ status: resp.status, responseText: resp.text });
        }, window.__gmDelay);
        return { abort() {} };
    };
})();
`;

const OK = (o, t) => JSON.stringify({
    status: 200,
    text: JSON.stringify({
        model: 'deepseek-flash',
        choices: [{ message: { role: 'assistant', content: JSON.stringify({ original: o, translation: t }) }, finish_reason: 'stop' }],
    }),
});

const srv = await startServer({ port: PORT, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: PORT + 600 });
const out = {};

try {
    const { sessionId } = await cdp.newPage();
    await cdp.addInitScript(PRELUDE, sessionId);
    await cdp.addInitScript(USERSCRIPT, sessionId);
    await cdp.navigate(sessionId, `http://127.0.0.1:${PORT}/lab.html?mode=canvas`,
        { waitFor: 'window.__H1SUB__ && window.__lab && window.__lab.ready', timeoutMs: 25000 });

    for (const mode of ['interval', 'frame']) {
        const r = await cdp.evaluate(`
            (async () => {
                const H = window.__H1SUB__;
                const P = H.Pipeline;
                const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                const v = H.findVideo();
                const bx = H.getContentBox(v);

                // ── 可控画面源：接替 Capturer.grab，内容由本脚本决定 ──
                const src = document.createElement('canvas');
                src.width = 900; src.height = 120;
                const g = src.getContext('2d');
                const draw = (text) => {
                    g.fillStyle = '#101010'; g.fillRect(0, 0, 900, 120);
                    if (!text) return;
                    g.fillStyle = '#fff';
                    g.font = 'bold 52px sans-serif';
                    g.textBaseline = 'middle';
                    g.fillText(text, 24, 60);
                };
                const realGrab = H.Capturer.grab;
                H.Capturer.grab = () => src;

                H.CFG.region = H.anchorRegion(bx.left, bx.top + bx.height - 60, bx.width, 100, v);
                H.CFG.captureMode = 'element';
                H.CFG.engine = 'openai-vision';
                H.CFG.apiBase = 'https://api.deepseek.com';
                H.CFG.apiKey = 'sk-bench';
                H.CFG.smartSkip = true;
                H.CFG.interval = ${INTERVAL};
                H.CFG.sampleMode = '${mode}';
                H.CFG.textSimThreshold = 0.28;
                window.__gmDelay = ${API_DELAY};
                window.__gmResponse = JSON.parse(${JSON.stringify(OK('BENCH LINE', '基准译文'))});
                P.resetStats();

                // 帧源替身（只在 frame 模式装）：见文件头"环境限制"
                let pump = null, realRvfc = null, realCancel = null;
                if ('${mode}' === 'frame') {
                    realRvfc = v.requestVideoFrameCallback;
                    realCancel = v.cancelVideoFrameCallback;
                    const pending = new Map();
                    let seq = 0;
                    v.requestVideoFrameCallback = (cb) => { const h = ++seq; pending.set(h, cb); return h; };
                    v.cancelVideoFrameCallback = (h) => { pending.delete(h); };
                    pump = setInterval(() => {
                        const list = Array.from(pending.values());
                        pending.clear();
                        for (const cb of list) cb(performance.now(), {});
                    }, 33);
                }

                // 记录"这一轮真的去调接口了"的时刻
                let reactedAt = 0;
                const realRec = P.recognize;
                P.recognize = function () { reactedAt = performance.now(); return realRec.apply(this, arguments); };

                const trials = [];
                for (let i = 0; i < ${TRIALS}; i++) {
                    // 1) 先让画面里没有字幕 —— 不花钱，于是付费间隔自然过期
                    draw('');
                    P.resetFrameState();
                    P.running = true;
                    P.tick();
                    // 让它先跑过至少一个周期（确保处在稳定的轮询节奏里），再多等一段**随机**
                    // 时间：字幕出现的时刻相对于轮询相位必须是随机的，否则量到的只是这一步
                    // 恰好落在周期里的哪个固定位置，而不是"平均要等多久"。
                    await sleep(${INTERVAL} * 1.6 + Math.random() * ${INTERVAL});

                    // 2) 新的一句出现，记下时刻，等它被发现
                    const text = 'BENCH LINE ' + i;
                    reactedAt = 0;
                    const t0 = performance.now();
                    draw(text);
                    const deadline = t0 + 8000;
                    while (!reactedAt && performance.now() < deadline) await sleep(5);
                    trials.push(reactedAt ? reactedAt - t0 : null);
                    await sleep(${INTERVAL} * 0.5);      // 让这一轮收尾
                }

                P.stop();
                P.recognize = realRec;
                H.Capturer.grab = realGrab;
                if (pump) clearInterval(pump);
                if (realRvfc) { v.requestVideoFrameCallback = realRvfc; v.cancelVideoFrameCallback = realCancel; }

                const ok = trials.filter(x => x !== null);
                ok.sort((a, b) => a - b);
                return {
                    mode: '${mode}',
                    trials,
                    median: ok.length ? ok[Math.floor(ok.length / 2)] : null,
                    min: ok[0] ?? null,
                    max: ok[ok.length - 1] ?? null,
                    apiCalls: P.stats.apiCalls,
                    looks: P.stats.shots,        // 一共看了多少次画面（两种模式可以直接比）
                    samples: P.stats.samples,    // 帧驱动那部分（interval 模式下恒为 0）
                };
            })()`, { sessionId, awaitPromise: true });
        out[mode] = r;
        console.log(`${mode.padEnd(9)} 延迟(ms)：` + (r.trials || []).map(x => x === null ? '—' : Math.round(x)).join(', '));
    }
} catch (e) {
    console.log('基准失败: ' + e.message);
    console.log(cdp.pageErrors.slice(0, 4).map(x => '   ' + String(x.text).slice(0, 250)).join('\n'));
    process.exitCode = 1;
} finally {
    cdp.close();
    await srv.close();
}

if (out.interval && out.frame) {
    const f = (x) => (x === null || x === undefined) ? '—' : Math.round(x) + ' ms';
    console.log('\n' + '='.repeat(60));
    console.log(`  字幕「出现 → 被发现」延迟（各 ${TRIALS} 次，间隔 ${INTERVAL}ms）`);
    console.log('='.repeat(60));
    console.log('  模式        中位数      最小      最大');
    console.log('  interval    ' + f(out.interval.median).padStart(9) + f(out.interval.min).padStart(10) + f(out.interval.max).padStart(10));
    console.log('  frame       ' + f(out.frame.median).padStart(9) + f(out.frame.min).padStart(10) + f(out.frame.max).padStart(10));
    const drop = out.interval.median && out.frame.median
        ? (1 - out.frame.median / out.interval.median) * 100 : 0;
    console.log('='.repeat(60));
    console.log(`  中位数下降 ${drop.toFixed(0)}%（看画面的次数：frame ${out.frame.looks} 次`
        + ` vs interval ${out.interval.looks} 次；付费调用：frame ${out.frame.apiCalls} 次`
        + ` vs interval ${out.interval.apiCalls} 次）`);
}
const dest = path.join(TEST_DIR, '_sample-bench.json');
fs.writeFileSync(dest, JSON.stringify({ when: new Date().toISOString(), interval: INTERVAL, apiDelay: API_DELAY, trials: TRIALS, results: out }, null, 2), 'utf8');
console.log('  明细已写入 ' + path.basename(dest));
