# 更新日志

本项目的所有重要变更都会记录在此文件。
版本号遵循语义化版本（SemVer）。更早的 1.4.0~1.10.0 为发布前的本地迭代记录。
每条记录均由归档快照之间的实际代码差异（`git diff --no-index`）比对得出。

## [未发布]

### 性能
- **八项热路径优化（行为、公开 API、配置键与 UI 文案全部不变）**：
  - `findVideo()` 加 200ms TTL 缓存（新增 `invalidateFindVideoCache()`，并在 SPA 路由切换处调用）。该函数在 `watchForVideo` 里由 rAF 驱动（最高 60 次/秒）、在框选预览里也按帧触发，而 `querySelectorAll` + `getBoundingClientRect` 是一次强制同步重排；同时用 `el.isConnected` 兜住 SPA 换页后的游离元素。新增的 `invalidateFindVideoCache` 已挂进 `window.__H1SUB__`。
  - `Overlay.show()` 增加内容指纹（`original + '\u0000' + translation`）：指纹命中且当前可见时只调 `position()`，不重建 `innerHTML`（重建后紧跟的 `position()` 要读 `offsetWidth`，每次都是一遍强制重排）。`clear()` 里把指纹置 `null` 保证下次必定重建；**指纹命中路径仍会同步 `<video>` 全屏下的原生字幕轨**（抽成 `overlaySyncTrack()` 供两条路径共用），否则全屏时译文会停在上一句。
  - `UI.renderStats()` / `UI.setStatus()` 增加内容去重：`setStatus` 每帧都被 Pipeline 调用，状态与颜色都没变时不再写 DOM。状态灯的背景色比对记在实例字段上 —— 直接比较 `dot.style.background` 是无效的，CSSOM 会把 `#4ade80` 规范化成 `rgb(74, 222, 128)`，字符串永远不相等。
  - `sanitizeCfg()` 校验 `region` 时不再分配临时数组。
  - `textSimilarity()` 在进 DP 之前先用相似度上界剪枝（`upper = 1 - |la-lb| / maxLen`，低于 `0.2` 直接返回 0）。取 `0.2` 是最保守值：默认阈值下需 `sim > 0.72` 才算同一句，上界到不了 0.2 的串绝无可能重复，判定结果不变；长度差悬殊的对子因此不必再走完 O(m·n)。
  - `shouldSkipFrame()` 里 `lastThumb` 为 `null`（第一帧）时直接短路，不再白跑一遍 512 个样本的 `thumbDiff` 循环。
  - 「最近识别」的 30 条上限提为具名常量 `HIST_MAX`（纯给将来调参留入口）。
- **修复构建模板 bug：产物里出现两份完全相同的 `// ==UserScript==` 块**。`_build/build.mjs` 把 `00-header.js` 既作为文件头输出、又随其它模块一起拼进了 IIFE 内部，于是头块重复了一遍（IIFE 里那份是死代码）。现在 `body` 从 `modules.slice(1)` 开始拼接，产物里只剩一个头部块（开头一行 `// ==UserScript==` + 结尾一行 `// ==/UserScript==`）。

### 新增
- **新增第五个引擎 `web-translate`：逆向免费网页接口翻译**（`src/49-web-translate.js`）。不申请任何 API Key，直接复用翻译网站自己前端在用的那份接口；识别仍由本机 Umi-OCR 负责（所以这个引擎是「本机识别 + 免费在线翻译」的组合）。
  - **三个接口 + 降级链**：腾讯交互翻译（`transmart.qq.com/api/imt`，纯 JSON、无鉴权，最省事）→ 彩云小译（前端公开 token）→ 必应翻译（`cn.bing.com/ttranslatev3`，要抓 IG + token，最稳）。面板上也可以锁定只用一个。
  - **各家语言码各自映射**：同一门语言三家叫法不同（必应要 `auto-detect`/`zh-Hans`，彩云要 `ja2zh` 且不接受 `auto`，腾讯繁体用 `zh-TW`），`wtLangPair()` 一层收口；不支持的组合直接跳过该引擎。
  - **必应 token 过期自动重取**：返回空 body 就是 token 失效，丢掉上下文重抓一次再翻（实测 `www.bing.com` 会回 200 + 空 body，所以固定用 `cn.bing.com`）。
  - **限速 + 缓存 + 成败统计**：同一引擎两次请求之间有最小间隔（`wtMinInterval`，默认 1200ms，可关），翻译结果进 LRU 缓存，每个引擎的成功/失败次数与最近错误进诊断报告 —— 逆向接口随时会失效，得能一眼看出是谁挂了。
  - **「测试各接口」按钮**：把三个接口各试一次并列出耗时与结果，不用靠猜。
  - ⚠️ **性质与风险已在面板与文档里写清楚**：这些是各家的**内部接口**，不是公开 API，服务条款上通常不允许第三方直接调用，且随时可能改版、限流、封 IP。仅建议个人自用，不要刷量；要稳定请走官方 API 或本地模型。
