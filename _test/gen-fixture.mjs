// 生成确定性测试视频：驱动 Chrome 用 MediaRecorder 录出 pattern.webm
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, startServer } from './cdp.mjs';

import { FIXTURES as FIX, PAGES } from './paths.mjs';

fs.mkdirSync(FIX, { recursive: true });

const srv = await startServer({ port: 8740, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: 9340 });

try {
    await cdp.attachToPage();
    await cdp.goto('http://127.0.0.1:8740/gen.html', { waitFor: 'window.__makeFixture' });

    console.log('正在录制测试视频…');
    const r = await cdp.evaluate('window.__makeFixture()', { awaitPromise: true });

    if (!r || !r.b64) throw new Error('录制失败：没有拿到数据');

    const buf = Buffer.from(r.b64, 'base64');
    const dest = path.join(FIX, 'pattern.webm');
    fs.writeFileSync(dest, buf);

    console.log('✅ 测试视频已生成');
    console.log('   路径 : ' + dest);
    console.log('   大小 : ' + Math.round(buf.length / 1024) + ' KB');
    console.log('   编码 : ' + r.mime);
    console.log('   图案 : ' + JSON.stringify(r.pattern));

    if (cdp.pageErrors.length) {
        console.log('\n⚠️ 页面异常:');
        cdp.pageErrors.forEach(e => console.log('   ' + e.slice(0, 200)));
    }
} catch (e) {
    console.log('❌ 失败：' + e.message);
    if (cdp.pageErrors.length) cdp.pageErrors.forEach(x => console.log('   ' + x.slice(0, 300)));
    process.exitCode = 1;
} finally {
    cdp.close();
    await srv.close();
}
