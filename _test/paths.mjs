// 路径解析中心：所有测试都从这里取路径，不要在测试里写死绝对路径。
//
// 原因：仓库克隆到任何目录都应该能跑测试。以前各测试文件里硬编码了
// 作者本机的绝对路径，换台机器或换个目录就全挂。这里改成以「本文件自身
// 所在位置」为基准来推导，跟当前工作目录（process.cwd()）无关，
// 所以从 C:\ 或任何地方 `node D:\...\_test\engine.mjs` 都能正常跑。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 本文件位于 <ROOT>/_test/ 下，所以 TEST_DIR 就是它自己的目录
export const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(TEST_DIR);

export const PAGES = path.join(TEST_DIR, 'pages');
export const FIXTURES = path.join(TEST_DIR, 'fixtures');
export const VENDOR = path.join(TEST_DIR, 'vendor');
export const SHOTS = path.join(TEST_DIR, 'shots');

export const USERSCRIPT_PATH = path.join(ROOT, 'video-hardsub-translator.user.js');

// 被测脚本源码，多个测试都要读，统一放这里
export function readUserscript() {
    return fs.readFileSync(USERSCRIPT_PATH, 'utf8');
}