- **语言名 → 语言码的映射下沉到公共模块**（`32-util.js` 的 `LANG_ALIASES` / `langCode`）：浏览器内置 AI 与免费网页接口两个引擎都要做这一步（「日语」→`ja`），原先只存在于 `48-browser-ai.js`，现改为共用一张表，避免两处各维护一份。
- 新增测试套件 `_test/web-translate.mjs`（44 项）与对应 npm 脚本 `test:web-translate`。用 `GM_xmlhttpRequest` 桩按 URL 模拟三家的响应，覆盖：语言码映射、降级链（逐个挂掉看它换谁）、三家全挂时错误里带每一家的原因、必应 token 过期重取、限速真的隔开了、缓存命中不再发请求、指定单一接口只打那一家、测活、面板联动、诊断报告。
- **新增第四个引擎 `browser-ai`：浏览器内置 AI，完全离线的识别 + 翻译**（`src/48-browser-ai.js`）。直接调用浏览器自带的端侧模型：`Translator`（Translation API，端侧翻译模型）与 `LanguageModel`（Prompt API，Gemini Nano，可读图）。**不联网、不需要 API Key、原文不出设备、不产生任何费用**，代价是需要 Chrome 138+ 桌面版（或 Edge）、页面为 HTTPS/localhost，且首次要下载一次语言包。
  - **两条识别路线**（面板「识别方式」）：`umi` = 本机 Umi-OCR 认出原文再交给端侧翻译（识别率最高，推荐）；`builtin` = 端侧多模态模型直接读图（零安装，识别率一般）。
  - **翻译方式三态**（`baiTrans`）：`auto` 优先端侧翻译模型、语言对不支持时自动退回端侧大模型；`translator` 只用翻译模型；`prompt` 只用端侧大模型。
  - **语言名 → BCP-47 映射**：面板里填的「日语 / 简体中文」自动转成 `ja` / `zh`（含大小写与子标签规范化），认不出来时直接报错并指出该填什么，**不猜**——猜错会静默翻错语言。
  - **会话复用**：按「语言对 + 模式」缓存端侧会话；每次翻译都 `create()` 会把模型反复加载，单句耗时从几十毫秒涨到几百毫秒，根本跟不上字幕节奏。换语言/换模式/用户点重置时才销毁重建。
  - **流式显示**（`baiStream`，默认开）：走 `translateStreaming` / `promptStreaming`，边生成边把已生成的部分盖到字幕上。分片既有「累计」式（Chrome 当前行为）也有「增量」式（规范讨论过改），两种都能正确拼接；主循环按 80 ms 节流并做**代（generation）校验**，用户中途停止或重选区域后迟到的分片不会再画上去。
  - **下载必须在用户手势里发起**：模型没下载时 `create()` 会直接拒绝（`Requires a user gesture…`）。因此下载只由面板上的「② 准备离线模型」按钮触发（带进度条），主循环只用已建好的会话，不会在后台偷偷下载。
  - **失败要说人话**：需要手势、语言对不支持、跨域 iframe 被 Permissions Policy 拦住、模型下载失败等英文 DOMException 全部翻译成可操作的提示。
  - 面板新增「浏览器内置 AI」区块：「① 检测浏览器 AI」（列出 `Translator` / `LanguageModel` / 安全上下文 / 框架位置 / 语言方向 / 各能力的 availability）与「② 准备离线模型」；离线引擎下自动隐藏不需要的 API 配置区，Umi-OCR 配置区随「识别方式」显隐。
  - 诊断报告新增「浏览器内置 AI（离线）」段（可用 API、安全上下文、框架位置、语言代码映射、上次探测结果），并新增 `Diag.baiProbe` 保存探测快照（`build()` 是同步的，不能现算）。
  - **Edge 与 Chrome 不是同一套实现**（Edge 145 实测）：Edge **没有 `LanguageModel`**（没有 Prompt API，「内置多模态读图」用不了、语言对不支持时也没有大模型可退）；且它的 `Translator` 对 **`日语 → 中文` 必报** `UnknownError: Other generic failures occurred.` —— `zh`/`zh-Hans`/`zh-Hant`/`zh-CN`/`zh-TW`/`ja-JP→zh` 全试过、全挂，而同一台机器上 `ja→en`、`ja→ko`、`ja→fr`、`en→zh` 都正常（坏的只是这一对）。**注意它 `availability()` 会老实回 `downloadable`、`create()` 也成功，只有真 `translate()` 才炸**，所以只探测可用性看不出问题。
  - **经英语中转**（`baiPivot`，默认开，`baiPivotTranslate`）：直连失败时改走 `原文 → 英语 → 目标语言`，两条腿在 Edge 上都是好的，这是 Edge 上唯一还能离线跑通的路。只在**直连确认失败后**才启用，且坏语言对按对记进 `baiBrokenPairs`，不会每帧重撞；关掉该项会给出可操作的报错而不是静默失败。
  - **「② 准备离线模型」现在会真跑一句自检**（`translate('Test')`）。这是唯一能在**用户手势还在**的时候发现坏语言对的时机 —— 否则用户要等到第一句字幕才看到报错。自检发现直连不可用时会顺手把中转需要的两个会话也备好，并在面板上写明「已改走经英语中转，译文质量会略降」。
  - 面板「浏览器内置 AI」区块补充 Edge 注意事项，文案不再对 Edge 承诺「不联网 / 原文不出设备」（未经证实）；诊断报告新增中转开关与已试出的坏语言对。
  - `translate()` 的报错映射补上 `Other generic failures occurred.` → 明确指出是浏览器不支持该语言对、并给出三条出路（开中转 / 换 Chrome / 换引擎）。
