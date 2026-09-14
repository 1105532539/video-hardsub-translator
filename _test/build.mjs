// 构建守卫测试：给 _build/build.mjs 补上它此前**完全没有**的覆盖。
//
// 为什么需要它：build.mjs 守着一堆规则（模块编号、重名、依赖、三处版本号、
// 语法门、--check 漂移），但在此之前没有任何测试证明「规则被违反时它真会失败」。
// 而它防的恰恰是「共享作用域里两个模块重名」这类最难排查的问题 ——
// 守卫本身失效了也没人知道。
//
// 做法：把 src/ 复制到临时目录，**每次只改坏一样东西**，断言退出码非 0
// 且报错信息命中预期。跑完删掉临时目录，不碰真实仓库。
//
// 注意：本测试不起 Chrome、不占端口，所以可以放在任何位置跑。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './paths.mjs';

const BUILD = path.join(ROOT, '_build', 'build.mjs');
const R = [];
let suite = '';
const S = (n) => { suite = n; console.log('\n── ' + n + ' ──'); };
function check(name, pass, detail) {
    R.push({ suite, name, pass: !!pass });
    console.log('  ' + (pass ? 'OK  ' : 'BAD ') + name + (pass || detail === undefined ? '' : '   → ' + detail));
}

/** 造一个临时仓库副本：src/ + package.json + _build/，产物从零开始（不存在） */
function makeSandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h1sub-build-'));
    fs.mkdirSync(path.join(dir, '_build'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
    fs.copyFileSync(BUILD, path.join(dir, '_build', 'build.mjs'));
    return dir;
}

/** 在沙箱里跑构建，返回 { code, out }（stdout+stderr 合并） */
function runBuild(dir, args = []) {
    try {
        const out = execFileSync(process.execPath, [path.join(dir, '_build', 'build.mjs'), ...args], {
            cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { code: 0, out };
    } catch (e) {
        return { code: e.status === undefined ? -1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') };
    }
}

const readSrc = (dir, f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
const writeSrc = (dir, f, s) => fs.writeFileSync(path.join(dir, 'src', f), s, 'utf8');

/** 每个用例都在自己的沙箱里跑，互不影响 */
function withSandbox(fn) {
    const dir = makeSandbox();
    try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log('构建守卫测试（_build/build.mjs）');
console.log('每次用例都在临时目录里改坏一样东西，断言构建能拦下来。');

// ── 0. 对照组：没改坏的 src/ 必须构建成功 ──────────────────────────
//    没有这一条，下面任何一条"失败了"都可能只是因为沙箱本身建错了。
S('0. 对照组（未改坏时必须成功）');
withSandbox((dir) => {
    const r = runBuild(dir);
    check('干净的 src/ 构建成功', r.code === 0, 'exit ' + r.code + ' ' + r.out.slice(0, 200));
    check('产物确实被写出来了',
        fs.existsSync(path.join(dir, 'video-hardsub-translator.user.js')));
});

// ── 1. 顶层名字重复（共享作用域里会互相覆盖）────────────────────────
S('1. 顶层名字重复');
withSandbox((dir) => {
    // 往 32-util.js 里塞一个 20-video.js 已经定义的名字
    const f = '32-util.js';
    writeSrc(dir, f, readSrc(dir, f).replace(
        '    function sleep(ms)',
        '    function findVideo() { return null; }\n    function sleep(ms)'));
    const r = runBuild(dir);
    check('重名被拦下（退出码非 0）', r.code !== 0, 'exit ' + r.code);
    check('报错指明是哪个名字', /findVideo/.test(r.out), r.out.slice(0, 300));
    check('报错提示会互相覆盖', /覆盖/.test(r.out), r.out.slice(0, 300));
});

// ── 2. 依赖指向一个没人提供的名字（拼写错误）────────────────────────
S('2. 依赖写错（没人提供）');
withSandbox((dir) => {
    const f = '24-region.js';
    writeSrc(dir, f, readSrc(dir, f).replace(
        '//  依赖：findVideo', '//  依赖：findVideosTypo'));
    const r = runBuild(dir);
    check('无人提供的依赖被拦下', r.code !== 0, 'exit ' + r.code);
    check('报错点名该依赖', /findVideosTypo/.test(r.out), r.out.slice(0, 300));
});

// ── 3. 声称对外提供、实际没定义 ────────────────────────────────────
S('3. 对外提供与实现不符');
withSandbox((dir) => {
    const f = '30-image.js';
    writeSrc(dir, f, readSrc(dir, f).replace(
        '//  对外提供：thumbnail、', '//  对外提供：thumbnailGhost、'));
    const r = runBuild(dir);
    check('虚报 provide 被拦下', r.code !== 0, 'exit ' + r.code);
    check('报错点名该名字', /thumbnailGhost/.test(r.out), r.out.slice(0, 300));
});

// ── 4. 模块编号重复 ───────────────────────────────────────────────
S('4. 模块编号重复');
withSandbox((dir) => {
    fs.copyFileSync(path.join(dir, 'src', '32-util.js'), path.join(dir, 'src', '30-util2.js'));
    const r = runBuild(dir);
    check('编号重复被拦下', r.code !== 0, 'exit ' + r.code);
    check('报错说明编号重复', /编号重复/.test(r.out), r.out.slice(0, 300));
});

// ── 5. 文件名不合规范 ─────────────────────────────────────────────
S('5. 文件名不合规范');
withSandbox((dir) => {
    fs.writeFileSync(path.join(dir, 'src', 'util.js'), '    // 编号缺了\n', 'utf8');
    const r = runBuild(dir);
    check('非法文件名被拦下', r.code !== 0, 'exit ' + r.code);
});

// ── 6. 版本号三处不一致 ───────────────────────────────────────────
S('6. 版本号不一致');
withSandbox((dir) => {
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    p.version = '99.99.99';
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(p, null, 2), 'utf8');
    const r = runBuild(dir);
    check('package.json 与 @version 不一致被拦下', r.code !== 0, 'exit ' + r.code);
    check('报错点名版本号', /版本号不一致/.test(r.out), r.out.slice(0, 300));
});

// ── 7. 语法错误必须在**写文件之前**被挡住 ──────────────────────────
S('7. 语法门（写文件前挡住）');
withSandbox((dir) => {
    // 先正常构建一次，拿到一份好产物
    runBuild(dir);
    const outFile = path.join(dir, 'video-hardsub-translator.user.js');
    const good = fs.readFileSync(outFile, 'utf8');

    // 再改出语法错误重建
    const f = '24-region.js';
    writeSrc(dir, f, readSrc(dir, f) + '\n    function broken( { \n');
    const r = runBuild(dir);
    check('语法错误被拦下', r.code !== 0, 'exit ' + r.code);
    check('好产物没有被写坏', fs.readFileSync(outFile, 'utf8') === good,
        '产物被覆盖了 —— 语法门没能在写入前生效');
});

// ── 8. --check 能发现漂移（这是"改了 src 忘了构建"的唯一防线）──────
S('8. --check 检测产物漂移');
withSandbox((dir) => {
    const outFile = path.join(dir, 'video-hardsub-translator.user.js');

    // 产物还不存在时应失败
    const before = runBuild(dir, ['--check']);
    check('产物不存在时 --check 失败', before.code !== 0, 'exit ' + before.code);

    // 构建后应通过
    runBuild(dir);
    const ok = runBuild(dir, ['--check']);
    check('刚构建完 --check 通过', ok.code === 0, 'exit ' + ok.code + ' ' + ok.out.slice(0, 200));

    // 改一个字节后应失败
    fs.appendFileSync(outFile, '\n', 'utf8');
    const drift = runBuild(dir, ['--check']);
    check('产物被改动后 --check 失败', drift.code !== 0, 'exit ' + drift.code);
    check('提示要重新构建', /npm run build/.test(drift.out), drift.out.slice(0, 300));
});

// ── 9. 缺「对外提供 / 依赖」声明 ──────────────────────────────────
S('9. 模块头缺声明');
withSandbox((dir) => {
    const f = '32-util.js';
    writeSrc(dir, f, readSrc(dir, f).replace('//  依赖：无\n', ''));
    const r = runBuild(dir);
    check('缺「依赖：」被拦下', r.code !== 0, 'exit ' + r.code);
    check('报错提示要写"无"', /没有依赖就写/.test(r.out), r.out.slice(0, 300));
});

// ── 10. 扫描器必须挡得住注释/字符串里的假声明（回归）──────────────
//     build.mjs 早期版本是纯逐行正则，把 /* */ 里的 `const X = 1` 也算作
//     顶层绑定 —— 也就是说重名守卫可以被一段注释绕过。这里锁死修复。
S('10. 扫描器抗注释/字符串绕过');
withSandbox((dir) => {
    const f = '32-util.js';
    // 在块注释里放一个与 20-video.js 同名的假声明。
    // 若扫描器没剥离注释，会误报"顶层名字重复"；正确行为是构建照常通过。
    writeSrc(dir, f, readSrc(dir, f).replace(
        '    function sleep(ms)',
        '    /*\n    function findVideo() {}\n    */\n    function sleep(ms)'));
    const r = runBuild(dir);
    check('注释里的假声明不触发重名误报', r.code === 0,
        'exit ' + r.code + ' —— 扫描器又被注释骗了：' + r.out.slice(0, 200));

    // 反向：模板串里的假声明同样不该被当成真的
    const g = '24-region.js';
    writeSrc(dir, g, readSrc(dir, g).replace(
        '    function getContentBox(video) {',
        '    const FAKE = `\n    function getContentBox() {}\n    `;\n    function getContentBox(video) {'));
    const r2 = runBuild(dir);
    check('模板串里的假声明不触发重名误报', r2.code === 0,
        'exit ' + r2.code + ' —— ' + r2.out.slice(0, 200));
});

// ── 11. 依赖对账（只警告，不阻断构建）──────────────────────────────
S('11. 依赖对账：只警告、不阻断');
withSandbox((dir) => {
    const f = '24-region.js';
    // 声明一个存在但本模块没用到的依赖
    writeSrc(dir, f, readSrc(dir, f).replace(
        '//  依赖：findVideo', '//  依赖：findVideo、thumbnail'));
    const r = runBuild(dir);
    check('对账不一致**不**阻断构建（仍是退出码 0）', r.code === 0, 'exit ' + r.code);
    check('但会给出警告', /依赖声明对账/.test(r.out), r.out.slice(0, 300));
    check('警告点名 thumbnail', /thumbnail/.test(r.out), r.out.slice(0, 300));
});

// ── 汇总 ─────────────────────────────────────────────────────────
const pass = R.filter(x => x.pass).length;
const fail = R.length - pass;
console.log('\n' + '='.repeat(54));
console.log(`  总计 ${R.length} 项  ·  通过 ${pass}  ·  失败 ${fail}`);
if (fail) R.filter(x => !x.pass).forEach(x => console.log('  BAD [' + x.suite + '] ' + x.name));
console.log('='.repeat(54));
if (fail) process.exitCode = 1;
