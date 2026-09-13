#!/usr/bin/env node
/*
 * ═════════════════════════════════════════════════════════════════════
 *  _build/build.mjs — 把 src/ 下的模块拼成根目录的单个用户脚本
 * ═════════════════════════════════════════════════════════════════════
 *
 *  为什么是「拼接」而不是真打包：
 *    用户脚本必须**单文件即装即用**（Tampermonkey 没有模块加载器，
 *    @require 又要外部托管、破坏"点一下就能装"），所以源码分成多个模块、
 *    产物仍然是一个文件。各模块共享同一个 IIFE 作用域 —— 拼接不改变
 *    任何一行的语义，产物与重构前的单文件在代码层面逐行等价。
 *
 *  零依赖：只用 Node 内置模块，仓库不需要 npm install。
 *
 *  用法：
 *    node _build/build.mjs           生成产物
 *    node _build/build.mjs --check   只校验产物是否与 src/ 一致（CI / 提交前用）
 *
 *  构建时会核对（任何一条不过就退出码 1）：
 *    1. src/ 文件名规范、编号不重复
 *    2. 每个模块都有「对外提供 / 依赖」声明，且对外提供的名字真的定义了
 *    3. 没有两个模块定义同名顶层绑定（共享作用域里这会互相覆盖）
 *    4. 依赖的名字确实有模块提供（挡住拼写错误）
 *    5. package.json / @version / SCRIPT_VERSION 三处版本号一致
 *    6. 产物能通过语法解析（vm.Script，只解析不执行）
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const BUILD_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(BUILD_DIR);
const SRC_DIR = path.join(ROOT, 'src');
const OUT_FILE = path.join(ROOT, 'video-hardsub-translator.user.js');
const CHECK_ONLY = process.argv.includes('--check');

const errors = [];
const fail = (msg) => errors.push(msg);

// ── 1. 收集模块，顺序由文件名的两位编号决定 ──────────────────────────

const MODULE_NAME = /^(\d{2})-([a-z0-9-]+)\.js$/;

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();
if (!files.length) fail('src/ 里没有任何模块');
if (files[0] !== '00-header.js') fail('第一个模块必须是 00-header.js（用户脚本元数据块要在文件最前面）');

const seenNo = new Map();
const modules = files.map((file) => {
    const m = MODULE_NAME.exec(file);
    if (!m) {
        fail(`模块文件名不合规范：${file}（应形如 30-image.js）`);
        return null;
    }
    if (seenNo.has(m[1])) fail(`模块编号重复：${m[1]}（${seenNo.get(m[1])} 与 ${file}）`);
    seenNo.set(m[1], file);
    return { file, no: m[1], text: fs.readFileSync(path.join(SRC_DIR, file), 'utf8').replace(/\r\n/g, '\n') };
}).filter(Boolean);

// ── 2. 读模块头里的「对外提供 / 依赖」 ────────────────────────────────

function headerField(text, label) {
    const anchor = '//  ' + label + '：';
    const at = text.indexOf(anchor);
    if (at < 0) return null;
    const out = [];
    const lines = text.slice(at).split('\n');
    for (let i = 0; i < lines.length; i++) {
        let line;
        if (i === 0) {
            line = lines[i].replace(/^\s*\/\/\s*/, '');
            line = line.slice(line.indexOf('：') + 1);
        } else {
            const mm = /^\s*\/\/\s?(.*)$/.exec(lines[i]);
            if (!mm) break;                       // 注释块结束
            line = mm[1];
            if (/═/.test(line)) break;            // 撞到分隔线，说明字段读完了
            if (/^(对外提供|依赖)：/.test(line.trim())) break;
        }
        out.push(line);
    }
    const names = out.join('').split('、').map((s) => s.trim()).filter(Boolean);
    return names.length === 1 && names[0] === '无' ? [] : names;
}

// ── 3. 扫描每个模块定义的顶层绑定（IIFE 内缩进 4 空格）────────────────

const DECL = /^ {4}((?:async\s+)?function|class|const|let|var)\s+(.*)$/;
const BARE_ASSIGN = /^ {4}([A-Za-z_$][\w$]*)\s*=[^=]/;

function topLevelNames(text) {
    const names = [];
    for (const line of text.split('\n')) {
        const m = DECL.exec(line);
        if (m) {
            const kind = m[1], rest = m[2];
            if (kind === 'class' || kind.endsWith('function')) {
                const n = /^([A-Za-z_$][\w$]*)/.exec(rest);
                if (n) names.push(n[1]);
                continue;
            }
            // const/let/var：一行可能声明多个（const THUMB_W = 32, THUMB_H = 16;）
            const re = /(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g;
            let mm, hit = 0;
            while ((mm = re.exec(rest))) { names.push(mm[1]); hit++; }
            if (!hit) {
                // 解构之类本仓库没用到，但别静默漏掉
                const n = /^([A-Za-z_$][\w$]*)/.exec(rest);
                if (n) names.push(n[1]);
            }
            continue;
        }
        const asg = BARE_ASSIGN.exec(line);
        if (asg) names.push(asg[1]);
    }
    return names;
}

const owner = new Map();          // 顶层名字 → 模块文件名
let providesAll = new Set();

for (const mod of modules) {
    mod.declared = topLevelNames(mod.text);
    mod.dups = mod.declared.filter((n, i) => mod.declared.indexOf(n) !== i);
    if (mod.dups.length) fail(`${mod.file} 内部重复定义：${[...new Set(mod.dups)].join('、')}`);

    for (const n of mod.declared) {
        if (owner.has(n)) fail(`顶层名字重复：${n} 同时定义在 ${owner.get(n)} 和 ${mod.file}（共享作用域里会互相覆盖）`);
        else owner.set(n, mod.file);
    }

    if (mod.file === '00-header.js') { mod.provides = []; mod.deps = []; continue; }

    mod.provides = headerField(mod.text, '对外提供');
    mod.deps = headerField(mod.text, '依赖');
    if (mod.provides === null) fail(`${mod.file} 的模块头里缺少「对外提供：」（见其它模块的写法）`);
    if (mod.deps === null) fail(`${mod.file} 的模块头里缺少「依赖：」（没有依赖就写"无"）`);
    mod.provides = mod.provides || [];
    mod.deps = mod.deps || [];

    for (const n of mod.provides) {
        if (!mod.declared.includes(n)) fail(`${mod.file} 声称对外提供 ${n}，但模块里没有定义它`);
    }
    providesAll = new Set([...providesAll, ...mod.provides]);
}

for (const mod of modules) {
    for (const n of mod.deps || []) {
        if (!providesAll.has(n)) fail(`${mod.file} 依赖 ${n}，但没有任何模块声称提供它（拼写错误？）`);
    }
}

// ── 4. 版本号三处一致 ───────────────────────────────────────────────

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const header = modules[0].text;
const metaVersion = (/^\/\/\s*@version\s+(\S+)/m.exec(header) || [])[1];
const srcVersion = (/const SCRIPT_VERSION = '([^']+)'/.exec(
    modules.map((m) => m.text).join('\n')) || [])[1];