- 新增测试套件 `_test/browser-ai.mjs`（65 项）与对应 npm 脚本 `test:browser-ai`。内置 AI 的全局对象（实测可写可覆盖）被打了一套**行为一致**的替身，并刻意模仿三个真实坑：分片既有增量式也有累计式、模型没下载时 `create()` 会报「需要用户手势」、**`create()` 成功但 `translate()` 才抛 UnknownError 的坏语言对**。覆盖语言映射、能力探测、全离线链路（断言**没有发出任何网络请求**）、会话复用与缓存、多模态读图（断言交给模型的是真实 Blob）、流式拼接与节流、经英语中转与坏语言对记忆、准备阶段自检、回退与错误提示、面板联动、诊断报告。

### 修复
- **修复端侧翻译遇到「纯拟声」字幕时退化成无限重复**（真机实测反馈）。现象：一句 18 字的原文，`ja→en` 吐出 **971 字**的 `"Oh, oh, oh, oh…"`，再经 `en→zh` 被**放大一轮**成 3613 字、单句耗时 **5.6 秒**（正常约 240ms），悬浮层直接被刷成一整屏。
  - 定位过程：在真实 Edge 上复现，确认**不是流式的锅**（Edge 的 `translateStreaming` 实测只回 1 个分片，等价于一次性调用），而是模型本身在重复输入上失控，且**第一段就已经失控**。
  - 新增 `baiCollapseRepeat()`：把「同一 1~6 字符片段连续重复 5 次以上」压成两遍。阈值刻意取 5 次，正常的四连重复（「谢谢谢谢」）不受影响；实测把 971 字压到 11 字，而正常句子的 71/26/63 字**一字未动**。
  - **中转的第一段也压**：否则失控的英语会被第二段再放大一轮 —— 这是 5.6 秒的真正来源。
  - 新增 `baiPolish()` 收尾：去掉模型单边残留的引号（它常常只在开头加一个 `"`）、压重复、去掉压完留下的尾逗号、并按「原文长度 ×4（下限 80 字）」给译文长度兜底。
  - ⚠️ **中转质量损失是已知限制**：Edge 上「日语 → 中文」必须过两道翻译，`お腹の奥` 会变成「胃」、`Gスポット` 会变成「是个地方」。想要直连质量请改用 Chrome。这一点已在 README 的 `browser-ai` 一节写明。
- **修复 Edge 上「经英语中转」必报 `AbortError: signal is aborted without reason`**（v1.12.0 未发布期间的回归）。会话缓存原先每个用途只有**一个槽位**，而经英语中转要**同时**用到两个翻译会话（`ja→en` 与 `en→zh`）：建第二个时会把刚拿到的第一个 `destroy()` 掉，而 `destroy()` 会**打断在飞的 `translate()`**，于是真机上必现该报错。改为按「用途 + 语言对」存多个会话（`baiCache` 换成 `Map`，上限 8，配置一变 `baiReset()` 清空）。该问题同样由用户实测反馈（Edge 已升级到最新版仍复现），验证结论是内核版本不是原因。
  - 顺带修掉一个性能问题：原先每句字幕都会重建两个会话（反复加载模型），现在只在首次建立、之后一直复用。
  - 新增恢复路径：一旦真的吃到 `AbortError`，就把该语言对相关的会话丢掉，下一句自动重建，而不是之后每一句都继续失败；这类错误也翻成了可操作的中文提示。
  - 测试替身补上真实行为：`destroy()` 之后该会话的 `translate()` 会拒绝并报 `AbortError`（早先的替身只记了个数，所以"拿已销毁的会话去翻译"这种 bug 在测试里看不出来）。新增 5 项断言专门盯住这一处，`browser-ai.mjs` 由 78 项增至 94 项。

### 变更（模块化重构，**无行为变化**）- 把原本 4141 行的单文件脚本按功能组件拆分为 `src/` 下的 27 个模块（配置 / 站点行为 / 区域锚定 / 图像分析 / HTTP / 签名 / Umi-OCR / 有道 / 截图器 / 对话接口 / 引擎分发 / 主循环 / 字幕层 / 全屏 / Trusted Types / 框选器 / 诊断 / 面板骨架 / 面板样式 / 弹窗 / 面板行为 / 启动）。**文件名前缀的两位数字就是拼接顺序**，每个模块头部写明了「对外提供」与「依赖」。
- 新增零依赖的拼接构建 `_build/build.mjs`：按编号顺序把模块拼回根目录的单个用户脚本，并核对模块命名与编号、对外提供与依赖声明、顶层名字全局唯一性、三处版本号一致性，最后用 `vm.Script` 做语法解析（只解析不执行）。构建**不做任何重命名、转译、作用域包装或压缩**——只是把源码按顺序连起来，因此"源码即产物、可逐行审计"这条性质依然成立。
- `package.json` 新增 `build` / `build:check` / `pretest` 脚本；`lint` 改为「构建 + 语法检查」；`npm test` 会自动先构建一次，保证测试跑的永远是当前源码的产物。

