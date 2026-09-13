# 架构与模块职责

> 本文面向想读懂、修改或扩展本脚本的开发者。所有结论均以
> `src/` 下的模块源码（v1.12.0）为准；根目录的
> `video-hardsub-translator.user.js` 是由它们拼接出来的产物。

---

## 目录

- [总体设计](#总体设计)
- [源码结构与构建](#源码结构与构建)
- [模块地图](#模块地图)
- [数据流](#数据流)
- [截图器 Capturer](#截图器-capturer)
- [主循环 Pipeline](#主循环-pipeline)
- [引擎层](#引擎层)
- [UI 层](#ui-层)
- [全屏策略 Fullscreen](#全屏策略-fullscreen)
- [区域框选器 RegionSelector](#区域框选器-regionselector)
- [诊断模块 Diag](#诊断模块-diag)
- [性能特征与优化](#性能特征与优化)
- [内存与生命周期](#内存与生命周期)
- [安全考量](#安全考量)
- [扩展指南：新增一个引擎](#扩展指南新增一个引擎)

---

## 总体设计

源码按功能组件拆成 `src/` 下的多个模块，构建时**原样拼接**成根目录的单个用户脚本。
产物仍然是一个 `IIFE`（立即执行函数），运行在页面主世界（page context），
没有第三方运行时依赖，装进 Tampermonkey 依然只是一个文件。

```js
(function () {
    'use strict';
    if (window.__H1SUB_LOADED__) return;   // 同一文档只初始化一次
    window.__H1SUB_LOADED__ = true;
    // … src/ 下的模块按编号顺序原样拼在这里 …
})();
```

### 三条设计主线

1. **一个主循环 + 若干无状态工具函数。** 只有 `Pipeline` 持有跨帧状态；截图、几何、图像分析、HTTP 都是纯函数或单一职责对象，便于单独测试。
2. **所有异步结果都要能作废。** 用户随时可能点停止、重选区域或跳页，因此引入**代（generation）**机制（见 [主循环](#主循环-pipeline)）。
3. **失败要说人话。** 每个可能的失败点（跨域污染、暂停、找不到视频、API 报错、Umi-OCR 没启动）都映射到状态栏上一条可操作的提示，而不是静默失败。

### 挂载策略

`@match *://*/*` 意味着脚本会在**每个**站点加载，因此挂载条件被设计得很克制：

| 页面情况 | 行为 |
| --- | --- |
| 有 ≥200×120 的视频 | 直接展开完整面板 |
| 暂时没有视频 | 只在右下角留一个**小胶囊**，点击才展开 |
| 视频后来才出现（SPA / 懒加载） | `watchForVideo()` 检测到后自动展开 |
| 处于 iframe 且其中没有视频 | **完全不挂载**（广告/统计框架不受影响） |
| iframe 中有视频 | 面板挂在该 iframe 内，不会出现两层 |
| 站点在 `disabledHosts` 中 | 彻底不介入 |

判定入口是 `boot()` → `isConfigured()` / `isHostDisabled()` / `isTopFrame()` / `findVideo()`。

---

## 源码结构与构建

### 目录

```
src/
├── 00-header.js          用户脚本元数据块（==UserScript==）与总说明（纯注释）
├── 10-config.js          配置：默认值、读写、规整、平台预设、模型能力判定
├── 12-log.js             日志
├── 14-constants.js       热路径常量与状态栏配色
├── 20-video.js           视频元素定位
├── 22-site.js            站点级行为：禁用开关、视频出现监听、按站点记忆区域
├── 24-region.js          区域锚定与坐标换算
├── 30-image.js           截图分析与文本相似度（热路径）
├── 32-util.js            通用小工具（JSON 容错解析、data URL、休眠…）
├── 40-http.js            GM_xmlhttpRequest 封装
├── 42-youdao-sign.js     SHA-256、UUID 与有道错误码
├── 44-umi-ocr.js         Umi-OCR 本机识别
├── 46-youdao-image.js    有道图片翻译
├── 48-browser-ai.js      浏览器内置 AI：完全离线的识别 / 翻译
├── 49-web-translate.js   免费网页接口：逆向的内部接口翻译
├── 50-capturer.js        截图器（element / display 双后端）
├── 60-chat.js            OpenAI 兼容接口与翻译缓存
├── 62-engines.js         五种引擎的统一入口
├── 70-pipeline.js        主循环
├── 80-overlay.js         悬浮字幕层
├── 82-fullscreen.js      全屏适配
├── 84-html.js            HTML 转义、Trusted Types、颜色
├── 86-selector.js        区域框选器
├── 88-diag.js            诊断模式
├── 90-panel-html.js      控制面板：HTML 骨架
├── 92-panel-css.js       控制面板：样式表
├── 94-modal.js           通用弹窗骨架
├── 96-panel-ui.js        控制面板：控件绑定、配置档案、导入导出
└── 98-boot.js            启动装配
```

**文件名前缀的两位数字就是拼接顺序**，后文可以依赖前文。

### 构建

```bash
npm run build          # 生成 video-hardsub-translator.user.js
npm run build:check    # 只校验产物是否与 src/ 一致（提交前 / CI）
npm run lint           # 构建 + 语法检查
```

`_build/build.mjs` 是**零依赖**的纯 Node 脚本（只用 `node:fs` / `node:path` /
`node:vm`），仓库不需要 `npm install`。它做四件事：

1. 按编号顺序读入 `src/*.js`，拼进同一个 IIFE；
2. **核对模块头声明**：每个模块必须在头部写清「对外提供」与「依赖」，
   脚本会检查"声称提供的名字是否真的定义了""依赖的名字是否真有人提供""有没有两个
   模块定义了同名顶层绑定""版本号三处是否一致"；
3. 用 `vm.Script` 解析一遍产物（只解析不执行），语法错误挡在写文件之前；
4. 写入根目录产物，保证 LF 行尾、无 BOM。

### 三条硬性规则

| 规则 | 原因 |
| --- | --- |
| **不要手改根目录的 `.user.js`** | 它是产物，下次构建就覆盖。改 `src/`，再 `npm run build` |
| **顶层名字全局唯一** | 所有模块共享同一个 IIFE 作用域，重名会互相覆盖 —— 构建脚本会拦下来 |
| **模块头必须写「对外提供 / 依赖」** | 这是共享作用域下唯一能表达接口的地方，也由构建脚本核对 |

拼接是**纯文本搬运**，不做任何重命名、转译或作用域包装，所以"源码即产物"这条
可审计性依然成立：把 `src/` 的模块按顺序连起来（去掉模块头注释）就是产物本身。

### 为什么不做成 `import` / `export`

用户脚本没有模块加载器，`@require` 又需要外部托管、破坏"点一下就能装"。而本项目里
`UI` / `Pipeline` / `Capturer` / `Overlay` / `Fullscreen` / `Diag` / `RegionSelector`
这七个单例之间是**双向引用**的（例如 `Fullscreen.sync()` 要摆布 `UI.root` 和
`Overlay.el`，而 `Overlay.show()` 又要回调 `Fullscreen`）。原实现靠的就是同一个词法
作用域 + 函数声明提升 + 调用时才求值；改成 `import` 会让这些回边变成模块初始化期
的循环依赖，收益不抵风险。所以模块化的边界落在**文件与声明**上：

- 每个模块头写明它对外提供什么、依赖谁；
- 构建脚本把这些声明当成契约来校验；
- 跨模块调用一律在函数体内发生（不在顶层初始化时用别人的东西），
  这条规则保证拼接顺序只需要满足"声明在前"即可。

### 已知边界

`96-panel-ui.js` 仍然有 1100 多行 —— 因为 `UI` 是一个巨大的对象字面量，
拆它需要用 `Object.assign(UI, {...})` 把字面量切开，属于会改变代码结构的改动。
当前版本优先选择"零行为变化"，所以先保持整块；后续若要继续拆，可按
"面板骨架 / 控件绑定 / 配置档案 / 状态显示"四条线用 `Object.assign` 拆分。

---

## 模块地图

| 模块 | 主要成员 | 职责 |
| --- | --- | --- |
| `10-config` | `DEFAULTS` `CFG` `loadCfg` `sanitizeCfg` `saveCfg` `saveCfgKeys` `API_PRESETS` `isNoVisionModel` | 默认值、校验、持久化、平台预设、模型能力判定 |
| `12-log` | `log` `warn` | 统一 `[字幕翻译]` 前缀 |
| `14-constants` | `THUMB_W/H` `EDGE_*` `NO_CHANGE_DIFF` `STATUS_COLORS` | 热路径阈值与配色 |
| `20-video` | `findVideo` | 找到页面上"最大"的 `<video>`（主播放器） |
| `22-site` | `isHostDisabled` `banCurrentHost` `isTopFrame` `watchForVideo` `syncRegionForHost` `rememberRegion` | 按站点决定是否介入、视频后加载监听、按站点记忆区域 |
| `24-region` | `getContentBox` `resolveRegion` `anchorRegion` | 画面内容框推算与区域锚定换算 |
| `30-image` | `thumbnail` `thumbDiff` `edgeDensity` `textSimilarity` | 三个"要不要花钱调 API"的判定 |
| `32-util` | `parseModelJson` `sleep` `canvasToJpeg` `stripDataUrlPrefix` `stripWrappingQuotes` | 纯计算小工具 |
| `40-http` | `gmRequest` | `GM_xmlhttpRequest` Promise 封装（绕 CORS） |
| `42-youdao-sign` | `sha256Hex` `sha256HexJS` `youdaoTruncate` `uuidHex` `YOUDAO_ERR` | 有道签名素材与错误码翻译 |
| `44-umi-ocr` | `UMI_LANGS` `callUmiOCR` `umiProbe` `recognizeByUmi` `umiBase` | 本机 Umi-OCR 识别（零下载） |
| `46-youdao-image` | `callYoudaoImage` | 有道图片翻译（OCR + 翻译一步） |
| `48-browser-ai` | `baiProbe` `baiPrepare` `baiTranslate` `baiOcrByBuiltin` `recognizeByBrowserAI` | 浏览器内置 AI：完全离线的识别 / 翻译 |
| `49-web-translate` | `wtTranslate` `wtSelftest` `wtLangPair` `wtStats` `recognizeByWebTranslate` | 免费网页接口（逆向）：降级链、限速、token 重取 |
| `50-capturer` | `Capturer` | 双后端截图、裁切缩放、污染处理 |
| `60-chat` | `cacheGet` `cachePut` `apiUrl` `buildChatBody` `extractContent` `callChatCore` `callChat` | LRU 缓存、请求构造、响应解析、HTTP 错误翻译 |
| `62-engines` | `translateByVision` `translateText` `recognizeAndTranslate` | 五种引擎的统一入口 |
| `70-pipeline` | `Pipeline` | 定时、守卫、跳过判定、结果展示、错误恢复 |
| `80-overlay` | `Overlay` | 字幕渲染、定位 |
| `82-fullscreen` | `Fullscreen` `uiHost` | 全屏时搬移 UI、`<video>` 全屏时改走原生字幕轨 |
| `84-html` | `escapeHtml` `setHTML` `TT_POLICY` `hexToRgb` | Trusted Types 兼容层与样式小工具 |
| `86-selector` | `RegionSelector` | 拖拽框选、实时预览、锚点记录 |
| `88-diag` | `Diag` `SCRIPT_VERSION` | 记录、报告生成、区域对齐可视化 |
| `90-panel-html` | `panelHTML` | 面板 DOM 骨架（只放结构，不放行为） |
| `92-panel-css` | `panelCSS` | 面板与弹窗样式 |
| `94-modal` | `openModal` | 诊断 / 导入导出共用的弹窗骨架 |
| `96-panel-ui` | `UI` | 面板构建、控件绑定、档案、导入导出、状态显示 |
| `98-boot` | `isConfigured` `boot` `mountUI` | 挂载决策、测试钩子、油猴菜单、SPA 路由轮询 |


---

## 数据流

### 一次完整循环

```
tick()                          ← setTimeout 驱动，间隔 CFG.interval（≥300ms）
 └─ step()
     ├─ findVideo()                   找到页面上面积最大的合格 <video>
     ├─ ensureReady(video)            视频存在？已框选？未暂停？上一轮已返回？
     ├─ grabFrame(video)              Capturer.grab → canvas（失败/污染则走岔路）
     ├─ stats.shots++
     ├─ shouldSkipFrame(canvas)       变化检测 + 边缘密度，通过则返回
     ├─ recognize(canvas, myGen)      调引擎；返回前校验代是否仍然有效
     └─ present(res)                  四分支决定：清空 / 保持 / 保持 / 显示
```

### 为什么把 `step()` 拆成这么多小方法

这一整套流程原本挤在一个约 160 行的方法里，想给任何一处守卫加日志都得先通读全文。现在 `step()` 只剩 6 行主体，每个分支的进入条件与返回值语义都能从方法名读出来：

| 方法 | 返回 `false` / `null` 的含义 |
| --- | --- |
| `ensureReady` | 这一轮不该跑（没视频 / 没框选 / 暂停 / 上一轮未返回） |
| `grabFrame` | 截不到（区域跑出画面）或已转入跨域处理流程 |
| `shouldSkipFrame` | 画面没变或没文字，**省钱跳过** |
| `recognize` | 异步结果已作废（用户停止 / 换区域 / 跳页） |

---

## 截图器 Capturer

### 双后端

| 模式 | 实现 | 优点 | 限制 |
| --- | --- | --- | --- |
| `element` | `ctx.drawImage(video, …)` | 最快、零授权、无额外进程 | 跨域且无 CORS 头时画布被**污染**，`getImageData` 抛 `SecurityError` |
| `display` | `getDisplayMedia({video:true})` 捕获标签页 → `drawImage(displayVideo, …)` | 一定能读到像素 | 首次需用户授权；需把页面坐标换算成捕获流坐标 |

`Capturer.grab()` 是统一入口，按 `CFG.captureMode` 分派；`auto` 则跟随运行时探测到的 `Capturer.mode`。

### 污染检测与善后

`grabFromElement()` 在裁切后用 `getImageData(0, 0, 1, 1)` 试探一次。抛异常则标记 `code = 'TAINTED'`，并由 `Pipeline.handleTainted()` 接管：

```
TAINTED / NO_DISPLAY
  ├─ captureMode === 'element'（用户显式指定，不擅自改配置）
  │     → 提示手动改设置，停止运行
  └─ 其他（auto / display）
        → 停止当前运行 → 请求标签页共享 → 写入 captureMode='display'
          → 提示用户重新点「开始」
```

**关键点：换模式后主动 `stop()`。** 否则会处于"有流但运行状态错乱"的中间态；让用户重新点开始，状态机始终清晰。

`startDisplayCapture()` 只在**全部成功之后**才落 `displayStream` / `displayVideo` / `mode`，保证三者一致；失败时会把已拿到的流 `stop()` 掉，避免留下一个"有流但没画面"的僵死状态（否则后续每次申请都会被开头的 `if (this.displayStream) return` 挡掉）。

### 坐标换算

页面坐标 → 视频像素坐标需要消除 `object-fit` 造成的留白（黑边）。`getContentBox(video)` 读取元素矩形与 `objectFit`，推算**真实画面区**。框选时用 `anchorRegion()` 把页面坐标转成"相对画面区的比例 + 当时画面区"的快照：

```js
// region 结构
{
  x, y, w, h,        // 页面坐标（当前）
  box: { left, top, width, height }   // 框选那一刻的画面区快照
}
```

`resolveRegion(region, video, knownBox)` 用快照与新画面区的比例重新投影，因此**视频位置变化（滚动、播放器重排、换集）后区域会跟着走**，而不是死守旧坐标。

> `knownBox` 是后加的可选参数：调用方（`grabFromElement`）刚算过内容框，直接传进来即可，避免一次多余的 `getBoundingClientRect` + `getComputedStyle` 强制重排。

### 裁切与缩放

```js
let scale = Math.min(3, Math.max(1, 200 / sh));   // 太矮就放大，最多 3 倍
if (sw * scale > 1400) scale = 1400 / sw;         // 宽度封顶 1400
```

放大是因为**字幕只有几十像素高时 OCR 基本认不出来**；但放太大只是白烧 token（图片体积直接决定费用），所以双重封顶。

### 画布复用（v1.11.0）

`crop()` 复用同一个输出画布 `this._out`，而不是每帧 `createElement('canvas')`：

- 每帧新建的画布在 1400×116 尺寸下意味着约 **650KB** 像素后备存储，加上一个新的 2D context；
- 所有调用方都是"**拿到立刻用掉**"——编码成 data URL、画到预览、读像素做缩略图/边缘密度，没有任何调用方跨周期持有；
- 因此复用是安全的。唯一需要注意的是：**改 `canvas.width/height` 会重置 context 全部状态**，所以 `imageSmoothingEnabled` / `imageSmoothingQuality` 只在尺寸变化时随 context 一起重建。

实测 `Capturer.grab` 单次耗时从 0.848ms 降到 0.458ms（**↓46%**）。

---

## 主循环 Pipeline

### 状态字段

| 字段 | 作用 |
| --- | --- |
| `running` | 用户意图：是否处于运行状态 |
| `busy` | 上一轮请求是否仍在飞（防止请求堆积） |
| `timer` | `setTimeout` 句柄 |
| `gen` | **代**计数器，每次 start/stop/换区域 +1 |
| `lastThumb` | 上一帧缩略图（变化检测基准） |
| `lastOriginal` / `lastTranslation` | 上一句原文/译文（去重与回退基准） |
| `emptyStreak` | 连续空帧计数（连续 2 帧才清空字幕，避免闪烁） |
| `missVideo` | 连续找不到视频的轮数（30 轮后自动停止） |
| `stats` | `{shots, apiCalls, skipped, errors}` |

### 代（generation）机制

异步识别结果回来时，世界可能已经变了。`recognize()` 在 `await` 之后重新校验：

```js
if (myGen !== this.gen || !this.running) {
    log('丢弃作废的识别结果');
    return null;
}
```

没有这道校验，SPA 跳页时会出现「`Overlay.clear()` 之后旧字幕又冒出来」这种诡异现象。

### 错误处理与退避

`tick()` 捕获 `step()` 的异常：计入 `stats.errors`、写入 `Diag.lastError`（带栈顶 3 行）、状态栏显示 `出错：…`，然后 **`await sleep(1500)`** 再排下一轮——连续出错时不会把状态栏刷爆。

### 跳过判定（省钱核心）

`shouldSkipFrame()` 按成本从低到高排列：

| 顺序 | 判定 | 默认阈值 | 成本 |
| --- | --- | --- | --- |
| 1 | 32×16 灰度缩略图平均绝对差 | `< 0.004` 视为画面未变 | 极低 |
| 2 | 160×48 边缘密度 | `< 0.035` 视为无文字 | 低 |
| — | 文本相似度（在 `present()` 中） | `sim > 1 - 0.28 = 0.72` 视为同一句 | 低 |

第 1 步命中且 `lastOriginal` 非空时**直接返回**——预览重绘也一并跳过（画面一模一样时重画 `drawImage` 纯属浪费）。

第 2 步命中会累加 `emptyStreak`，连续 ≥2 帧才清空悬浮层，避免字幕一闪一闪。

### 结果四种走向（`present()`）

| 情况 | 处理 | 原因 |
| --- | --- | --- |
| 完全没有字幕 | `emptyStreak++`，≥2 帧才清空 | 防闪烁 |
| 有原文、无译文 | **保持上一句**，提示 warn | `Overlay` 渲染的是 `translation \|\| original`，放行会把未翻译的外文当译文显示，状态还会误报"已翻译" |
| 与上句相似 | 保持，不刷新 | 防字幕抖动（OCR 每帧都有微小差异） |
| 正常 | `Overlay.show` + 历史 + 诊断记录 + 状态栏 | — |

### 生命周期

```
start()  → 校验已框选 → invalidate() → running=true → 复位 lastThumb/emptyStreak → tick()
stop()   → running=false → invalidate() → 清定时器 → Overlay.clear()
           → 清 lastOriginal/lastTranslation（否则重新开始后第一句会被误判重复）
toggle() → running ? stop() : start()
```

---

## 引擎层

### 翻译缓存（LRU）

```js
const cache = new Map();   // 原文 → 译文，CACHE_MAX = 500
```

`Map` 的迭代顺序即插入顺序，因此「命中后 `delete` 再 `set`」等价于把该条**移到队尾**；淘汰时 `cache.keys().next().value` 就是最久未使用的一条。

> 早先是纯 FIFO：一句反复出现的台词，只要中间插进 500 条新字幕就会被挤掉，然后重新付费翻译。改成 LRU 后重复台词稳定命中。

`translateText()` 用 `cacheGet(text) !== undefined` 判断命中，而不是真值判断——**空字符串是 falsy**，用真值判断会导致"模型返回空"这种缓存永远命中不了，同一句被反复送去付费接口。

### 请求体构造与思考模式

```js
function buildChatBody(messages, { temperature = 0.2, maxTokens } = {}) {
    const body = { model: CFG.model, messages, max_tokens: maxTokens || Number(CFG.maxTokens) || 1024 };
    if (shouldDisableThinking()) {
        body.thinking = { type: 'disabled' };   // 思考模式不支持 temperature，发了也白发
    } else {
        body.temperature = temperature;
    }
    return body;
}
```

`shouldDisableThinking()` 的三态：

| `thinkingMode` | 行为 |
| --- | --- |
| `on` | 不发送该参数，跟随平台默认 |
| `off` | 总是发送关闭参数 |
| `auto`（默认） | 仅当 `apiBase` 含 `deepseek` 时发送 |

**不能无脑发送**：不认识该字段的平台（OpenAI、Gemini 等）可能直接返回 400。

### 响应解析的三种形态（`extractContent`）

1. `content` 是普通字符串 → 直接用
2. `content` 是内容块数组（部分平台）→ 提取 `text` / `content` 字段拼接
3. `content` 为空但存在 `reasoning_content` → 说明**思考模式把输出预算吃光了**，抛出带解决建议的错误

此外 `finish_reason === 'length'` 也会给出专门的错误信息，因为这是思考模式最典型的失败表现。

### 错误翻译

`callChatCore()` 把 HTTP 状态码翻译成可操作的提示：

| 状态 | 追加提示 |
| --- | --- |
| 401 | API Key 不对或没填 |
| 402 | 账户余额不足 |
| 404 | API 地址或模型名不对 |
| 429 | 请求太频繁或额度用尽，试试调大截图间隔 |
| 400 + 含 `model` | 模型名可能写错了 |

### 引擎分发

```js
async function recognizeAndTranslate(canvas, opts) {
    if (CFG.engine === 'youdao-img')    return await callYoudaoImage(canvasToJpeg(canvas, 0.9));
    if (CFG.engine === 'browser-ai')    return await recognizeByBrowserAI(canvas, opts);
    if (CFG.engine === 'web-translate') return await recognizeByWebTranslate(canvas);
    if (CFG.engine === 'umi-ocr')       return await recognizeByUmi(canvas);
    return await translateByVision(canvasToJpeg(canvas, 0.85));   // 默认
}
```

JPEG 质量按引擎分别调过：`openai-vision` 用 0.85（视觉模型对压缩不敏感，省流量），`umi-ocr` 用 0.92（PaddleOCR 对细节更敏感），有道用 0.9。

> 图片**必须放在 `user` 消息里**：DeepSeek 明确不接受 `system` / `assistant` 消息中的图片（会返回 400）。

### 浏览器内置 AI（完全离线引擎）

`48-browser-ai.js` 把「浏览器自带的端侧模型」接成第四条引擎。它复用了两条已有的识别路径，只把**翻译**换成端侧：

```
识别  umi     → callUmiOCR()（44-umi-ocr.js，本机 PaddleOCR）
      builtin → LanguageModel.prompt([{role:'user', content:[text, image]}])
翻译  auto / translator → Translator.translate() / translateStreaming()
                          直连是坏语言对时 → 经英语中转（ja→en 再 en→zh）
      prompt            → LanguageModel.prompt()（文本翻译，不声明 expectedOutputs）
```

下面四条是**实测**（Chrome 153）得到的约束，实现里每一条都有对应处理，改这块之前请先读：

| 约束 | 实测表现 | 处理 |
| --- | --- | --- |
| 下载必须在用户手势里 | 模型未下载时 `create()` 抛 `Requires a user gesture when availability is "downloadable"` | 只由面板「② 准备离线模型」按钮触发下载；主循环只用已建好的会话 |
| 端侧模型声明语言里没有中文 | `availability({expectedOutputs:[{type:'text',languages:['zh']}]})` → `unavailable`；`en`/`ja`/`fr`/`de`/`es` → `downloadable` | 要它输出中文时不写 `expectedOutputs`，靠系统提示词引导；多模态读图按**源语言**声明 |
| 跨域 iframe 默认不可用 | Permissions Policy 限制（顶层窗口与同源 iframe 才有） | `baiFrameNote()` 探测并在面板/诊断里说清楚 |
| 流式分片语义未定 | Chrome 当前给的是**累计**文本，规范讨论过改成**增量**；Edge 的 `translateStreaming` 实测**只回 1 个分片**（等价于一次性调用） | `baiJoinChunk()` 两种都认，避免升级后串字 |
| **模型在重复输入上会失控** | 纯拟声字幕（「ああっああっ」）会让 `ja→en` 吐出 971 字的 `Oh, oh, oh…`，再过一遍 `en→zh` 被放大成 3613 字、耗时 5.6 秒 | `baiCollapseRepeat()` 把「同一 1~6 字符片段重复 ≥5 次」压成两遍（阈值取 5，正常的四连重复不误伤）；**中转的第一段也压**，否则会被第二段放大一轮；`baiPolish()` 收尾去引号 / 去尾逗号 / 按「原文 ×4」兜底长度 |
| **Edge 不是同一套实现** | Edge 145：**没有 `LanguageModel`**（没有 Prompt API）；`Translator` 对 **`ja→zh` 全系变体**（`zh`/`zh-Hans`/`zh-Hant`/`zh-CN`/`zh-TW`/`ja-JP→zh`）`create()` 成功但 `translate()` 必抛 `UnknownError: Other generic failures occurred.`；而 `ja→en`、`ja→ko`、`ja→fr`、`en→zh` 都正常 | ① 「内置多模态读图」在 Edge 上直接给出可操作提示；② **经英语中转**（`baiPivotTranslate`，ja→en→zh）；③ `baiPrepare()` 里真跑一句自检，把坏语言对在**用户手势还在**的时候就试出来；④ `baiBrokenPairs` 按语言对记住结论，避免每帧重撞 |

> 第 5 条是这条引擎最容易踩空的地方：**只探测 `availability()` 看不出问题** —— Edge 会老老实实回 `downloadable`/`available`，`create()` 也成功，只有真去 `translate()` 才炸。所以 `baiPrepare()` 的自检不是锦上添花，它是唯一能在“用户还没开始播”时发现问题的时机。

会话是**有状态且昂贵**的，所以按「语言对 + 模式」缓存在 `baiCache` 里复用（`baiReuse`）：每句都 `create()` 会把模型反复加载，单句耗时从几十毫秒涨到几百毫秒。换语言 / 换模式 / 用户重置时 `baiReset()` 统一销毁。

流式显示（`CFG.baiStream`）由 `Pipeline.partialSink(myGen)` 落到字幕上，三层保护：开关关闭时返回 `undefined`（引擎退回一次性调用）、用**代**校验丢弃作废分片、按 80 ms 节流（模型一秒能吐几十个分片，每个都写 `innerHTML` 会带一次强制重排）。

### 免费网页接口（`49-web-translate.js`）

复用翻译网站**自己前端在用的那份接口**，只做文本翻译，识别交给本机 Umi-OCR。三个引擎 + 一条降级链：

```
翻译  腾讯 transmart（纯 JSON、无鉴权） → 彩云小译（前端公开 token） → 必应（抓 IG + token）
识别  callUmiOCR()（与 umi-ocr 引擎共用）
```

| 设计点 | 为什么 |
| --- | --- |
| `wtLangPair(id, src, tgt)` 逐家映射语言码 | 同一门语言三家叫法不同：必应要 `auto-detect`/`zh-Hans`，彩云要 `ja2zh` 且**不接受 `auto`**，腾讯繁体用 `zh-TW`。返回 `null` 表示这家用不了，直接跳过 |
| 降级链逐个试，全挂时把**每一家的原因**拼进错误 | 逆向接口的失败原因很重要（改版？限流？），只说一句"翻译失败"没法排查 |
| `wtMinInterval` 限速（默认 1200ms） | 同一引擎两次请求强制隔开，别把人家接口打挂 —— 也就不容易吃到限流 |
| 必应空 body ⇒ 视为 token 过期，丢掉上下文重抓一次 | token 与 cookie 绑定，页面里的 `params_AbusePreventionHelper` 有有效期。另外实测 `www.bing.com` 会回 200 + **空 body**，所以固定用 `cn.bing.com` |
| `wtStats` 记每个引擎的成败与最近错误，进诊断报告 | 出问题时能一眼看出是谁挂了 |
| 复用 `cacheGet` / `cachePut`（键带 `wt|` 前缀和引擎链） | 换接口或换语言对之后不该命中旧译文 |

> ⚠️ 这几个是**内部接口而非公开 API**，服务条款上通常不允许第三方直接调用，且随时可能改版/限流。面板与 `README` 都写明了这一点，模块头注释里也有。

---

## UI 层

### 面板构建

`panelHTML()` 返回完整的面板标记，`panelCSS()` 返回样式（含 `!important` 关键声明以抵抗宿主页面样式重置）。挂载后 `UI.cacheEls()` 遍历 `[id^="h1sub-"]`，把 `id.replace(/-/g, '_')` 作为键缓存到 `UI.els`，后续所有控件访问都是 `e.xxx`，不做重复查询。

### Trusted Types 兼容

部分站点（如 YouTube）启用了 Trusted Types，直接给 `innerHTML` 赋字符串会抛异常。所有富文本注入统一走：

```js
function setHTML(el, html) {
    if (window.trustedTypes && window.trustedTypes.createPolicy) {
        // 复用同一个策略：重复创建同名策略会抛错
        TT_POLICY = TT_POLICY || window.trustedTypes.createPolicy('h1sub', { createHTML: s => s });
        el.innerHTML = TT_POLICY.createHTML(html);
        return;
    }
    el.innerHTML = html;
}
```

### 面板交互

| 交互 | 实现要点 |
| --- | --- |
| 拖动面板 | 标题栏 `mousedown` + **document 级** `mousemove` / `mouseup`；松手保存 `panelPos` |
| 调宽 | 左边缘 5px 抓手；宽度限制 260–760px；松手保存 `panelWidth` |
| 折叠 | `display` 切换，保留标题栏 |
| 位置恢复 | `panelPos` 会被夹在视口内（`Math.min(window.innerWidth - 60, p.left)`），避免拖出屏幕后消失 |

> **可维护性细节**：document 级拖动监听挂在实例上（`UI._onDragMove` / `UI._onDragUp`），`destroy()` 时摘除。否则每次 `destroy → mount` 都会多漏一对监听，旧的闭包连同其引用的 DOM 一起泄漏。

### 配置写入策略

`saveCfg(cfg)` 会遍历写入全部 30+ 个存储项。仅在**批量变更**时使用（导入、重置）。单键或少数键变更一律走：

```js
saveCfgKeys(CFG, ['captureMode']);
```

涉及的面板操作包括：输入框/滑块变更、平台预设、截图方式切换、禁用/恢复站点、配置档案增删应用、面板位置与宽度、首次引导标记。

---

## 全屏策略 Fullscreen

浏览器进入全屏后**只渲染全屏元素及其子树**，挂在 `body` 上的 UI 会被整个隐藏。因此：

```
fullscreenchange
  ├─ 进入全屏
  │    ├─ fullscreenElement 是普通容器 → 把 Overlay / 面板 / 胶囊**搬进**该容器
  │    └─ fullscreenElement 就是 <video> 本身（替换元素，不渲染子节点）
  │           → 改用**原生字幕轨**（TextTrack + VTTCue）输出
  └─ 退出全屏 → 全部搬回 body
```

`uiHost()` 统一回答"UI 现在应该挂在谁下面"，`Overlay` / `UI` 都通过它取宿主。原生字幕轨回退时会创建一个 `TextTrack` 并维护一条长 `VTTCue`（在 `show()` 时更新 `cue.text`），从而在 `<video>` 全屏时仍能看到译文。

---

## 区域框选器 RegionSelector

`begin()` 进入框选模式后在 `document` 上以**捕获阶段**监听 `mousedown` / `mousemove` / `mouseup` / `keydown`：

- 拖动过程中通过 `requestAnimationFrame` 更新选区矩形，并调用 `Capturer.grab()` 把选区内容实时画进预览（让用户确认框对了字幕带）；
- `Esc` 取消；选区小于最小尺寸时提示「框选太小，已取消」；
- `blur` 兜底清理（拖到窗口外松手 / alt-tab 走掉时 `mouseup` 收不到）。

> **踩坑记录**：`blur` 监听**不能**用捕获阶段。`blur` 自身不冒泡，但捕获阶段是从 `window` 往下走的，于是页面上任何元素失焦都会触发。真实症状是：用户点完面板上的「框选字幕区」按钮（按钮处于聚焦态），再移到视频上按下左键——浏览器把焦点从按钮移走派发 `blur`，框选还没开始就被清理掉了，表现为"框选功能用不了"。

框选完成后调用 `anchorRegion()` 记录锚点并 `rememberRegion()` 按站点持久化（`regionsByHost` 上限 60 条，超出按插入顺序淘汰最旧的）。

---

## 诊断模块 Diag

| 能力 | 说明 |
| --- | --- |
| `record(entry)` | 记录最近 40 条识别结果（含引擎、耗时、原文、译文） |
| `build()` | 生成纯文本诊断报告 |
| `open()` | 打开诊断弹窗（含区域对齐可视化） |
| `tainted` / `lastYoudao` / `lastError` | 关键事件快照，一并进报告 |

报告内容涵盖：脚本版本、页面 URL、视频元素几何、`videoWidth/Height`、`object-fit`、**推算的画面区**、`paused/ended`、`readyState`、视口与 DPR、截图后端、是否触发过污染、框选区域及其在**视频像素坐标系**下的位置、识别历史、最近错误。

这是"我看不到用户屏幕"场景下最高效的排查手段——用户复制一段文本即可定位问题（报告**不包含** API Key）。

---

## 性能特征与优化

### 热路径成本分布（每轮截图）

| 环节 | 量级 | 说明 |
| --- | --- | --- |
| `drawImage` 裁切缩放 | 主导 | GPU 侧缩放，无法用 JS 优化 |
| `getImageData`（缩略图/边缘密度） | 中 | 读回像素，尺寸已压到 32×16 / 160×48 |
| `toDataURL('image/jpeg')` | 中 | 一次性编码，约 0.7ms @1400×116 |
| 缩略图 / 边缘密度 JS 循环 | 低 | 分别 512 / 7680 个像素 |
| 相似度 DP | 低 | 字幕长度通常 < 40 字符 |

**结论：真正的成本在网络与图像编解码，因此优化重点放在「减少浪费」（跳过判定、缓存）与「消除每帧的分配」上，而不是微调 JS 循环。**

### v1.11.0 的六项优化

| 优化 | 手段 | 效果 |
| --- | --- | --- |
| 截图画布复用 | `crop()` 复用 `_out` / `_outCtx`，尺寸不变则不重建 | `grab` ↓46% |
| 边缘密度滚动行缓冲 | 只保留两行灰度（`EDGE_ROWS`），逐行滚动比较 | 去掉每次 30KB 分配与一遍完整扫描 |
| 编辑距离复用类型化数组 | 模块级 `Int32Array` scratch + `charCodeAt` 比较 + 列取短边 | 去掉每帧两个数组分配 |
| 消除重复布局读取 | `resolveRegion(region, video, knownBox)` 接收调用方刚算出的 box | 每帧少一次 `getBoundingClientRect` + `getComputedStyle` |
| 精确写入存储 | 单键变更改用 `saveCfgKeys` | 一次改设置从写 30+ 项降到 1 项 |
| 遍历去分配 | `findVideo()` 直接遍历 `NodeList` | 去掉每帧一次 `Array.from` |

### 正确性约束

优化必须**不改变行为**。为此：

- 边缘密度改为滚动行后，比较的像素对与旧实现**逐位相同**（同样从第 2 行、第 2 列起计数），仅去掉了整块灰度矩阵；
- 相似度 DP 交换长短串只影响滚动行长度，编辑距离与 `1 - dist/max(m,n)` 都是对称的；
- 画布复用不改变任何调用方的可观察行为（全部"拿到即用"）。

回归验证：**444 项端到端测试全部通过**，A/B 基准无指标回退。

---

## 内存与生命周期

所有长期增长的结构都有明确上限：

| 结构 | 上限 | 位置 |
| --- | --- | --- |
| 翻译缓存 | 500 条（LRU） | 引擎层 |
| 识别历史（DOM） | 30 条 | `UI.pushHistory` |
| 诊断记录 | 40 条 | `Diag.record` |
| 按站点区域 | 60 个 | `rememberRegion` |
| 配置档案 | 用户自定（面板可删） | `apiProfiles` |
| 缩略图/边缘缓冲 | 固定尺寸 | `scratch()` 复用的离屏画布 |

`UI.destroy()` 负责彻底拆除：清 SPA 路由轮询定时器、摘 `resize` 监听、**摘面板拖动的 document 级监听**、停止标签页共享、移除 Overlay 与面板节点、清空 `els` 缓存、把 `root` 置空（否则挂载判断会一直失效）。

`boot()` 只在文档级执行一次（`window.__H1SUB_LOADED__` 守卫）。油猴菜单注册了 4 条命令：显示/隐藏面板、框选字幕区域、开始/停止、在本站禁用。

---

## 安全考量

| 风险 | 缓解措施 |
| --- | --- |
| **导入配置注入 HTML** | `sanitizeCfg()` 校验所有数值区间；`textColor` 用 `#RGB`~`#RRGGBBAA` 正则白名单；`region` 坐标非有限数则整体置 `null` |
| **旧配置残留非法枚举** | `engine` 不在白名单则回落默认值（否则 `<select>` 显示空白，运行时却按另一个引擎跑） |
| **rich text 注入** | 只有面板自身构造的 HTML 走 `setHTML`；所有用户数据/模型输出都经 `escapeHtml()` |
| **API Key 外泄** | Key 只存在 `GM_setValue`（用户脚本私有存储），导出配置时**导出的是全量配置**——包含 Key，面板有明确提示；诊断报告**不含** Key |
| **像素数据外发** | 仅字幕区域截图会发送到你配置的 API；脚本本身不向任何第三方回传数据 |
| **信任边界** | 模型返回的 JSON 经 `parseModelJson()` 容错解析，解析失败时降级为"整段文本当译文"，不执行任何模型输出 |

---

## 扩展指南：新增一个引擎

以新增一个「Azure 视觉」引擎为例，需要改 4 处：

**1. 加入白名单**（一、配置）

```js
const ENGINES = ['openai-vision', 'umi-ocr', 'youdao-img', 'azure-vision'];
```

**2. 实现识别函数**（六、翻译引擎）

```js
async function recognizeByAzure(canvas) {
    const dataUrl = canvasToJpeg(canvas, 0.9);
    const res = await gmRequest({
        url: CFG.azureEndpoint + '/vision/v3.2/read/analyze',
        headers: { 'Ocp-Apim-Subscription-Key': CFG.azureKey, 'Content-Type': 'application/json' },
        data: JSON.stringify({ url: dataUrl }),
    });
    // …解析… 返回 { original, translation }
    return { original, translation };
}
```

**3. 接进分发**（六、翻译引擎）

```js
async function recognizeAndTranslate(canvas, opts) {
    if (CFG.engine === 'youdao-img')   return await callYoudaoImage(canvasToJpeg(canvas, 0.9));
    if (CFG.engine === 'browser-ai')   return await recognizeByBrowserAI(canvas, opts);
    if (CFG.engine === 'umi-ocr')      return await recognizeByUmi(canvas);
    if (CFG.engine === 'azure-vision') return await recognizeByAzure(canvas);
    return await translateByVision(canvasToJpeg(canvas, 0.85));
}
```

**4. 面板 UI**：在 `panelHTML()` 的引擎下拉里加 `<option>`，并新增对应配置项（记得同步 `DEFAULTS` 并把枚举值纳入 `sanitizeCfg()` 的兜底），然后在 `UI.syncEngineUI()` 里控制其显隐。

**测试要求**：在 `_test/engine.mjs` 的 `GM_xmlhttpRequest` 桩里按 URL 匹配返回模拟响应，断言请求体与解析结果；并确保既有的 444 项测试仍然全绿。若新引擎依赖浏览器专有 API（像 `browser-ai` 依赖 `Translator` / `LanguageModel`），照 `_test/browser-ai.mjs` 的做法给这些全局对象打一套行为一致的替身，别让测试去下载真实模型。

---

## 相关文档

- [接口文档](API.md)——第三方 API 与内部 JS API
- [测试指南](TESTING.md)——如何运行测试与性能基准
- [本地 OCR 方案设计](local-ocr-design.md)——Umi-OCR 等本地方案的取舍分析
