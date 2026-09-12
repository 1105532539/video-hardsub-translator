// 独立验证 fixture：这个 webm 在 Chrome 里能否真的解码、尺寸对不对、像素内容是否匹配图案
import { Cdp, startServer } from './cdp.mjs';
import { FIXTURES as FIX, PAGES } from './paths.mjs';

const srvFix = await startServer({ port: 8741, root: FIX, cors: true });
const srvPage = await startServer({ port: 8742, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: 9341 });

try {
    await cdp.attachToPage();
    await cdp.goto('http://127.0.0.1:8742/pattern.js');

    // 在空白页里手动造 video 元素，指向 fixture
    await cdp.evaluate(`
        window.__probe = (async () => {
            const v = document.createElement('video');
            v.muted = true; v.playsInline = true;
            v.crossOrigin = 'anonymous';
            v.src = 'http://127.0.0.1:8741/pattern.webm';
            document.body.appendChild(v);

            const meta = await new Promise((res, rej) => {
                v.onloadedmetadata = () => res(true);
                v.onerror = () => rej(new Error('video error: ' + (v.error && v.error.message)));
                setTimeout(() => rej(new Error('metadata 超时')), 10000);
            }).catch(e => e.message);

            await new Promise(r => { v.onseeked = r; v.currentTime = 1.0; setTimeout(r, 3000); });

            const out = { meta, duration: v.duration, vw: v.videoWidth, vh: v.videoHeight,
                          readyState: v.readyState, error: v.error ? v.error.message : null };
            if (!v.videoWidth) return out;

            const c = document.createElement('canvas');
            c.width = v.videoWidth; c.height = v.videoHeight;
            const x = c.getContext('2d', { willReadFrequently: true });
            x.drawImage(v, 0, 0);
            out.drew = true;

            const px = (X, Y) => {
                const d = x.getImageData(X, Y, 1, 1).data;
                return [d[0], d[1], d[2]];
            };
            out.cellCenters = {};
            const cells = [
                ['r0c0', 80, 50], ['r0c1', 240, 50], ['r0c2', 400, 50], ['r0c3', 560, 50],
                ['r1c0', 80, 150], ['r1c1', 240, 150], ['r1c2', 400, 150], ['r1c3', 560, 150],
                ['r2c0', 80, 250], ['r2c1', 240, 250], ['r2c2', 400, 250], ['r2c3', 560, 250],
            ];
            for (const [k, X, Y] of cells) out.cellCenters[k] = px(X, Y);

            // 字幕带：统计白色像素（文字）数量
            const band = x.getImageData(0, 300, 640, 60).data;
            let white = 0, black = 0;
            for (let i = 0; i < band.length; i += 4) {
                const g = band[i] * 0.299 + band[i + 1] * 0.587 + band[i + 2] * 0.114;
                if (g > 200) white++; else if (g < 40) black++;
            }
            out.bandWhitePx = white;
            out.bandBlackPx = black;
            return out;
        })();
    `);

    const r = await cdp.evaluate('window.__probe', { awaitPromise: true });
    console.log('=== fixture 探测结果 ===');
    console.log(JSON.stringify(r, null, 2));

    console.log('\n=== 判定 ===');
    const expect = {
        r0c0: [255, 0, 0], r0c1: [0, 255, 0], r0c2: [0, 0, 255], r0c3: [255, 255, 0],
        r1c0: [255, 0, 255], r1c1: [0, 255, 255], r1c2: [255, 128, 0], r1c3: [128, 0, 255],
        r2c0: [0, 128, 0], r2c1: [128, 0, 0], r2c2: [0, 0, 128], r2c3: [128, 128, 128],
    };
    let pass = 0, fail = 0;
    if (r.vw === 640 && r.vh === 360) { console.log('✅ 尺寸正确 640x360'); pass++; }
    else { console.log(`❌ 尺寸异常 ${r.vw}x${r.vh}`); fail++; }

    for (const k of Object.keys(expect)) {
        const got = r.cellCenters && r.cellCenters[k];
        const want = expect[k];
        if (!got) { console.log(`❌ ${k} 取不到像素`); fail++; continue; }
        const ok = got.every((v, i) => Math.abs(v - want[i]) <= 12);
        if (ok) pass++; else { console.log(`❌ ${k} 期望 ${want} 实际 ${got}`); fail++; }
    }
    if (pass >= 13) console.log(`✅ 12 个色块颜色全部匹配`);
    if (r.bandWhitePx > 500) { console.log(`✅ 字幕带检测到白色文字像素 ${r.bandWhitePx}`); pass++; }
    else { console.log(`❌ 字幕带没有文字像素（white=${r.bandWhitePx}）`); fail++; }

    console.log(`\n通过 ${pass}，失败 ${fail}`);
    if (fail) process.exitCode = 1;

    if (cdp.pageErrors.length) {
        console.log('\n页面异常:');
        cdp.pageErrors.forEach(e => console.log('  ' + e.slice(0, 250)));
    }
} catch (e) {
    console.log('❌ ' + e.message);
    cdp.pageErrors.forEach(x => console.log('   ' + x.slice(0, 300)));
    process.exitCode = 1;
} finally {
    cdp.close();
    await srvFix.close();
    await srvPage.close();
}