### 说明
- **产物与安装方式完全不变**：根目录仍是单个 `video-hardsub-translator.user.js`，运行时零第三方依赖，Tampermonkey 里依然"点一下就装完"，`@downloadURL` / `@updateURL` 不用改。变的只是仓库里源码的组织方式。
- **无损性已验证**：把重构前的单文件与新的构建产物各自去掉注释与空行后逐行比对，代码流均为 3016 行且完全一致；6 个测试套件 306 项断言全部通过（50/76/37/79/33/31）。（该数字是重构当时的口径；后续加入 `browser-ai`、`web-translate` 两个套件后现为 8 个套件 444 项。）
- **不要直接编辑根目录的 `.user.js`**：它是产物，改动会被下次构建覆盖（文件头已加醒目提示）。改 `src/` 里对应的模块，然后 `npm run build`。
- 已知边界：`src/96-panel-ui.js` 仍有 1100 多行，因为 `UI` 是一个巨大的对象字面量，拆它需要改用 `Object.assign(UI, {…})` 切开，属于会改变代码结构的改动。本次优先保证"零行为变化"，故保持整块。
- 文档同步更新：`README.md`（设计目标、技术栈选型、本地开发、目录结构、源码结构表）、`docs/ARCHITECTURE.md`（新增「源码结构与构建」一节、模块地图改为 27 个模块）、`CONTRIBUTING.md`（开发环境、结构约定、硬性约束、测试要求）、PR 模板与功能建议模板中的"无构建"表述。

## [1.11.1] - 2026-09-12

### 变更
- `@namespace` 由 `local.hardsub.translate` 改为代码仓库地址 `https://github.com/1105532539/video-hardsub-translator`。Greasy Fork 要求该字段存在，并且**在更新时如果发现它发生变化会发出警告**；用户脚本管理器也用 `@name` + `@namespace` 组合判断「这个脚本是否已安装」。因此趁首次发布到 Greasy Fork 之前把它固定为与仓库一致的值，避免日后改动导致已安装用户被识别成另一个脚本、收不到更新。
- 为发布到 Greasy Fork 做准备：新增 `docs/greasyfork-listing.md`（可直接粘贴的发布正文 + 表单填写对照 + 合规自查），并在 `CONTRIBUTING.md` 中新增「发布到 Greasy Fork」一节，把同步步骤与注意事项（`@version` 必须递增、`@namespace` 不可再改、Greasy Fork 会改写 `@downloadURL` / `@updateURL`、发布文案不得引导用户改用其它安装源）写入发版流程。
- 修正 `CONTRIBUTING.md` 发版流程中的版本号位置：由「两处」更正为「四处」——此前遗漏了 `package.json` 的 `version` 与 `README.md` 顶部的 version 徽章，实际发版时这两处也会与脚本版本号脱节。

### 说明
- 本版**不含任何功能或行为改动**：脚本逻辑与 1.11.0 完全一致，仅元数据（`@namespace` / `@version` / `SCRIPT_VERSION`）与文档调整。

## [1.11.0] - 2026-09-12

### 新增
- 新增集中定义的热路径常量：缩略图尺寸 32×16（THUMB_W / THUMB_H）、边缘密度采样尺寸 160×48（EDGE_W / EDGE_H）、相邻像素灰度差阈值 45（EDGE_GRAD）、边缘密度下限 0.035（EDGE_MIN）、画面无变化阈值 0.004（NO_CHANGE_DIFF），以及状态栏配色表 STATUS_COLORS（err / warn / ok / busy / idle）。

### 变更
- 设置落盘由「全量重写」改为「只写改动键」：面板拖动位置、面板宽度、单个配置项、相似度阈值、应用预设、截图方式、清空禁用列表、API 配置档案的保存与切换与删除、首次引导标记，全部改用 `saveCfgKeys()` 只写实际变化的那几个键，不再一次改写 30+ 个存储项。
- 抽出共用助手 `canvasToJpeg()`：openai-vision / umi-ocr / youdao-img 三条引擎最终都经它把画布编成 JPEG（质量参数仍按引擎区分）。
- 抽出共用助手 `stripDataUrlPrefix()`：Umi-OCR 与有道接口都要求纯 base64，去掉 `data:image/...;base64,` 前缀的逻辑收成一处。
- 抽出共用助手 `stripWrappingQuotes()`：剥掉模型偶尔给译文套上的引号 / 书名号。
- 抽出共用助手 `banCurrentHost()`：面板标题栏的 🚫 与油猴菜单的「在本站禁用」共用同一套确认、写配置与销毁 UI 的逻辑；油猴菜单那处原先用的是不带恢复指引的短确认文案，现在统一为带「高级 → 恢复「本站禁用」的网站」提示的文案。
- 抽出 `UI.applyCaptureMode(mode, statusMsg, statusKind)`：「申请共享授权」「停止共享」「画布被污染自动切换」三处重复的「写配置 → 落盘 → 刷新控件 → 刷新捕获提示」流程收成一个方法。
- 用户脚本元数据补全：`@author` 由新建脚本的模板占位符 `you` 改为实际作者，新增 `@license GPL-3.0-or-later`、`@homepageURL`、`@supportURL`，并按已公布给用户的安装地址补上 `@downloadURL` / `@updateURL`（用户脚本管理器可据此自动检查更新）；脚本头部注释补充 GPL-3.0 授权声明。

