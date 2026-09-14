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
 *
 *  另外会做一项**只警告、不阻断**的对账（见第 3b 节）：
 *    模块头的「依赖」与代码实际使用是否一致（声明了没用 / 用了没声明）。
 *    之所以先不阻断：98-boot.js 的 window.__H1SUB__ 调试钩子重导出了上百个
 *    名字，声明补齐之前直接报错会让构建无法通过。
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
    if (names.length === 1 && names[0] === '无') return [];
    // 「依赖：*」= 通配（见 98-boot.js 的说明）。此时后面通常还跟着一段解释性
    // 注释，会被上面的循环一并收进来，所以只要开头是 * 就整体当作通配。
    if (names.length && names[0].charAt(0) === '*') return ['*'];
    return names;
}

// ── 3. 扫描每个模块定义的顶层绑定（IIFE 内缩进 4 空格）────────────────

const DECL = /^ {4}((?:async\s+)?function|class|const|let|var)\s+(.*)$/;
const BARE_ASSIGN = /^ {4}([A-Za-z_$][\w$]*)\s*=[^=]/;

/**
 * 把注释、字符串与正则字面量替换成等长空白（保留换行与列位置）。
 * 两个用途：① 顶层绑定扫描不被注释里的假代码骗到；② 依赖使用情况扫描
 * 不被字符串 / 注释里的同名词误判。
 *
 * ⚠️ 正则字面量必须单独处理：`/[&<>"]/g` 里的引号是**正则的一部分**，
 *    若当成字符串起点会一路吞掉后面成片的代码（本文件早期版本就踩过）。
 *    判别用通行启发式：`/` 前面是「期待表达式」的符号时才算正则。
 */
const REGEX_PRECEDERS = new Set([
    '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';',
    '+', '-', '*', '%', '~', '^', '<', '>', '\n',
]);

function blankOut(text) {
    let out = '';
    let i = 0;
    const n = text.length;
    let prev = '';                    // 上一个「有意义的」字符，供正则判别用
    const pad = (from, to) => { for (let k = from; k < to; k++) out += (text[k] === '\n' ? '\n' : ' '); };

    while (i < n) {
        const c = text[i], c2 = text[i + 1];

        if (c === '/' && c2 === '*') {                              // 块注释
            const end = text.indexOf('*/', i + 2);
            const stop = end < 0 ? n : end + 2;
            pad(i, stop);
            i = stop;
            prev = '\n';
        } else if (c === '/' && c2 === '/') {                       // 行注释
            const end = text.indexOf('\n', i);
            const stop = end < 0 ? n : end;
            pad(i, stop);
            i = stop;
            prev = '\n';
        } else if (c === '/' && (prev === '' || REGEX_PRECEDERS.has(prev))) {
            let j = i + 1, inClass = false;
            while (j < n) {
                const d = text[j];
                if (d === '\\') { j += 2; continue; }
                if (d === '\n') break;                              // 正则不跨行，防跑飞
                if (d === '[') inClass = true;
                else if (d === ']') inClass = false;
                else if (d === '/' && !inClass) { j++; break; }
                j++;
            }
            pad(i, j);
            i = j;
            prev = '/';
        } else if (c === '\'' || c === '"' || c === '`') {          // 字符串 / 模板串
            const quote = c;
            let j = i + 1;
            while (j < n) {
                if (text[j] === '\\') { j += 2; continue; }
                if (text[j] === quote) { j++; break; }
                j++;
            }
            pad(i, j);
            i = j;
            prev = quote;
        } else {
            out += c;
            if (!/\s/.test(c)) prev = c;
            i++;
        }
    }
    return out;
}

