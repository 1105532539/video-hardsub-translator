// 从 CHANGELOG.md 里抽出某个版本的正文，供 GitHub Release 的「更新说明」使用。
//
// 为什么要单独有个脚本：Release 的说明应当**直接来自 CHANGELOG**，而不是在 GitHub 网页上
// 另写一份 —— 两份说明迟早会不一致（这个项目管它叫「口径漂移」，见 docs/OPTIMIZATION-PLAN.md
// 的 P3-9）。有了它，发版流程收敛成三步：
//
//     ① 在 CHANGELOG.md 写下 `## [x.y.z] - 日期` 与正文
//     ② 递增 package.json / @version / SCRIPT_VERSION（三处一致，构建脚本会校验）
//     ③ git tag -a vX.Y.Z && git push origin vX.Y.Z
//
// 剩下的交给 `.github/workflows/release.yml`：它调本脚本取说明，再建 Release 并把
// `video-hardsub-translator.user.js` 作为附件传上去。本机不需要任何 token。
//
// 用法：node _build/release-notes.mjs v1.14.0     （v 前缀可有可无）
// 输出：该版本的正文写到 stdout（供 `gh release create --notes-file` 用）
// 退出码：0 成功；1 = 参数/版本号对不上或 CHANGELOG 里找不到这一节
//         （宁可让发版失败，也不要发一个空的更新说明）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function fail(msg) {
    console.error('✗ ' + msg);
    process.exit(1);
}

const arg = String(process.argv[2] || '').trim();
if (!arg) fail('用法：node _build/release-notes.mjs v1.14.0');

const ver = arg.replace(/^v/i, '');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(ver)) {
    fail(`「${arg}」不像一个版本号（期望 v1.2.3 这种形式）`);
}

// 版本号必须和仓库里的三处口径一致，否则说明 tag 打在了一个版本号还没递增的提交上 ——
// 这种 Release 发出去就是错的，早点拦住。
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (pkg.version !== ver) {
    fail(`tag 是 ${arg}，但 package.json 里的版本是 ${pkg.version}`
        + ' —— 先把版本号（package.json / @version / SCRIPT_VERSION）递增到同一个值再打 tag');
}

const md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const lines = md.split('\n');

// 版本号里的点在正则里要转义
const esc = ver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const start = lines.findIndex((l) => new RegExp('^## \\[' + esc + '\\]').test(l));
if (start < 0) {
    fail(`CHANGELOG.md 里没有 [${ver}] 这一节 —— 别忘了写更新说明；`
        + `已经写了的话，标题要写成 "## [${ver}] - YYYY-MM-DD"`);
}

// 到下一个 `## [` 为止（文件末尾则到结尾）
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
    if (/^## \[/.test(lines[i])) { end = i; break; }
}
const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) fail(`CHANGELOG.md 里 [${ver}] 那一节是空的`);

process.stdout.write(body + '\n');