### 修复
- 修复「最近识别」历史记录里只有原文、没有译文：原写法是 `setHTML(div, '<原文那段>') + '<译文那段>'`，译文那段被拼接到 `setHTML()` 的返回值（undefined）上直接丢弃；现在两段 HTML 一起交给 `setHTML()` 渲染。（该问题自 1.6.1 把 innerHTML 改写成 setHTML 时引入。）
- `UI.destroy()` 现在会摘掉面板拖动挂在 `document` 上的 `mousemove` / `mouseup` 监听并复位拖动状态，避免反复销毁再挂载时监听器越攒越多（旧闭包一直挂在 document 上）。

### 性能
- 截图输出画布复用（`Capturer._out` / `_outCtx`）：原来每截一帧都新建 canvas + 2d context + 整块像素后备存储（1400×116 约 650KB）；现在只在尺寸变化时才重建并重新设置 imageSmoothing，其余情况复用同一个画布。所有调用方都是「拿到立刻用掉」，不跨周期持有。
- 边缘密度扫描改用两行滚动缓冲（模块级 `EDGE_ROWS`）：不再每次调用分配一块 160×48 的 Float32Array（约 30KB）并整块扫描，结果与旧实现逐位相同。
- 文本相似度的编辑距离复用模块级 Int32Array 滚动行（按需扩容），不再每次 `new` 两个普通数组；同时把较短的一边作为列数（滚动行更短、缓存更友好）、用 `charCodeAt` 代替逐字符取字符串、手写比较取代三次 `Math.min` 调用；超长输入的上限判断随之简化为直接返回 0（两边相等的情况已在前面提前返回，语义不变）。
- 解算截图区域时不再重复读一次布局：`Pipeline.step()` 刚算出的视频内容框直接作为 `knownBox` 传给 `resolveRegion()`，省掉一次 `getBoundingClientRect` + `getComputedStyle` 造成的强制重排。
- `findVideo()` 改为直接按下标遍历 NodeList，不再先 `Array.from` 生成一份中间数组（该函数每个截图周期都会调用一次）。

## [1.10.0] - 2026-09-12

### 新增
- 框选完成后立刻出图：密钥已配好时直接走一次完整识别（`UI.manualShot()`），不用等点「开始」就能发现框歪了；没配密钥时只重新截一张预览，不触发 401 报错。视频暂停时也能截，适合「暂停着慢慢框」的用法。
- 新增 `RegionSelector.refreshPreview()`：按当前 `CFG.region` 重新截一张图刷新面板预览，供框选完成、Esc 取消、窗口失焦取消三处调用。

### 修复
- 修复框选完成后预览显示旧画面：重截预览的代码原先放在 `cleanup()` 里，而 `cleanup()` 是在设置新区域**之前**执行的，截到的还是上一次的区域；现已从 `cleanup()` 移除，改由 `onUp()` 在新区域写好后调用 `refreshPreview()`。

## [1.9.1] - 2026-09-12

### 新增
- 框选过程中实时预览：拖动选区时把当前框住的这块截出来喂给面板预览（用 requestAnimationFrame 合并，宽度 <20 或高度 <8 时跳过，截不到时静默跳过），否则预览里始终是上一次框的区域。
- 开始框选时先把预览区露出来：首次框选时 `CFG.region` 还是空的，`syncRegion()` 会把整个预览藏掉，用户无从对照。

### 修复
- 修复框选遮罩把整个面板一起压暗：遮罩 z-index 由 2147483600 降到 2147483400，低于面板（2147483500），框选期间面板与预览区保持清晰可读（遮罩仍高于字幕层 2147483000，字幕层跟着一起变暗）。
- `Pipeline.stop()` 现在同时清掉悬浮字幕并重置 `lastOriginal` / `lastTranslation` / `emptyStreak`：停止后不再残留最后一句（容易被误认为还在翻译），重新开始后第一句若与停之前那句相同也不会被当成重复句吞掉。
- 框选结束（含取消）后按实际区域重截一张预览并同步预览区显隐，不再残留拖到一半的画面。

## [1.9.0] - 2026-09-12

### 新增
- 全屏适配：新增 `Fullscreen` 模块，监听 `fullscreenchange` / `webkitfullscreenchange`，把面板、字幕层、右下角小胶囊搬进全屏元素（全屏元素是播放器容器的站点，如 YouTube、B 站），退出全屏再搬回 body。
- 针对「全屏元素就是 `<video>` 本身」的情况改用原生字幕轨显示译文：`<video>` 是替换元素，塞进去的子节点不参与渲染，因此改为用 `VTTCue` 让浏览器把译文画在视频画面内；全程复用同一条 cue（只改文字与起止时间），避免播一小时堆出几千条 cue。
- 新增 `uiHost()` 统一决定面板 / 字幕层 / 胶囊挂在哪个元素下（全屏元素可挂则挂进去，`<video>` 与 iframe 除外）。

