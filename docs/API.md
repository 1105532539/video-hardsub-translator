# 接口文档

> 本文档分三部分：脚本**对外调用**的第三方 API、脚本**对外暴露**的内部 JS API，
> 以及贯穿全局的数据结构。以 `video-hardsub-translator.user.js` v1.12.0 为准。

---

## 目录

- [一、第三方 API](#一第三方-api)
  - [1.1 OpenAI 兼容对话接口（openai-vision）](#11-openai-兼容对话接口openai-vision)
  - [1.2 Umi-OCR HTTP 接口（umi-ocr）](#12-umi-ocr-http-接口umi-ocr)
  - [1.3 有道图片翻译（youdao-img）](#13-有道图片翻译youdao-img)
  - [1.4 浏览器内置 AI（browser-ai）](#14-浏览器内置-aibrowser-ai)
  - [1.5 免费网页接口（web-translate）](#15-免费网页接口web-translate)
- [二、内部 JS API（window.\_\_H1SUB\_\_）](#二内部-js-apiwindow__h1sub__)
- [三、数据结构](#三数据结构)
- [四、GM 存储键](#四gm-存储键)
- [五、油猴菜单命令](#五油猴菜单命令)

---

## 一、第三方 API

> 「浏览器内置 AI（`browser-ai`）」引擎不调用任何第三方接口，见 [1.4](#14-浏览器内置-aibrowser-ai)；
> 「免费网页接口（`web-translate`）」调用的是各家内部接口，见 [1.5](#15-免费网页接口web-translate)。

### 1.1 OpenAI 兼容对话接口（openai-vision）

#### 端点构造

```js
function apiUrl() {
    let base = (CFG.apiBase || '').trim().replace(/\/+$/, '');   // 去掉结尾斜杠
    if (!/\/chat\/completions$/.test(base)) base += '/chat/completions';
    return base;
}
```

| 你填的 `apiBase` | 实际请求地址 |
| --- | --- |
| `https://api.deepseek.com` | `https://api.deepseek.com/chat/completions` |
| `https://api.openai.com/v1` | `https://api.openai.com/v1/chat/completions` |
| `https://api.openai.com/v1/chat/completions` | 保持不变（已带后缀） |

#### 请求头

```
Content-Type: application/json
Authorization: Bearer <CFG.apiKey>        // 仅当 apiKey 非空时携带
```

> 请求通过 `GM_xmlhttpRequest` 发出，因此**不受页面 CORS 限制**，也不需要你自建代理。

#### 请求体

```jsonc
{
  "model": "deepseek-flash",
  "messages": [ /* … */ ],
  "max_tokens": 1024,
  "temperature": 0.2,                        // ← 与 thinking 二选一
  "thinking": { "type": "disabled" }         // ← 仅 when shouldDisableThinking() === true
}
```

**关键规则：`temperature` 与 `thinking` 互斥。** 思考模式不支持 `temperature`，发送了也会被忽略，因此脚本在禁用思考时**不发送** `temperature`：

```js
function shouldDisableThinking() {
    const mode = CFG.thinkingMode || 'auto';
    if (mode === 'on') return false;
    if (mode === 'off') return true;
    return (CFG.apiBase || '').toLowerCase().indexOf('deepseek') >= 0;   // auto
}
```

| `thinkingMode` | 效果 |
| --- | --- |
| `auto`（默认） | 仅当 `apiBase` 包含 `deepseek` 时附加 `thinking` |
| `off` | 总是附加 |
| `on` | 从不附加（跟随平台默认） |

#### 视觉消息格式

```jsonc
{
  "role": "user",
  "content": [
    { "type": "text", "text": "请识别并翻译这张字幕图片。" },
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,/9j/4AAQ…" } }
  ]
}
```

> ⚠️ **图片必须放在 `user` 消息内。** DeepSeek 明确不接受 `system` / `assistant` 消息中的图片（会返回 400）。

用于视觉引擎的系统提示词要求模型**只输出一个 JSON 对象**：

```json
{"original":"识别到的原文（如果没有文字则为空字符串）","translation":"译文（如果没有文字则为空字符串）"}
```

脚本用 `parseModelJson()` 容错解析（允许 ```json 代码块包裹、前后有解释文字）。解析失败时降级为「把整段文本当译文、原文留空」。

#### 响应解析

按优先级兼容三种形态（`extractContent`）：

| 形态 | 处理 |
| --- | --- |
| `choices[0].message.content` 是字符串 | 直接使用（`trim()` 后非空） |
| `content` 是内容块数组 | 提取每块的 `text` / `content` 字段并拼接 |
| `content` 为空、有 `reasoning_content` | **抛错**：思考模式吃光了输出预算 |

`finish_reason === 'length'` 也会抛出专门的错误提示（同样指向思考模式）。

#### 错误映射

| HTTP | 脚本追加的提示 |
| --- | --- |
| 401 | API Key 不对或没填 |
| 402 | 账户余额不足 |
| 404 | API 地址或模型名不对 |
| 429 | 请求太频繁或额度用尽，试试调大截图间隔 |
| 400 且响应含 `model` | 模型名可能写错了 |

原始错误信息优先取 `error.message`，其次 `message`，再退化为响应前 200 字符。

#### 内置平台预设

| 预设 | `apiBase` | `model` | 备注 |
| --- | --- | --- | --- |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | 国内需代理 |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max` | — |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4v-plus` | — |
| 月之暗面 Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k-vision-preview` | — |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | 国内需代理 |
| OpenRouter | `https://openrouter.ai/api/v1` | `google/gemini-2.5-flash` | — |
| DeepSeek（推荐） | `https://api.deepseek.com` | `deepseek-flash` | 支持图片输入 |
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-pro` | ⚠️ **不支持图片**，选它会自动切到 Umi-OCR 引擎 |

#### 模型能力判定

```js
const DS_VISION_MODELS = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'];
const VISION_MARKERS  = ['vision', '-vl', 'vl-', '4v', 'multimodal'];
const NO_VISION_MODELS = ['deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner',
                          'gpt-3.5-turbo', 'moonshot-v1-8k', 'qwen-max', 'glm-4-plus'];
```

`isNoVisionModel(name)` 的判定顺序：

1. 在 `DS_VISION_MODELS` 中 → **能**看图
2. 名字含任一 `VISION_MARKERS` → **能**看图
3. 精确命中 `NO_VISION_MODELS`，或以 `模型名 + '-'` 开头 → **不能**看图
4. 其余 → 视为能看图（不拦未知模型）

> 第 2 步不可省略：`moonshot-v1-8k-vision-preview` 以 `moonshot-v1-8k` 开头，没有这一步就会被前缀规则误判成纯文本模型——用户选了标着"视觉"的预设，引擎却被自动切走。

此外 `isStaleDeepSeekModel(name)` 用于识别"看着像 DeepSeek 但不是能用图的那些名字"，提示改用 `deepseek-flash`。

#### 调用示例

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{
    "model": "deepseek-flash",
    "max_tokens": 1024,
    "thinking": { "type": "disabled" },
    "messages": [
      { "role": "system", "content": "你是一个视频硬字幕识别与翻译引擎。严格只输出一个 JSON 对象 {\"original\":\"…\",\"translation\":\"…\"}" },
      { "role": "user", "content": [
          { "type": "text", "text": "请识别并翻译这张字幕图片。" },
          { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,…" } }
      ]}
    ]
  }'
```

---

### 1.2 Umi-OCR HTTP 接口（umi-ocr）

需要在**本机**运行 [Umi-OCR](https://github.com/hiroi-sora/Umi-OCR)，并在「全局设置 → 高级」中开启 HTTP 服务（默认端口 `1224`）。

`umiBase()` 会去掉配置地址结尾的斜杠。

#### POST `/api/ocr` —— 识别一张图

**请求体**

```jsonc
{
  "base64": "…",                              // 纯 base64，不带 data:image/...;base64, 前缀
  "options": {
    "ocr.language": "models/config_japan.txt", // 识别语言（见下表）
    "tbpu.parser": "single_none",              // 排版解析：单栏-无换行（字幕是单行，禁止自动断行）
    "data.format": "text"                      // 返回纯文本
  }
}
```

**响应**

```jsonc
{ "code": 100, "data": "おはようございます", "time": 0.12 }
```

| `code` | 含义 | 脚本处理 |
| --- | --- | --- |
| `100` | 成功 | 取 `data`（字符串，或对象数组时拼接各项 `text`），压缩空白后返回 |
| `101` | 无文字 | 返回空字符串（**不报错**，属于正常情况） |
| 其他 | 失败 | 抛出 `Umi-OCR 识别失败（code=…）` |

#### GET `/api/ocr/get_options` —— 探测服务与可选参数

用于面板上的「**测试连接**」。响应是参数字典，脚本读取 `['ocr.language'].optionsList` 来列出可用语言：

```jsonc
{ "ocr.language": { "optionsList": [["models/config_japan.txt", "日本語"], …] } }
```

#### 内置语言选项（`UMI_LANGS`）

| 配置文件 | 语言 |
| --- | --- |
| `models/config_japan.txt` | 日本語（默认） |
| `models/config_chinese.txt` | 简体中文 |
| `models/config_chinese_cht(v2).txt` | 繁體中文 |
| `models/config_en.txt` | English |
| `models/config_korean.txt` | 한국어 |
| `models/config_cyrillic.txt` | Русский |

#### 错误提示

连接失败时脚本会给出针对性指引，而不是抛原始网络错误：

```
连不上本机 Umi-OCR（http://127.0.0.1:1224）。请确认：
1. Umi-OCR 已经启动并在运行
2. 「全局设置」勾选「高级」→ 打开「HTTP 服务」
3. 端口是 1224
```

#### 调用示例

```bash
curl http://127.0.0.1:1224/api/ocr \
  -H "Content-Type: application/json" \
  -d '{"base64":"'"$(base64 -w0 subtitle.jpg)"'",
       "options":{"ocr.language":"models/config_japan.txt",
                  "tbpu.parser":"single_none",
                  "data.format":"text"}}'
```

---

### 1.3 有道图片翻译（youdao-img）

一次调用完成 OCR + 翻译，**按量计费**。需要在 <https://ai.youdao.com/> 创建应用并获取 `appKey` / `appSecret`。

#### 请求

```
POST https://openapi.youdao.com/ocrtransapi
Content-Type: application/x-www-form-urlencoded
```

> 有道要求**表单编码**，不是 JSON。

| 参数 | 值 | 说明 |
| --- | --- | --- |
| `type` | `1` | 输入类型：1 = Base64 |
| `q` | base64 | **纯 base64，绝不能带 `data:image/...;base64,` 前缀** |
| `from` | `CFG.youdaoFrom` | 源语言，默认 `auto` |
| `to` | `CFG.youdaoTo` | 目标语言，默认 `zh-CHS` |
| `appKey` | `CFG.youdaoAppKey` | 应用 ID |
| `salt` | `uuidHex()` | 32 位大写十六进制 UUID |
| `sign` | 见下 | v3 签名 |
| `signType` | `v3` | 签名算法版本 |
| `curtime` | 秒级时间戳 | `String(Math.round(Date.now() / 1000))` |
| `docType` | `json` | 返回 JSON |
| `render` | `0` | 不返回渲染图 |
| `translateOption` | `1` \| `0` | `1` = 使用有道翻译大模型 pro 版 |

#### 签名算法

```
sign = SHA-256( appKey + input + salt + curtime + appSecret )
```

其中 `input` 是 `q` 按有道规则**截断**后的结果：

```js
function youdaoTruncate(q) {
    const len = q.length;
    if (len <= 20) return q;
    return q.substring(0, 10) + len + q.substring(len - 10, len);   // 前10 + 长度 + 后10
}
```

> ⚠️ **计算签名时 `q` 不做 URL encode**，编码只发生在发送前。这是最常见的签名失败原因。
>
> ⚠️ `salt` 用 `crypto.randomUUID()`（无则回退 `Math.random`）生成，每次请求都不同，避免触发错误码 `207`（重放请求）。

`sha256Hex(str)` 优先使用 `crypto.subtle.digest`，在非安全上下文（HTTP 页面）下回退到内置的纯 JS 实现 `sha256HexJS`。

#### 响应

```jsonc
{
  "errorCode": "0",
  "resRegions": [
    { "context": "原文", "tranContent": "译文", "boundingBox": "…" }
  ]
}
```

脚本把 `resRegions` 里所有 `context` 用换行拼接为原文、所有 `tranContent` 拼接为译文：

```js
const original    = regions.map(x => (x.context || '').trim()).filter(Boolean).join('\n').trim();
const translation = regions.map(x => (x.tranContent || '').trim()).filter(Boolean).join('\n').trim();
```

同时把本次请求摘要写入 `Diag.lastYoudao`（错误码、区域数、包围盒、base64 长度、`curtime`、签名前缀）——签名前缀只保留前 12 字符，便于诊断而不泄露完整签名。

#### 错误码对照（`YOUDAO_ERR`）

| 码 | 含义 |
| --- | --- |
| `101` | 缺少必填参数 |
| `102` | 不支持的语言类型（检查 from / to 代码） |
| `103` | 翻译文本过长 |
| `108` | 应用ID无效：appKey 填错，或应用没绑定「图片翻译」服务实例 |
| `110` | 无相关服务的有效实例：需在控制台创建「图片翻译」实例并绑定到该应用 |
| `113` | q 不能为空 |
| `114` | 不支持的图片传输方式 |
| `202` | 签名校验失败：appSecret 错误，或 base64 里带了 `data:` 图片头 |
| `203` | 访问IP不在白名单 |
| `205` | 接口与应用平台类型不一致：创建应用时要选「API」而不是 Android/iOS SDK |
| `206` | 时间戳无效导致签名失败：检查本机系统时间 |
| `207` | 重放请求：salt 重复了 |
| `401` | 账户已欠费，体验金用完了 |
| `411` | 访问频率受限 |
| `1004` | 识别图片过大 |
| `1201` | 图片 base64 解密失败：确认传的是纯 base64，不含 `data:` 前缀 |
| `1301` | OCR 段落识别失败 |
| `1411` | 访问频率受限 |
| `1412` | 超过最大识别字节数 |
| `2003` | 不支持的语言识别类型 |

#### 调用示例（含签名）

```bash
APP_KEY=your_app_key
APP_SECRET=your_app_secret
Q=$(base64 -w0 subtitle.jpg | tr -d '\n')
SALT=$(uuidgen | tr -d '-' | tr 'a-z' 'A-Z')
CURTIME=$(date +%s)
LEN=${#Q}
if [ "$LEN" -le 20 ]; then INPUT="$Q"; else INPUT="${Q:0:10}${LEN}${Q: -10}"; fi
SIGN=$(printf '%s' "${APP_KEY}${INPUT}${SALT}${CURTIME}${APP_SECRET}" | sha256sum | cut -d' ' -f1)

curl https://openapi.youdao.com/ocrtransapi \
  -d "type=1" -d "q=${Q}" -d "from=auto" -d "to=zh-CHS" \
  -d "appKey=${APP_KEY}" -d "salt=${SALT}" -d "sign=${SIGN}" \
  -d "signType=v3" -d "curtime=${CURTIME}" -d "docType=json" \
  -d "render=0" -d "translateOption=1"
```

---

### 1.4 浏览器内置 AI（browser-ai）

完全不发网络请求：识别在本机（Umi-OCR 或端侧多模态模型），翻译也由浏览器**自带**的端侧模型完成。要求 Chrome 138+ 桌面版（或 Edge）、页面为 HTTPS 或 localhost、且不是跨域 iframe（Permissions Policy 限制，顶层窗口与同源 iframe 才有）。

用到的两个 Web API 全局对象（脚本一律通过 `window[...]` 取值，因为不支持时它们是**未声明标识符**，直接写名字会抛 `ReferenceError`）：

| API | 用途 | 关键成员 |
| --- | --- | --- |
| `Translator` | 端侧**翻译**模型 | `availability({sourceLanguage, targetLanguage})`、`create(opts)`；实例 `translate(text)` / `translateStreaming(text)` / `destroy()` |
| `LanguageModel` | 端侧大模型（Prompt API），可读图 | `availability(opts)`、`create(opts)`；实例 `prompt(input)` / `promptStreaming(input)` / `destroy()` |
| `LanguageDetector` | 语种检测（可选） | 仅用于探测展示 |

#### 调用形态

```js
// 翻译：语言标签必须是 BCP-47（脚本负责从「日语 / 简体中文」映射过来）
const t = await Translator.create({ sourceLanguage: 'ja', targetLanguage: 'zh' });
await t.translate('おはようございます');

// 多模态读图：图片必须是 user 消息里的内容块，值可以是 Blob / canvas 等 ImageBitmapSource
const s = await LanguageModel.create({
  expectedInputs: [{ type: 'text', languages: ['ja'] }, { type: 'image' }],
  initialPrompts: [{ role: 'system', content: '你是视频字幕 OCR 引擎…' }],
});
await s.prompt([{
  role: 'user',
  content: [
    { type: 'text', value: '请把这张字幕截图里的文字原样抄出来。' },
    { type: 'image', value: blob },
  ],
}]);
```

#### 实测约束（Chrome 153）

| 约束 | 表现 | 脚本的处理 |
| --- | --- | --- |
| 下载要在用户手势里 | 模型未下载时 `create()` 抛 `Requires a user gesture when availability is "downloadable"` | 下载只由面板「② 准备离线模型」触发 |
| 端侧模型声明语言没有中文 | `expectedOutputs: [{type:'text', languages:['zh']}]` → `unavailable`（`en`/`ja`/`fr`/`de`/`es` 可用） | 输出中文时不写 `expectedOutputs`；读图按源语言声明 |
| 跨域 iframe 不可用 | `availability()` 抛错或返回 `unavailable` | `baiFrameNote()` 提前探测并给出提示 |
| 流式分片语义未定 | 现为**累计**文本，规范讨论过改**增量** | `baiJoinChunk()` 两种都认 |

`availability()` 的返回值：`available`（已就绪）/ `downloadable`（需下载）/ `downloading`（下载中）/ `unavailable`（不支持）；脚本另外用 `unsupported`（没有这个 API）与 `error`（探测抛错）两种内部值。

---

### 1.5 免费网页接口（web-translate）

⚠️ **这一节是逆向来的内部接口，不是公开 API**：服务条款上通常不允许第三方直接调用，且随时可能改版 / 限流 / 封 IP。仅建议个人自用。只做**文本翻译**，识别由本机 Umi-OCR 负责。全部经 `GM_xmlhttpRequest` 发出（绕开 CORS）。

| 引擎 | 端点 | 鉴权 | 请求 | 取译文 |
| --- | --- | --- | --- | --- |
| `tencent` | `POST https://transmart.qq.com/api/imt` | **无** | JSON：`{header:{fn:'auto_translation',client_key}, type:'plain', model_category:'normal', source:{lang,text_list:[text]}, target:{lang}}` | `header.ret_code === 'succ'` 且 `auto_translation[0]` |
| `caiyun` | `POST https://api.interpreter.caiyunai.com/v1/translator` | 前端公开 token（`x-authorization: token …`） | JSON：`{source:[text], trans_type:'ja2zh', request_id, detect:true}` | `rc === 0` 且 `target[0]` |
| `bing` | `GET https://cn.bing.com/translator` → `POST https://cn.bing.com/ttranslatev3?isVertical=1&IG=…&IID=translator.5028` | 页面里的 `IG` + `params_AbusePreventionHelper`（token / key），与 cookie 绑定 | 表单：`fromLang / text / to / token / key` | `[0].translations[0].text`；**空 body = token 过期**，需重抓页面 |

#### 语言码映射（`wtLangPair`）

同一门语言三家叫法不同，这一层是让「一个接口吃所有引擎」成立的关键：

| 规范码 | `tencent` | `caiyun` | `bing` |
| --- | --- | --- | --- |
| `auto` | `auto` | ❌ 不支持（返回 `null`，跳过该引擎） | `auto-detect` |
| `zh` | `zh` | `zh` | `zh-Hans` |
| `zh-Hant` | `zh-TW` | `zh`（它只有这一个中文标签） | `zh-Hant` |
| 其它 | 原样 | 原样 + `trans_type = src2tgt` | 原样 |

#### 实测注意（2026-09）

- `www.bing.com` 的 `ttranslatev3` 会回 **200 + 空 body**，必须用 `cn.bing.com`。
- `tencent` 与 `bing` 都**不校验 Referer**，所以油猴里不必伪造来源头（脚本仍带上 Referent 以便贴近真实调用）。
- `caiyun` 的 token 硬编码在它自己前端里，哪天被撤就废。

---

## 二、内部 JS API（`window.__H1SUB__`）

脚本挂载后会把内部对象暴露到页面全局，**供自动化测试与二次开发使用**。它不影响正常运行，且可安全只读访问。

```js
const H = window.__H1SUB__;
H.version;              // '1.12.0'
```

> 该接口是**调试/测试用途**，不保证跨版本稳定；正式集成请以用户脚本本身为准。

### 2.1 顶层对象与版本

| 成员 | 说明 |
| --- | --- |
| `version` | 脚本版本字符串 |
| `CFG` | **活的**配置对象（修改后记得调用 `saveCfg()` 落盘） |
| `DEFAULTS` | 默认值对象（运行时不可被污染） |
| `ENGINES` | `['openai-vision', 'umi-ocr', 'youdao-img', 'browser-ai', 'web-translate']` |

### 2.2 核心模块

| 成员 | 说明 |
| --- | --- |
| `Pipeline` | 主循环。`start()` / `stop()` / `toggle()` / `step()` / `invalidate()`；状态见 `running` `busy` `gen` `stats` `lastThumb` `lastOriginal` |
| `Capturer` | 截图器。`grab(region, video)` / `grabFromElement()` / `grabFromDisplay()` / `crop()` / `startDisplayCapture()` / `stopDisplayCapture()`；状态见 `mode` `displayStream` |
| `Overlay` | 字幕悬浮层。`show(original, translation)` / `clear()` / `position()` / `reposition()` |
| `UI` | 控制面板。`mount()` / `destroy()` / `setStatus()` / `loadToUI()` / `syncRegion()` / `pushHistory()` 等 |
| `RegionSelector` | 框选器。`begin()`；状态见 `active` |
| `Diag` | 诊断。`record()` / `build()` / `open()`；状态见 `records` `tainted` `lastError` `lastYoudao` |
| `Fullscreen` | 全屏策略。`init()` / `moveTo()` / `hideTrack()` 等 |
| `uiHost()` | 返回当前 UI 宿主（全屏元素或 `body`） |

### 2.3 图像与文本分析

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `thumbnail` | `(canvas) → Float32Array` | 32×16 灰度缩略图，**每次返回新数组**（调用方会长期持有） |
| `thumbDiff` | `(a, b) → number` | 两缩略图的平均绝对差（0~1） |
| `edgeDensity` | `(canvas) → number` | 160×48 边缘密度（0~1） |
| `textSimilarity` | `(a, b) → number` | 归一化编辑距离相似度（0~1） |
| `parseModelJson` | `(txt) → object\|null` | 容错解析模型返回的 JSON |
| `hexToRgb` | `(hex) → {r,g,b}\|null` | 颜色解析 |
| `escapeHtml` | `(s) → string` | HTML 转义 |
| `setHTML` | `(el, html) → void` | Trusted Types 安全的 `innerHTML` |

### 2.4 几何与区域

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `findVideo()` | `→ HTMLVideoElement\|null` | 页面上面积最大的、≥200×120 的视频。带 200ms TTL 缓存（`el.isConnected` 兜底），高频调用不会反复触发强制重排 |
| `invalidateFindVideoCache()` | `→ void` | 立刻作废上面那个缓存，让下次 `findVideo()` 必然重扫。SPA 路由切换时内部已调用 |
| `getContentBox(video)` | `→ {left,top,width,height}` | 剔除 `object-fit` 留白后的**真实画面区** |
| `anchorRegion(x, y, w, h, video)` | `→ region` | 把页面坐标转成带画面区快照的锚点结构 |
| `resolveRegion(region, video?, knownBox?)` | `→ region` | 按当前画面区重新投影区域 |
| `rememberRegion(region)` | `→ void` | 按 `hostname` 记住区域（上限 60） |
| `syncRegionForHost()` | `→ void` | 切换到当前站点的区域 |
| `watchForVideo(cb, timeoutMs?)` | `→ void` | 等待视频出现（默认 180 秒超时） |
| `isTopFrame()` / `isHostDisabled()` | `→ boolean` | 挂载决策辅助 |

### 2.5 引擎与网络

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `recognizeAndTranslate(canvas, opts?)` | `async → {original, translation}` | **统一入口**，按 `CFG.engine` 分发；`opts.onDelta(累计译文, 原文)` 供流式显示 |
| `translateByVision(dataUrl)` | `async → {original, translation}` | 视觉大模型（一步） |
| `translateText(text)` | `async → string` | 纯文本翻译（带 LRU 缓存） |
| `recognizeByUmi(canvas)` | `async → {original, translation}` | Umi-OCR 识别 + 大模型翻译 |
| `callUmiOCR(dataUrl)` | `async → string` | 仅调 Umi-OCR |
| `umiProbe()` | `async → object` | 探测 Umi-OCR（面板「测试连接」） |
| `umiBase()` | `→ string` | 规范化后的 Umi-OCR 地址 |
| `callYoudaoImage(dataUrl)` | `async → {original, translation}` | 有道图片翻译 |
| `recognizeByBrowserAI(canvas, opts?)` | `async → {original, translation}` | 浏览器内置 AI 离线引擎（识别 + 端侧翻译） |
| `baiTranslate(text, {onDelta}?)` | `async → string` | 只用端侧模型翻译一句（带缓存与会话复用） |
| `baiOcrByBuiltin(canvas)` | `async → string` | 端侧多模态读图，返回识别出的原文 |
| `baiPrepare(onProgress?)` | `async → string[]` | 建好/下载端侧会话**并真跑一句自检**。**必须在用户点击的调用栈里调用** |
| `baiProbe()` | `async → Array<{label,value,kind}>` | 探测内置 AI（面板「检测浏览器 AI」） |
| `baiReset()` | `→ void` | 销毁全部端侧会话（换语言 / 换模式时用） |
| `baiSupport()` | `→ {translator, lm, detector}` | 三个内置 API 是否存在 |
| `langCode(name)` | `→ string` | 「日语」→ `ja`；认不出来返回 `''`（映射表在 `32-util.js`，浏览器内置 AI 与免费网页接口共用） |
| `baiPair()` | `→ {src,tgt} \| null` | 当前语言方向（由 `srcLang` / `tgtLang` 映射） |
| `baiPairKey(pair)` | `→ string` | 语言对的规范键，如 `'ja>zh'` |
| `baiMayPivot(pair)` | `→ boolean` | 这个语言对能不能经英语中转 |
| `baiIsPairFailure(e)` | `→ boolean` | 这个错误是不是"语言对本身不可用" |
| `baiBrokenPairs` | `{ 'ja>zh': '错误原文' }` | 运行时试出来的坏语言对（只读观察用） |
| `baiJoinChunk(acc, chunk)` | `→ string` | 拼接流式分片（累计式与增量式都认） |
| `wtTranslate(text)` | `async → string` | 免费网页接口翻译（按降级链逐个试） |
| `wtSelftest()` | `async → Array<{id,label,ok,out?,err?,ms}>` | 三个接口各试一次（面板「测试各接口」） |
| `wtLangPair(id, src, tgt)` | `→ object \| null` | 某家引擎的语言码映射；`null` = 这家用不了该语言对 |
| `wtOrder()` | `→ string[]` | 当前的降级链顺序 |
| `wtStats` / `wtReset()` | `{id:{ok,fail,lastError}}` / `→ void` | 各家成败统计（进诊断报告）/ 重置限速与 token 上下文 |
| `recognizeByWebTranslate(canvas)` | `async → {original, translation}` | Umi-OCR 识别 + 免费接口翻译 |
| `callChat(body)` / `callChatCore(body)` | `async → string \| object` | OpenAI 兼容调用（后者返回 `{text, usage, finishReason, model}`） |
| `apiUrl()` / `buildChatBody()` / `shouldDisableThinking()` | `→ …` | 请求构造辅助 |
| `extractContent(message, finishReason)` | `→ string` | 响应正文提取 |
| `cacheGet(k)` / `cachePut(k, v)` | `→ …` | LRU 缓存读写 |
| `sha256Hex(s)` / `sha256HexJS(s)` | `async → string` / `→ string` | SHA-256（原生 / 纯 JS） |
| `youdaoTruncate(q)` / `uuidHex()` | `→ string` | 有道签名辅助 |

### 2.6 配置与模型判定

| 成员 | 说明 |
| --- | --- |
| `sanitizeCfg(cfg)` | 校验并修正配置 |
| `saveCfg()` | 落盘全部配置 |
| `isNoVisionModel(name)` / `isStaleDeepSeekModel(name)` | 模型能力判定 |
| `NO_VISION_MODELS` / `DS_VISION_MODELS` | 判定所用的名单 |
| `renderProfiles(name?)` / `upsertProfile(name)` / `applyProfile(name)` / `deleteProfile(name)` / `saveProfile()` / `syncProfileSelection()` | 配置档案操作 |
| `testUmi()` | 面板「测试连接」逻辑 |
| `panelHTML()` / `panelCSS()` | 面板标记与样式 |
| `openModal(opts)` | 通用弹窗 |
| `TT_POLICY` | 已创建的 Trusted Types 策略（未启用时为 `null`） |
| `report()` | 等价于 `Diag.build()` |

### 2.7 使用示例

**把字幕带设为「画面底部 12%」并开始翻译**

```js
const H = window.__H1SUB__;
const v = H.findVideo();
const box = H.getContentBox(v);

H.CFG.region = H.anchorRegion(
    box.left,
    box.top + box.height * 0.88,
    box.width,
    box.height * 0.12,
    v
);
H.CFG.engine = 'openai-vision';
H.UI.syncRegion();
H.Pipeline.start();
```

**取一帧并目视检查框选位置**

```js
const H = window.__H1SUB__;
const canvas = H.Capturer.grab(H.CFG.region, H.findVideo());
canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;border:2px solid red';
document.body.appendChild(canvas);   // 看完记得 remove()
```

**批量验证识别链路（不启动循环）**

```js
const H = window.__H1SUB__;
const canvas = H.Capturer.grab(H.CFG.region, H.findVideo());
console.log(await H.recognizeAndTranslate(canvas));
```

**导出诊断报告**

```js
console.log(window.__H1SUB__.report());
```

---

## 三、数据结构

### 3.1 框选区域 `region`

```ts
interface Region {
    x: number;      // 页面坐标（视口相对）
    y: number;
    w: number;
    h: number;
    box?: {         // 框选那一刻的「画面区」快照，用于位置变化后重新投影
        left: number;
        top: number;
        width: number;
        height: number;
    };
}
```

`box` 缺失或坐标非法时，`resolveRegion()` 退化为按绝对坐标使用（保持旧配置可用，不报错）。

### 3.2 主循环统计 `Pipeline.stats`

```ts
interface Stats {
    shots: number;      // 截图轮数
    apiCalls: number;   // 实际发生的 API 调用次数
    skipped: number;    // 被跳过判定拦下的轮数
    errors: number;     // 异常次数
}
```

### 3.3 诊断记录 `Diag`

```ts
interface DiagEntry {
    engine: string;        // 形如 'openai-vision@element'
    ms: number;            // 本轮耗时
    original: string;
    translation: string;
    time: string;          // 记录时刻（locale 时间字符串）
}

interface DiagState {
    modal: HTMLElement | null;
    records: DiagEntry[];  // 最近 40 条，新→旧
    tainted: boolean;      // 是否触发过画布污染
    lastYoudao: object | null;   // 最近一次有道的请求/响应摘要
    lastError: { time: string, msg: string, stack: string } | null;
}
```

### 3.4 识别结果

```ts
interface RecognitionResult {
    original: string;      // 识别到的原文（可能为空）
    translation: string;   // 译文（可能为空）
}
```

所有引擎的返回值都统一成这个形状，`Pipeline.present()` 只面向它做判断。

### 3.5 配置档案 `apiProfiles`

```ts
interface ApiProfile {
    name: string;
    apiBase: string;
    apiKey: string;
    model: string;
    thinkingMode: 'auto' | 'off' | 'on';
    maxTokens: number;
}
```

> 导出配置时会**移除 `regionsByHost`**（各站的页面坐标换机器没有意义），但**保留 API Key**——分享导出文件前请注意脱敏。

---

## 四、GM 存储键

所有配置以 `h1sub.` 为前缀通过 `GM_setValue` 持久化，即存储键为 `h1sub.<配置名>`：

```
h1sub.engine          h1sub.apiBase         h1sub.apiKey
h1sub.model           h1sub.thinkingMode    h1sub.maxTokens
h1sub.apiProfiles     h1sub.youdaoAppKey    h1sub.youdaoAppSecret
h1sub.youdaoFrom      h1sub.youdaoTo        h1sub.youdaoLLM
h1sub.umiBase         h1sub.umiLang         h1sub.umiParser
h1sub.srcLang         h1sub.tgtLang         h1sub.extraPrompt
h1sub.baiOcr          h1sub.baiTrans        h1sub.baiStream
h1sub.baiPivot        h1sub.interval        h1sub.captureMode
h1sub.smartSkip       h1sub.wtEngine        h1sub.wtMinInterval
h1sub.textSimThreshold h1sub.region         h1sub.regionHost
h1sub.regionsByHost   h1sub.disabledHosts   h1sub.onboarded
h1sub.fontSize        h1sub.showOriginal    h1sub.overlayTop
h1sub.bgOpacity       h1sub.textColor       h1sub.outline
h1sub.offsetY         h1sub.panelWidth      h1sub.panelPos
```

配置项的完整含义、类型与默认值见 [README 的配置项参考](../README.md#配置项参考)。

**写入策略**：单键/少数键变更调用 `saveCfgKeys(cfg, keys)`（只写指定键）；仅导入配置与重置时调用 `saveCfg(cfg)` 全量写入。

---

## 五、油猴菜单命令

脚本注册了 4 个用户脚本管理器菜单命令：

| 菜单项 | 等价操作 |
| --- | --- |
| 显示/隐藏 字幕翻译面板 | 切换面板可见性；若处于小胶囊模式则展开 |
| 框选字幕区域 | `RegionSelector.begin()` |
| 开始/停止 | `Pipeline.toggle()` |
| 在本站禁用（不再显示面板） | 把当前 `hostname` 加入 `disabledHosts` 并销毁 UI |

---

## 相关文档

- [架构与模块职责](ARCHITECTURE.md)
- [测试与性能基准指南](TESTING.md)
- [项目说明](../README.md)
