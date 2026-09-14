# 贡献指南

感谢你愿意为本项目做出贡献！本文档说明如何报告问题、提交代码，以及本项目遵循的规范。

---

## 目录

- [行为准则](#行为准则)
- [报告问题](#报告问题)
- [提出功能建议](#提出功能建议)
- [开发环境搭建](#开发环境搭建)
- [分支策略](#分支策略)
- [提交信息规范](#提交信息规范)
- [代码规范](#代码规范)
- [测试要求](#测试要求)
- [Pull Request 流程](#pull-request-流程)
- [文档要求](#文档要求)
- [版本发布流程](#版本发布流程)
- [许可证与贡献授权](#许可证与贡献授权)

---

## 行为准则

- 尊重所有参与者，对事不对人。
- 提供可复现的信息，避免"我这边不行"这类无法定位的反馈。
- 不接受用于绕过付费、破解内容或侵犯著作权用途的贡献。

---

## 报告问题

请使用 [Bug 报告模板](https://github.com/1105532539/video-hardsub-translator/issues/new?template=bug_report.yml)。

### 请务必附上诊断报告

面板 → 「**诊断**」 → 「**复制报告**」，把生成的纯文本一并贴出。报告包含：

- 脚本版本、页面 URL
- 视频元素几何、`videoWidth/Height`、`object-fit`、推算出的画面区
- 当前截图后端、是否触发过画布污染
- 框选区域及其在**视频像素坐标系**下的位置
- 最近识别历史与最后一次错误（含栈顶）

这些信息能极大加快定位速度。报告**不包含你的 API Key**。

### ⚠️ 请勿粘贴敏感信息

提交 Issue / PR / 截图前，请确认已移除：

- API Key、appSecret（面板里的 Key 输入框打码后再截图）
- 导出的配置文件（**导出内容包含 API Key**）
- 任何个人身份信息

若不确定，可先把 Key 换成占位符。

### 高效的问题描述

```markdown
## 环境
- 浏览器 / 版本：
- 用户脚本管理器 / 版本：
- 脚本版本：（见面板底部或诊断报告）
- 引擎：openai-vision / umi-ocr / youdao-img
- 模型：（如 deepseek-flash）

## 复现步骤
1. 打开 …
2. 框选 …
3. 点开始 …

## 期望行为

## 实际行为
（贴状态栏提示 / 控制台报错 / 诊断报告）

## 已尝试
```

---

## 提出功能建议

请使用 [功能建议模板](https://github.com/1105532539/video-hardsub-translator/issues/new?template=feature_request.yml)。

建议描述清楚**使用场景**与**当前的不便**，而不只是"希望支持 X"。若与现有设计目标冲突（例如"内置离线 OCR 模型"会违背"零模型下载"），请一并说明取舍建议。

---

## 开发环境搭建

```bash
git clone https://github.com/1105532539/video-hardsub-translator.git
cd video-hardsub-translator
```

源码按功能组件分在 `src/` 下，**根目录的 `video-hardsub-translator.user.js` 是构建产物**
（用户脚本必须单文件才能即装即用，所以源码分模块、产物拼接成一个文件）：

```bash
npm run build          # 把 src/ 按编号顺序拼成根目录的 .user.js
npm run build:check    # 只校验产物是否与 src/ 一致（提交前 / CI 用）
npm run lint           # 构建 + 语法检查
```

构建脚本 `_build/build.mjs` **零依赖**（只用 Node 内置模块），不做重命名、转译或压缩，
只是把模块按顺序连起来，并核对每个模块头的「对外提供 / 依赖」声明。

> ⚠️ **不要直接编辑根目录的 `.user.js`**：它是产物，会被下次构建覆盖。
> 请改 `src/` 里对应的模块 —— 模块分工与编号顺序见
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#模块地图)。

### 本地调试的三种方式

| 方式 | 操作 |
| --- | --- |
| **Tampermonkey 开发模式** | 新建脚本 → 粘贴源码 → 保存；改完重新粘贴或使用"编辑"窗口 |
| **本地文件实时加载** | 在管理器里新建脚本，内容为 `// @require file:///D:/deepseek/video-hardsub-translator.user.js`（部分管理器支持） |
| **无头自动化调试** | 直接跑测试套件（见下），这是排查交互问题最快的方式 |

### 运行测试

需要 Node.js ≥ 22 与本机 Chrome：

```bash
npm test                 # 全部 9 个套件（串行）
node _test/smoke-panel.mjs   # 只跑某一个
node _test/shots.mjs         # 生成面板截图便于目视检查
```

详细说明见 [`docs/TESTING.md`](docs/TESTING.md)。

---

## 分支策略

| 分支 | 用途 | 保护 |
| --- | --- | --- |
| **`main`** | 稳定分支。始终保持**可发布 + 全部测试通过**的状态 | 只接受通过 PR 的合并，禁止直接推送 |
| `feat/<简短描述>` | 新功能 | — |
| `fix/<简短描述>` | 缺陷修复 | — |
| `perf/<简短描述>` | 性能优化 | — |
| `refactor/<简短描述>` | 重构（**不改变外部行为**） | — |
| `docs/<简短描述>` | 文档 | — |
| `chore/<简短描述>` | 杂项（工具、注释、格式） | — |

示例：`feat/azure-vision-engine`、`fix/tainted-canvas-retry`、`perf/reuse-crop-canvas`

### 为什么不用 Git Flow

本项目是单人维护的小型用户脚本，引入 `develop` / `release` / `hotfix` 等长期分支只会带来合并负担而没有收益。采用**主干开发（trunk-based）**：

- `main` 永远可发布；
- 功能分支生命周期尽可能短（通常几天内合并）；
- **发布用 Git tag 标记**（`v1.11.0`），而不是开长期发布分支；
- 合并方式统一为 **Squash merge**，让 `main` 的历史保持"一个 PR 一条提交"的线性可读状态。

### 版本标签

```bash
git tag -a v1.11.0 -m "v1.11.0"
git push origin v1.11.0
```

---

## 提交信息规范

采用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
<type>(<scope>): <简短描述>

[可选的详细说明]

[可选的关联 Issue]
```

### 允许的 type

| type | 用途 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `perf` | 性能优化 |
| `refactor` | 重构（不改变行为） |
| `docs` | 文档 |
| `test` | 测试 |
| `chore` | 杂项 |

### 常用 scope

`engine`（引擎/翻译）、`capture`（截图）、`pipeline`（主循环）、`overlay`（字幕层）、`ui`（面板）、`config`（配置）、`diag`（诊断）、`test`、`readme`、`docs`

### 示例

```
feat(engine): 支持自定义引擎适配器
fix(capture): 修复跨域视频切换 display 模式后状态未复位
perf(pipeline): 复用截图画布，grab 单次耗时下降 46%
refactor(ui): 抽出 applyCaptureMode 消除三处重复流程
docs(readme): 补充有道签名计算示例
test(engine): 增加思考模式参数的断言
chore: 集中热路径常量定义
```

### 描述要求

- 用**动词开头**、说明**做了什么**，不要写"更新代码"这种无信息量的描述。
- 破坏性变更请在正文中以 `BREAKING CHANGE:` 开头说明影响与迁移方式。

---

## 代码规范

本项目刻意保持"产物单文件、零第三方依赖、零转译"，因此规范的核心是**可读性与可审计性**。
源码分模块存放，但构建只是**纯文本拼接**——产物与源码逐行等价，任何人都能直接读懂。

### 基本约定

| 项目 | 约定 |
| --- | --- |
| 缩进 | 4 个空格（与现有代码一致） |
| 引号 | 单引号 |
| 分号 | 必须写 |
| 声明 | 只用 `const` / `let`，禁止 `var` |
| 严格模式 | IIFE 内 `'use strict'` |
| 模块对象 | `PascalCase`（`Pipeline` / `Capturer` / `Overlay`） |
| 常量 | `UPPER_SNAKE_CASE`（`CACHE_MAX` / `EDGE_MIN`） |
| 函数/变量 | `camelCase` |
| DOM id | `h1sub-` 前缀（面板内元素） |
| 存储键 | `h1sub.` 前缀（`NS` 常量） |

### 注释规范（本项目最重要的一条）

**注释解释"为什么"，而不是"做了什么"。** 代码本身已经说明做了什么；注释的价值在于记录**当时的取舍、约束与踩过的坑**。

```js
// ❌ 无价值：重复代码语义
// 遍历所有 video 元素
for (let i = 0; i < vids.length; i++) {

// ✅ 有价值：解释约束与后果
// 过滤掉广告/预览用的超小视频：不这么做的话，页面上任意一个小预览
// 都可能被当成主播放器，导致框选的区域完全对不上
```

保留**历史踩坑记录**同样重要。例如区域框选器里关于 `blur` 不能用捕获阶段的注释，直接避免了后人"顺手优化"成捕获阶段再踩一次同样的坑。修改这类代码前请先读懂注释。

### 结构约定

- 源码按功能组件分成 `src/` 下的多个模块，**文件名前缀的两位数字就是拼接顺序**（后文可依赖前文）。新代码请放进职责相符的模块；确实需要新模块时，用未占用的编号新建文件，并在模块头写明「对外提供」与「依赖」——构建脚本会核对这两行。
- **顶层名字必须全局唯一**：所有模块共享同一个 IIFE 作用域，重名会互相覆盖（构建脚本会拦下来）。
- **跨模块调用只写在函数体内**，不要在模块顶层初始化时使用别的模块的东西 —— 这条规则保证拼接顺序只需要满足"声明在前"。
- 复杂函数请拆分成"名字能说明返回值语义"的小方法。参考 `Pipeline.step()`：主体只有 6 行，细节分散到 `ensureReady` / `grabFrame` / `shouldSkipFrame` / `recognize` / `present`。
- 每个非平凡函数写 JSDoc，至少标明 `@param` / `@returns` 与失败时的返回语义。
- 用户可见的文案、状态栏提示**保持中文且具体**：说清"发生了什么 + 该怎么办"，不要只写"出错了"。

### 硬性约束

| 约束 | 原因 |
| --- | --- |
| **不引入第三方运行时依赖** | 用户脚本必须单文件即装即用，且便于审计 |
| **不引入第三方构建依赖** | 构建只能是零依赖的纯文本拼接（`_build/build.mjs`），不得引入打包器 / 转译器 |
| **不直接改根目录产物** | 它是 `src/` 拼接出来的，改动会被覆盖；改 `src/` 再 `npm run build` |
| **不新增浏览器端模型下载** | 项目的核心设计目标之一 |
| **保持行为向后兼容** | 老用户的已有配置必须继续可用（旧配置由 `sanitizeCfg()` 兼容） |
| **所有 `innerHTML` 走 `setHTML()`** | 兼容启用 Trusted Types 的站点 |
| **所有用户数据 / 模型输出经 `escapeHtml()`** | 防注入 |
| **新增配置项必须同步 `DEFAULTS` 与 `sanitizeCfg`** | 否则导入/加载时会被丢弃或注入非法值 |
| **新增引擎必须加入 `ENGINES` 白名单** | 否则 `<select>` 会显示空白而运行时行为不一致 |

### 性能相关改动

- 热路径（每帧执行的代码）中**避免新增分配**：优先复用缓冲、类型化数组与离屏画布。
- 修改热路径前先跑 `bench.mjs` 取基线，改完用 `bench-ab.mjs` 对比。
- 优化**不得改变行为**——如果为了性能需要改变行为，请拆成独立的提交并说明理由。

---

## 测试要求

### 提交 PR 前必须全部通过

```bash
npm run build:check          # 产物是否与 src/ 一致（改了 src/ 却忘了构建，这里会失败）
npm run lint                 # 构建 + node --check 语法检查

npm test                     # 全部 8 个套件（会自动先跑一次 npm run build）

node _test/engine.mjs        # 期望 50/50
node _test/browser-ai.mjs    # 期望 94/94
node _test/web-translate.mjs # 期望 44/44
node _test/opt.mjs           # 期望 76/76
node _test/allsite.mjs       # 期望 37/37
node _test/smoke-panel.mjs   # 期望 79/79
node _test/layout.mjs        # 期望 33/33
node _test/fullscreen.mjs    # 期望 31/31
```

**523 项必须全部通过，且退出码为 0。**

### 新功能 / 修 Bug 必须带测试

| 改动类型 | 测试要求 |
| --- | --- |
| 修 Bug | 新增断言必须能**证明"撤销修复就会失败"**，否则测试可能在空转 |
| 新功能 | 覆盖主路径 + 至少一个失败路径 |
| 性能优化 | 附 `bench-ab.mjs` 前后对比数据；功能测试必须全绿 |
| 重构 | 不新增测试，但必须证明行为未变（全部既有测试通过） |
| 纯文档 | 无需测试 |

### 写测试的注意事项

- 用 `GM_xmlhttpRequest` **桩**拦截网络，禁止依赖真实 API 与真实 Key。
- 每个套件使用**独立端口**（避免冲突），路径一律通过 `_test/paths.mjs` 解析，**不要写绝对路径**。
- 每个套件都要有「页面无 JS 异常」断言——它能抓到断言没覆盖到的隐蔽报错。
- 详细写法见 [`docs/TESTING.md`](docs/TESTING.md)。

---

## Pull Request 流程

1. **先开 Issue 讨论**（较大改动或行为变更）。小修复可以直接提 PR。
2. 从最新的 `main` 切出功能分支：
   ```bash
   git checkout main && git pull
   git checkout -b fix/tainted-canvas-retry
   ```
3. 按[代码规范](#代码规范)实现，同步更新测试与文档。
4. 本地跑通全部测试。
5. 提交并推送，向 `main` 发起 PR。

### PR 描述清单

```markdown
## 改动内容
（做了什么，为什么）

## 关联 Issue
Closes #123

## 测试
- [ ] node --check 通过
- [ ] 9 个测试套件全部通过（523/523）
- [ ] 新增/修改的测试能证明修复有效

## 行为影响
- [ ] 不改变既有行为（重构/性能）
- [ ] 改变了行为 → 已说明原因与迁移方式

## 文档
- [ ] 已更新 README / docs（如涉及配置项、接口、使用方式）
- [ ] 已更新 CHANGELOG.md
```

### 审查标准

PR 会被从以下角度审查：

- **正确性**：边界情况（无视频、暂停、跨域、全屏、SPA 跳页）是否都考虑到了？
- **行为兼容**：老配置、老用法是否仍然可用？
- **性能**：热路径是否引入了新的分配或强制重排？
- **可读性**：注释是否解释了"为什么"？函数是否过长？
- **约束**：是否引入了第三方依赖、第三方构建依赖或模型下载？是否误改了根目录产物？
- **测试**：断言是否真的能失败（而不是恒真）？

---

## 文档要求

| 改动 | 需要更新 |
| --- | --- |
| 新增/修改配置项 | `README.md` 配置项参考表；必要时 `DEFAULTS` 注释 |
| 新增引擎 / 第三方接口 | `README.md` 引擎对比；`docs/API.md` |
| 改变使用流程 | `README.md` 使用说明 |
| 改变架构 / 模块职责 | `docs/ARCHITECTURE.md` |
| 新增 / 拆分 / 合并 `src/` 模块 | 模块头的「对外提供 / 依赖」；`docs/ARCHITECTURE.md` 的目录树与模块地图；`README.md` 的源码结构表 |
| 任何用户可见改动 | `CHANGELOG.md`（遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)） |

### README 截图

截图由脚本自动生成，不要手工截图上传：

```bash
node _test/shots.mjs     # 输出到 _test/shots/
```

---

## 版本发布流程

1. 确认 `main` 上全部测试通过（`npm test`，应 523 项全部通过）。
2. 更新**四处**版本号（必须全部一致——只改前两处会导致包版本与 README 徽章和脚本版本脱节）：
   - 用户脚本头部元数据 `// @version      <新版本号>`
   - 脚本内 `const SCRIPT_VERSION = '<新版本号>';`
   - `package.json` 的 `version`
   - `README.md` 顶部的 version 徽章
3. 更新 `CHANGELOG.md`，把 `[未发布]` 改为具体版本与日期。
4. 提交并打标签：
   ```bash
   git commit -am "chore(release): v<新版本号>"
   git tag -a v<新版本号> -m "v<新版本号>"
   git push origin main --tags
   ```
5. 在 GitHub 上创建 Release，附上 CHANGELOG 对应段落，并上传 `video-hardsub-translator.user.js` 作为附件（方便用户直接下载安装）。
6. 同步到 Greasy Fork（见下节）。

版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)：

- **主版本**：破坏性变更（旧配置无法继续使用）
- **次版本**：向后兼容的新功能
- **修订号**：向后兼容的缺陷修复

> 即使只改了文档或元数据，也**同样要递增修订号**：Greasy Fork 检测到代码变化而 `@version` 未变时会发出警告，用户脚本管理器也不会向已安装用户推送更新。

---

## 发布到 Greasy Fork

可直接粘贴的发布正文维护在 [`docs/greasyfork-listing.md`](docs/greasyfork-listing.md)。

### 当前状态

脚本已发布：**<https://greasyfork.org/zh-CN/scripts/595525>**（脚本 ID `595525`）。

首次发布是**手工粘贴**完成的——Greasy Fork 没有开放写入 API（官方只提供只读 JSON API），发布只能在浏览器里操作。因此它目前**还没有**和仓库建立同步关系，下面两种更新方式需要二选一。

### 更新方式 A：手工粘贴（立即可用）

脚本管理页 → 「更新」→ 粘贴新版 `video-hardsub-translator.user.js` 全文 → 提交。

### 更新方式 B：脚本同步（推荐，配好后一劳永逸）

脚本管理页 → 管理（Admin）→ **脚本同步（Script sync）**，源地址填：

```
https://raw.githubusercontent.com/1105532539/video-hardsub-translator/main/video-hardsub-translator.user.js
```

可选：在 GitHub 仓库添加 Webhook，让 push / release 立即触发同步（Greasy Fork 支持 GitHub 的 push 与 release 通知；webhook 地址需登录后在 Greasy Fork 的 webhook 信息页领取）。在第一次 webhook 生效之前，脚本的同步类型会显示为 Automatic 或 Manual。

### 注意事项

- **`@version` 必须先递增**，否则同步会因「代码变了但版本没变」告警。
- **`@namespace` 不要再改**。Greasy Fork 在更新时若发现该字段变化会警告，用户脚本管理器也据此判定「是否已安装」。它现已固定为仓库地址。
- **不要删 `@downloadURL` / `@updateURL`**。Greasy Fork 会自动把它们改写为指向自己的地址：GitHub 版从 GitHub 更新、Greasy Fork 版从 Greasy Fork 更新，互不干扰。
- **发布正文里不要引导用户改用 GitHub 安装**——Greasy Fork 规则明确禁止引导用户使用其它下载源。把仓库作为「代码仓库 / 问题反馈」链接是允许的。
- 描述必须与实际功能一致：**要写明脚本会把框选区域的截图发送给用户自行配置的第三方 API**。
- 本脚本**不需要 `@antifeature`**：没有广告、追踪、挖矿、会员或返利链接；`payment` 类型针对的是「要求用户向脚本作者付费」，而本脚本的付费对象是第三方 API 供应商，且 Umi-OCR 引擎完全本地免费。

---

## 许可证与贡献授权

本项目采用 **GPL-3.0** 许可证。提交贡献即表示你同意：

- 你的贡献以 **GPL-3.0** 授权（inbound = outbound）；
- 你有权提交该代码（若来自其它项目，请确认其许可证与 GPL-3.0 兼容，并在 PR 中说明来源）；
- 你的贡献不包含任何第三方专有代码。

---

## 相关文档

- [项目说明](README.md)
- [架构与模块职责](docs/ARCHITECTURE.md)
- [接口文档](docs/API.md)
- [测试与性能基准](docs/TESTING.md)