### 变更
- 全屏时状态栏分别提示「已进入全屏：字幕层已跟随」与「已进入全屏：<video> 直接全屏，改用系统字幕轨显示」。
- 原生字幕轨不依赖 `removeTextTrack` 清理（实测本机 Chrome 未实现该 API，`typeof video.removeTextTrack === 'undefined'`），改为复用同一条轨、不用时置 `mode = 'disabled'`，否则每进一次全屏就多挂一条轨。
- 诊断导出新增 `Fullscreen` 与 `uiHost`。

### 修复
- 修复「一全屏字幕就没了」：浏览器进全屏时只渲染全屏元素及其子树，挂在 body 上的面板与字幕层会被整个隐藏，现在会把它们搬进全屏子树。
- 退出全屏（以及销毁面板）时收掉原生字幕轨，避免字幕一直挂在视频上。

## [1.8.0] - 2026-09-12

### 新增
- 新增统一的弹窗骨架 `openModal()`：诊断模式、导出配置、导入配置三个弹窗不再各自抄一份遮罩层、标题栏与关闭按钮的 HTML 与样式。
- 面板骨架 `panelHTML()` 与样式表 `panelCSS()` 从 `mount()` 中抽出（只放结构与样式，不放行为）。
- 翻译缓存改为 LRU：新增 `cacheGet()`，命中后把该条删掉再塞回，等于移到队尾，淘汰时丢的永远是最久没用过的那条；`cachePut()` 对已存在的键也先摘掉。原来是纯先进先出，一句反复出现的台词只要中间插进 500 条新字幕就会被挤掉、重新花钱翻一遍。

### 变更
- `Pipeline.step()` 拆分为 `ensureReady` / `grabFrame` / `handleTainted` / `shouldSkipFrame` / `recognize` / `present`，主流程只保留「找视频 → 截图 → 判断是否跳过 → 调引擎 → 显示」，各分支的返回时机由方法名即可读出。
- `UI.bind()` 按面板分区拆成 `bindPanelChrome` / `bindProfiles` / `bindUmi` / `bindConfigInputs` / `bindPresets` / `bindCaptureControls` / `bindConfigIO` / `bindTools` / `bindViewport`，并抽出 `onChangeEffects(key)` 统一处理「某个配置项变化后界面 / 缓存要跟着做什么」。
- `Capturer` 抽出 `crop(src, sx, sy, sw, sh)`：直接读 `<video>` 与读标签页共享流两条路径共用同一份「裁切 + 适度放大」算法（封顶 3 倍、宽 1400）。
- `textSimilarity()` 先判断两边完全相同就直接返回 1（两边同为空串也走这条），不再跑一遍 O(m×n) 动态规划。
- `escapeHtml()` 改为单次扫描替换（`HTML_ESCAPES` 映射表），不再用 4 个链式 `replace` 扫 4 遍、产生 3 个中间字符串；该函数每次渲染字幕都会调用。
- `RegionSelector` 抽出 `createOverlay()`（遮罩 / 选区框 / 顶部提示条的纯构造部分）。
- 诊断导出新增 `escapeHtml`、`hexToRgb`、`openModal`、`cacheGet`、`cachePut`、`panelHTML`、`panelCSS`。

### 修复
- `bindInput` / `bindRange` 增加控件存在性判断，面板上某个控件缺失时不再中断整段绑定流程。

## [1.7.1] - 2026-09-12

### 修复
- 修复「框选功能用不了」：`window` 的 blur 监听从捕获阶段改回冒泡阶段。blur 自身不冒泡，但捕获阶段是从 window 一路向下走的，页面上任何元素失焦都会被这个监听抓到（真实场景：点完面板上的「① 框选字幕区」按钮后移到视频上按下左键，焦点离开按钮），于是框选还没开始就被 cleanup 掉。
- 修正 `removeEventListener` 的标志位与 `addEventListener` 不一致导致旧监听摘不掉的问题（上一轮的 onBlur 会拿着已删除的遮罩再去 cleanup，反而搅乱本轮状态），并把回调改成提前 return 的写法。

## [1.7.0] - 2026-09-12

### 新增
- 区域锚定：框选用 `anchorRegion()` 一并记下当时的视频内容框，之后由 `resolveRegion()` 按比例换算到当前视口，页面滚动、切全屏、换集、刷新后播放器位置不同都不会让区域与画面错位（不锚定是静默出错：截到错误像素、照样扣 API 费用）；老配置没有锚点时按绝对坐标用，保持旧行为。
- 新增 `sanitizeCfg()` 配置校验：引擎名白名单（openai-vision / umi-ocr / youdao-img）、数值区间（fontSize 12~48、bgOpacity 0~1、offsetY ±200、interval 300~60000、textSimThreshold 0~0.8）、textColor 颜色格式、region 坐标合法性、apiProfiles / disabledHosts / regionsByHost 类型；加载配置与导入配置都要过这一道。
- 新增 `saveCfgKeys(cfg, keys)`：只写指定的几个键。
- `Pipeline` 新增世代计数 `gen` 与 `invalidate()`：用户点停止、重选区域、SPA 跳页之后，还在飞的识别结果一律丢弃，不再把过期字幕画上去。
- 复用离屏画布：thumbnail 与 edgeDensity 用的两块画布（`THUMB_BUF` / `EDGE_BUF`）由 `scratch()` 长期持有并复用，不再每轮新建 canvas + 2d context + ImageData。