if (!metaVersion) fail('00-header.js 里找不到 // @version');
if (!srcVersion) fail('src/ 里找不到 const SCRIPT_VERSION');
if (metaVersion && pkg.version !== metaVersion) {
    fail(`版本号不一致：package.json 是 ${pkg.version}，@version 是 ${metaVersion}`);
}
if (srcVersion && pkg.version !== srcVersion) {
    fail(`版本号不一致：package.json 是 ${pkg.version}，SCRIPT_VERSION 是 ${srcVersion}`);
}

if (errors.length) {
    console.error('构建前检查未通过：\n');
    for (const e of errors) console.error('  ✗ ' + e);
    console.error('');
    process.exit(1);
}

// ── 5. 拼接 ─────────────────────────────────────────────────────────

const WARNING = [
    '/*',
    ' * ⚠️ 本文件由 src/ 下的模块自动拼接生成 —— 请勿直接编辑，改了会被下次构建覆盖。',
    ' *    改代码请改 src/ 里对应的模块，然后运行：npm run build',
    ' *    模块清单、拼接顺序与依赖关系见 _build/build.mjs 和每个模块头的说明；',
    ' *    架构总览见 docs/ARCHITECTURE.md。',
    ' */',
].join('\n');

const PROLOGUE = [
    '(function () {',
    "    'use strict';",
    '',
    '    // 同一个文档里只初始化一次',
    '    if (window.__H1SUB_LOADED__) return;',
    '    window.__H1SUB_LOADED__ = true;',
].join('\n');

// 🐛 修复：body 不再包含 00-header.js。它上面已经作为 header 输出过一次，
// 再拼进 IIFE 内部会生成第二份完全相同的 ==UserScript== 块 —— 那是模板 bug，
// 属于死代码（用户脚本管理器只认文件开头那一份）。
// 判据：产物里 "==UserScript==" 只应出现 2 次（开头一行 + 结尾的 ==/UserScript==）。
const body = modules.slice(1).map((m) => m.text.replace(/\s+$/, '')).join('\n\n');

const output = [
    header.replace(/\s+$/, ''),
    '',
    WARNING,
    '',
    PROLOGUE,
    '',
    body,
    '})();',
    '',
].join('\n');

// ── 6. 语法自检（只解析、不执行）────────────────────────────────────

try {
    new vm.Script(output, { filename: 'video-hardsub-translator.user.js' });
} catch (e) {
    console.error('拼接结果语法有问题，已中止（未写入文件）：\n  ' + e.message);
    process.exit(1);
}

if (output.includes('\r')) {
    console.error('产物里出现了 CR，行尾必须是 LF（见 .gitattributes）');
    process.exit(1);
}

// ── 7. 写入 / 校验 ──────────────────────────────────────────────────

const old = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null;

if (CHECK_ONLY) {
    if (old === output) {
        console.log('✅ 产物与 src/ 一致（' + modules.length + ' 个模块，'
            + output.split('\n').length + ' 行）');
        process.exit(0);
    }
    console.error('✗ 产物与 src/ 不一致 —— 源码改了但没重新构建。');
    console.error('  请运行：npm run build');
    process.exit(1);
}

fs.writeFileSync(OUT_FILE, output, 'utf8');

const lines = output.split('\n').length - 1;
const kb = (Buffer.byteLength(output, 'utf8') / 1024).toFixed(1);
const changed = old !== output;
const verbose = process.argv.includes('--verbose');

console.log('已生成 video-hardsub-translator.user.js' + (changed ? '' : '（内容无变化）'));
console.log('  ' + modules.length + ' 个模块 · ' + lines + ' 行 · ' + kb + ' KB · v' + pkg.version);

// 模块清单只在产物真的变了（或显式要）时打印，免得每次 npm test 都刷一屏
if (changed || verbose) {
    console.log('');
    for (const m of modules) {
        const n = m.text.split('\n').length;
        const deps = m.file === '00-header.js' ? '' : (m.deps.length ? '  ← ' + m.deps.join('、') : '');
        console.log('  ' + m.file.padEnd(22) + String(n).padStart(5) + ' 行' + deps);
    }
}

console.log('\n检查通过：模块命名与编号、对外提供与依赖声明、顶层名字唯一性、版本号一致性、语法解析。');
