// 用 node 的 fetch 探测公开 HLS 流 + 下载 hls.js（PowerShell 的网络栈在此环境不可用）
import fs from 'node:fs';
import path from 'node:path';

import { TEST_DIR, VENDOR as OUT } from './paths.mjs';

fs.mkdirSync(OUT, { recursive: true });

const streams = [
    'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8',
    'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
    'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
    'https://test-streams.mux.dev/pts_shift/master.m3u8',
];

async function head(url) {
    try {
        const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(12000) });
        const body = r.ok ? (await r.text()).slice(0, 120).replace(/\s+/g, ' ') : '';
        return { ok: r.ok, status: r.status, body };
    } catch (e) {
        return { ok: false, status: '-', body: e.message.slice(0, 70) };
    }
}

console.log('=== 公开 HLS 测试流可达性 ===');
const good = [];
for (const u of streams) {
    const r = await head(u);
    console.log(`${r.ok ? '✅' : '❌'} ${r.status}  ${u}`);
    if (r.ok) { console.log(`      ${r.body.slice(0, 90)}`); good.push(u); }
    else console.log(`      ${r.body}`);
}

console.log('\n=== 下载 hls.js ===');
const HLS_URLS = [
    'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js',
    'https://unpkg.com/hls.js@1.5.17/dist/hls.min.js',
];
for (const u of HLS_URLS) {
    try {
        const r = await fetch(u, { signal: AbortSignal.timeout(60000) });
        if (!r.ok) { console.log(`❌ ${r.status} ${u}`); continue; }
        const txt = await r.text();
        const dest = path.join(OUT, 'hls.min.js');
        fs.writeFileSync(dest, txt, 'utf8');
        console.log(`✅ hls.js 已保存：${Math.round(txt.length / 1024)} KB -> ${dest}`);
        break;
    } catch (e) {
        console.log(`❌ ${u} : ${e.message.slice(0, 70)}`);
    }
}

console.log('\n可用流数量: ' + good.length);
fs.writeFileSync(path.join(TEST_DIR, 'streams.json'), JSON.stringify(good, null, 2));