### 变更
- 目标区域与视频内容框重叠不足一半时 `grabFromElement()` 直接返回 null，状态栏提示「截不到画面 —— 区域可能已不在视频上，请重新框选」；避免坐标被 `Math.max(0, …)` 硬夹到边上后截出一块完全无关的画面（不报错、不返回 null，钱照扣）。
- 认出原文但没拿到译文（模型返回空、接口抽风）时保持上一句并提示「只认出原文、没拿到译文」：Overlay 渲染的是 `translation || original`，直接放行会把未翻译的外文原文当译文显示，状态还报「已翻译」。
- `Overlay` 拆出 `position()`，`reposition()` 只重算位置、不再重建 HTML：原来拖窗口边缘每帧都要重建一次 innerHTML 再读 `offsetWidth`（强制同步重排），而内容根本没变；`position()` 也改为按 `resolveRegion()` 重新锚定。
- 标签页捕获的授权流程加固：非安全上下文（http 页面）下 `navigator.mediaDevices` 为 undefined，现在直接报「当前页面不是 https，浏览器不允许截屏」，不再一律报「用户取消了授权」让用户反复重试；区分 `NotAllowedError`（用户拒绝）与参数不被支持（后者去掉扩展选项重试一次）；起播失败时关掉已拿到的流，避免留下「有流但没画面」的僵死状态让之后每次申请都被开头的 `if (this.displayStream) return` 挡掉；三者都成功后才落 `displayStream` / `displayVideo` / `mode` 状态。
- `Capturer.grab(region, video)` 接收调用方已查到的 video，避免同一轮里再查一遍。
- 翻译缓存的命中判断从真值判断改为 `cache.has()`：模型偶尔返回空内容，空字符串是 falsy，用 `if (hit)` 会导致这类缓存永远命中不了、同一句被反复送到付费接口重翻。
- 帧预览延后到「画面未变化」早退之后再绘制，并且面板收成胶囊 / 内容折叠 / 面板隐藏时不再绘制预览。
- 找不到视频时给出状态提示，并连续 30 轮（默认间隔下约 36 秒）仍找不到就自动停止，不再在没视频的页面上空转。
- SPA 路由跟踪改为只比较 `pathname + search`：站点播放过程中改 hash（章节 / 时间戳跳转）或查询串（埋点、无限滚动）不再导致字幕莫名其妙自己停掉；同时修正 `this._hrefTimer` 为 `UI._hrefTimer`（`mountUI` 是普通函数，这里的 this 是 undefined，原写法会抛掉整个挂载流程）。
- 切换目标语言 / 原文语言 / 模型 / API 地址 / 额外提示词 / 引擎后清空翻译缓存并重置上一句（最典型的是改了目标语言，同一句日文还一直出旧语种）。
- `UI.destroy()` 同时停止标签页共享（否则浏览器顶部一直显示「正在共享此标签页」、隐藏的 video 还在解码，而「停止共享」按钮已随面板消失），并清空 root / els、清掉 `_hrefTimer`、摘掉 resize 监听。
- `window` resize 触发的重新定位用 rAF 合并成每帧最多一次。
- 移除无用的 `history` 配置项（导出配置不再需要 delete 它）；导入配置不再逐键 `GM_setValue`，改为 sanitize 后统一 `saveCfg()`。
- 视觉模型判定新增 `VISION_MARKERS`（vision / -vl / vl- / 4v / multimodal）：修复 `moonshot-v1-8k-vision-preview` 这类以 `moonshot-v1-8k` 开头的视觉模型被前缀规则误判成纯文本、用户选了标着「视觉」的预设引擎却被自动切走的问题。
- `watchForVideo()` 的 MutationObserver 回调用 rAF 合并成每帧最多一次：DOM 每秒变动几十批时不再每批都调一次 `findVideo()`（要读 `getBoundingClientRect`，是强制同步重排）。
- `syncRegionForHost()` 不再无条件全量落盘：没有本站区域记录时直接跳过写盘（原来每打开一个页面都会把 30+ 个配置项整份重写一遍）。
- 诊断导出新增 `resolveRegion`、`anchorRegion`、`sanitizeCfg`、`ENGINES`。

### 修复
- 修复框选遮罩吞掉整页点击：遮罩改为 `pointer-events:none`、十字光标改挂在根元素上；mouseup 丢在窗口外（拖出浏览器 / alt-tab）时遮罩不会再把整页点击都吞掉。
- 新增窗口失焦兜底：拖到窗口外松手或 alt-tab 走开时取消框选并提示「框选已取消（窗口失去焦点）」。
- 重选区域后作废正在飞的那次识别（`Pipeline.invalidate()`）并重置上一句记录。

