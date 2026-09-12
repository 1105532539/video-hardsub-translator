// 精确统计方法行数：按大括号配平找边界，比正则可靠
import { readUserscript } from './paths.mjs';

const lines = readUserscript().split('\n');

// 找出 `        name(args) {` 这种 8 空格缩进的方法定义（UI / Pipeline / Diag 等对象内）
const results = [];
for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {8}(?:async )?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/);
    if (!m) continue;

    // 从这一行开始配平大括号，跳过字符串/注释里的括号（够用了：这些代码里没有怪写法）
    let depth = 0, end = i, ok = false;
    for (let j = i; j < lines.length; j++) {
        const l = lines[j].replace(/\/\/.*$/, '');        // 去行尾注释
        for (const ch of l) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        if (depth === 0) { end = j; ok = true; break; }
    }
    if (ok) results.push({ name: m[1], start: i + 1, end: end + 1, lines: end - i + 1 });
}

console.log('=== 方法行数排行（前 20）===');
results.sort((a, b) => b.lines - a.lines).slice(0, 20).forEach(r =>
    console.log(`  ${String(r.lines).padStart(4)} 行  ${r.name.padEnd(24)} 第 ${r.start}-${r.end} 行`));

const total = results.reduce((s, r) => s + r.lines, 0);
console.log(`\n共 ${results.length} 个方法，合计 ${total} 行`);
console.log(`其中超过 100 行的：${results.filter(r => r.lines > 100).length} 个`);
console.log(`超过 40 行的：${results.filter(r => r.lines > 40).length} 个`);
