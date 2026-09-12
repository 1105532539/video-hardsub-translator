// 新旧两版交替跑基准，各 3 轮取中位数 —— 单次测量很容易被机器负载带偏。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TEST_DIR } from './paths.mjs';

const OLD = process.argv[2];
const NEW = process.argv[3];
const ROUNDS = Number(process.argv[4] || 3);

if (!OLD || !NEW) {
    console.log('用法: node bench-ab.mjs <旧脚本> <新脚本> [轮数]');
    process.exit(1);
}

const runs = { old: [], new: [] };
const SCRATCH = path.join(TEST_DIR, '_ab.json');

function runOnce(script, tag, round) {
    execFileSync(process.execPath, [
        path.join(TEST_DIR, 'bench.mjs'), `${tag} 第${round}轮`,
        `--script=${script}`,
        `--port=${8800 + round * 2 + (tag === 'new' ? 1 : 0)}`,
        `--out=${SCRATCH}`,
    ], { stdio: 'ignore', cwd: ROOT });
    return JSON.parse(fs.readFileSync(SCRATCH, 'utf8')).results;
}

// 交替跑，而且每轮**调换先后顺序** —— 如果固定"旧版先跑"，机器状态
// 在一轮内的漂移就会系统性地算到新版头上。奇数轮旧先、偶数轮新先。
for (let r = 1; r <= ROUNDS; r++) {
    const oldFirst = (r % 2 === 1);
    process.stdout.write(`第 ${r} 轮（${oldFirst ? '旧先' : '新先'}）… `);
    if (oldFirst) {
        runs.old.push(runOnce(OLD, 'old', r));
        process.stdout.write('旧版完成 … ');
        runs.new.push(runOnce(NEW, 'new', r));
    } else {
        runs.new.push(runOnce(NEW, 'new', r));
        process.stdout.write('新版完成 … ');
        runs.old.push(runOnce(OLD, 'old', r));
    }
    console.log('这一轮结束');
}

const median = (xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const metrics = Object.keys(runs.old[0]).filter(k => {
    const v = runs.old[0][k];
    return v && typeof v === 'object' && typeof v.per === 'number';
});

console.log('\n' + '='.repeat(78));
console.log(`  A/B 基准（各 ${ROUNDS} 轮，取中位数）`);
console.log('='.repeat(78));
console.log('  ' + '项目'.padEnd(26) + '旧版'.padStart(12) + '新版'.padStart(12) + '变化'.padStart(14));
console.log('  ' + '-'.repeat(74));

const summary = {};
for (const m of metrics) {
    const o = median(runs.old.map(r => r[m].per));
    const n = median(runs.new.map(r => r[m].per));
    const pct = o === 0 ? 0 : ((n - o) / o) * 100;
    summary[m] = { old: o, new: n, pct };
    const arrow = Math.abs(pct) < 5 ? '  ~' : (pct < 0 ? '  ↓ 快' : '  ↑ 慢');
    console.log('  ' + m.padEnd(26)
        + (o.toFixed(4) + ' ms').padStart(12)
        + (n.toFixed(4) + ' ms').padStart(12)
        + (pct.toFixed(1) + '%' + arrow).padStart(14));
}
console.log('='.repeat(78));

// 单轮原始值，便于判断离散程度
console.log('\n各轮原始值（ms）：');
for (const m of metrics) {
    console.log('  ' + m.padEnd(26)
        + '旧 [' + runs.old.map(r => r[m].per.toFixed(4)).join(', ') + ']'
        + '  新 [' + runs.new.map(r => r[m].per.toFixed(4)).join(', ') + ']');
}

fs.writeFileSync(path.join(TEST_DIR, '_ab-summary.json'),
    JSON.stringify(summary, null, 2), 'utf8');