### 安全
- 修复导入配置未做类型校验导致的 HTML 注入：`fontSize` 是唯一被直接拼进 innerHTML 的配置值（`'<div style="font-size:' + CFG.fontSize + 'px">'`），粘贴一份构造过的 JSON 就能注入 HTML；现在导入后统一经过 `sanitizeCfg()` 再落盘。

## [1.6.1] - 2026-09-12

### 新增
- 新增 Trusted Types 兼容层：`TT_POLICY` + `setHTML()`，全脚本写 innerHTML 统一走这一个入口；策略名被占用时退回随机后缀名，站点不允许自建策略时退回普通赋值，不影响其他站点。

### 变更
- 诊断导出新增 `TT_POLICY` 与 `setHTML`。

### 修复
- 修复在启用 `require-trusted-types-for 'script'` CSP 的站点（YouTube、Gmail、Google 搜索等）上脚本完全失效：直接给 innerHTML 赋字符串会抛 TypeError，导致面板建不出来、字幕也渲染不出来，等于脚本没装。

## [1.6.0] - 2026-09-12

### 新增
- 多套 API 配置档案（`apiProfiles`）：面板新增「我的配置」下拉框与「💾 保存当前配置 / 删除」按钮，保存的是「API 地址 + Key + 模型 + 思考模式 + 最大 token」一整套，切换供应商不用再翻控制台找 Key。
- 保存配置时弹小窗问名字（默认名由 API 主机名首段与模型名拼出，地址没填全时用模型名兜底），同名直接覆盖，不会在列表里堆出重复项。
- 删除配置需要点两次确认（第一次按钮变成「再点一次删除」，4 秒后自动复位），避免误触丢掉保存的 Key。
- 「我的配置」下拉框会反映当前生效的配置：手动改了地址 / Key / 模型后回到占位项，表示「当前是未保存的改动」；应用平台预设后也会同步刷新选中状态。

### 变更
- 使用说明补充保存 / 一键切换配置的说明。
- 诊断导出新增 `renderProfiles`、`syncProfileSelection`、`upsertProfile`、`applyProfile`、`deleteProfile`、`saveProfile`。

## [1.5.1] - 2026-09-12

### 变更
- 使用说明补充：Umi-OCR 只负责把字幕认成文字、不做翻译，译文仍由上面的 API 出；因为它已经把字认好了，翻译只需要文本模型，比用视觉模型便宜得多。

### 修复
- 修复诊断模式、导出配置、导入配置三个弹窗的按钮在部分站点上看不清：这些弹窗挂在 body 上、不在 `#h1sub-panel` 内，`#h1sub-panel button` 那套样式作用不到它们，按钮会退化成站点自己的重置样式（很多站点是「透明背景 + 继承文字色」，变成浅灰字贴深灰底）；现在给弹窗容器加上 `h1sub-modal` 类并单独配一套按钮与关闭 × 的样式。

## [1.5.0] - 2026-09-12

### 新增
- 新增 umi-ocr 引擎：调用本机运行的 Umi-OCR 的 HTTP 接口（默认 `http://127.0.0.1:1224`）做识别（PaddleOCR），再把纯文本交给大模型翻译；面板相应新增「服务地址」「识别语言」「测试连接」，识别语言下拉覆盖日本語 / 简体中文 / 繁體中文 / English / 한국어 / Русский。
- 「测试连接」不只探测接口是否在线，还会真识别一张写着 `TEST 123` 的图确认引擎能出结果，并列出接口返回的可用语言。
- 连接失败时给出可操作的提示（确认 Umi-OCR 已启动、已在「全局设置 → 高级」打开 HTTP 服务、端口号是否一致）；Umi-OCR 的 `code=101`（无文字）按空结果处理。

### 变更
- 移除浏览器本地 OCR（Tesseract.js）整套实现：不再按需从 4 个 CDN 下载 Tesseract 内核与 10~20MB 语言包，也不再使用 `GM_addElement`（`@grant` 一并去掉）。
- 引擎下拉里的「本地 OCR + 文本模型（最省钱）」被「Umi-OCR 本地识别（识别率最高·零下载）」取代；`openai-text` 引擎、`ocrLang` 设置、面板上的「下载并检查本地 OCR」按钮及其状态提示删除，新增 `umiBase` / `umiLang` / `umiParser` 设置。
- 选中不支持图片的模型时，预设的自动切换目标由本地 OCR 改为 Umi-OCR。
- 抽出 `translateText()`（纯文本翻译，带缓存）：Umi-OCR 认出文字后只需调这一步，不再重复发图片。
- 诊断导出相应更新（去掉 `LocalOCR` / `translateByLocal` / `checkLocalOCR`，新增 `callUmiOCR`、`umiProbe`、`recognizeByUmi`、`UMI_LANGS`、`umiBase`、`testUmi`）。

## [1.4.0] - 2026-09-12

（这是现存最早的归档快照，没有更早的版本可供比对，因此本版没有可记录的变更条目。）

---

## 关于本文件的说明

1.4.0 之前的版本没有归档快照，无法比对，故未记录。
本文件由 `_backup/` 中归档的历史快照与当前版本逐一做 `git diff --no-index` 比对后重建，条目均以实际代码差异为依据。
