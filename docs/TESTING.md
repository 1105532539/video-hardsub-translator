# 测试与性能基准指南

> 本项目有 **523 项端到端测试**，零第三方依赖，用真实 Chrome 跑真实 DOM。
> 本文说明如何运行、如何编写新测试，以及如何测量性能变化。

---

## 目录

- [设计原则](#设计原则)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [测试套件一览](#测试套件一览)
- [测试架构](#测试架构)
- [测试页面与 fixture](#测试页面与-fixture)
- [编写新测试](#编写新测试)
- [性能基准](#性能基准)
- [A/B 对比基准](#ab-对比基准)
- [v1.11.0 实测结果](#v1110-实测结果)
- [复现优化验证](#复现优化验证)
- [常见问题](#常见问题)
- [CI 集成](#ci-集成)

---

## 设计原则

| 原则 | 做法 | 收益 |
| --- | --- | --- |
| **零依赖** | 只用 Node 内置模块；用内置 `WebSocket` 直接驱动 CDP | 不需要 `npm install`，无供应链风险，无版本腐化 |
| **真浏览器** | 启动真实 Chrome（headless），注入真实用户脚本 | 能测到 `getComputedStyle`、布局、全屏、画布像素、Trusted Types 等 jsdom 无法覆盖的东西 |
| **无需真 Key** | 用 `GM_xmlhttpRequest` **桩**拦截网络并断言请求体 | CI 中可跑，不花钱，不受限流影响 |
| **可复现** | 固定端口、固定 fixture、固定初始配置 | 结果稳定，前后可对比 |
| **路径无关** | 所有路径由 `_test/paths.mjs` 相对自身解析 | 克隆到任何目录都能跑 |

---

## 环境要求

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| **Node.js** | **≥ 22**（建议 **22.4+**） | 需要全局 `WebSocket`、`fetch` 与顶层 `await`。全局 `WebSocket` 自 Node 21 引入，Node 22.4 起转为稳定、不再需要 `--experimental-websocket`；本项目实测于 Node 24.14 |
| **Chrome / Chromium** | 近期版本 | 通过 CDP 驱动；测试使用 `--headless=new` |
| **npm 依赖** | 无 | — |

### 指定 Chrome 路径

默认按 Windows 常见安装位置查找：

```
C:\Program Files\Google\Chrome\Application\chrome.exe
```

其它情况请设置环境变量 `CHROME_PATH`（见 `_test/cdp.mjs`）：

```powershell
# Windows (PowerShell)
$env:CHROME_PATH = 'D:\Apps\Chrome\chrome.exe'
```

```bash
# macOS / Linux
export CHROME_PATH=/usr/bin/google-chrome
```

> 找不到浏览器时，测试会直接给出明确报错，而不是抛一个难懂的 `spawn ENOENT`。

---

## 快速开始

```bash
node _test/engine.mjs         # 引擎层
node _test/browser-ai.mjs     # 浏览器内置 AI（离线引擎）
node _test/web-translate.mjs  # 免费网页接口（逆向）
node _test/opt.mjs            # 专项测试
node _test/allsite.mjs        # 全站运行策略
node _test/smoke-panel.mjs    # 面板冒烟
node _test/layout.mjs         # 布局几何
node _test/fullscreen.mjs     # 全屏适配
```

也可以在项目根目录用 npm 脚本：

```bash
npm test              # 依次跑完全部 8 个套件
npm run test:engine   # 只跑引擎层
npm run bench         # 单版本性能基准
```

> ⚠️ **必须串行执行。** 每个套件都会启动自己的静态服务器与 Chrome 实例并绑定**固定端口**（87xx / 93xx），并行跑会互相抢端口。`npm test` 已经按顺序串联。

每个套件都会打印逐项结果与汇总：

```
── 8. 无异常 ──
  OK   页面无 JS 异常

======================================================
  总计 50 项  ·  通过 50  ·  失败 0
======================================================
```

**失败时退出码为 1**，可直接用于 CI 判定。

---

## 测试套件一览

| 套件 | 项数 | 覆盖重点 | 页面端口 / CDP 端口 |
| --- | --- | --- | --- |
| `build.mjs` | 27 | 构建守卫本身：顶层重名、依赖无人提供、虚报 provide、模块编号重复、非法文件名、版本号不一致、**语法门必须在写文件前生效**、`--check` 三种情形、缺模块头声明、扫描器抗注释/字符串绕过 | 无（不起 Chrome、不占端口） |
| `engine.mjs` | 50 | 请求体构造、思考模式参数、响应解析（三种 content 形态）、错误提示、模型能力判定、端到端识别链路 | 8780 / 9380 |
| `browser-ai.mjs` | 96 | 浏览器内置 AI 离线引擎：语言映射、内核版本门槛、能力探测、全离线链路（断言零网络请求）、会话复用、多模态读图、**画布快照时序（识别期间覆盖画布）**、流式拼接与节流、Edge 式坏语言对与经英语中转、准备阶段自检、面板联动 | 8781 / 9381 |
| `web-translate.mjs` | 44 | 免费网页接口（逆向）：语言码逐家映射、降级链（逐个挂掉看它换谁）、全挂时的错误聚合、必应 token 过期重取、限速、缓存、指定单一接口、测活、面板联动 | 8782 / 9382 |
| `opt.mjs` | 126 | 各轮优化专项：模型判定、LRU 缓存、区域锚点投影、缩略图独立数组、框选交互、`destroy()` 清理，以及本轮新增的**静帧不再重复付费识别（含反证）**、出错分类与指数退避、后台暂停、`stop()` 清 `busy` 与 `lastSentThumb`（停止→重开不再空白）、`resetFrameState`、`hexToRgb` 位宽一致性、配置校验 | 8790 / 9390 |
| `allsite.mjs` | 37 | 全站策略：无视频只留胶囊、iframe 不污染、本站禁用、按站点记忆区域、默认值不被污染 | 8770 / 9370 |
| `smoke-panel.mjs` | 79 | 面板挂载、元素引用完整性、平台预设、配置档案、导入导出、诊断、配置持久化（刷新后仍在） | 8760 / 9360 |
| `layout.mjs` | 33 | 面板在视口内、控件尺寸与边框、按钮无需滚动即可点到、设置项高度不失控 | 8764 / 9364 |
| `fullscreen.mjs` | 31 | 全屏时 UI 搬进全屏子树、`<video>` 全屏改用原生字幕轨、退出全屏搬回 body | 8822 / 9422 |

合计 **523 项**。

> `browser-ai.mjs` 给 `Translator` / `LanguageModel` 打了一套行为一致的替身（这两个全局对象实测可写可覆盖），
> 所以它**不会**真的下载端侧模型。替身刻意模仿了两个真实坑：流式分片既有累计式也有增量式、
> 模型没下载时 `create()` 会报「需要用户手势」。

---

## 测试架构

### 1. `_test/cdp.mjs` —— 零依赖 CDP 封装

不依赖 `puppeteer` / `playwright`，直接用 Node 内置 `WebSocket` 说 Chrome DevTools Protocol：

```js
const cdp = await Cdp.launch({ port: 9380 });      // 启动 headless Chrome
const { sessionId } = await cdp.newPage();          // 新建 target + attach
await cdp.addInitScript(PRELUDE, sessionId);        // 先注入 GM 桩
await cdp.addInitScript(USERSCRIPT, sessionId);     // 再注入被测脚本
await cdp.navigate(sessionId, url, { waitFor: '…' });
await cdp.evaluate(expr, { sessionId });
cdp.errorsFor(sessionId);                            // 收集页面异常
```

它会**收集页面抛出的异常**，因此每个套件最后都有一项「页面无 JS 异常」断言——这是发现"改动引入隐蔽报错"的关键防线。

> ⚠️ 注意：`cdp.mjs` 同时也在累积 `consoleErrors`，但**目前没有任何套件读取它**
> （`errorsFor()` 只过滤 `pageErrors`）。所以脚本里的 `console.error` **不会**让测试失败。

`startServer()` 提供一个带 **Range 请求支持**的静态服务器（视频元素播放需要它），并默认开启 CORS。

### 2. GM API 桩（`PRELUDE`）

被测脚本依赖油猴 API，因此测试先注入一份桩实现：

```js
window.GM_getValue = function (k, d) { return (k in store) ? store[k] : d; };
window.GM_setValue = function (k, v) { store[k] = v; };
window.GM_registerMenuCommand = function () {};
window.GM_xmlhttpRequest = function (opts) { /* 记录请求 + 按 URL 回放预设响应 */ };
```

`GM_xmlhttpRequest` 桩会：

- 把每次请求的 `url` / `method` / `headers` / 解析后的 `body` 记进 `window.__gmReqs`，供断言检查；
- 按 URL 自动回放响应：`/api/ocr/*` 返回模拟的 Umi-OCR 结果，其余走 `window.__gmResponse`（或 `__gmResponseQueue` 队列）。

> **为什么桩必须按 URL 匹配**：直接覆盖 `window.__H1SUB__.callUmiOCR` 是没用的——`recognizeByUmi` 引用的是闭包里的那个函数，而不是全局对象上的属性。只有从网络层拦截，才能让测试走完真实的 `callUmiOCR` 代码路径。

### 3. 注入顺序

```
addInitScript(PRELUDE)     ← 必须在页面加载前定义 GM_*，否则脚本挂载时就报错
addInitScript(USERSCRIPT)  ← 被测脚本
navigate(url, { waitFor: 'window.__H1SUB__ && window.__lab && window.__lab.ready' })
```

`waitFor` 同时等待脚本挂载与测试页面就绪，避免竞态。

### 4. 断言与退出码

每个套件自带极简断言器：

```js
function check(name, pass, detail) {
    R.push({ suite, name, pass: !!pass });
    console.log(`  ${pass ? 'OK  ' : 'BAD '} ${name}${pass || !detail ? '' : '  <- ' + detail}`);
    return !!pass;
}
```

失败项会在末尾统一重列，并设置 `process.exitCode = 1`。

> **踩坑记录**：测试主流程崩溃时也必须往 `R` 里压一条失败记录，否则会出现「失败 0」和退出码 1 同时出现、看起来"全过了"的自相矛盾输出。

### 5. 为什么不用 jsdom

本项目的多数风险点恰好是 jsdom **测不了**的：

| 风险点 | 为什么必须真浏览器 |
| --- | --- |
| 面板是否被挤出视口 | 需要真实布局引擎计算 `getBoundingClientRect` |
| 宿主页面 `button` 样式重置后是否仍可见 | 需要真实层叠样式解析 |
| 全屏时 UI 是否真的被隐藏 | 需要真实 `fullscreenchange` 与全屏子树渲染 |
| 跨域画布污染 | 需要真实 `getImageData` 的 SecurityError |
| 视频像素与 `object-fit` 几何 | 需要真实视频解码与画面区推算 |
| Trusted Types | 需要真实 CSP 策略环境 |

---

## 测试页面与 fixture

`_test/pages/` 下的页面由静态服务器提供：

| 页面 | 用途 |
| --- | --- |
| `lab.html?mode=canvas` | **主力测试页**：`pattern.js` 在 canvas 上绘制已知图案，再喂给 `<video>`；几何完全已知，便于断言区域换算 |
| `empty.html` | 没有视频的普通页面（验证"只留小胶囊"） |
| `iframe-host.html` | 宿主页 + iframe（验证 iframe 内挂载与不重复挂载） |
| `tt.html` | Trusted Types 场景 |
| `gen.html` | fixture 生成辅助页 |

`fixtures/pattern.webm` 是自动生成的测试视频，图案位置与 `pattern.js` 中的常量一一对应（`BAND_Y` / `BAND_H` / `cellRect()` 等），因此测试可以断言"框选区域在视频像素坐标系下的位置"是否正确。

`vendor/hls.min.js` 供 HLS 模式测试页使用；`smoke-panel.mjs` 启动时会把它与 `pattern.webm` 复制到 `pages/` 下（这两个复制产物已被 `.gitignore` 忽略）。

---

## 编写新测试

在 `_test/` 下新建 `.mjs`，套用下面的骨架即可（路径全部走 `paths.mjs`，不要写绝对路径）：

```js
import { Cdp, startServer } from './cdp.mjs';
import { PAGES, readUserscript } from './paths.mjs';

const USERSCRIPT = readUserscript();
const PORT = 8795, CDP_PORT = 9395;

const PRELUDE = `
(function () {
    const store = window.__gmStore = {};
    window.__gmReqs = [];
    window.GM_getValue = function (k, d) { return (k in store) ? store[k] : d; };
    window.GM_setValue = function (k, v) { store[k] = v; };
    window.GM_registerMenuCommand = function () {};
    window.GM_xmlhttpRequest = function () {};
})();
`;

const R = [];
let suite = '';
const S = (n) => { suite = n; console.log('\n── ' + n + ' ──'); };
function check(name, pass, detail) {
    R.push({ suite, name, pass: !!pass });
    console.log(`  ${pass ? 'OK  ' : 'BAD '} ${name}${pass || !detail ? '' : '  <- ' + detail}`);
    return !!pass;
}

const srv = await startServer({ port: PORT, root: PAGES, cors: true });
const cdp = await Cdp.launch({ port: CDP_PORT });

try {
    const { sessionId } = await cdp.newPage();
    await cdp.addInitScript(PRELUDE, sessionId);
    await cdp.addInitScript(USERSCRIPT, sessionId);
    await cdp.navigate(sessionId, `http://127.0.0.1:${PORT}/lab.html?mode=canvas`,
        { waitFor: 'window.__H1SUB__ && window.__lab && window.__lab.ready', timeoutMs: 25000 });

    const ev = (e, o = {}) => cdp.evaluate(e, { sessionId, ...o });

    S('1. 我的第一条断言');
    check('脚本已挂载', await ev('!!window.__H1SUB__'));

    S('2. 无异常');
    const errs = cdp.errorsFor(sessionId);
    check('页面无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' || '));
} catch (e) {
    console.log('\nFAIL 崩溃: ' + e.message);
    console.log(cdp.pageErrors.slice(0, 5).map(x => '   ' + String(x.text).slice(0, 300)).join('\n'));
    R.push({ suite: '崩溃', name: '测试执行中断: ' + e.message, pass: false });
    process.exitCode = 1;
} finally {
    cdp.close();
    await srv.close();
}

const pass = R.filter(x => x.pass).length;
const fail = R.length - pass;
console.log(`\n  总计 ${R.length} 项  ·  通过 ${pass}  ·  失败 ${fail}`);
if (fail) R.filter(x => !x.pass).forEach(x => console.log('  BAD [' + x.suite + '] ' + x.name));
if (fail) process.exitCode = 1;
```

### 编写原则

1. **每个套件用不同端口**（避免与既有套件冲突），并在 `paths.mjs` 之外不引入任何硬编码路径。
2. **必须包含「页面无 JS 异常」断言**，否则会漏掉"改动引入了报错但断言恰好没覆盖"的情况。
3. **修 bug 的测试要能证明"关掉修复就会红"**——否则测试可能只是在空转。例如验证 LRU 缓存时，应断言「超过容量后仍然命中热键」，而不是仅仅断言"能存能取"。
4. **不要依赖真实网络与真实 API Key**，一律用 `GM_xmlhttpRequest` 桩。
5. **避免依赖精确耗时**，时间相关断言给出宽松裕度。

---

## 性能基准

### `bench.mjs` —— 单版本热路径基准

```bash
node _test/bench.mjs "标注名" --script=<脚本路径> --port=8796 --out=<输出 json>
```

它测量：

| 指标 | 说明 |
| --- | --- |
| `启动到面板可用` | 从导航到 `window.__H1SUB__` 就绪的耗时（ms） |
| `textSimilarity·相同串` / `·不同串` | 相似度计算（分快路径与完整 DP 两条路径） |
| `escapeHtml` | HTML 转义 |
| `thumbnail` / `edgeDensity` | 缩略图与边缘密度 |
| `Capturer.grab` | **每帧截图**（最关键的指标） |
| `canvas.toDataURL(jpeg/png)` | 图像编码 |
| `Pipeline.step·空转` | 主循环空转开销 |
| `Overlay.show+定位` | 字幕层渲染与定位 |
| `UI.mount` | 面板挂载 |
| `300 轮热路径堆增长` | 连续跑 300 轮后的堆增量（检查是否泄漏） |

### 两个测量细节

**1. 迭代次数按"总耗时至少跨过 100ms"来定。**

Chrome 出于 Spectre 缓解会把 `performance.now()` 量化到约 100µs。如果某个函数只跑几毫秒，总共才几十个时钟刻度，量出来的差异基本是噪声。因此 `bench.mjs` 为每个指标配置了足够的迭代次数（`Capturer.grab` 600 次、`edgeDensity` 10000 次、相似度 60000 次等）。

**2. 先预热再计时。**

每次测量前先跑 `min(200, iters)` 次，避开 JIT 冷启动带来的偏差。

**3. 接口缺失时跳过而不是崩溃。**

钩子是后来才加的，旧版本可能没有某个接口。基准会把它标为 `skipped`，从而允许对新旧两版做对比。

---

## A/B 对比基准

```bash
node _test/bench-ab.mjs <旧版脚本> <新版脚本> [轮数=3]
```

输出示例：

```
==============================================================================
  A/B 基准（各 3 轮，取中位数）
==============================================================================
  项目                                  旧版          新版            变化
  --------------------------------------------------------------------------
  Capturer.grab                0.8480 ms   0.4577 ms   -46.0%  ↓ 快
  ...
```

### 为什么这样设计

| 设计 | 原因 |
| --- | --- |
| **多轮取中位数**（默认 3 轮） | 单次测量极易被机器负载带偏；中位数比均值更抗离群值 |
| **每轮调换先后顺序**（奇数轮旧先、偶数轮新先） | 如果固定"旧版先跑"，机器状态在一轮内的漂移会被系统性地算到新版头上 |
| **交替跑而非"先跑完旧版再跑完新版"** | 让两版经历尽可能相同的环境条件 |
| **各用不同端口**（`8800 + 轮次*2 + tag`） | 避免端口占用与实例串扰 |

结果同时写入 `_test/_ab-summary.json`（机器可读，便于前后对比）与终端表格（含各轮原始值，便于判断离散程度）。

---

## v1.11.0 实测结果

优化轮次的前后对比（各 3 轮取中位数）：

| 指标 | 旧版 (1.10.0) | 新版 (1.11.0) | 变化 |
| --- | --- | --- | --- |
| `Capturer.grab` | 0.8480 ms | 0.4577 ms | **↓ 46.0%** |
| `canvas.toDataURL(png)` | 0.4440 ms | 0.4210 ms | ↓ 5.2% |
| `Overlay.show+定位` | 0.0607 ms | 0.0585 ms | ↓ 3.5% |
| `edgeDensity` | 0.0914 ms | 0.0885 ms | ↓ 3.2% |
| `textSimilarity·不同串` | 0.0015 ms | 0.0015 ms | ↓ 1.9% |
| `textSimilarity·相同串` | 0.0001 ms | 0.0001 ms | 持平 |
| `thumbnail` | 0.0142 ms | 0.0143 ms | 持平（噪声内） |
| `canvas.toDataURL(jpeg)` | 0.6958 ms | 0.7083 ms | 持平（噪声内） |
| `Pipeline.step·空转` | 0.0542 ms | 0.0563 ms | 持平（噪声内） |
| `UI.mount` | 0.700 ms | 0.700 ms | 持平 |
| 300 轮热路径堆增长 | 0 KB | 0 KB | 持平 |

同时 **523 项功能测试全部通过**，证明优化未改变行为。

---

## 复现优化验证

```bash
# 1. 准备新旧两版脚本（旧版可从 git 历史取出）
git show v1.10.0:video-hardsub-translator.user.js > old.user.js

# 2. 各 3 轮交替对比
node _test/bench-ab.mjs old.user.js video-hardsub-translator.user.js 3

# 3. 功能回归
npm test
```

---

## 常见问题

<details>
<summary><b>报错「Chrome 调试端口未就绪」/ 测试启动很慢</b></summary>

- 确认已安装 Chrome 且路径正确（必要时设置 `CHROME_PATH`）
- 首次启动可能被杀软/EDR 拦截，观察是否有进程被终止
- 上次异常退出可能残留 Chrome 进程占用调试端口，任务管理器里结束残留的 `chrome.exe`
- 端口被占用时，换一个端口（每个套件顶部都有 `PORT` / `CDP_PORT` 常量）

</details>

<details>
<summary><b>测试结果不稳定 / 时好时坏</b></summary>

1. 确认是**串行**执行的——并行跑多个套件会互相抢端口与 CPU
2. 长时间跑基准时关闭占用 CPU 的后台任务（基准对比尤其敏感）
3. 只有 `layout.mjs` 依赖窗口尺寸（使用了 `--window-size=1500,1000`）；如果你改过系统缩放，可能需要同步调整
4. 时间相关断言本身带有裕度，偶发失败先重跑一次确认

</details>

<details>
<summary><b>想单独看某个页面的面板长什么样</b></summary>

```bash
node _test/shots.mjs      # 生成 _test/shots/{1-panel,2-diag,3-wide}.png
```

也可以启动静态服务器后自己用浏览器打开 `_test/pages/lab.html?mode=canvas`（记得先注入 GM 桩，或直接用浏览器扩展加载脚本）。

</details>

<details>
<summary><b>测试会不会消耗我的 API 额度？</b></summary>

不会。所有网络请求都被 `GM_xmlhttpRequest` 桩拦截，测试**不需要也不使用**真实 API Key。

</details>

---

## CI 集成

所有套件通过退出码表示结果（全通过为 0），因此可直接接入 CI。

仓库已提供 `.github/workflows/ci.yml`，分两个 job：

| job | 内容 | 说明 |
| --- | --- | --- |
| `build` | `build.mjs --check` + `node --check` | **只依赖 Node，零 flake**，任何改动都会跑 |
| `test` | `npm test`（9 个套件） | 跑在 `windows-latest`，与本项目开发环境对齐 |

> **为什么 `build` 必须单独成一个 job**：`package.json` 的 `pretest` 会先执行
> `npm run build`，**重新生成产物**。所以「改了 `src/` 却忘了构建」这种漂移
> **永远不会让 `npm test` 失败** —— 只有单独的 `build:check` 能发现它。
> 本地提交前请**两个都跑**（见 `CONTRIBUTING.md`「提交前必须通过」）。

注意要点：

- **必须串行**执行各套件（端口冲突），不要用矩阵并行拆成多个 job 跑同一台机器
- headless Chrome 需要 `--no-sandbox`（`cdp.mjs` 已默认加上）
- `windows-latest` runner 已预装 Chrome，且路径与 `cdp.mjs:12-13` 的默认值一致；
  用其它系统或非默认安装路径时，通过 `CHROME_PATH` 环境变量指定
- 此前各套件**仅在 Windows 上验证过**，所以 CI 先用 `windows-latest`；
  待 Linux 验证通过后可以再换成 `ubuntu-latest` 以降低成本

---

## 相关文档

- [架构与模块职责](ARCHITECTURE.md)
- [接口文档](API.md)
- [贡献指南](../CONTRIBUTING.md)