function topLevelNames(text) {
    const names = [];
    for (const line of blankOut(text).split('\n')) {
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

/** 模块里「用到」了哪些标识符（去注释/字符串/正则后按词法切分） */
function usedNames(text) {
    const clean = blankOut(text);
    const used = new Set();
    const re = /[A-Za-z_$][\w$]*/g;
    let m;
    while ((m = re.exec(clean))) {
        const name = m[0];
        // ① 前面是 . 或 ?. → 属性访问，不是对外部名字的使用
        //    注意：不能用 [.\w$]? 这类前缀字符组去"顺手"吃掉点号 —— \w 会把
        //    标识符的首字母也吃掉（CFG 会被切成 C + FG），本文件踩过这个坑。
        let k = m.index - 1;
        while (k >= 0 && (clean[k] === ' ' || clean[k] === '\t')) k--;
        if (k >= 0 && clean[k] === '.') continue;

        // ② 形如 `{ foo: 1 }` / `, foo: 1` 的对象字面量键 → 不是使用
        //    只在前面确实是 { 或 , 时才判为键，避免把三元 `a ? b : c` 的 b 误伤
        let after = m.index + name.length;
        let j = after;
        while (j < clean.length && (clean[j] === ' ' || clean[j] === '\t')) j++;
        if (clean[j] === ':') {
            let b = k;
            while (b >= 0 && /\s/.test(clean[b])) b--;
            if (b >= 0 && (clean[b] === '{' || clean[b] === ',')) continue;
        }
        used.add(name);
    }
    return used;
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
        if (n === '*') continue;                 // 通配，见 98-boot.js
        if (!providesAll.has(n)) fail(`${mod.file} 依赖 ${n}，但没有任何模块声称提供它（拼写错误？）`);
    }
}

// ── 3b. 依赖声明与代码实际使用是否对得上（**只警告、不阻断**）────────
//  为什么是警告而不是错误：98-boot.js 的 window.__H1SUB__ 调试钩子从每个模块
//  重导出上百个名字，它的模块头不可能逐个声明。直接开成错误会让构建立刻失败，
//  所以先以警告落地，等声明补齐后再考虑转成错误。
//  两类问题都要报：
//    ① 声明了却没用到  —— 声明写错了文件（见下），或改名后忘了同步
//    ② 用到了却没声明  —— 契约漏写，模块地图会慢慢失真
const depWarnings = [];

for (const mod of modules) {
    if (mod.file === '00-header.js') continue;

    // 「依赖：*」= 声明使用全部模块的名字。只有 98-boot.js 的 window.__H1SUB__
    // 调试钩子用：它是一个刻意的测试接口，从每个模块重导出上百个名字，
    // 逐条列进模块头既无意义也没人维护。见 docs/API.md「内部 JS API」。
    if ((mod.deps || []).includes('*')) continue;

    const used = usedNames(mod.text);
    const declaredSet = new Set(mod.deps || []);

    for (const n of mod.deps || []) {
        if (!used.has(n)) {
            depWarnings.push(`${mod.file} 声明依赖 ${n}，但模块里没有用到它`
                + (providesAll.has(n) ? '（是不是声明写错了文件？）' : ''));
        }
    }

    // 只统计「别的模块提供、本模块使用」的名字；本模块自己定义的不算
    const missing = [];
    for (const n of used) {
        if (declaredSet.has(n)) continue;
        const provider = owner.get(n);
        if (!provider || provider === mod.file) continue;   // 没人提供 = 全局/浏览器 API
        missing.push(n + '(' + provider + ')');
    }
    if (missing.length) {
        depWarnings.push(`${mod.file} 用到但未声明：${missing.join('、')}`);
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

// 依赖声明与使用情况的对账结果（只警告）——放在最后，免得刷屏盖住主要结论
if (depWarnings.length) {
    console.log('\n⚠️  依赖声明对账（' + depWarnings.length + ' 条，不影响构建）：');
    for (const w of depWarnings) console.log('   · ' + w);
    console.log('   （模块头的「依赖」应与代码实际使用一致；见 docs/ARCHITECTURE.md 模块地图）');
}
