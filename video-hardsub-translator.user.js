// ==UserScript==
// @name         网页视频硬字幕实时翻译（OCR + 第三方大模型 API）
// @namespace    https://github.com/1105532539/video-hardsub-translator
// @version      1.12.0
// @description  任意网站通用：框选视频硬字幕区域，定时截图 → OCR → 第三方大模型 API 或浏览器内置端侧模型翻译成中文 → 悬浮字幕显示
// @author       1105532539
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/1105532539/video-hardsub-translator
// @supportURL   https://github.com/1105532539/video-hardsub-translator/issues
// @downloadURL  https://raw.githubusercontent.com/1105532539/video-hardsub-translator/main/video-hardsub-translator.user.js
// @updateURL    https://raw.githubusercontent.com/1105532539/video-hardsub-translator/main/video-hardsub-translator.user.js
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-idle
// ==/UserScript==

/*
 * ═════════════════════════════════════════════════════════════════════
 *  网页视频硬字幕实时翻译
 *  video-hardsub-translator.user.js
 * ═════════════════════════════════════════════════════════════════════
 *
 *  给任何网站上的 <video> 做「硬字幕」实时翻译。
 *
 *  硬字幕 = 已经烧进画面里的字幕（不是可关闭的字幕轨）。
 *  如果你的视频本来就有字幕轨（YouTube、B站这类），
 *  请不要用这个脚本 —— 直接读字幕轨的工具体验更好也更省钱。
 *  这个脚本是给「字幕就画在画面上」的视频用的。
 *
 * ─────────────────────────────────────────────────────────────────────
 *  工作原理
 * ─────────────────────────────────────────────────────────────────────
 *  1. 你在页面上框选「硬字幕所在的区域」
 *  2. 脚本每隔 N 毫秒把该区域截成图片
 *  3. 图片交给 AI（四种引擎，见下）得到中文译文
 *  4. 译文以悬浮字幕的形式盖在视频上
 *
 *  四种识别引擎（面板里可选）：
 *    openai-vision（默认）：把截图直接发给「视觉大模型」，一步完成
 *                        OCR + 翻译。对动画风格的描边/艺术字识别率高，
 *                        只需一次 API 调用。需要支持图片输入的模型。
 *    umi-ocr（识别率最高）：把截图发给本机运行的 Umi-OCR（离线、免费），
 *                        拿到纯文本后再交给大模型翻译。
 *                        识别引擎是 PaddleOCR，比浏览器内置方案强得多，
 *                        而且浏览器这边一个字节都不用下载。
 *    browser-ai（完全离线）：用浏览器**自带**的端侧模型（Chrome 138+ / Edge）
 *                        在本机完成识别与翻译 —— 不联网、不要 API Key、
 *                        原文不出设备、不产生任何费用。
 *                        识别可以配 Umi-OCR（推荐），也可以直接用端侧
 *                        多模态模型读图；翻译走端侧翻译模型。
 *                        代价：首次要点一次「准备离线模型」下载语言包，
 *                        且跨域 iframe 里的播放器默认用不了。
 *    youdao-img：有道图片翻译 API，同样是 OCR + 翻译一步到位，
 *                        按量计费（不是免费额度）。
 *
 *  前三种引擎都**不需要浏览器下载任何模型**。
 *
 *  ⚠️ 关于「思考模式」（思维链）：
 *    DeepSeek V4.1-Flash 默认开启思考模式，模型会先输出一大段推理再给答案。
 *    这对「看字幕图 → 翻译」这种任务毫无必要，而且会吃掉输出预算，
 *    可能让正文变成空的（表现为"识别不出来"）。
 *    脚本默认对 DeepSeek 接口自动发送 {"thinking":{"type":"disabled"}} 关掉它。
 *    注意思考模式也不支持 temperature 参数。
 *
 *  两种截图来源（脚本自动切换）：
 *    element 模式：直接读取 <video> 元素的画面。最快、无需授权。
 *                  但如果视频来自跨域 CDN 且未发送 CORS 头，浏览器会
 *                  「污染」画布，导致读不到像素 —— 此时自动切到 display 模式。
 *    display 模式：用 getDisplayMedia 捕获当前标签页。一定能拿到像素，
 *                  但首次需要你手动授权「共享此标签页」。
 *
 *  它会在哪些页面上出现（@match 已放开到所有网址，但不会到处乱挂）：
 *    · 页面上有 ≥200×120 的视频      → 直接显示完整面板
 *    · 页面上暂时没有视频            → 只留右下角一个小胶囊，点击才展开
 *    · 视频后来才加载（SPA/懒加载）  → 视频一出现，胶囊自动展开成面板
 *    · 视频被套在 iframe 里          → 面板挂在那个 iframe 内，不会出现两层
 *    · iframe 里没有视频             → 完全不挂（广告/统计框架不会被污染）
 *    · 你在某站点点过 🚫「本站禁用」 → 该站点彻底不介入
 *
 *  框选区域按网站分别记忆，换站不会串台。
 *
 * ─────────────────────────────────────────────────────────────────────
 *  许可证
 * ─────────────────────────────────────────────────────────────────────
 *  版权所有 (C) 2026 1105532539
 *
 *  本程序是自由软件：你可以按照自由软件基金会发布的 GNU 通用公共许可证
 *  （第 3 版，或你选择的任何更新版本）的条款重新发布和/或修改它。
 *
 *  本程序的分发是希望它有用，但不提供任何担保，甚至不提供适销性或
 *  特定用途适用性的默示担保。详见 GNU 通用公共许可证。
 *
 *  你应该已经收到一份 GNU 通用公共许可证的副本；如果没有，
 *  请见 <https://www.gnu.org/licenses/>。完整全文见仓库根目录 LICENSE。
 *
 *  实践含义：你可以自由使用、修改、再发布本脚本；但如果你发布了修改后的
 *  版本，必须同样以 GPL-3.0 开放源代码。
 * ─────────────────────────────────────────────────────────────────────
 */

/*
 * ⚠️ 本文件由 src/ 下的模块自动拼接生成 —— 请勿直接编辑，改了会被下次构建覆盖。
 *    改代码请改 src/ 里对应的模块，然后运行：npm run build
 *    模块清单、拼接顺序与依赖关系见 _build/build.mjs 和每个模块头的说明；
 *    架构总览见 docs/ARCHITECTURE.md。
 */

(function () {
    'use strict';

    // 同一个文档里只初始化一次
    if (window.__H1SUB_LOADED__) return;
    window.__H1SUB_LOADED__ = true;

    // ═══════════════════════════════════════════════════════════════
    //  10-config.js — 配置：默认值、读写、规整、平台预设
    //
    //  CFG 是全脚本唯一的那份配置对象：启动时 loadCfg() 读出来并过一遍
    //  sanitizeCfg()（挡住老版本残留的引擎名、被改坏的坐标、注入型 fontSize），
    //  之后热路径直接读 CFG.xxx，不再碰存储。
    //
    //  写回一律走 saveCfg / saveCfgKeys —— 后者只写指定的几个键，
    //  因为全量写一次要动 30+ 个存储项。
    //
    //  对外提供：NS、DEFAULTS、ENGINES、BAI_OCR_CHOICES、BAI_TRANS_CHOICES、
    //              WT_ENGINE_CHOICES、
    //              NUM_RANGES、API_PRESETS、DS_VISION_MODELS、
    //              NO_VISION_MODELS、VISION_MARKERS、CFG、cloneDefault、loadCfg、
    //              sanitizeCfg、saveCfg、saveCfgKeys、isNoVisionModel、
    //              isStaleDeepSeekModel
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    const NS = 'h1sub.';

    const DEFAULTS = {
        // ---- 识别 / 翻译引擎 ----
        //   openai-vision=视觉大模型一步搞定 | youdao-img=有道图片翻译
        //   umi-ocr=本机 Umi-OCR 识别+大模型翻译 | browser-ai=浏览器端侧模型（离线免 Key）
        //   web-translate=本机 Umi-OCR + 逆向网页接口（免 Key，接口非公开、可能失效）
        engine: 'openai-vision',

        // ---- OpenAI 兼容接口 ----
        apiBase: 'https://api.deepseek.com',    // 结尾不要带 /
        apiKey: '',
        model: 'deepseek-flash',                // openai-vision 必须用支持图片的模型

        // 思考模式（思维链）：对字幕 OCR 只会拖慢速度、吃掉输出预算，还可能让 content
        // 返回空，所以默认关掉。auto=检测到 DeepSeek 接口才关（推荐）| off=总是关 | on=不动
        thinkingMode: 'auto',

        // 单次回复最大 token。思考模式会吃掉一部分，所以给得宽裕（只是上限，用不到不多花钱）
        maxTokens: 1024,

        // 多套 API 配置档案：[{name, apiBase, apiKey, model, thinkingMode, maxTokens}]
        apiProfiles: [],

        // ---- 有道智云 ----
        youdaoAppKey: '',                       // 应用ID
        youdaoAppSecret: '',                    // 应用密钥
        youdaoFrom: 'auto',                     // auto | ja | en | ko ...
        youdaoTo: 'zh-CHS',
        youdaoLLM: true,                        // true=有道翻译大模型 pro 版

        // ---- Umi-OCR（本机运行的离线 OCR，浏览器不用下载任何东西）----
        umiBase: 'http://127.0.0.1:1224',       // Umi-OCR 的 HTTP 服务地址
        umiLang: 'models/config_japan.txt',     // 识别语言（对应引擎配置文件）
        umiParser: 'single_none',               // 字幕是单行，别让它自作主张断行

        // ---- 浏览器内置 AI（engine = browser-ai 时生效）----
        //   ⚠️ 需要 Chrome ≥ 138 / Edge ≥ 148，低于此版本 Translator / LanguageModel
        //   根本不存在（见 48-browser-ai.js）。
        baiOcr: 'umi',          // umi=Umi-OCR 本机识别（推荐）| builtin=端侧多模态读图（仅 Chrome）
        baiTrans: 'auto',       // auto=优先端侧翻译模型 | translator=只用它 | prompt=只用端侧大模型
        baiStream: true,        // 边生成边出字（关掉可避免个别页面上的闪烁）
        // 语言对直连不可用时经英语中转（原文 → 英语 → 目标语言）：Edge 的 ja→zh 必报
        // Generic failures，而 ja→en、en→zh 都好使，这是 Edge 上唯一能离线跑通的路。
        baiPivot: true,

        // ---- 免费网页接口（engine = web-translate 时生效）----
        //   逆向复用翻译网站的前端接口：免 Key，但属非公开接口，服务条款通常不允许
        //   第三方调用且随时可能失效，仅建议自用。识别仍由本机 Umi-OCR 负责。
        wtEngine: 'auto',       // auto=按降级链 | tencent | caiyun | bing
        wtMinInterval: 1200,    // 同一引擎两次请求的最小间隔(ms)，别把人家打挂了

        // ---- 语言 ----
        srcLang: '日语',
        tgtLang: '简体中文',

        // ---- 截图与节奏 ----
        interval: 1200,                         // 截图间隔(ms)
        region: null,                           // 框选区域（页面坐标）
        regionHost: null,                       // 上面这个 region 是在哪个网站框的
        regionsByHost: {},                      // 按网站分别记住框选区域 { hostname: region }
        captureMode: 'auto',                    // auto | element | display
        smartSkip: true,                        // 无文字时跳过 API 调用（省钱）
        textSimThreshold: 0.28,                 // 文本相似度阈值(0~1)，越高越不容易重复翻译

        // ---- 全站运行的开关 ----
        disabledHosts: [],                      // 在这个列表里的网站不显示面板（本站禁用）

        // ---- 外观 ----
        fontSize: 24,
        showOriginal: true,
        overlayTop: true,                       // 译文放在字幕区上方（否则下方）
        bgOpacity: 0.68,                        // 译文背景不透明度 0~1
        textColor: '#ffffff',                   // 译文颜色
        outline: true,                          // 文字加描边（亮背景上更清楚）
        offsetY: 0,                             // 垂直微调（px，正数往下）
        panelWidth: 320,                        // 面板宽度
        panelPos: null,                         // 面板位置 {left,top}，null=默认右下角

        // ---- 首次运行引导 ----
        onboarded: false,

        // ---- 高级 ----
        extraPrompt: '',
    };

    /** 深拷贝默认值：对象/数组类默认值必须拷贝，否则 CFG 和 DEFAULTS 会指向同一个
     *  对象，运行时一改就把默认值污染了。 */
    function cloneDefault(v) {
        if (v === null || typeof v !== 'object') return v;
        try { return JSON.parse(JSON.stringify(v)); } catch (e) { return Array.isArray(v) ? [] : {}; }
    }

    function loadCfg() {
        const cfg = {};
        for (const k in DEFAULTS) {
            let v;
            try { v = GM_getValue(NS + k, undefined); } catch (e) { v = undefined; }
            cfg[k] = (v === undefined) ? cloneDefault(DEFAULTS[k]) : v;
        }
        return sanitizeCfg(cfg);
    }

    /** 当前支持的四种引擎 */
    const ENGINES = ['openai-vision', 'umi-ocr', 'youdao-img', 'browser-ai', 'web-translate'];

    // web-translate 的接口选择，和面板上的 <option> 一一对应
    const WT_ENGINE_CHOICES = ['auto', 'tencent', 'caiyun', 'bing'];

    // browser-ai 那两个下拉框的合法取值，和面板上的 <option> 一一对应。
    // 和 ENGINES 一样，坏值必须兜回默认 —— 直接赋给 <select> 会让它
    // selectedIndex = -1（显示空白），运行时却按别的模式跑。
    const BAI_OCR_CHOICES = ['umi', 'builtin'];
    const BAI_TRANS_CHOICES = ['auto', 'translator', 'prompt'];

    // 数值型配置的合法区间（和面板控件的 min/max 一致）
    const NUM_RANGES = {
        fontSize: [12, 48],
        bgOpacity: [0, 1],
        offsetY: [-200, 200],
        interval: [300, 60000],
        textSimThreshold: [0, 0.8],
        wtMinInterval: [0, 10000],
    };

    /**
     * 把一份配置修正到「能用」的状态，加载和导入都要过这一道。
     * 一类是老版本残留的坏引擎名 —— 直接赋给 <select> 会让它 selectedIndex = -1，
     * 下拉框空白而运行时却按别的模式跑；一类是导入的 JSON 完全没做类型校验，而
     * fontSize 恰好是唯一被直接拼进 innerHTML 的配置值，粘一份构造过的就能注入 HTML。
     */
    function sanitizeCfg(cfg) {
        if (!cfg || typeof cfg !== 'object') return cfg;

        if (ENGINES.indexOf(cfg.engine) < 0) cfg.engine = DEFAULTS.engine;

        // browser-ai / web-translate 的模式枚举同样要兜住
        if (BAI_OCR_CHOICES.indexOf(cfg.baiOcr) < 0) cfg.baiOcr = DEFAULTS.baiOcr;
        if (BAI_TRANS_CHOICES.indexOf(cfg.baiTrans) < 0) cfg.baiTrans = DEFAULTS.baiTrans;
        cfg.baiStream = !!cfg.baiStream;
        cfg.baiPivot = cfg.baiPivot === undefined ? DEFAULTS.baiPivot : !!cfg.baiPivot;
        if (WT_ENGINE_CHOICES.indexOf(cfg.wtEngine) < 0) cfg.wtEngine = DEFAULTS.wtEngine;

        for (const k in NUM_RANGES) {
            const r = NUM_RANGES[k];
            const n = Number(cfg[k]);
            cfg[k] = Number.isFinite(n)
                ? Math.min(r[1], Math.max(r[0], n))
                : cloneDefault(DEFAULTS[k]);
        }

        if (typeof cfg.textColor !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(cfg.textColor)) {
            cfg.textColor = DEFAULTS.textColor;
        }
        if (cfg.region && typeof cfg.region === 'object') {
            const g = cfg.region;
            // ⚡ 优化：原来是「四个坐标塞进临时数组、再用数组方法逐个判断」的写法，
            //    会分配一个长度 4 的临时数组再走一次回调；改成直接四个与，逻辑等价
            if (!(Number.isFinite(Number(g.x)) && Number.isFinite(Number(g.y))
                && Number.isFinite(Number(g.w)) && Number.isFinite(Number(g.h)))
                || Number(g.w) <= 0 || Number(g.h) <= 0) {
                cfg.region = null;      // 坐标是坏的就当没设过，免得后面算出 NaN
            }
        } else {
            cfg.region = null;
        }
        if (!Array.isArray(cfg.apiProfiles)) cfg.apiProfiles = [];
        if (!Array.isArray(cfg.disabledHosts)) cfg.disabledHosts = [];
        if (!cfg.regionsByHost || typeof cfg.regionsByHost !== 'object') cfg.regionsByHost = {};
        return cfg;
    }

    function saveCfg(cfg) {
        for (const k in cfg) {
            try { GM_setValue(NS + k, cfg[k]); } catch (e) { /* ignore */ }
        }
    }

    /** 只写指定的几个键 */
    function saveCfgKeys(cfg, keys) {
        for (const k of keys) {
            try { GM_setValue(NS + k, cfg[k]); } catch (e) { /* ignore */ }
        }
    }

    const CFG = loadCfg();

    // ── API 平台预设：面板里一键填入地址+模型 ──
    const API_PRESETS = [
        { name: '— 选择预设，一键填入 —', base: '', model: '', note: '' },
        {
            name: 'Google Gemini（视觉·便宜）',
            base: 'https://generativelanguage.googleapis.com/v1beta/openai',
            model: 'gemini-2.5-flash',
            note: '国内需代理',
        },
        {
            name: '阿里云百炼（视觉·国产）',
            base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            model: 'qwen-vl-max',
            note: '',
        },
        {
            name: '智谱 GLM（视觉·国产）',
            base: 'https://open.bigmodel.cn/api/paas/v4',
            model: 'glm-4v-plus',
            note: '',
        },
        {
            name: '月之暗面 Kimi（视觉·国产）',
            base: 'https://api.moonshot.cn/v1',
            model: 'moonshot-v1-8k-vision-preview',
            note: '',
        },
        {
            name: 'OpenAI（视觉）',
            base: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
            note: '国内需代理',
        },
        {
            name: 'OpenRouter（视觉·聚合）',
            base: 'https://openrouter.ai/api/v1',
            model: 'google/gemini-2.5-flash',
            note: '',
        },
        {
            name: 'DeepSeek deepseek-flash（视觉·推荐）',
            base: 'https://api.deepseek.com',
            model: 'deepseek-flash',
            note: 'DeepSeek 统一用 deepseek-flash：支持图片输入，可直接用于「视觉大模型」引擎',
        },
        {
            name: 'DeepSeek deepseek-v4-pro（⚠️ 不支持图片）',
            base: 'https://api.deepseek.com',
            model: 'deepseek-v4-pro',
            note: 'deepseek-v4-pro 不支持图片输入，要配「Umi-OCR 本地识别」引擎（先跑 Umi-OCR 认字，再让模型翻译）',
        },
    ];

    // DeepSeek 侧能用于视觉引擎的模型名。两个 v4-flash 旧名官方只标了「仍接受，
    // 请求由最新 Flash 模型处理」，所以它们同样支持图片输入。
    const DS_VISION_MODELS = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'];

    // 已知不支持图片输入的模型名 —— 手动输入时面板会提醒
    const NO_VISION_MODELS = [
        'deepseek-v4-pro',
        'deepseek-chat', 'deepseek-reasoner',        // 历史上的纯文本模型名
        'gpt-3.5-turbo', 'moonshot-v1-8k', 'qwen-max', 'glm-4-plus',
    ];

    // 名字里带这些字样的一律当"能看图"。否则下面的前缀规则会把
    // 'moonshot-v1-8k-vision-preview' 误判成纯文本（它确实以 'moonshot-v1-8k' 开头），
    // 用户选了标着"视觉"的 Kimi 预设、引擎却被自动切走。
    const VISION_MARKERS = ['vision', '-vl', 'vl-', '4v', 'multimodal'];

    /** 这个模型名是不是已知不支持图片 */
    function isNoVisionModel(name) {
        const m = String(name || '').trim().toLowerCase();
        if (!m) return false;
        // 能看图的先放行（否则会被下面的前缀规则误伤）
        if (DS_VISION_MODELS.indexOf(m) >= 0) return false;
        if (VISION_MARKERS.some(k => m.indexOf(k) >= 0)) return false;
        return NO_VISION_MODELS.some(x => m === x || m.indexOf(x + '-') === 0);
    }

    /** 看着像 DeepSeek 但不属于能看图的那几个 → 建议改用 deepseek-flash */
    function isStaleDeepSeekModel(name) {
        const m = String(name || '').trim().toLowerCase();
        if (!m || m.indexOf('deepseek') !== 0) return false;
        return DS_VISION_MODELS.indexOf(m) < 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  12-log.js — 日志
    //
    //  对外提供：LOG_PREFIX、log、warn
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    const LOG_PREFIX = '[字幕翻译]';
    function log(...a) { console.log(LOG_PREFIX, ...a); }
    function warn(...a) { console.warn(LOG_PREFIX, ...a); }

    // ═══════════════════════════════════════════════════════════════
    //  14-constants.js — 热路径常量与配色
    //
    //  截图循环每 1.2 秒走一遍，魔数集中在这里便于调参。
    //
    //  对外提供：THUMB_W、THUMB_H、EDGE_W、EDGE_H、EDGE_GRAD、EDGE_MIN、
    //              NO_CHANGE_DIFF、STATUS_COLORS
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    const THUMB_W = 32, THUMB_H = 16;   // 「画面是否变化」缩略图尺寸
    const EDGE_W = 160, EDGE_H = 48;    // 「区域里有没有文字」采样尺寸
    const EDGE_GRAD = 45;               // 相邻像素灰度差超过此值记作一条边
    const EDGE_MIN = 0.035;             // 边缘密度低于此值视为「无文字」，跳过 API
    const NO_CHANGE_DIFF = 0.004;       // 缩略图平均差低于此值视为「画面没变」

    /** 状态栏配色（setStatus 的 kind → 颜色） */
    const STATUS_COLORS = {
        err: '#f87171',
        warn: '#fbbf24',
        ok: '#4ade80',
        busy: '#22d3ee',
        idle: '#8b93a7',
    };

    // ═══════════════════════════════════════════════════════════════
    //  20-video.js — 视频元素定位
    //
    //  对外提供：findVideo、invalidateFindVideoCache
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    // ⚡ 优化：给 findVideo 加 200ms TTL 缓存。它由 watchForVideo 的 rAF 和
    //    RegionSelector 拖拽预览按帧驱动（最高 60 次/秒），而 querySelectorAll +
    //    getBoundingClientRect 是一次强制同步重排；200ms 远短于截图间隔，不影响响应。
    let _fvCache = { el: null, expires: 0 };

    /** 找到页面上"最大"的那个 video 元素（主播放器） */
    function findVideo() {
        const now = performance.now();
        // ⚡ 优化：el.isConnected —— SPA 换页后旧元素会变成游离节点，必须重扫
        if (now < _fvCache.expires
            && (_fvCache.el === null || _fvCache.el.isConnected)) {
            return _fvCache.el;
        }
        const vids = document.querySelectorAll('video');
        let best = null, bestArea = 0;
        for (let i = 0; i < vids.length; i++) {
            const v = vids[i];
            const r = v.getBoundingClientRect();
            const area = r.width * r.height;
            // 过滤掉广告/预览用的超小视频
            if (area > bestArea && r.width > 200 && r.height > 120) {
                best = v; bestArea = area;
            }
        }
        _fvCache.el = best;
        _fvCache.expires = now + 200;
        return best;
    }

    /** 主动作废 findVideo 的缓存 */
    // ⚡ 优化：新增主动作废入口，供 SPA 路由切换时调用，让下一次 findVideo 必然重扫：
    //    换页后 200ms 内可能拿到上一页的元素，而"已经跳走了"只有调用方知道。
    function invalidateFindVideoCache() {
        _fvCache.expires = 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  22-site.js — 站点级行为：禁用开关、视频出现监听、按站点记忆区域
    //
    //  「本站禁用」「视频后加载」「换站不串台」这三件事都是"按站点"的，
    //  所以收在同一个模块里。
    //
    //  对外提供：isHostDisabled、banCurrentHost、isTopFrame、watchForVideo、
    //              syncRegionForHost、rememberRegion
    //  依赖：CFG、saveCfgKeys、log、findVideo、UI
    // ═══════════════════════════════════════════════════════════════
    /** 当前网站是不是被用户禁用了 */
    function isHostDisabled() {
        const list = Array.isArray(CFG.disabledHosts) ? CFG.disabledHosts : [];
        return list.indexOf(location.hostname) >= 0;
    }

    /** 把当前站点加进禁用列表并移除 UI。面板标题栏的 🚫 和油猴菜单共用这一套 */
    function banCurrentHost() {
        const h = location.hostname;
        if (!confirm('不再在「' + h + '」上显示翻译面板？\n\n'
            + '（以后想恢复：在任意网站打开面板 → 高级 →「恢复「本站禁用」的网站」）')) return;
        const list = Array.isArray(CFG.disabledHosts) ? CFG.disabledHosts.slice() : [];
        if (list.indexOf(h) < 0) list.push(h);
        CFG.disabledHosts = list;
        saveCfgKeys(CFG, ['disabledHosts']);
        UI.destroy();
    }

    /** 当前是否处于顶层窗口（iframe 里要另做判断，避免面板重复挂） */
    function isTopFrame() {
        try { return window.top === window.self; } catch (e) { return true; }
    }

    /**
     * 等页面出现「像样的」视频元素。MutationObserver + 轮询双保险 —— 视频常常是
     * 懒加载 / SPA 切页后才出现。返回一个取消函数。
     */
    function watchForVideo(onFound, timeoutMs = 180000) {
        if (findVideo()) { onFound(); return () => { }; }
        let done = false;
        const stop = () => {
            if (done) return;
            done = true;
            try { obs.disconnect(); } catch (e) { }
            clearInterval(iv);
            clearTimeout(tm);
        };
        const hit = () => {
            if (done) return;
            if (findVideo()) { stop(); onFound(); }
        };
        // DOM 变动可能一秒来几十批，而 findVideo() 要读 getBoundingClientRect（强制
        // 同步重排）。合并成每帧最多一次；后台标签页里 rAF 不跑也没关系，下面还有
        // 1 秒的轮询兜底。
        let queued = false;
        const hitSoon = () => {
            if (done || queued) return;
            queued = true;
            const run = () => { queued = false; hit(); };
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
            else setTimeout(run, 0);
        };
        let obs;
        try {
            obs = new MutationObserver(hitSoon);
            obs.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) { obs = { disconnect() { } }; }
        const iv = setInterval(hit, 1000);
        const tm = setTimeout(stop, timeoutMs);
        return stop;
    }

    /**
     * 换了网站，之前框的区域就没意义了（页面坐标完全不同）。按网站分别恢复/清空。
     */
    function syncRegionForHost() {
        const host = location.hostname;
        if (CFG.region && CFG.regionHost === host) return;   // 已经是本站的，不动

        const saved = (CFG.regionsByHost || {})[host] || null;
        // 之前这里无条件 saveCfg(CFG)：在没有任何区域记录的站上，每打开一个页面
        // 都会把 30+ 个配置项整份重写一遍
        if (CFG.region === saved && CFG.regionHost === (saved ? host : null)) return;

        CFG.region = saved;
        CFG.regionHost = saved ? host : null;
        saveCfgKeys(CFG, ['region', 'regionHost']);
        if (saved) log('已恢复本站（' + host + '）上次框选的区域');
    }

    /** 记住本站的框选区域 */
    function rememberRegion(region) {
        const host = location.hostname;
        CFG.region = region;
        CFG.regionHost = host;
        if (!CFG.regionsByHost || typeof CFG.regionsByHost !== 'object') CFG.regionsByHost = {};
        CFG.regionsByHost[host] = region;
        // 别让它无限膨胀
        const keys = Object.keys(CFG.regionsByHost);
        if (keys.length > 60) delete CFG.regionsByHost[keys[0]];
        saveCfgKeys(CFG, ['region', 'regionHost', 'regionsByHost']);
    }

    // ═══════════════════════════════════════════════════════════════
    //  24-region.js — 区域锚定与坐标换算
    //
    //  对外提供：getContentBox、resolveRegion、anchorRegion
    //  依赖：findVideo
    // ═══════════════════════════════════════════════════════════════
    /**
     * 计算 <video> 元素里「真实画面」所占的矩形。object-fit 会产生黑边，坐标映射
     * 必须基于真实画面而不是元素本身。
     */
    function getContentBox(video) {
        const r = video.getBoundingClientRect();
        const vw = video.videoWidth || 0;
        const vh = video.videoHeight || 0;
        if (!vw || !vh) {
            return { left: r.left, top: r.top, width: r.width, height: r.height };
        }
        let fit = 'contain';
        try { fit = getComputedStyle(video).objectFit || 'contain'; } catch (e) { }
        if (fit === 'fill' || fit === 'none') {
            return { left: r.left, top: r.top, width: r.width, height: r.height };
        }
        const s = fit === 'cover'
            ? Math.max(r.width / vw, r.height / vh)
            : Math.min(r.width / vw, r.height / vh);
        const w = vw * s, h = vh * s;
        return {
            left: r.left + (r.width - w) / 2,
            top: r.top + (r.height - h) / 2,
            width: w,
            height: h,
        };
    }

    /**
     * 把「框选时记下的区域」换算成当前的视口坐标。
     *
     * region.x/y 是框选那一刻的视口坐标，而视频是会动的（滚动、全屏、换集），所以框选
     * 时一并记下当时视频内容框的位置，之后按比例重新锚定 —— 不锚定是**静默出错**：截到
     * 错误像素，OCR 认出一堆乱字，API 照样扣钱，用户看不出哪里不对。
     *
     * 老配置里没有 region.box，就按绝对坐标用（和以前行为一致，不炸）。
     *
     * @param {object} region    框选时记下的区域
     * @param {HTMLVideoElement} [video] 不给我就自己找
     * @param {object} [knownBox] 调用方刚算过的内容框 —— 传进来就少一次
     *                            getBoundingClientRect + getComputedStyle 强制重排
     */
    function resolveRegion(region, video, knownBox) {
        if (!region) return region;
        const was = region.box;
        // 锚点本身也来自可能被导入/被改坏的配置，先确认它是四个有限正数，
        // 否则下面的比例换算会算出 NaN，一路传进 canvas 尺寸里
        if (!was || ![was.left, was.top, was.width, was.height].every(v => Number.isFinite(Number(v)))
            || Number(was.width) <= 0 || Number(was.height) <= 0) {
            return region;
        }
        const v = video || findVideo();
        if (!v) return region;

        const now = knownBox || getContentBox(v);
        const sx = now.width / was.width;
        const sy = now.height / was.height;
        return {
            x: now.left + (region.x - was.left) * sx,
            y: now.top + (region.y - was.top) * sy,
            w: region.w * sx,
            h: region.h * sy,
            // 换算结果本身不再需要锚点，避免二次换算
        };
    }

    /** 框选完成时调用：把"当时的视频位置"一起存进去，供 resolveRegion 用 */
    function anchorRegion(x, y, w, h, video) {
        const r = { x, y, w, h };
        const v = video || findVideo();
        if (v && v.videoWidth) {
            const box = getContentBox(v);
            if (box.width > 0 && box.height > 0) {
                r.box = { left: box.left, top: box.top, width: box.width, height: box.height };
            }
        }
        return r;
    }

    // ═══════════════════════════════════════════════════════════════
    //  30-image.js — 截图分析与文本相似度（热路径）
    //
    //  决定"这帧要不要花钱调 API"的三个判断都在这儿：
    //    画面是否变化（thumbnail + thumbDiff）
    //    区域里有没有文字（edgeDensity）
    //    这句是不是和上一句重复（textSimilarity）
    //  离屏画布与 DP 滚动行缓冲都复用，不每轮新建。
    //
    //  对外提供：thumbnail、thumbDiff、edgeDensity、textSimilarity
    //  依赖：THUMB_W、THUMB_H、EDGE_W、EDGE_H、EDGE_GRAD、EDGE_MIN
    // ═══════════════════════════════════════════════════════════════
    /**
     * 复用的离屏画布。这两个函数每轮（约 1.2 秒）各调一次，原来每次都在新建
     * canvas + 2d context + ImageData —— 而 willReadFrequently 的提示本来就是让
     * "同一个" context 走 CPU 后端的，对一次性画布毫无意义。
     */
    const THUMB_BUF = {};
    const EDGE_BUF = {};

    function scratch(store, w, h) {
        if (!store.c || store.c.width !== w || store.c.height !== h) {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            store.c = c;
            store.x = c.getContext('2d', { willReadFrequently: true });
        }
        return store.x;
    }

    /** 生成 32x16 灰度缩略图，用于「画面是否变化」的快速判断。
     *  返回的数组会被 Pipeline.lastThumb 长期持有做对比，所以每次必须新建 ——
     *  能复用的只有画布，数组不能复用。 */
    function thumbnail(canvas) {
        const x = scratch(THUMB_BUF, THUMB_W, THUMB_H);
        x.drawImage(canvas, 0, 0, THUMB_W, THUMB_H);
        const d = x.getImageData(0, 0, THUMB_W, THUMB_H).data;
        const g = new Float32Array(THUMB_W * THUMB_H);
        for (let i = 0; i < g.length; i++) {
            g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
        }
        return g;
    }

    function thumbDiff(a, b) {
        if (!a || !b) return 1;
        let s = 0;
        for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
        return s / a.length / 255;
    }

    /**
     * 边缘密度：粗略判断区域里到底有没有文字，跳过大部分无效 API 调用。
     * 只留两行灰度做滚动比较（水平边看同行左右、垂直边看上下行），结果和「先算完整
     * 灰度矩阵再扫一遍」逐位相同，但省掉每次一块 160×48 的 Float32Array（约 30KB）。
     */
    const EDGE_ROWS = [new Float32Array(EDGE_W), new Float32Array(EDGE_W)];

    function edgeDensity(canvas) {
        const x = scratch(EDGE_BUF, EDGE_W, EDGE_H);
        x.drawImage(canvas, 0, 0, EDGE_W, EDGE_H);
        const d = x.getImageData(0, 0, EDGE_W, EDGE_H).data;
        let cnt = 0;
        let prev = EDGE_ROWS[0], cur = EDGE_ROWS[1];
        for (let y = 0; y < EDGE_H; y++) {
            const rowOff = y * EDGE_W * 4;
            for (let i = 0; i < EDGE_W; i++) {
                const p = rowOff + i * 4;
                cur[i] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
            }
            // 和旧实现一样，第一行没有上一行可对比，从第二行起计数
            if (y > 0) {
                for (let i = 1; i < EDGE_W; i++) {
                    if (Math.abs(cur[i] - cur[i - 1]) > EDGE_GRAD
                        || Math.abs(cur[i] - prev[i]) > EDGE_GRAD) cnt++;
                }
            }
            const t = prev; prev = cur; cur = t;
        }
        return cnt / (EDGE_W * EDGE_H);
    }

    /** 归一化编辑距离，用来判断两次 OCR 结果是不是"同一句话"。
     *  DP 滚动行用模块级缓冲（每次识别出新字幕都可能调一次），不再每回 new 两个
     *  普通数组（稀疏、装箱，还要 GC）；Int32 足够，超长输入会被下面 40000 挡掉。 */
    let SIM_BUF_A = new Int32Array(64);
    let SIM_BUF_B = new Int32Array(64);

    function textSimilarity(a, b) {
        a = (a || '').replace(/\s+/g, '');
        b = (b || '').replace(/\s+/g, '');
        // 最常见的输入就是同一句（整帧没变、或 OCR 结果一字不差），直接给 1，
        // 不必跑一遍 O(m×n) 的动态规划；两边都为空也走这条，结果同样是 1。
        if (a === b) return 1;
        if (!a || !b) return 0;
        // ⚡ 优化：进 DP 前先用相似度上界剪枝 —— 编辑距离至少等于长度差，所以相似度不
        //    可能超过 1 - |la-lb| / maxLen，长度差悬殊的对子（3 字 vs 30 字）原来要跑完
        //    O(m·n) 才返回 0。取 0.2 是最保守的：默认阈值 0.28 意味着 sim > 0.72 才算同一
        //    句，够不到 0.2 的串绝无可能被判重复，所以不改变任何既有结论。
        const la = a.length, lb = b.length;
        const maxLen = la > lb ? la : lb;
        const upper = 1 - (maxLen - (la < lb ? la : lb)) / maxLen;
        if (upper < 0.2) return 0;
        // 列数取较短的那边：滚动行更短，缓存更友好。编辑距离与方向无关，
        // 1 - dist/max(m,n) 也对称，结果不受影响。
        if (a.length < b.length) { const t = a; a = b; b = t; }
        const m = a.length, n = b.length;
        if (m * n > 40000) return 0;   // 太长就不算了（相等已在上面短路）
        if (SIM_BUF_A.length < n + 1) {
            SIM_BUF_A = new Int32Array(n + 1);
            SIM_BUF_B = new Int32Array(n + 1);
        }
        let prev = SIM_BUF_A, cur = SIM_BUF_B;
        for (let j = 0; j <= n; j++) prev[j] = j;
        for (let i = 1; i <= m; i++) {
            cur[0] = i;
            const ca = a.charCodeAt(i - 1);   // charCodeAt 比较比逐字符取字符串快
            for (let j = 1; j <= n; j++) {
                const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
                const del = prev[j] + 1, ins = cur[j - 1] + 1, sub = prev[j - 1] + cost;
                cur[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
            }
            const t = prev; prev = cur; cur = t;
        }
        const dist = prev[n];
        return 1 - dist / Math.max(m, n);
    }

    // ═══════════════════════════════════════════════════════════════
    //  32-util.js — 通用小工具
    //
    //  对外提供：parseModelJson、sleep、canvasToJpeg、stripDataUrlPrefix、
    //              stripWrappingQuotes、LANG_ALIASES、langCode
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    /** 从模型返回里尽力抠出 JSON */
    function parseModelJson(txt) {
        if (!txt) return null;
        let s = String(txt).trim();
        s = s.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
        const a = s.indexOf('{'), b = s.lastIndexOf('}');
        if (a >= 0 && b > a) s = s.slice(a, b + 1);
        try { return JSON.parse(s); } catch (e) { return null; }
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    /** canvas → JPEG data URL。三种引擎最后都走这一步，质量参数按引擎调过 */
    function canvasToJpeg(canvas, quality) {
        return canvas.toDataURL('image/jpeg', quality);
    }

    /** 去掉 data:image/...;base64, 前缀 —— Umi-OCR 和有道的接口都要求纯 base64 */
    function stripDataUrlPrefix(dataUrl) {
        return String(dataUrl).replace(/^data:[^,]*,/, '');
    }

    /** 模型偶尔会给译文套一层引号 / 书名号，剥掉再显示 */
    function stripWrappingQuotes(s) {
        return String(s || '').replace(/^["「『]|["」』]$/g, '').trim();
    }

    /**
     * 语言名 → 语言码（面板填的是「日语 / 简体中文」，各家服务只认 `ja` / `zh`）。
     * 浏览器内置 AI（48-browser-ai.js）和免费网页接口（49-web-translate.js）都用，
     * 所以放在公共模块里。
     *
     * 认不出来返回空串，由调用方决定报错还是退回 `auto` —— **绝不猜**：猜错会静默
     * 翻错语言，用户完全看不出哪里不对。
     */
    const LANG_ALIASES = [
        { code: 'ja', names: ['日语', '日文', '日本語', 'japanese', 'jp'] },
        { code: 'zh', names: ['简体中文', '中文', '汉语', '简体', '中文（简）', 'chinese', 'zh-cn', 'zh-hans'] },
        { code: 'zh-Hant', names: ['繁体中文', '繁體中文', '中文（繁）', 'zh-tw', 'zh-hant'] },
        { code: 'en', names: ['英语', '英文', 'english'] },
        { code: 'ko', names: ['韩语', '韩文', '한국어', 'korean'] },
        { code: 'fr', names: ['法语', '法文', 'french'] },
        { code: 'de', names: ['德语', '德文', 'german'] },
        { code: 'es', names: ['西班牙语', 'spanish'] },
        { code: 'ru', names: ['俄语', 'russian'] },
        { code: 'it', names: ['意大利语', 'italian'] },
        { code: 'pt', names: ['葡萄牙语', 'portuguese'] },
        { code: 'th', names: ['泰语', 'thai'] },
        { code: 'vi', names: ['越南语', 'vietnamese'] },
    ];

    /** 「日语」→「ja」；认不出来返回 ''。已是语言标签的按规范大小写整理 */
    function langCode(name) {
        const s = String(name == null ? '' : name).trim();
        if (!s) return '';
        const low = s.toLowerCase();
        for (let i = 0; i < LANG_ALIASES.length; i++) {
            if (LANG_ALIASES[i].names.indexOf(low) >= 0) return LANG_ALIASES[i].code;
        }
        if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(s)) return '';
        // 主语言小写，4 字母的脚本子标签首字母大写（zh-hant → zh-Hant），
        // 地区子标签全大写（ja-jp → ja-JP）；用户手打 'JA' 也能用。
        const parts = s.split('-');
        parts[0] = parts[0].toLowerCase();
        for (let i = 1; i < parts.length; i++) {
            parts[i] = parts[i].length === 4
                ? parts[i].charAt(0).toUpperCase() + parts[i].slice(1).toLowerCase()
                : parts[i].toUpperCase();
        }
        return parts.join('-');
    }

    // ═══════════════════════════════════════════════════════════════
    //  40-http.js — HTTP：用 GM_xmlhttpRequest 绕过 CORS
    //
    //  对外提供：gmRequest
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    function gmRequest(opts) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: opts.method || 'POST',
                url: opts.url,
                headers: opts.headers || {},
                data: opts.data,
                timeout: opts.timeout || 45000,
                responseType: 'text',
                onload: (r) => resolve(r),
                onerror: () => reject(new Error('网络请求失败（检查地址/代理）')),
                ontimeout: () => reject(new Error('请求超时')),
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  42-youdao-sign.js — 签名素材：SHA-256、UUID 与有道错误码
    //
    //  对外提供：rotr、SHA256_K、sha256HexJS、sha256Hex、youdaoTruncate、uuidHex、
    //              YOUDAO_ERR
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

    const SHA256_K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    /** 纯 JS SHA-256 回退：有道签名必须用 sha256，而 crypto.subtle 只在 https 等「安全上下文」
     *  才存在（已用 Node 的 crypto 逐字节比对验证通过）。 */
    function sha256HexJS(str) {
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
            let c = str.charCodeAt(i);
            if (c < 0x80) {
                bytes.push(c);
            } else if (c < 0x800) {
                bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
            } else if (c < 0xd800 || c >= 0xe000) {
                bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            } else {
                i++;
                c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63),
                    0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            }
        }

        const bitLen = bytes.length * 8;
        bytes.push(0x80);
        while (bytes.length % 64 !== 56) bytes.push(0);
        const hi = Math.floor(bitLen / 4294967296);
        const lo = bitLen >>> 0;
        bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
        bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

        let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        const w = new Array(64);

        for (let i = 0; i < bytes.length; i += 64) {
            for (let j = 0; j < 16; j++) {
                w[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16)
                     | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3];
            }
            for (let j = 16; j < 64; j++) {
                const x = w[j - 15], y = w[j - 2];
                const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
                const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
                w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
            }
            let [a, b, c, d, e, f, g, h] = H;
            for (let j = 0; j < 64; j++) {
                const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                const ch = (e & f) ^ (~e & g);
                const t1 = (h + S1 + ch + SHA256_K[j] + w[j]) | 0;
                const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const t2 = (S0 + maj) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0;
                d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            H = [(H[0] + a) | 0, (H[1] + b) | 0, (H[2] + c) | 0, (H[3] + d) | 0,
                 (H[4] + e) | 0, (H[5] + f) | 0, (H[6] + g) | 0, (H[7] + h) | 0];
        }
        return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
    }

    async function sha256Hex(str) {
        try {
            if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
                const buf = new TextEncoder().encode(str);
                const d = await crypto.subtle.digest('SHA-256', buf);
                return Array.from(new Uint8Array(d))
                    .map(b => b.toString(16).padStart(2, '0')).join('');
            }
        } catch (e) { /* 落到纯 JS 实现 */ }
        return sha256HexJS(str);
    }

    /** 有道的 input 截断规则：q 长度 ≤ 20 → input = q；q 长度 > 20 →
     *  input = q 前 10 字符 + q 长度 + q 后 10 字符。 */
    function youdaoTruncate(q) {
        const len = q.length;
        if (len <= 20) return q;
        return q.substring(0, 10) + len + q.substring(len - 10, len);
    }

    function uuidHex() {
        try {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                return crypto.randomUUID().replace(/-/g, '').toUpperCase();
            }
        } catch (e) { /* ignore */ }
        let s = '';
        for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
        return s.toUpperCase();
    }

    /** 有道常见错误码，便于定位问题 */
    const YOUDAO_ERR = {
        '101': '缺少必填参数',
        '102': '不支持的语言类型（检查 from / to 代码）',
        '103': '翻译文本过长',
        '108': '应用ID无效：appKey 填错，或应用没绑定「图片翻译」服务实例',
        '110': '无相关服务的有效实例：需要在控制台创建「图片翻译」实例并绑定到该应用',
        '113': 'q 不能为空',
        '114': '不支持的图片传输方式',
        '202': '签名校验失败：appSecret 错误，或 base64 里带了 data: 图片头',
        '203': '访问IP不在白名单',
        '205': '接口与应用平台类型不一致：创建应用时要选「API」而不是 Android/iOS SDK',
        '206': '时间戳无效导致签名失败：检查本机系统时间',
        '207': '重放请求：salt 重复了（正常不会发生，每次都是新 UUID）',
        '401': '账户已欠费，体验金用完了',
        '411': '访问频率受限',
        '1004': '识别图片过大',
        '1201': '图片 base64 解密失败：确认传的是纯 base64，不含 data: 前缀',
        '1301': 'OCR 段落识别失败',
        '1411': '访问频率受限',
        '1412': '超过最大识别字节数',
        '2003': '不支持的语言识别类型',
    };

    // ═══════════════════════════════════════════════════════════════
    //  44-umi-ocr.js — Umi-OCR：调用本机运行的离线识别服务
    //
    //  为什么专门支持它：浏览器内置 OCR 需要下载 WASM 内核和十几 MB 语言包，
    //  国内经常连 CDN 都连不上（实测 jsdelivr 通了但页面 CSP 仍会拦掉脚本注入）。
    //  Umi-OCR 把这件事整个搬到浏览器外面 —— 它自带 PaddleOCR 引擎，离线运行，
    //  识别率比浏览器内置方案高一个档次，而且浏览器这边一个字节都不用下。
    //
    //  前提：本机装好并运行 Umi-OCR，且在「全局设置 → 高级」里允许 HTTP 服务。
    //
    //  对外提供：UMI_LANGS、umiBase、umiNiceError、callUmiOCR、umiProbe、
    //              recognizeByUmi
    //  依赖：CFG、gmRequest、stripDataUrlPrefix、canvasToJpeg、translateText
    // ═══════════════════════════════════════════════════════════════
    /** Umi-OCR 的语言选项 → 引擎配置文件 */
    const UMI_LANGS = [
        { code: 'models/config_japan.txt', name: '日本語' },
        { code: 'models/config_chinese.txt', name: '简体中文' },
        { code: 'models/config_chinese_cht(v2).txt', name: '繁體中文' },
        { code: 'models/config_en.txt', name: 'English' },
        { code: 'models/config_korean.txt', name: '한국어' },
        { code: 'models/config_cyrillic.txt', name: 'Русский' },
    ];

    function umiBase() {
        return String(CFG.umiBase || 'http://127.0.0.1:1224').replace(/\/+$/, '');
    }

    /** 把底层网络错误翻译成人话 —— 这个功能最常见的失败就是"没开软件" */
    function umiNiceError(e, r) {
        const s = String((e && e.message) || (r && r.responseText) || '');
        if (/refused|ECONNREFUSED|Failed to fetch|NetworkError|error/i.test(s)) {
            return '连不上本机 Umi-OCR（' + umiBase() + '）。请确认：\n'
                + '1. Umi-OCR 已经启动并在运行\n'
                + '2. 「全局设置」勾选「高级」→ 打开「HTTP 服务」\n'
                + '3. 端口是 ' + (umiBase().match(/:(\d+)/) || [, '1224'])[1];
        }
        return s || '未知错误';
    }

    /** 调 Umi-OCR 识别一张图，返回识别出的文字；接口要求 base64 不带 data:...;base64, 前缀。 */
    async function callUmiOCR(dataUrl) {
        const b64 = stripDataUrlPrefix(dataUrl);
        const body = {
            base64: b64,
            options: {
                'ocr.language': CFG.umiLang || 'models/config_japan.txt',
                // 字幕只有一行，用"单栏-无换行"，避免它自作主张断行
                'tbpu.parser': CFG.umiParser || 'single_none',
                'data.format': 'text',
            },
        };

        let r;
        try {
            r = await gmRequest({
                url: umiBase() + '/api/ocr',
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(body),
                timeout: 30000,
            });
        } catch (e) {
            throw new Error(umiNiceError(e));
        }

        if (r.status < 200 || r.status >= 300) {
            throw new Error('Umi-OCR 返回 HTTP ' + r.status + '：'
                + String(r.responseText || '').slice(0, 160));
        }

        let j;
        try { j = JSON.parse(r.responseText); }
        catch (e) {
            throw new Error('Umi-OCR 返回的不是合法 JSON：'
                + String(r.responseText || '').slice(0, 160));
        }

        // code: 100=成功, 101=无文字, 其余=失败
        if (j.code === 101) return '';
        if (j.code !== 100) {
            throw new Error('Umi-OCR 识别失败（code=' + j.code + '）：' + String(j.data || ''));
        }

        const text = (typeof j.data === 'string')
            ? j.data
            : (Array.isArray(j.data) ? j.data.map(x => x.text || '').join('') : '');
        return String(text).replace(/\s+/g, ' ').trim();
    }

    /** 探测 Umi-OCR 是否在线，并顺便问出支持的参数 */
    async function umiProbe() {
        let r;
        try {
            r = await gmRequest({
                url: umiBase() + '/api/ocr/get_options',
                method: 'GET',
                timeout: 8000,
            });
        } catch (e) {
            throw new Error(umiNiceError(e));
        }
        if (r.status < 200 || r.status >= 300) {
            throw new Error('HTTP ' + r.status + '（地址对吗？）');
        }
        let j = null;
        try { j = JSON.parse(r.responseText); } catch (e) { /* 老版本可能返回空 */ }
        return j || {};
    }

    async function recognizeByUmi(canvas) {
        const original = await callUmiOCR(canvasToJpeg(canvas, 0.92));
        if (!original) return { original: '', translation: '' };
        return { original, translation: await translateText(original) };
    }

    // ═══════════════════════════════════════════════════════════════
    //  46-youdao-image.js — 有道图片翻译接口（OCR + 翻译一步到位）
    //
    //  有道智云「图片翻译」接口：一次调用完成 OCR + 翻译。
    //  文档：https://ai.youdao.com/DOCSIRMA/html/trans/api/tpfy/index.html
    //
    //  对外提供：callYoudaoImage
    //  依赖：CFG、stripDataUrlPrefix、uuidHex、youdaoTruncate、sha256Hex、
    //              gmRequest、YOUDAO_ERR、Diag
    // ═══════════════════════════════════════════════════════════════
    async function callYoudaoImage(dataUrl) {
        if (!CFG.youdaoAppKey || !CFG.youdaoAppSecret) {
            throw new Error('请先填写有道 appKey 和 appSecret');
        }

        // ⚠️ 有道明确要求：base64 不能包含 data:image/...;base64, 这一截图片头
        const b64 = stripDataUrlPrefix(dataUrl);

        const salt = uuidHex();
        const curtime = String(Math.round(Date.now() / 1000));
        const input = youdaoTruncate(b64);
        // sign = sha256(应用ID + input + salt + curtime + 应用密钥)；计算签名时 q 不能做 URL encode，编码只发生在发送前
        const sign = await sha256Hex(
            CFG.youdaoAppKey + input + salt + curtime + CFG.youdaoAppSecret
        );

        // 有道要求「表单」格式，不是 JSON
        const form = new URLSearchParams();
        form.set('type', '1');                                  // 1 = Base64
        form.set('q', b64);
        form.set('from', CFG.youdaoFrom || 'auto');
        form.set('to', CFG.youdaoTo || 'zh-CHS');
        form.set('appKey', CFG.youdaoAppKey);
        form.set('salt', salt);
        form.set('sign', sign);
        form.set('signType', 'v3');
        form.set('curtime', curtime);
        form.set('docType', 'json');
        form.set('render', '0');
        form.set('translateOption', CFG.youdaoLLM ? '1' : '0'); // 1=大模型pro版

        const r = await gmRequest({
            url: 'https://openapi.youdao.com/ocrtransapi',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: form.toString(),
            timeout: 30000,
        });

        if (r.status < 200 || r.status >= 300) {
            throw new Error('HTTP ' + r.status + ' ' + String(r.responseText || '').slice(0, 200));
        }

        let j;
        try { j = JSON.parse(r.responseText); }
        catch (e) { throw new Error('返回内容不是 JSON：' + String(r.responseText || '').slice(0, 160)); }

        const code = String(j.errorCode);
        const regions = Array.isArray(j.resRegions) ? j.resRegions : [];

        Diag.lastYoudao = {
            errorCode: code,
            regionCount: regions.length,
            boxes: regions.map(r => r.boundingBox).filter(Boolean).slice(0, 6),
            req: {
                hadDataPrefix: /^data:/.test(String(dataUrl)),
                b64Len: b64.length,
                signPrefix: sign.slice(0, 12) + '…',
                curtime,
            },
        };

        if (code !== '0') {
            const hint = YOUDAO_ERR[code] ? '（' + YOUDAO_ERR[code] + '）' : '';
            throw new Error('有道错误码 ' + code + hint);
        }

        const original = regions.map(x => (x.context || '').trim()).filter(Boolean).join('\n').trim();
        const translation = regions.map(x => (x.tranContent || '').trim()).filter(Boolean).join('\n').trim();
        return { original, translation };
    }

    // ═══════════════════════════════════════════════════════════════
    //  48-browser-ai.js — 浏览器内置 AI：完全离线的识别 / 翻译
    //
    //  路线：直接调用浏览器**自带**的端侧模型，不联网、不要 API Key、
    //  原文不出设备、也不产生任何 API 费用。
    //
    //    Translator（Translation API）  —— 端侧翻译模型，快，专为翻译训练
    //    LanguageModel（Prompt API）    —— Gemini Nano，可看图（多模态）
    //
    //  于是有两条组合（面板里「识别方式」自己选）：
    //    umi     ：Umi-OCR 认出原文 → Translator 翻译      （识别率最高，推荐）
    //    builtin ：LanguageModel 直接读图得到原文 → Translator 翻译（零安装）
    //
    //  ⚠️ 前提：这是**内核功能**，版本不够时 API 根本不存在 ——
    //     Chrome ≥ 138 / Edge ≥ 148（见 BAI_MIN_VERSION 与 baiVersionNote）。
    //
    //  ⚠️ 四条实测得出的硬约束（Chrome 153 / Edge 145，见 docs/ARCHITECTURE.md）：
    //   1. 会话创建会触发模型下载，而「下载」必须发生在**用户手势**里。
    //      所以下载一律由面板上的「② 准备离线模型」按钮发起（baiPrepare），
    //      主循环里只用已经建好的会话，绝不自己 create() 一个待下载的模型。
    //   2. 端侧模型**声明支持**的语言里没有中文（zh / ko / ru … 都会让
    //      availability() 直接返回 "unavailable"）。所以：
    //        · 要求它输出中文时**不能**写 expectedOutputs，只能靠提示词引导；
    //        · 多模态读图时按「源语言」声明（日语 OK），中文源语言要用 Umi-OCR。
    //   3. 跨域 iframe 默认拿不到这两个 API（Permissions Policy），
    //      而本脚本经常正好挂在播放器的 iframe 里 —— 探测结果里要说清楚。
    //   4. **Edge 和 Chrome 不是同一套实现**（Edge 145 实测）：
    //        · Edge 没有 LanguageModel（没有 Prompt API），只有 Translator，
    //          所以「内置多模态读图」在 Edge 上根本用不了，语言对一旦不支持
    //          也没有端侧大模型可以兜底；
    //        · Edge 的 Translator 对 **日语 → 中文** 这个语言对必报
    //          `UnknownError: Other generic failures occurred.`
    //          （zh / zh-Hans / zh-Hant / zh-CN / zh-TW 全试过，全挂；
    //           而 ja→en、ja→ko、ja→fr、en→zh 都正常 —— 是这一对坏了）。
    //          注意它 create() 会成功、到 translate() 才抛，所以只探测
    //          availability() 是看不出问题的，必须真跑一句（baiPrepare 里的自检）。
    //        · 绕法：经英语中转（ja→en 再 en→zh），两条腿在 Edge 上都是好的。
    //          见 baiPivotTranslate。
    //
    //  对外提供：BAI_OCR_MODES、BAI_TRANS_MODES、BAI_AVAIL_TEXT、
    //              BAI_MIN_VERSION、BAI_OCR_SYSTEM、baiApi、baiSupport、
    //              baiBrowser、baiVersionNote、baiPair、
    //              baiFrameNote、baiAvailability、baiAvailText、baiProbe、
    //              baiPrepare、baiReset、baiJoinChunk、baiTranslate、
    //              baiOcrByBuiltin、recognizeByBrowserAI、baiCollapseRepeat、baiPolish、
    //              baiPairKey、baiMayPivot、baiIsPairFailure、baiBrokenPairs
    //  依赖：CFG、isTopFrame、log、warn、cacheGet、cachePut、stripWrappingQuotes、
    //              canvasToJpeg、callUmiOCR、langCode
    // ═══════════════════════════════════════════════════════════════
    const BAI_OCR_MODES = ['umi', 'builtin'];

    const BAI_TRANS_MODES = ['auto', 'translator', 'prompt'];

    /** 内置 AI 的**内核版本门槛**：低于门槛时这两个 API 根本不存在（连 `typeof` 都拿不到），门槛附近
     *  则可能"API 在、但能力不全"（实测 Edge 145 有 Translator 无 LanguageModel，且 ja→中文 必失败）。 */
    const BAI_MIN_VERSION = { chrome: 138, edge: 148 };

    /**
     * 认浏览器内核与版本：优先 `navigator.userAgentData`（UA 字符串会被简化/冻结，版本号不可靠），
     * 拿不到再退回正则解析 UA。
     * @param {string} [uaOverride] 只在测试里用：直接喂一串 UA 验证解析
     */
    function baiBrowser(uaOverride) {
        let s = typeof uaOverride === 'string' ? uaOverride : '';
        let brand = 'other';
        let major = 0;

        if (uaOverride === undefined) {
            try {
                const d = navigator.userAgentData;
                if (d && Array.isArray(d.brands)) {
                    for (let i = 0; i < d.brands.length; i++) {
                        const b = d.brands[i] || {};
                        const v = parseInt(b.version, 10) || 0;
                        if (/Microsoft Edge/i.test(b.brand)) { brand = 'edge'; major = v; }
                        else if (/Google Chrome/i.test(b.brand) && brand !== 'edge') { brand = 'chrome'; major = v; }
                    }
                }
            } catch (e) { /* 沙箱里可能没有 userAgentData */ }
            if (brand === 'other') {
                try { s = String(navigator.userAgent || ''); } catch (e2) { s = ''; }
            }
        }

        if (brand === 'other') {
            const mEdge = /Edg(?:e|A|iOS)?\/(\d+)/.exec(s);
            const mChrome = /(?:Chrome|Chromium)\/(\d+)/.exec(s);
            if (mEdge) { brand = 'edge'; major = Number(mEdge[1]); }
            else if (mChrome) { brand = 'chrome'; major = Number(mChrome[1]); }
        }

        const min = BAI_MIN_VERSION[brand] || 0;
        const name = brand === 'edge' ? 'Edge' : (brand === 'chrome' ? 'Chrome' : '非 Chromium 内核');
        const known = brand !== 'other';
        return {
            brand: brand,
            major: major,
            min: min,
            name: name,
            known: known,
            ok: known && major >= min,
            text: known ? (name + ' ' + major) : name,
            required: known ? (name + ' ≥ ' + min) : 'Chrome ≥ 138 / Edge ≥ 148',
        };
    }

    /** 版本门槛的提示语；满足要求时返回空串。低于门槛但 API 还在时**不禁止使用**
     *  （某些语言对可能照样能用），只警告。 */
    function baiVersionNote() {
        const b = baiBrowser();
        if (!b.known) {
            return '⚠️ 当前不是 Chromium 内核的浏览器（' + b.text + '）—— 内置 AI 只在 Chrome ≥ 138 / Edge ≥ 148 上提供，请改用其它引擎';
        }
        if (b.major < b.min) {
            return '⚠️ 当前 ' + b.text + ' 低于要求（' + b.required + '）：内置 AI 的 API 在这个版本上不存在或不完整'
                + '（实测 Edge 145 缺少多模态大模型、且「日语 → 中文」必失败）。'
                + '请升级浏览器，或改用 Chrome / 其它引擎。';
        }
        return '';
    }

    //  语言名 → 语言码的映射表在 32-util.js（langCode），49-web-translate.js 用的是同一张表。
    const BAI_AVAIL_TEXT = {
        available: '✅ 已就绪（不用再下载）',
        downloadable: '⬇️ 需要下载（点「② 准备离线模型」）',
        downloading: '⏳ 正在下载…',
        unavailable: '❌ 不支持（语言对或能力不够）',
        unsupported: '❌ 这台浏览器没有这个 API',
        error: '❌ 探测出错',
    };

    /** 多模态读图用的系统提示词。要足够严，否则模型会"顺手翻译"或加上解说。 */
    const BAI_OCR_SYSTEM = '你是视频字幕 OCR 引擎。用户给你一张字幕区域的截图，'
        + '你只把图中出现的文字原样抄出来：不翻译、不解释、不加标点、不要引号、不要换行。'
        + '图中没有文字时，只回复「无文字」四个字。';

    /** 取内置 AI 的全局构造器。不能直接写 `Translator`：不支持时它是未声明标识符，会抛
     *  ReferenceError 而不是给出 undefined（脚本会在 boot 阶段直接崩掉）。 */
    function baiApi(kind) {
        const n = kind === 'translator' ? 'Translator'
            : (kind === 'lm' ? 'LanguageModel' : 'LanguageDetector');
        try {
            if (typeof window !== 'undefined' && window[n]) return window[n];
            if (typeof self !== 'undefined' && self[n]) return self[n];
        } catch (e) { /* 沙箱里取不到就当不支持 */ }
        return null;
    }

    /** 三个内置 API 在不在（只看有没有，不看模型下没下） */
    function baiSupport() {
        return {
            translator: !!baiApi('translator'),
            lm: !!baiApi('lm'),
            detector: !!baiApi('detector'),
        };
    }

    function baiPair() {
        const src = langCode(CFG.srcLang);
        const tgt = langCode(CFG.tgtLang);
        if (!src || !tgt) return null;
        return { src: src, tgt: tgt };
    }

    function baiPairOrThrow() {
        const p = baiPair();
        if (p) return p;
        throw new Error('认不出「' + (CFG.srcLang || '空') + ' / ' + (CFG.tgtLang || '空')
            + '」对应的语言代码 —— 请在面板「语言」里填标准写法，'
            + '例如 日语 / 简体中文 / 英语 / 韩语');
    }

    /** 内置 AI 只对顶层窗口和同源 iframe 开放，这里给出一句人话说明 */
    function baiFrameNote() {
        if (isTopFrame()) return '';
        try {
            // 能读到 top 的 location 就是同源 iframe，权限和顶层一样
            void window.top.location.href;
            return '';
        } catch (e) {
            return '当前页面是跨域 iframe —— 浏览器默认不允许在这里使用内置 AI，'
                + '请把视频页面单独打开（或改用 Umi-OCR 引擎）';
        }
    }

    /** availability() 包一层：API 不存在或抛错都不该让调用方崩掉 */
    async function baiAvailability(kind, opts) {
        const api = baiApi(kind);
        if (!api || typeof api.availability !== 'function') return 'unsupported';
        try {
            return await api.availability(opts || {});
        } catch (e) {
            warn('内置 AI availability 探测失败：', e);
            return 'error';
        }
    }

    function baiAvailText(v) {
        return BAI_AVAIL_TEXT[v] || String(v || '未知');
    }

    function baiNiceError(e, pair) {
        const m = String((e && e.message) || e || '');
        const name = String((e && e.name) || '');
        // 会话被 destroy() 会把在飞的 translate() 打断。正常路径不该发生（见 baiCache 的说明），
        if (baiIsAbort(e)) {
            return '翻译被中断了（端侧会话被重建：多半是刚改过语言/引擎设置，或页面正在切走）'
                + '—— 重新点「② 准备离线模型」，或重新点「开始」即可';
        }
        if (/generic failures occurred/i.test(m)) {
            return '这个浏览器的内置翻译不支持「' + baiPairText(pair) + '」这个语言对'
                + '（Edge 上「日语 → 中文」必报 Generic failures）。'
                + '可以：① 勾选「语言对不可用时经英语中转」；② 改用 Chrome；③ 换其它翻译引擎';
        }
        if (/user gesture/i.test(m)) {
            return '离线模型还没下载好 —— 请点面板上的「② 准备离线模型」'
                + '（浏览器只在用户点击时允许下载模型）';
        }
        if (/permissions policy|disallowed by permissions|not allowed/i.test(m)) {
            return '这个页面不允许使用内置 AI（跨域 iframe 默认被禁）'
                + '—— 请把视频页面单独打开，或改用其它引擎';
        }
        if (/NetworkError/i.test(m)) return '模型下载失败，请检查网络后重试：' + m;
        if (/EncodingError|SecurityError/i.test(m)) {
            return '截图喂不进端侧模型（画布跨域或被污染）：' + m;
        }
        return m || '浏览器内置 AI 调用失败';
    }

    function baiPairText(pair) {
        if (!pair) return (CFG.srcLang || '?') + ' → ' + (CFG.tgtLang || '?');
        return (CFG.srcLang || pair.src) + ' → ' + (CFG.tgtLang || pair.tgt);
    }

    // ── 语言对直连是否可用 ────────────────────────────────────
    //  有些语言对是**坏的**：availability() 说 downloadable/available、create() 也成功，真去 translate()
    //  才抛 UnknownError（Edge 的 ja→中文 就是这样）—— 只能"撞一次才知道"，撞到就记下来，别每帧再撞。

    /** 记录「哪些语言对直连是坏的」：{ 'ja>zh': '错误原文' } */
    const baiBrokenPairs = {};

    function baiPairKey(pair) {
        return pair.src + '>' + pair.tgt;
    }

    /** 这个错误是不是"语言对本身不可用"，而不是网络 / 权限 / 手势问题 */
    function baiIsPairFailure(e) {
        const m = String((e && e.message) || e || '');
        if (/generic failures occurred/i.test(m)) return true;
        // Edge 抛的是 UnknownError，但网络类错误也是 UnknownError，所以限定在没有网络/权限字样时才算
        const name = String((e && e.name) || '');
        return name === 'UnknownError' && !/network|permission|gesture|quota/i.test(m);
    }

    /** 能不能经英语中转：开关开着、且两边都不是英语（英语↔x 不需要中转） */
    function baiMayPivot(pair) {
        return !!CFG.baiPivot && pair.src !== 'en' && pair.tgt !== 'en';
    }

    // ── 会话缓存 ──────────────────────────────────────────────
    //  必须复用：每次翻译都 create() 一遍等于把模型反复加载，单句耗时会从几十毫秒涨到几百毫秒。
    //  ⚠️ 按「用途 + 语言对」存**多个**会话，而不是每用途一个槽位：「经英语中转」要同时用到 ja→en 和
    //     en→zh，只留一个槽位时建第二个会把第一个 destroy() 掉，而 destroy() 会**打断在飞的 translate()**，
    //     真机上直接报 AbortError（Edge 上 ja→中文 必须走中转，所以这个问题在 Edge 上是必现的）。
    const baiCache = new Map();          // '用途|语言对' -> 会话实例
    const BAI_CACHE_MAX = 8;             // 兜底上限；换配置时 baiReset() 会全部清掉

    function baiDrop(inst) {
        try { if (inst && typeof inst.destroy === 'function') inst.destroy(); } catch (e) { }
    }

    /** 按「用途 + key」复用会话；不同 key 各存各的，不会互相销毁 */
    function baiReuse(slot, key, make) {
        const id = slot + '|' + key;
        if (baiCache.has(id)) {
            const inst = baiCache.get(id);
            // 命中的挪到队尾（Map 迭代顺序 = 插入顺序），淘汰时丢最久没用的
            baiCache.delete(id);
            baiCache.set(id, inst);
            return Promise.resolve(inst);
        }
        return Promise.resolve().then(make).then((inst) => {
            baiCache.set(id, inst);
            // 实际到不了这个上限：一个配置下最多同时存在 3 个会话（直连 1 个 + 中转 2 个）
            while (baiCache.size > BAI_CACHE_MAX) {
                const oldest = baiCache.keys().next().value;
                baiDrop(baiCache.get(oldest));
                baiCache.delete(oldest);
            }
            return inst;
        });
    }

    /** 关掉所有会话，下次用的时候重建。换语言 / 换模式 / 用户点「重置」时调 */
    function baiReset() {
        for (const inst of baiCache.values()) baiDrop(inst);
        baiCache.clear();
        log('已释放浏览器内置 AI 会话');
    }

    function baiForget(slot, key) {
        const id = slot + '|' + key;
        if (!baiCache.has(id)) return;
        const inst = baiCache.get(id);
        baiCache.delete(id);
        baiDrop(inst);
    }

    /** 把某个语言对相关的翻译会话全丢掉（直连那个 + 中转那两个） */
    function baiForgetPair(pair) {
        baiForget('translator', pair.src + '>' + pair.tgt);
        if (pair.src !== 'en') baiForget('translator', pair.src + '>en');
        if (pair.tgt !== 'en') baiForget('translator', 'en>' + pair.tgt);
    }

    function baiIsAbort(e) {
        return String((e && e.name) || '') === 'AbortError'
            || /aborted without reason/i.test(String((e && e.message) || ''));
    }

    /** 下载进度事件 → 面板上的进度条（tag 决定文案） */
    const BAI_TAG_NAME = { trans: '内置翻译模型', text: '内置大模型', ocr: '多模态读图模型' };

    function baiMonitorFor(tag, done) {
        return (m) => {
            try {
                m.addEventListener('downloadprogress', (e) => {
                    const pct = Math.max(0, Math.min(1, Number(e.loaded) || 0));
                    done((BAI_TAG_NAME[tag] || '模型') + ' 下载中 ' + Math.round(pct * 100) + '%', pct);
                });
            } catch (e) { /* 监控器不是必须的，加不上就算了 */ }
        };
    }

    // ── 三种会话 ──────────────────────────────────────────────

    /** 内置翻译模型（Translator）。语言对不支持时返回 null，由调用方决定是退回大模型还是直接报错。 */
    async function baiTranslatorSession(pair, opts) {
        const tr = baiApi('translator');
        if (!tr) return null;
        const avail = await baiAvailability('translator', {
            sourceLanguage: pair.src, targetLanguage: pair.tgt,
        });
        if (avail === 'unavailable' || avail === 'unsupported' || avail === 'error') return null;

        const done = (opts && opts.onProgress) || null;
        const key = pair.src + '>' + pair.tgt;
        return await baiReuse('translator', key, async () => {
            try {
                return await tr.create({
                    sourceLanguage: pair.src,
                    targetLanguage: pair.tgt,
                    monitor: done ? baiMonitorFor('trans', done) : undefined,
                });
            } catch (e) {
                throw new Error(baiNiceError(e));
            }
        });
    }

    /** 内置大模型（Prompt API）做**文本**翻译。刻意不写 expectedOutputs：端侧模型声明支持的语言里
     *  没有中文，一旦声明 zh 就会让 availability() 变成 unavailable（Chrome 153 实测），只能靠提示词引导。 */
    async function baiTextSession(pair, opts) {
        const lm = baiApi('lm');
        if (!lm) {
            throw new Error('这台浏览器没有内置大模型（Prompt API）—— 请改用别的翻译引擎');
        }
        const done = (opts && opts.onProgress) || null;
        return await baiReuse('text', 'text|' + pair.src + '>' + pair.tgt, async () => {
            const options = {
                initialPrompts: [{
                    role: 'system',
                    content: '你是专业的影视字幕翻译。把用户给出的' + (CFG.srcLang || pair.src)
                        + '字幕翻译成' + (CFG.tgtLang || pair.tgt) + '。'
                        + '只输出译文本身：不要解释、不要注音、不要重复原文、不要加引号。'
                        + '译文要简洁口语化，符合字幕阅读习惯。',
                }],
            };
            if (done) options.monitor = baiMonitorFor('text', done);
            try {
                return await lm.create(options);
            } catch (e) {
                throw new Error(baiNiceError(e));
            }
        });
    }

    /** 多模态读图会话：直接把截图交给端侧模型认字（不翻译），按「源语言」声明输入语言。
     *  中文不在端侧模型支持列表里，所以源语言是中文时这条路走不通，报错让用户换 Umi-OCR。 */
    async function baiOcrSession(opts) {
        const lm = baiApi('lm');
        if (!lm) {
            throw new Error('这台浏览器没有内置多模态模型（Prompt API）—— '
                + '「浏览器内置读图」用不了，请把「识别方式」改成 Umi-OCR 本地识别');
        }
        const src = langCode(CFG.srcLang) || 'ja';
        const expectedInputs = [{ type: 'text', languages: [src] }, { type: 'image' }];

        const avail = await baiAvailability('lm', { expectedInputs: expectedInputs });
        if (avail === 'unavailable' || avail === 'unsupported' || avail === 'error') {
            throw new Error('端侧模型不支持「看图 + ' + src + '」这种输入 —— '
                + '请把「识别方式」改成 Umi-OCR 本地识别');
        }
        const done = (opts && opts.onProgress) || null;
        return await baiReuse('ocr', 'img|' + src, async () => {
            const options = {
                expectedInputs: expectedInputs,
                initialPrompts: [{ role: 'system', content: BAI_OCR_SYSTEM }],
            };
            if (done) options.monitor = baiMonitorFor('ocr', done);
            try {
                return await lm.create(options);
            } catch (e) {
                throw new Error(baiNiceError(e));
            }
        });
    }

    // ── 准备 / 探测 ───────────────────────────────────────────

    /**
     * 把当前设置需要的会话全部建好（该下载的顺便下载）。
     * ⚠️ 必须在**用户点击的调用栈**里调用：模型还没下载时 Chrome 只在有用户手势时允许 create()。
     * @param {(msg:string, ratio:number)=>void} [onProgress] 进度回调，ratio 到 1 表示结束
     * @returns {Promise<string[]>} 准备好的东西，用于在面板上汇报
     */
    async function baiPrepare(onProgress) {
        const done = (msg, ratio) => { try { onProgress && onProgress(msg, ratio); } catch (e) { } };
        const api = baiSupport();
        if (!api.translator && !api.lm) {
            const ver = baiBrowser();
            throw new Error('这台浏览器没有内置 AI —— 需要 ' + ver.required
                + '（当前 ' + ver.text + '），且页面必须是 HTTPS 或 localhost');
        }
        const verNote = baiVersionNote();

        const pair = baiPairOrThrow();
        const ready = [];
        // 版本不达标时先说清楚（下面照样继续准备：某些语言对可能还能用）
        if (verNote) ready.push(verNote);

        if (CFG.baiOcr === 'builtin') {
            done('正在准备多模态读图模型…', 0);
            await baiOcrSession({ onProgress: done });
            ready.push('多模态读图');
        }

        if (pair.src === pair.tgt) {
            done('', 1);
            ready.push('源语言与目标语言相同（不需要模型）');
            return ready;
        }

        const trans = CFG.baiTrans || 'auto';
        let gotTranslator = false;
        if (trans !== 'prompt' && api.translator) {
            done('正在准备内置翻译模型…', 0);
            const t = await baiTranslatorSession(pair, { onProgress: done });
            gotTranslator = !!t;
            if (gotTranslator) ready.push('内置翻译模型（' + pair.src + ' → ' + pair.tgt + '）');
            else if (trans === 'translator') {
                throw new Error('内置翻译模型不支持 ' + pair.src + ' → ' + pair.tgt
                    + ' 这个语言对 —— 请把「翻译方式」改成「自动」或别的引擎');
            }
        }

        // 会话建好不等于能翻：Edge 上「日语 → 中文」是 create() 成功、translate() 才抛
        // UnknownError。所以在这里真跑一句自检（此刻还在用户手势里，主循环里就没有手势了）。
        if (gotTranslator) {
            const pk = baiPairKey(pair);
            let usable = true;
            try {
                await (await baiTranslatorSession(pair)).translate('Test');
                delete baiBrokenPairs[pk];
            } catch (e) {
                usable = false;
                if (!baiIsPairFailure(e)) throw new Error(baiNiceError(e, pair));
                baiBrokenPairs[pk] = String((e && e.message) || e);

                if (!baiMayPivot(pair)) {
                    throw new Error('这个浏览器的内置翻译不支持「' + baiPairText(pair) + '」这个语言对'
                        + '（' + baiBrokenPairs[pk] + '）。'
                        + '请勾选「语言对不可用时经英语中转」，或改用 Chrome / 其它翻译引擎');
                }
                done('直连不可用，正在准备经英语中转的模型…', 0);
                const toEn = await baiTranslatorSession({ src: pair.src, tgt: 'en' }, { onProgress: done });
                const fromEn = await baiTranslatorSession({ src: 'en', tgt: pair.tgt }, { onProgress: done });
                if (!toEn || !fromEn) {
                    throw new Error('「' + baiPairText(pair) + '」直连不可用，经英语中转的模型也备不齐'
                        + ' —— 请改用 Chrome 或其它翻译引擎');
                }
                ready.push('⚠️ 直连不可用，已改走经英语中转（'
                    + pair.src + ' → en → ' + pair.tgt + '），译文质量会略降');
            }
            if (usable) ready[ready.length - 1] = '内置翻译模型（' + pair.src + ' → ' + pair.tgt + '）✅ 自检通过';
        }

        if (!gotTranslator) {
            done('正在准备内置大模型…', 0);
            await baiTextSession(pair, { onProgress: done });
            ready.push('内置大模型（文本翻译）');
        }

        done('', 1);
        return ready;
    }

    /** 环境探测：一次问清「能不能用、缺什么、要不要下载」；只查询可用性，不下载、不建会话。 */
    async function baiProbe() {
        const rows = [];
        const add = (label, value, kind) => rows.push({ label: label, value: value, kind: kind || 'info' });
        const api = baiSupport();

        const ver = baiBrowser();
        add('浏览器内核', ver.known
            ? (ver.text + (ver.ok ? '（满足 ' + ver.required + '）' : '（⚠️ 低于 ' + ver.required + '）'))
            : (ver.text + '（内置 AI 只在 ' + ver.required + ' 上提供）'),
            ver.ok ? 'ok' : 'bad');

        add('Translator（端侧翻译）', api.translator ? '支持' : '不支持', api.translator ? 'ok' : 'bad');
        add('LanguageModel（端侧多模态）', api.lm ? '支持' : '不支持', api.lm ? 'ok' : 'bad');
        add('LanguageDetector（语种检测）', api.detector ? '支持' : '不支持', api.detector ? 'ok' : 'warn');

        let secure = false;
        try { secure = !!window.isSecureContext; } catch (e) { }
        add('安全上下文', secure ? '是' : '否（需要 HTTPS 或 localhost）', secure ? 'ok' : 'bad');

        const frameNote = baiFrameNote();
        add('顶层 / 同源框架', frameNote ? '跨域 iframe' : '是', frameNote ? 'bad' : 'ok');

        const pair = baiPair();
        if (!pair) {
            add('语言方向', '认不出「' + (CFG.srcLang || '空') + ' / ' + (CFG.tgtLang || '空')
                + '」，请填标准语言名', 'bad');
            return rows;
        }
        add('语言方向', pair.src + ' → ' + pair.tgt, 'info');

        // 坏语言对只有真跑一句才知道（见 baiBrokenPairs），这里只汇报"已经试出来"的结果，不偷偷发翻译请求。
        const broken = baiBrokenPairs[baiPairKey(pair)];
        if (broken) {
            add('语言对直连', baiMayPivot(pair)
                ? '❌ 不支持（已改走经英语中转）'
                : '❌ 不支持（可勾选「经英语中转」绕过）', 'warn');
        }

        if (api.translator) {
            const a = await baiAvailability('translator', {
                sourceLanguage: pair.src, targetLanguage: pair.tgt,
            });
            add('内置翻译模型', baiAvailText(a), a === 'available' || a === 'downloadable' || a === 'downloading' ? 'ok' : 'bad');
        }
        if (api.lm) {
            const a = await baiAvailability('lm', {});
            add('内置大模型（文本）', baiAvailText(a), a === 'available' || a === 'downloadable' || a === 'downloading' ? 'ok' : 'bad');

            const srcCode = langCode(CFG.srcLang) || 'ja';
            const ai = await baiAvailability('lm', {
                expectedInputs: [{ type: 'text', languages: [srcCode] }, { type: 'image' }],
            });
            add('内置多模态读图（' + srcCode + '）', baiAvailText(ai),
                ai === 'available' || ai === 'downloadable' || ai === 'downloading' ? 'ok' : 'bad');
        } else if (api.translator) {
            // Edge 就是这样：只有 Translator，没有 Prompt API
            add('兜底能力', '没有 Prompt API —— 语言对一旦不支持就没有端侧大模型可退', 'warn');
        }
        return rows;
    }

    // ── 翻译 ─────────────────────────────────────────────────

    /** 流式分片拼接：Chrome 现在给的是「累计文本」（每块都从头开始），但规范讨论过改成「增量」，
     *  两种都认，免得哪天升级就串字。 */
    function baiJoinChunk(acc, chunk) {
        const c = String(chunk == null ? '' : chunk);
        if (!c) return acc;
        if (c.indexOf(acc) === 0) return c;
        return acc + c;
    }

    /** 会话支持流式且有回调时走流式，返回累计文本；否则返回 null（调用方走一次性调用） */
    async function baiStreamTo(session, method, input, onDelta) {
        if (!onDelta || typeof session[method] !== 'function') return null;
        let it;
        try { it = session[method](input); } catch (e) { return null; }
        if (!it || typeof it[Symbol.asyncIterator] !== 'function') return null;
        let acc = '';
        for await (const chunk of it) {
            acc = baiJoinChunk(acc, chunk);
            if (acc) onDelta(acc);
        }
        return acc;
    }

    /**
     * 压掉「同一个短片段连续重复很多次」的退化输出：端侧模型遇到「ああっああっああっ」这种纯拟声字幕会失控 ——
     * 实测 18 字原文 `ja→en` 吐 971 字 `"Oh, oh, oh…"`，再过一遍 `en→zh` 被放大成 3613 字、耗时 5.6 秒，
     * 悬浮层直接被刷满整屏。压成两遍既保住语义又不糊满画面（阈值「单元 1~6 字符 + 重复 ≥5 次」，
     * 「谢谢谢谢」这种正常四连重复不会误伤）。
     */
    function baiCollapseRepeat(text) {
        const s = String(text == null ? '' : text);
        if (s.length < 24) return s;      // 短文本不可能构成「超长重复」
        return s.replace(/([\s\S]{1,6}?)\1{4,}/g, '$1$1');
    }

    /** 译文收尾：去残留引号 → 压退化重复 → 长度兜底（三条都是针对端侧模型的坏习惯，正常输出原样返回）。 */
    function baiPolish(out, source) {
        let s = String(out == null ? '' : out).trim();
        // 模型常常只在一头加引号（"哦,哦,哦…），stripWrappingQuotes 要求两头都有，所以这里也去掉单边残留
        s = s.replace(/^["“”'‘’「『]+/, '').replace(/["“”'‘’」』]+$/, '').trim();
        s = baiCollapseRepeat(s);
        // 压完常常留一个尾逗号（"哦,哦,"），显示出来很别扭
        s = s.replace(/[,，、;；:：]+$/, '').trim();
        // 压完仍长得离谱就截断：字幕放不下，再长也没意义
        const cap = Math.max(80, String(source == null ? '' : source).length * 4);
        if (s.length > cap) {
            s = s.slice(0, cap).replace(/[,，、;；:：\s]+$/, '') + '…';
        }
        return s.trim();
    }

    /** 只用内置翻译模型翻一句。语言对不支持（或没有 Translator）时返回 null。 */
    async function baiViaTranslator(text, pair, onDelta) {
        const t = await baiTranslatorSession(pair);
        if (!t) return null;
        const s = await baiStreamTo(t, 'translateStreaming', text, onDelta);
        return (s === null) ? await t.translate(text) : s;
    }

    /**
     * 经英语中转：原文 → 英语 → 目标语言。Edge 上「日语 → 中文」直连必失败，但 ja→en 和 en→zh 两条腿都是
     * 好的，中转就成了唯一还能离线跑通的路；代价是过两道翻译，语气和专有名词会比直连差，所以只在直连
     * 确认失败后才用（不是默认路径）。流式只用在第二段：第一段的英语产物没有显示价值。
     */
    async function baiPivotTranslate(text, pair, onDelta) {
        const toEn = await baiTranslatorSession({ src: pair.src, tgt: 'en' });
        const fromEn = await baiTranslatorSession({ src: 'en', tgt: pair.tgt });
        if (!toEn || !fromEn) return null;

        const midRaw = await toEn.translate(text);
        if (!midRaw || !String(midRaw).trim()) return null;
        // 第一段同样会失控（实测 18 字原文 → 971 字的 "Oh, oh, oh…"），
        // 不在这里压掉的话，它会被第二段**放大一轮**（→ 3613 字、5.6 秒）
        const mid = baiCollapseRepeat(String(midRaw).trim());

        const s = await baiStreamTo(fromEn, 'translateStreaming', mid, onDelta);
        return (s === null) ? await fromEn.translate(mid) : s;
    }

    /** 把一句原文翻成目标语言（全离线）。
     *  @param {{onDelta?:(partial:string)=>void}} [opts] onDelta 收到的是**累计**译文 */
    async function baiTranslate(text, opts) {
        const clean = String(text == null ? '' : text).trim();
        if (!clean) return '';
        const onDelta = opts && opts.onDelta;

        const pair = baiPairOrThrow();
        if (pair.src === pair.tgt) return clean;

        const trans = CFG.baiTrans || 'auto';
        const pivot = !!CFG.baiPivot;
        // 中转开关也进 key：关掉之后不该命中"中转出来的"旧译文
        const key = 'bai|' + trans + '|' + (pivot ? 'p' : 'd') + '|' + baiPairKey(pair) + '|' + clean;
        const hit = cacheGet(key);
        if (hit !== undefined) {
            if (onDelta) onDelta(hit);
            return hit;
        }

        const pk = baiPairKey(pair);
        let out = null;

        if (trans !== 'prompt') {
            // 已经知道这个语言对直连是坏的，就别每帧再去撞一次同样的错
            if (!baiBrokenPairs[pk]) {
                try {
                    out = await baiViaTranslator(clean, pair, onDelta);
                } catch (e) {
                    // 会话被销毁过（AbortError）→ 丢掉重建，否则后面每一句都会继续失败
                    if (baiIsAbort(e)) baiForgetPair(pair);
                    if (!baiIsPairFailure(e) || !baiMayPivot(pair)) {
                        throw new Error(baiNiceError(e, pair));
                    }
                    baiBrokenPairs[pk] = String((e && e.message) || e);
                    warn('内置翻译不支持语言对 ' + pk + '（' + baiBrokenPairs[pk] + '），改用经英语中转');
                    out = null;
                }
            }
            if (out !== null) {
                // 直连这次成功了，说明之前记的"坏了"已经过期
                if (baiBrokenPairs[pk]) delete baiBrokenPairs[pk];
            } else if (baiMayPivot(pair)) {
                try {
                    out = await baiPivotTranslate(clean, pair, onDelta);
                } catch (e) {
                    if (baiIsAbort(e)) baiForgetPair(pair);
                    throw new Error(baiNiceError(e, pair));
                }
                if (out === null) {
                    throw new Error('「' + baiPairText(pair) + '」在经英语中转后仍然失败'
                        + '—— 请改用 Chrome 或其它翻译引擎');
                }
            } else if (trans === 'translator') {
                throw new Error('内置翻译不支持「' + baiPairText(pair) + '」这个语言对'
                    + '（Edge 上「日语 → 中文」就是这样）。'
                    + '请勾选「语言对不可用时经英语中转」，或改用 Chrome / 其它引擎');
            }
        }

        if (out === null) {
            const s = await baiTextSession(pair);
            const prompt = '把下面这句' + (CFG.srcLang || pair.src) + '字幕翻译成'
                + (CFG.tgtLang || pair.tgt) + '，只输出译文：\n' + clean;
            out = await baiStreamTo(s, 'promptStreaming', prompt, onDelta);
            if (out === null) out = await s.prompt(prompt);
        }

        const result = baiPolish(out, clean);
        cachePut(key, result);
        return result;
    }

    // ── 识别 ─────────────────────────────────────────────────

    /** 画布 → Blob。转一手是为了**快照**：captureMode 下画布是复用的，直接把 canvas 交给异步的
     *  模型调用，像素可能已经被下一帧盖掉。 */
    function baiCanvasBlob(canvas) {
        return new Promise((resolve, reject) => {
            let done = false;
            const fail = (msg) => { if (!done) { done = true; reject(new Error(msg)); } };
            const timer = setTimeout(() => fail('截图编码超时'), 8000);
            try {
                canvas.toBlob((b) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (b) resolve(b);
                    else reject(new Error('截图编码失败（画布是空的？）'));
                }, 'image/jpeg', 0.9);
            } catch (e) {
                clearTimeout(timer);
                fail('读不到截图像素（视频跨域？）：' + (e && e.message || e));
            }
        });
    }

    /** 模型偶尔会附带解说 / 代码块 / 引号，这里清干净 */
    function baiCleanOcr(txt) {
        let s = String(txt == null ? '' : txt).trim();
        s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
        s = s.replace(/^(?:图中(?:的)?文字(?:是|为)?|识别结果|文字内容|字幕内容)\s*[:：]\s*/, '');
        s = stripWrappingQuotes(s);
        s = s.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (/^(?:无文字|没有文字|无|空|none|n\/a|\(无\)|（无）)$/i.test(s)) return '';
        return s;
    }

    async function baiOcrByBuiltin(canvas) {
        const session = await baiOcrSession();
        const blob = await baiCanvasBlob(canvas);
        let out;
        try {
            out = await session.prompt([{
                role: 'user',
                content: [
                    { type: 'text', value: '请把这张字幕截图里的文字原样抄出来。' },
                    // 图片必须以内容块的形式放在 user 消息里
                    { type: 'image', value: blob },
                ],
            }]);
        } catch (e) {
            throw new Error(baiNiceError(e));
        }
        return baiCleanOcr(out);
    }

    /** 离线引擎的统一入口：识别（Umi-OCR 或端侧多模态）→ 端侧翻译，返回值与其它引擎一致。 */
    async function recognizeByBrowserAI(canvas, opts) {
        const onDelta = opts && opts.onDelta;
        const useBuiltin = CFG.baiOcr === 'builtin';

        const original = useBuiltin
            ? await baiOcrByBuiltin(canvas)
            : await callUmiOCR(canvasToJpeg(canvas, 0.92));

        if (!original) return { original: '', translation: '' };

        // 把原文一并交给流式回调，好让悬浮层在"边生成边出字"时也能显示原文
        const wrapped = onDelta ? (partial) => onDelta(partial, original) : undefined;
        return { original: original, translation: await baiTranslate(original, { onDelta: wrapped }) };
    }

    // ═══════════════════════════════════════════════════════════════
    //  49-web-translate.js — 逆向免费网页接口翻译
    //
    //  不申请任何 API Key，直接复用翻译网站自己前端在用的那份接口。
    //  只做**文本翻译**，所以识别仍由本机 Umi-OCR 负责。
    //
    //  ⚠️ 性质说明（用之前先读，面板上也会原样提示）：
    //    · 这些都是各家的**内部接口**，不是公开 API，服务条款上通常不
    //      允许第三方直接调用。请仅作个人自用 / 学习，不要刷量。
    //    · 随时可能改版、限流、封 IP。所以这里做了「降级链 + 限速 + 缓存」，
    //      并且把每个引擎的成败记进诊断报告，出问题能一眼看出是谁挂了。
    //    · 要稳定就还是走官方 API 或本地模型（见 browser-ai / 大模型引擎）。
    //
    //  2026-09 本机实测（三个都活着）：
    //    tencent  transmart.qq.com/api/imt        纯 JSON，无任何鉴权，最省事
    //    caiyun   api.interpreter.caiyunai.com    前端公开 token，哪天被撤就废
    //    bing     cn.bing.com/ttranslatev3        要抓 IG + token，最稳
    //    实测补充：www.bing.com 会返回 200 + **空 body**（必须用 cn.bing.com）；
    //    tencent 不校验 Referer，bing 也不校验，所以油猴里不必伪造来源头。
    //
    //  对外提供：WT_ENGINES、WT_DEFAULT_ORDER、wtStats、wtReset、wtOrder、
    //              wtLangPair、wtTranslate、wtSelftest、recognizeByWebTranslate
    //  依赖：CFG、WT_ENGINE_CHOICES、gmRequest、canvasToJpeg、callUmiOCR、
    //              cacheGet、cachePut、sleep、langCode、stripWrappingQuotes、
    //              log、warn、Diag
    // ═══════════════════════════════════════════════════════════════
    /** 降级链顺序（auto 模式）：先挑最不容易失效的 */
    const WT_DEFAULT_ORDER = ['tencent', 'caiyun', 'bing'];

    const WT_ENGINES = [
        { id: 'tencent', label: '腾讯交互翻译', note: '纯 JSON、不需要任何 token，最省事' },
        { id: 'caiyun', label: '彩云小译', note: '用前端公开的 token，哪天被撤就废' },
        { id: 'bing', label: '必应翻译', note: '要抓 IG + token，最稳；token 会过期，会自动重取' },
    ];

    const wtStats = {};
    function wtStat(id, ok) {
        if (!wtStats[id]) wtStats[id] = { ok: 0, fail: 0, lastError: '' };
        if (ok) wtStats[id].ok++;
        else wtStats[id].fail++;
    }

    function wtOrder() {
        const want = CFG.wtEngine || 'auto';
        if (want !== 'auto' && WT_ENGINE_CHOICES.indexOf(want) > 0) return [want];
        return WT_DEFAULT_ORDER.slice();
    }

    /** 同一引擎两次请求的最小间隔 —— 别把人家的接口打挂了（也就不会被封） */
    const wtLastCall = {};
    async function wtThrottle(id) {
        const gap = Math.max(0, Number(CFG.wtMinInterval) || 0);
        if (!gap) return;
        const wait = gap - (Date.now() - (wtLastCall[id] || 0));
        if (wait > 0) await sleep(wait);
        wtLastCall[id] = Date.now();
    }

    function wtReset() {
        for (const k in wtLastCall) delete wtLastCall[k];
        wtBingCtx = null;
        log('已重置免费网页接口状态');
    }

    // ── 各家自己的语言码 ─────────────────────────────────────
    //  同一个语言各家叫法不同，这一层是"一个接口吃所有引擎"成立的关键；返回 null 表示该引擎用不了这个语言对。
    function wtLangPair(id, src, tgt) {
        if (src === tgt) return null;
        if (id === 'bing') {
            const f = src === 'auto' ? 'auto-detect' : (src === 'zh' ? 'zh-Hans' : src);
            const t = tgt === 'zh' ? 'zh-Hans' : tgt;
            return { from: f, to: t };
        }
        if (id === 'caiyun') {
            if (src === 'auto') return null;          // 彩云不接受 auto，必须显式给源语言
            const t = tgt === 'zh-Hant' ? 'zh' : tgt; // 它只有 zh 这一个中文标签
            return { from: src, to: t, tt: src + '2' + t };
        }
        // tencent：语言码和我们的规范码基本一致
        return { from: src === 'auto' ? 'auto' : src, to: tgt === 'zh-Hant' ? 'zh-TW' : tgt };
    }

    // ── 三个引擎 ─────────────────────────────────────────────

    /** 腾讯交互翻译：纯 JSON POST，无鉴权 */
    async function wtCallTencent(text, l) {
        const r = await gmRequest({
            url: 'https://transmart.qq.com/api/imt',
            headers: {
                'Content-Type': 'application/json',
                Referer: 'https://transmart.qq.com/zh-CN/index',
            },
            data: JSON.stringify({
                header: { fn: 'auto_translation', client_key: 'browser-chrome' },
                type: 'plain',
                model_category: 'normal',
                source: { lang: l.from, text_list: [text] },
                target: { lang: l.to },
            }),
            timeout: 20000,
        });
        if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
        let j;
        try { j = JSON.parse(r.responseText); } catch (e) { throw new Error('返回不是 JSON'); }
        if (!j || !j.header || j.header.ret_code !== 'succ') {
            throw new Error('接口返回 ' + ((j && j.header && j.header.ret_code) || '?'));
        }
        const out = j.auto_translation && j.auto_translation[0];
        if (out === undefined) throw new Error('返回里没有 auto_translation 字段');
        return out;
    }

    /** 彩云小译：token 硬编码在它自己前端里 */
    async function wtCallCaiyun(text, l) {
        const r = await gmRequest({
            url: 'https://api.interpreter.caiyunai.com/v1/translator',
            headers: {
                'Content-Type': 'application/json',
                'x-authorization': 'token 3975l6lr5pcbvidl6jl2',
            },
            data: JSON.stringify({
                source: [text],
                trans_type: l.tt,
                request_id: 'h1sub',
                detect: true,
            }),
            timeout: 20000,
        });
        if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
        let j;
        try { j = JSON.parse(r.responseText); } catch (e) { throw new Error('返回不是 JSON'); }
        if (!j || j.rc !== 0) throw new Error('rc=' + ((j && j.rc) || '?'));
        const out = j.target && j.target[0];
        if (out === undefined) throw new Error('返回里没有 target 字段');
        return out;
    }

    /** 必应的 token / IG 上下文，抓一次复用；过期（空 body）时重抓 */
    let wtBingCtx = null;

    function wtBingHost() {
        return 'cn.bing.com';   // www.bing.com 会回 200 + 空 body，不能用
    }

    async function wtBingPrepare() {
        const host = wtBingHost();
        const r = await gmRequest({
            url: 'https://' + host + '/translator',
            method: 'GET',
            headers: { Accept: 'text/html,application/xhtml+xml' },
            timeout: 20000,
        });
        if (r.status < 200 || r.status >= 300) throw new Error('取页面 HTTP ' + r.status);
        const html = String(r.responseText || '');
        const ig = (/IG:"([0-9A-Fa-f]+)"/.exec(html) || [])[1];
        const abuse = /params_AbusePreventionHelper\s*=\s*\[(\d+),\s*"([^"]+)"/.exec(html);
        if (!ig || !abuse) throw new Error('页面里抓不到 IG / params_AbusePreventionHelper（对方改版了）');
        wtBingCtx = { host: host, ig: ig, key: abuse[1], token: abuse[2] };
        return wtBingCtx;
    }

    async function wtCallBing(token) {
        const l = token.l;
        const ctx = wtBingCtx || await wtBingPrepare();
        const r = await gmRequest({
            url: 'https://' + ctx.host + '/ttranslatev3?isVertical=1&IG=' + ctx.ig + '&IID=translator.5028',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Referer: 'https://' + ctx.host + '/translator',
                Origin: 'https://' + ctx.host,
            },
            data: new URLSearchParams({
                fromLang: l.from, text: token.text, to: l.to,
                token: ctx.token, key: ctx.key,
            }).toString(),
            timeout: 20000,
        });
        const raw = String(r.responseText || '');
        if (!raw) {
            // 空 body = token 过期。让上层重建会话（cookie 也跟着重来）
            const e = new Error('返回空 body（HTTP ' + r.status + '）—— token 大概率过期了');
            e.wtTokenExpired = true;
            throw e;
        }
        let j;
        try { j = JSON.parse(raw); } catch (e) { throw new Error('返回不是 JSON：' + raw.slice(0, 120)); }
        const out = j && j[0] && j[0].translations && j[0].translations[0] && j[0].translations[0].text;
        if (!out) throw new Error('返回里没有译文：' + raw.slice(0, 120));
        return out;
    }

    async function wtCallEngine(id, text, src, tgt) {
        const l = wtLangPair(id, src, tgt);
        if (!l) throw new Error('不支持这个语言对');
        await wtThrottle(id);
        if (id === 'tencent') return await wtCallTencent(text, l);
        if (id === 'caiyun') return await wtCallCaiyun(text, l);
        try {
            return await wtCallBing({ text: text, l: l });
        } catch (e) {
            if (!e.wtTokenExpired) throw e;
            wtBingCtx = null;
            log('必应 token 过期，重取一次');
            await wtThrottle(id);
            return await wtCallBing({ text: text, l: l });
        }
    }

    /** 翻译一句：按配置的降级链逐个试，全挂了才抛错（错误里带每一家的原因）。
     *  @param {string} text  @returns {Promise<string>} */
    async function wtTranslate(text) {
        const clean = String(text == null ? '' : text).trim();
        if (!clean) return '';

        const src = langCode(CFG.srcLang) || 'auto';
        const tgt = langCode(CFG.tgtLang) || 'zh';
        if (src === tgt) return clean;

        const order = wtOrder();
        const key = 'wt|' + order.join(',') + '|' + src + '>' + tgt + '|' + clean;
        const hit = cacheGet(key);
        if (hit !== undefined) return hit;

        const errors = [];
        for (const id of order) {
            try {
                const out = await wtCallEngine(id, clean, src, tgt);
                if (!out || !String(out).trim()) throw new Error('返回空译文');
                wtStat(id, true);
                const res = stripWrappingQuotes(String(out).trim());
                cachePut(key, res);
                return res;
            } catch (e) {
                wtStat(id, false);
                wtStats[id].lastError = String((e && e.message) || e);
                warn('免费接口 ' + id + ' 失败：', e);
                errors.push(id + '：' + ((e && e.message) || e));
            }
        }
        Diag.wtLastError = errors.join('；');
        throw new Error('免费网页接口全部失败（可换「翻译接口」或改用其它引擎）：\n  ' + errors.join('\n  '));
    }

    /** 把三个引擎各试一次，给面板「测试各接口」用；只读结果、不改配置，返回 [{id,label,ok,out,err,ms}]。 */
    async function wtSelftest() {
        const src = langCode(CFG.srcLang) || 'ja';
        const tgt = langCode(CFG.tgtLang) || 'zh';
        const sample = src === 'ja' ? 'こんにちは、いい天気ですね。' : 'Hello, nice weather today.';
        const rows = [];
        for (const meta of WT_ENGINES) {
            const t0 = Date.now();
            try {
                const out = await wtCallEngine(meta.id, sample, src, tgt);
                rows.push({ id: meta.id, label: meta.label, ok: true, out: String(out).trim(), ms: Date.now() - t0 });
            } catch (e) {
                rows.push({ id: meta.id, label: meta.label, ok: false, err: String((e && e.message) || e), ms: Date.now() - t0 });
            }
        }
        return rows;
    }

    /** 免费网页接口引擎的统一入口：本机 Umi-OCR 识别 → 免费接口翻译 */
    async function recognizeByWebTranslate(canvas) {
        const original = await callUmiOCR(canvasToJpeg(canvas, 0.92));
        if (!original) return { original: '', translation: '' };
        return { original: original, translation: await wtTranslate(original) };
    }

    // ═══════════════════════════════════════════════════════════════
    //  50-capturer.js — 截图器：element / display 两种捕获方式
    //
    //  element 模式直接读 <video> 的画面，最快、无需授权；
    //  跨域 CDN 未发 CORS 头时画布会被污染，此时抛 TAINTED 由主循环切到 display 模式。
    //  display 模式用 getDisplayMedia 捕获标签页，一定能拿到像素，但要用户授权一次。
    //
    //  对外提供：Capturer
    //  依赖：CFG、findVideo、getContentBox、resolveRegion、UI、log、warn
    // ═══════════════════════════════════════════════════════════════
    const Capturer = {
        mode: 'element',        // 当前实际使用的模式
        displayStream: null,
        displayVideo: null,
        // 截图输出画布（crop 的产物）复用同一个：原来每截一帧就新建 canvas + 2d context
        // + 整块像素后备存储（1400×116 约 650KB），而调用方都是「拿到立刻用掉」，没人跨周期持有。
        _out: null,
        _outCtx: null,

        /** 从 <video> 元素直接截图；画布被跨域污染时抛 'TAINTED'。 */
        grabFromElement(region, video) {
            video = video || findVideo();
            if (!video || !video.videoWidth) return null;

            const box = getContentBox(video);
            // 区域是按"框选时视频所在位置"存的比例，视频挪了要跟着挪；box 顺手传进去，省一次布局读取
            region = resolveRegion(region, video, box);

            // 区域和视频画面基本不重叠（滚动太多 / 换了播放器布局 / 老配置没带锚点）时，
            // 下面的 Math.max(0, …) 会把坐标硬夹到边上：截出无关画面、不报错、钱照扣 → 直接判掉。
            const ovW = Math.min(region.x + region.w, box.left + box.width)
                - Math.max(region.x, box.left);
            const ovH = Math.min(region.y + region.h, box.top + box.height)
                - Math.max(region.y, box.top);
            if (ovW < region.w * 0.5 || ovH < region.h * 0.5) return null;

            const fx = (region.x - box.left) / box.width;
            const fy = (region.y - box.top) / box.height;
            const fw = region.w / box.width;
            const fh = region.h / box.height;

            const vw = video.videoWidth, vh = video.videoHeight;
            const sx = Math.max(0, Math.round(fx * vw));
            const sy = Math.max(0, Math.round(fy * vh));
            const sw = Math.min(vw - sx, Math.round(fw * vw));
            const sh = Math.min(vh - sy, Math.round(fh * vh));

            const c = this.crop(video, sx, sy, sw, sh);
            if (!c) return null;

            try { c.getContext('2d').getImageData(0, 0, 1, 1); }
            catch (e) { const err = new Error('TAINTED'); err.code = 'TAINTED'; throw err; }

            return c;
        },

        async startDisplayCapture() {
            if (this.displayStream) return;

            // http 页面不是「安全上下文」，navigator.mediaDevices 直接是 undefined；原来这里一律报
            // "用户取消了授权"，用户会反复重试一个根本弹不出来的窗口。
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                throw new Error('当前页面不是 https，浏览器不允许截屏。'
                    + '请改用「直接读取视频元素」模式，或把脚本切到 https 页面上用');
            }

            let stream;
            try {
                stream = await navigator.mediaDevices.getDisplayMedia({
                    video: { frameRate: 30 },
                    audio: false,
                    preferCurrentTab: true,
                    selfBrowserSurface: 'include',
                });
            } catch (e) {
                // 区分"用户拒绝"和"参数不被支持"——后者换掉扩展选项重试一次
                if (e && e.name === 'NotAllowedError') {
                    throw new Error('你拒绝了屏幕共享授权');
                }
                try {
                    stream = await navigator.mediaDevices.getDisplayMedia({
                        video: { frameRate: 30 }, audio: false,
                    });
                } catch (e2) {
                    throw new Error('无法启动屏幕共享：'
                        + String(e2 && e2.message || e2).slice(0, 120));
                }
            }

            const v = document.createElement('video');
            v.srcObject = stream;
            v.muted = true;
            v.playsInline = true;
            try {
                await v.play();
            } catch (e) {
                // 起播失败就把流关掉，否则会留下"有流但没画面"的僵死状态：之后每次申请都被开头的
                // if (this.displayStream) return 挡掉
                try { stream.getTracks().forEach(t => t.stop()); } catch (e2) { }
                throw new Error('屏幕共享已授权但视频起播失败：' + String(e && e.message).slice(0, 100));
            }

            // 全部成功之后才落状态，保证 displayStream / displayVideo / mode 三者一致
            this.displayStream = stream;
            this.displayVideo = v;
            this.mode = 'display';

            stream.getVideoTracks()[0].addEventListener('ended', () => {
                warn('屏幕共享已结束，切回 element 模式');
                this.displayStream = null;
                this.displayVideo = null;
                this.mode = 'element';
                UI.setStatus('共享已结束，已切回直接读取模式', 'warn');
            });
            log('display 捕获已启动');
        },

        stopDisplayCapture() {
            if (this.displayStream) {
                try { this.displayStream.getTracks().forEach(t => t.stop()); } catch (e) { }
            }
            this.displayStream = null;
            this.displayVideo = null;
            if (this.mode === 'display') this.mode = 'element';
            log('已停止 display 捕获');
        },

        /**
         * 把源画面的一块区域裁出来并适度放大：两种捕获方式的裁切算法完全一样、只有源不同，所以收在这里一份。
         * 放大倍率按经验定：字幕只有几十像素高时 OCR 基本认不出来，适度放大会明显提升准确率，但放太大只是白烧 token，所以封顶 3 倍、宽 1400。
         * 注意：返回的是复用画布 this._out，下一次 crop 会覆盖它（需要长期持有的调用方请先自行拷贝）。
         * @returns {HTMLCanvasElement|null} 区域太小（≤1px）时返回 null
         */
        crop(src, sx, sy, sw, sh) {
            if (sw <= 1 || sh <= 1) return null;

            let scale = Math.min(3, Math.max(1, 200 / sh));
            if (sw * scale > 1400) scale = 1400 / sw;
            const w = Math.max(2, Math.round(sw * scale));
            const h = Math.max(2, Math.round(sh * scale));

            // 改 canvas 尺寸会重置 context 的全部状态，所以只在尺寸变化时才重建并重新设置缩放参数
            if (!this._out || this._out.width !== w || this._out.height !== h) {
                const c = this._out || document.createElement('canvas');
                c.width = w;
                c.height = h;
                this._out = c;
                this._outCtx = c.getContext('2d', { willReadFrequently: true });
                this._outCtx.imageSmoothingEnabled = true;
                this._outCtx.imageSmoothingQuality = 'high';
            }
            this._outCtx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
            return this._out;
        },

        grabFromDisplay(region) {
            const v = this.displayVideo;
            if (!v || !v.videoWidth) return null;
            const track = this.displayStream.getVideoTracks()[0];
            const s = track.getSettings ? (track.getSettings() || {}) : {};
            const scaleX = (s.width || v.videoWidth) / window.innerWidth;
            const scaleY = (s.height || v.videoHeight) / window.innerHeight;

            return this.crop(v,
                Math.max(0, Math.round(region.x * scaleX)),
                Math.max(0, Math.round(region.y * scaleY)),
                Math.round(region.w * scaleX),
                Math.round(region.h * scaleY));
        },

        /** 统一入口：遵循面板里的「截图方式」设置；video 由 step() 传进来（它刚查过一次，没必要再查） */
        grab(region, video) {
            const pref = CFG.captureMode || 'auto';
            if (pref === 'display') {
                if (!this.displayStream) {
                    const err = new Error('还没授权标签页共享');
                    err.code = 'NO_DISPLAY';
                    throw err;
                }
                return this.grabFromDisplay(region);
            }
            if (pref === 'element') return this.grabFromElement(region, video);
            // auto：按运行时实际探测到的模式走
            return this.mode === 'display'
                ? this.grabFromDisplay(region)
                : this.grabFromElement(region, video);
        },
    };

    // ═══════════════════════════════════════════════════════════════
    //  60-chat.js — OpenAI 兼容接口与翻译缓存
    //
    //  只负责「把 messages 发出去、把正文取回来」，不关心跑的是哪种引擎。
    //
    //  对外提供：cache、CACHE_MAX、cacheGet、cachePut、apiUrl、apiHeaders、
    //              shouldDisableThinking、buildChatBody、extractContent、
    //              callChatCore、callChat
    //  依赖：CFG、gmRequest
    // ═══════════════════════════════════════════════════════════════
    const cache = new Map();          // 原文 -> 译文
    const CACHE_MAX = 500;

    /** 取缓存。Map 迭代顺序 = 插入顺序，所以「命中后删掉再塞回去」等于把这条挪到队尾，淘汰时丢的永远是
     *  最久没用过的那条（原来是纯先进先出：一句反复出现的台词，中间插进 500 条新字幕就会被挤掉重翻）。 */
    function cacheGet(k) {
        if (!cache.has(k)) return undefined;
        const v = cache.get(k);
        cache.delete(k);
        cache.set(k, v);
        return v;
    }

    function cachePut(k, v) {
        if (cache.has(k)) cache.delete(k);           // 已存在就先摘掉，保证位置最新
        if (cache.size >= CACHE_MAX) {
            cache.delete(cache.keys().next().value); // 队首 = 最久没用过的
        }
        cache.set(k, v);
    }

    function apiUrl() {
        let base = (CFG.apiBase || '').trim().replace(/\/+$/, '');
        if (!/\/chat\/completions$/.test(base)) base += '/chat/completions';
        return base;
    }

    function apiHeaders() {
        const h = { 'Content-Type': 'application/json' };
        if (CFG.apiKey) h['Authorization'] = 'Bearer ' + CFG.apiKey;
        return h;
    }

    /** 判断该不该给这个接口发「关闭思考模式」参数：不能无脑发 —— 不认识这个字段的平台
     *  （OpenAI、Gemini 等）可能直接报 400。 */
    function shouldDisableThinking() {
        const mode = CFG.thinkingMode || 'auto';
        if (mode === 'on') return false;
        if (mode === 'off') return true;
        // auto：只对已知默认开启思考模式的平台动手
        const base = (CFG.apiBase || '').toLowerCase();
        return base.indexOf('deepseek') >= 0;
    }

    /** 组装请求体：按平台补上思考模式 / 输出上限等参数 */
    function buildChatBody(messages, { temperature = 0.2, maxTokens } = {}) {
        const body = {
            model: CFG.model,
            messages,
            max_tokens: maxTokens || Number(CFG.maxTokens) || 1024,
        };
        const disableThinking = shouldDisableThinking();

        if (disableThinking) {
            // 思考模式不支持 temperature，发了也是白发，干脆不发
            body.thinking = { type: 'disabled' };
        } else {
            body.temperature = temperature;
        }
        return body;
    }

    /** 从返回的 message 里取出正文，兼容三种情况：content 是普通字符串（绝大多数）、
     *  content 是内容块数组（部分平台）、content 为空但有 reasoning_content（思考预算被吃光）。 */
    function extractContent(message, finishReason) {
        const c = message && message.content;
        if (typeof c === 'string' && c.trim()) return c.trim();

        if (Array.isArray(c)) {
            const joined = c
                .map(b => (typeof b === 'string' ? b : (b && (b.text || b.content)) || ''))
                .join('')
                .trim();
            if (joined) return joined;
        }

        const reasoning = message && message.reasoning_content;
        if (finishReason === 'length') {
            throw new Error('模型把输出预算用完了（finish_reason=length）—— '
                + '思考模式会先输出一大段推理，请把「思考模式」设为 关闭/auto，'
                + '或把「最大输出」调大');
        }
        if (reasoning) {
            throw new Error('模型只返回了推理过程、没有返回正文 —— '
                + '请把「思考模式」设为 关闭/auto');
        }
        if (typeof c === 'string') return '';   // 确实是空字符串，交给上层当"没识别到"
        throw new Error('返回结构异常：choices[0].message.content 既不是字符串也不是数组');
    }

    async function callChatCore(body) {
        const r = await gmRequest({
            url: apiUrl(),
            headers: apiHeaders(),
            data: JSON.stringify(body),
        });
        if (r.status < 200 || r.status >= 300) {
            let msg = 'HTTP ' + r.status;
            try {
                const j = JSON.parse(r.responseText);
                msg += '　' + (j.error?.message || j.message || String(r.responseText).slice(0, 200));
            } catch (e) { msg += '　' + String(r.responseText || '').slice(0, 200); }
            if (r.status === 401) msg += '　→ API Key 不对或没填';
            else if (r.status === 402) msg += '　→ 账户余额不足';
            else if (r.status === 404) msg += '　→ API 地址或模型名不对';
            else if (r.status === 429) msg += '　→ 请求太频繁或额度用尽，试试调大截图间隔';
            else if (/model/i.test(msg) && r.status === 400) msg += '　→ 模型名可能写错了';
            throw new Error(msg);
        }
        let j;
        try { j = JSON.parse(r.responseText); }
        catch (e) { throw new Error('返回内容不是合法 JSON：' + String(r.responseText).slice(0, 120)); }

        const choice = j.choices?.[0];
        if (!choice) {
            throw new Error('返回里没有 choices[0]：' + JSON.stringify(j).slice(0, 160));
        }
        return {
            text: extractContent(choice.message, choice.finish_reason),
            usage: j.usage || null,
            finishReason: choice.finish_reason,
            model: j.model || body.model,
        };
    }

    async function callChat(body) {
        const res = await callChatCore(body);
        return res.text;
    }

    // ═══════════════════════════════════════════════════════════════
    //  62-engines.js — 五种引擎的统一入口
    //
    //  recognizeAndTranslate() 按 CFG.engine 分派到五条路径，
    //  返回值统一为 { original, translation }，主循环不必知道用的是谁。
    //
    //  对外提供：translateByVision、translateText、recognizeAndTranslate
    //  依赖：CFG、callChat、buildChatBody、parseModelJson、stripWrappingQuotes、
    //              cacheGet、cachePut、canvasToJpeg、callYoudaoImage、
    //              recognizeByUmi、recognizeByBrowserAI、recognizeByWebTranslate
    // ═══════════════════════════════════════════════════════════════
    /** vision 模式：截图直接丢给视觉大模型，一步出结果。 */
    async function translateByVision(dataUrl) {
        const sys = [
            '你是一个视频硬字幕识别与翻译引擎。',
            '用户会给你一张从视频画面中裁切出来的「字幕区域」图片。',
            '请你：1) 识别图中的字幕文字；2) 把它翻译成' + CFG.tgtLang + '。',
            '严格只输出一个 JSON 对象，格式为：',
            '{"original":"识别到的原文（如果没有文字则为空字符串）","translation":"译文（如果没有文字则为空字符串）"}',
            '不要输出 markdown 代码块，不要任何解释。',
            '如果图中没有清晰可读的字幕文字，两个字段都返回空字符串。',
            '译文要符合影视字幕习惯：简洁、口语化、不要逐字硬翻。',
            CFG.extraPrompt ? ('额外要求：' + CFG.extraPrompt) : '',
        ].filter(Boolean).join('\n');

        const content = await callChat(buildChatBody([
            { role: 'system', content: sys },
            {
                role: 'user',
                content: [
                    { type: 'text', text: '请识别并翻译这张字幕图片。' },
                    // 注意：图片必须放在 user 消息里 —— DeepSeek 明确不接受 system / assistant 消息里的图片（会 400）
                    { type: 'image_url', image_url: { url: dataUrl } },
                ],
            },
        ], { temperature: 0.2 }));

        const obj = parseModelJson(content);
        if (obj && (obj.original !== undefined || obj.translation !== undefined)) {
            return {
                original: String(obj.original || '').trim(),
                translation: String(obj.translation || '').trim(),
            };
        }
        // 模型没按格式来，就把整段文本当译文
        return { original: '', translation: stripWrappingQuotes(content) };
    }

    /** 只做翻译（输入已经是文本），带缓存。本地 OCR / Umi-OCR 认出文字后只需要调这一步，不用再发图片。 */
    async function translateText(original) {
        const text = String(original || '').trim();
        if (!text) return '';

        // 用 has 而不是真值判断：模型偶尔会返回空内容，空字符串是 falsy，用 `if (hit)` 的话这种
        // 缓存永远命中不了，同一句会被反复送到付费接口去重翻。
        const hit = cacheGet(text);
        if (hit !== undefined) return hit;

        const sys = [
            '你是专业的影视字幕翻译。把用户给出的' + (CFG.srcLang || '原文') + '字幕翻译成' + CFG.tgtLang + '。',
            '只输出译文本身，不要解释、不要引号、不要注音、不要重复原文。',
            '译文要简洁口语化，符合字幕阅读习惯。',
            CFG.extraPrompt ? ('额外要求：' + CFG.extraPrompt) : '',
        ].filter(Boolean).join('\n');

        const translation = await callChat(buildChatBody([
            { role: 'system', content: sys },
            { role: 'user', content: text },
        ], { temperature: 0.3 }));
        const clean = stripWrappingQuotes(translation);
        cachePut(text, clean);
        return clean;
    }

    /**
     * 统一入口：按当前引擎选择识别/翻译路径，返回值统一为 { original, translation }。
     * @param {HTMLCanvasElement} canvas 已裁切好的字幕区截图
     * @param {{onDelta?:Function}} [opts] 只有浏览器内置 AI 用：onDelta(累计译文, 原文)，让悬浮层能"边生成边出字"
     */
    async function recognizeAndTranslate(canvas, opts) {
        if (CFG.engine === 'youdao-img') {
            return await callYoudaoImage(canvasToJpeg(canvas, 0.9));
        }
        if (CFG.engine === 'browser-ai') {
            return await recognizeByBrowserAI(canvas, opts);
        }
        if (CFG.engine === 'web-translate') {
            return await recognizeByWebTranslate(canvas);
        }
        if (CFG.engine === 'umi-ocr') {
            return await recognizeByUmi(canvas);
        }
        // openai-vision（默认）
        return await translateByVision(canvasToJpeg(canvas, 0.85));
    }

    // ═══════════════════════════════════════════════════════════════
    //  70-pipeline.js — 主循环
    //
    //  跑一轮 = 看看画面 → 该跳过就跳过 → 调引擎 → 显示译文。
    //  每一步都拆成了具名方法（ensureReady / grabFrame / shouldSkipFrame /
    //  recognize / present），哪个分支什么时候返回从名字就能读出来。
    //
    //  gen 计数器负责作废"飞在路上"的结果：用户点停止、重选区域、页面跳走之后，
    //  迟到的识别结果不能画到字幕上。
    //
    //  对外提供：Pipeline
    //  依赖：CFG、Capturer、UI、Overlay、Diag、recognizeAndTranslate、thumbnail、
    //              thumbDiff、edgeDensity、textSimilarity、sleep、findVideo、log、warn
    // ═══════════════════════════════════════════════════════════════
    const Pipeline = {
        running: false,
        busy: false,
        timer: null,
        // 每次 start / stop / 换区域都 +1；异步结果回来时对不上就说明这次识别已作废，直接丢掉。
        gen: 0,
        lastThumb: null,
        lastOriginal: '',
        lastTranslation: '',
        emptyStreak: 0,
        stats: { shots: 0, apiCalls: 0, skipped: 0, errors: 0 },

        invalidate() { this.gen++; },

        start() {
            if (this.running) return;
            if (!CFG.region) {
                UI.setStatus('请先框选字幕区域', 'warn');
                return;
            }
            this.invalidate();
            this.running = true;
            this.lastThumb = null;
            this.emptyStreak = 0;
            UI.setRunning(true);
            UI.setStatus('运行中…', 'ok');
            this.tick();
        },

        stop() {
            this.running = false;
            this.invalidate();
            if (this.timer) { clearTimeout(this.timer); this.timer = null; }
            // 停止要收掉字幕：不然最后一句一直挂着，用户以为还在翻译（换集 / 暂停时尤其容易误会）。
            // 「上一句」也得清 —— 否则重开后与停之前相同的首句会被当成重复句直接吞掉。
            Overlay.clear();
            this.lastOriginal = '';
            this.lastTranslation = '';
            this.emptyStreak = 0;
            UI.setRunning(false);
            UI.setStatus('已停止', 'idle');
        },

        toggle() { this.running ? this.stop() : this.start(); },

        async tick() {
            if (!this.running) return;
            if (this.timer) { clearTimeout(this.timer); this.timer = null; }

            try {
                await this.step();
            } catch (e) {
                this.stats.errors++;
                warn('step 出错：', e);
                Diag.lastError = {
                    time: new Date().toLocaleTimeString(),
                    msg: String(e && e.message || e),
                    stack: e && e.stack ? String(e.stack).split('\n').slice(0, 3).join('\n') : '',
                };
                UI.setStatus('出错：' + e.message, 'err');
                // 连续出错就停一会儿，避免刷屏
                await sleep(1500);
            }

            if (this.running) {
                this.timer = setTimeout(() => this.tick(), Math.max(300, CFG.interval));
            }
        },

        /** 跑一轮：看看画面 → 该跳过就跳过 → 调引擎 → 显示译文；细节在各自的具名方法里 */
        async step() {
            const myGen = this.gen;

            const video = findVideo();
            if (!this.ensureReady(video)) return;

            const canvas = await this.grabFrame(video);
            if (!canvas) return;

            this.stats.shots++;
            if (this.shouldSkipFrame(canvas)) return;

            const res = await this.recognize(canvas, myGen);
            if (!res) return;              // 结果已作废（停止 / 换了区域 / 页面跳走）

            this.present(res);
        },

        /** 前置检查：有没有视频、有没有框选、能不能截、上一轮回来没有；true = 可以继续这一轮 */
        ensureReady(video) {
            if (!video || !CFG.region) {
                // 什么都不说会让人以为卡死了：状态栏一直停在"运行中…"
                this.missVideo = (this.missVideo || 0) + 1;
                if (!video) {
                    // 连续 30 轮（默认间隔下约 36 秒）找不到就收手，免得在没视频的页面上一直空转
                    if (this.missVideo >= 30) {
                        UI.setStatus('一直没找到视频，已自动停止（可再点「开始」重试）', 'err');
                        this.stop();
                    } else {
                        UI.setStatus('没找到视频元素（换集 / 换页后常见）', 'warn');
                    }
                } else {
                    UI.setStatus('还没框选字幕区域', 'warn');
                }
                return false;
            }
            this.missVideo = 0;

            // 视频暂停时不截图，省 API
            if (video.paused || video.ended) {
                UI.setStatus('视频已暂停', 'idle');
                return false;
            }

            // 上一轮还没回来就跳过，防止请求堆积
            if (this.busy) return false;

            return true;
        },

        /** 截一帧；画布被污染（视频跨域）走 handleTainted 岔路（中断运行并引导改用标签页捕获）；null 表示这一轮不用继续 */
        async grabFrame(video) {
            let canvas = null;
            try {
                canvas = Capturer.grab(CFG.region, video);
            } catch (e) {
                if (e.code === 'TAINTED' || e.code === 'NO_DISPLAY') {
                    await this.handleTainted(e);
                    return null;
                }
                throw e;                       // 其他异常交给 tick() 的错误处理
            }
            if (!canvas) {
                // 区域跑到视频画面外了（滚动 / 播放器重排 / 换集）时 grab 会返回 null；
                // 不提示的话用户只会看到"运行中…"不动。
                UI.setStatus('截不到画面 —— 区域可能已不在视频上，请重新框选（① 框选字幕区）', 'warn');
                return null;
            }
            return canvas;
        },

        /** 画布被跨域污染时的善后：能切标签页捕获就切，切不了就告诉用户怎么办 */
        async handleTainted(e) {
            if (CFG.captureMode === 'element') {
                UI.setStatus('视频跨域且画布被污染 —— 请把「截图方式」改成「自动」或「标签页捕获」', 'err');
                this.stop();
                return;
            }
            warn('需要标签页捕获：' + e.message);
            if (e.code === 'TAINTED') Diag.tainted = true;
            UI.setStatus('正在请求「共享此标签页」授权，请在弹窗里选当前标签页…', 'warn');
            this.stop();                       // 换模式后让用户自己重新点开始，避免状态错乱
            try {
                await Capturer.startDisplayCapture();
                UI.applyCaptureMode('display', '✅ 已切换为标签页捕获，请重新点「开始」');
            } catch (e2) {
                UI.setStatus('共享授权失败：' + e2.message, 'err');
            }
        },

        /** 画面没变、或区域里根本没文字 → 这一轮不用花 API 钱；true = 跳过 */
        shouldSkipFrame(canvas) {
            // ---- 变化检测 ----
            const thumb = thumbnail(canvas);
            // ⚡ 优化：lastThumb 为 null（第一帧）时直接短路 —— thumbDiff 内部本来也会返回 1，
            //    但那样要先白跑一遍 512 个样本的循环；结果是 null 而非 false，下面只当条件用，语义不变。
            const noChange = this.lastThumb
                && thumbDiff(thumb, this.lastThumb) < NO_CHANGE_DIFF;

            // 上一轮识别到文字、且画面几乎没变 → 跳过；预览也放在这之后，画面一模一样时重画纯属白费。
            if (noChange && this.lastOriginal) {
                this.stats.skipped++;
                UI.setStatus('画面未变化，跳过', 'idle');
                return true;
            }
            this.lastThumb = thumb;
            UI.setPreview(canvas);

            // ---- 智能跳过：区域里没有文字就不调 API ----
            if (CFG.smartSkip) {
                const ed = edgeDensity(canvas);
                UI.setEdge(ed);
                if (ed < EDGE_MIN) {
                    this.stats.skipped++;
                    this.emptyStreak++;
                    if (this.emptyStreak >= 2) {
                        Overlay.clear();
                        this.lastOriginal = '';
                    }
                    UI.setStatus('未检测到文字，跳过（边缘密度 ' + ed.toFixed(3) + '）', 'idle');
                    return true;
                }
            }
            return false;
        },

        /** 调识别 / 翻译引擎；返回 null 表示结果已作废 */
        async recognize(canvas, myGen) {
            this.busy = true;
            UI.setStatus('识别中…', 'busy');
            const t0 = performance.now();
            let res;
            try {
                this.stats.apiCalls++;
                res = await recognizeAndTranslate(canvas, { onDelta: this.partialSink(myGen) });
            } finally {
                this.busy = false;
            }

            // 请求飞在路上时用户可能点了停止 / 重选区域 / 页面跳走：结果是给"上一轮"的，
            // 画上去就是过期字幕（SPA 跳页时尤其明显：Overlay.clear() 之后旧字幕又冒出来）。
            if (myGen !== this.gen || !this.running) {
                log('丢弃作废的识别结果');
                return null;
            }

            return {
                original: res.original,
                translation: res.translation,
                ms: Math.round(performance.now() - t0),
            };
        },

        /**
         * 流式译文的落点：端侧模型一边生成，这里一边把已生成的部分盖到字幕上。
         * 三层保护：① 没开 CFG.baiStream 就返回 undefined，引擎退回一次性调用；② 用**本次调用的代**
         * 校验，中途停止 / 重选区域后迟到的分片不能再往画面上画（同 recognize() 那道校验）；
         * ③ 按时间节流 —— 模型一秒吐几十个分片，每个都写一次 innerHTML 加一次强制重排，纯属浪费。
         * @param {number} myGen 本次识别所属的代
         * @returns {((partial:string, original:string)=>void)|undefined}
         */
        partialSink(myGen) {
            if (!CFG.baiStream) return undefined;
            let last = 0;
            return (partial, original) => {
                if (myGen !== this.gen || !this.running) return;
                const now = performance.now();
                if (now - last < 80) return;
                last = now;
                const t = String(partial || '').trim();
                if (!t) return;
                Overlay.show(original || '', t);
            };
        },

        present(res) {
            const dt = res.ms;

            // ① 这帧确实没字幕。连续两帧都没有才清掉悬浮层，避免字幕一闪一闪
            if (!res.original && !res.translation) {
                this.emptyStreak++;
                if (this.emptyStreak >= 2) {
                    Overlay.clear();
                    this.lastOriginal = '';
                    this.lastTranslation = '';
                }
                UI.setStatus('本帧无字幕（' + dt + 'ms）', 'idle');
                return;
            }
            this.emptyStreak = 0;

            // ② 认出了原文但没拿到译文（模型返回空、接口抽风）：不能往下走 —— Overlay 渲染的是
            //    `translation || original`，放行会把没翻译的外文原文当译文显示，状态还报"已翻译"。
            if (res.original && !res.translation) {
                UI.setStatus('只认出原文、没拿到译文，保持上一句', 'warn');
                return;
            }

            // ③ 文本相似度阈值：和上一句太像就不刷新，避免字幕抖动
            const sim = textSimilarity(res.original || res.translation, this.lastOriginal);
            if (this.lastOriginal && sim > (1 - CFG.textSimThreshold)) {
                UI.setStatus('与上句相似，保持（' + dt + 'ms）', 'idle');
                return;
            }

            // ④ 正常显示
            this.lastOriginal = res.original || res.translation;
            this.lastTranslation = res.translation;
            Overlay.show(res.original, res.translation);
            UI.pushHistory(res.original, res.translation);
            Diag.record({
                engine: CFG.engine + '@' + Capturer.mode,
                ms: dt,
                original: res.original,
                translation: res.translation,
            });
            UI.setStatus('已翻译（' + dt + 'ms）', 'ok');
            log('识别：', res.original, '→', res.translation);
        },
    };

    // ═══════════════════════════════════════════════════════════════
    //  80-overlay.js — 悬浮字幕层
    //
    //  译文的显示与定位。position() 与 show() 是分开的：拖窗口时每帧都要
    //  重算位置，但内容没变，不该重建 innerHTML 再触发一次强制重排。
    //
    //  对外提供：Overlay
    //  依赖：CFG、uiHost、hexToRgb、escapeHtml、setHTML、resolveRegion、
    //              Fullscreen
    // ═══════════════════════════════════════════════════════════════
    /** <video> 自己全屏时 DOM 字幕层不会被渲染（它是替换元素，子节点不参与绘制），只能把译文同时塞进
     *  原生字幕轨；普通全屏不用管 —— 那时 UI 已被搬进全屏容器。
     *  ⚡ 优化：抽成具名函数供 show() 两条路径共用 —— 指纹命中提前 return 时也必须走，否则译文停在上一句。 */
    function overlaySyncTrack(original, translation) {
        const vfs = Fullscreen.videoFullscreen();
        if (!vfs) return;
        Fullscreen.showOnTrack(vfs, CFG.showOriginal && original
            ? original + '\n' + (translation || original)
            : (translation || original));
    }

    const Overlay = {
        el: null,

        ensure() {
            if (this.el) return this.el;
            const d = document.createElement('div');
            d.id = 'h1sub-overlay';
            d.style.cssText = [
                'position:fixed',
                'z-index:2147483000',
                'pointer-events:none',
                'max-width:90vw',
                'padding:6px 14px',
                'border-radius:8px',
                'text-align:center',
                'line-height:1.45',
                'font-family:"Microsoft YaHei","PingFang SC",sans-serif',
                'font-weight:700',
                'display:none',
                'white-space:pre-wrap',
                'word-break:break-word',
                'transition:opacity .12s',
            ].join(';');
            uiHost().appendChild(d);
            this.el = d;
            return d;
        },

        applyStyle(d) {
            const op = Math.max(0, Math.min(1, Number(CFG.bgOpacity)));
            const rgb = hexToRgb(CFG.textColor || '#ffffff');
            d.style.background = 'rgba(0,0,0,' + op.toFixed(2) + ')';
            d.style.color = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
            // 描边：亮画面上也能看清
            d.style.textShadow = CFG.outline
                ? '0 0 4px #000,0 0 4px #000,1px 1px 0 #000,-1px -1px 0 #000,'
                + '1px -1px 0 #000,-1px 1px 0 #000,0 2px 6px rgba(0,0,0,.95)'
                : '0 2px 4px rgba(0,0,0,.95)';
        },

        show(original, translation) {
            if (!CFG.region) return;
            const d = this.ensure();
            this.last = { o: original, t: translation };   // 供 reposition 使用

            // ⚡ 优化：内容没变就只重算位置 —— resize 拖动 / manualShot / 流式回调都用同样内容反复调
            //    show()，而重建 innerHTML 后紧跟的 position() 要读 offsetWidth，每次都触发强制重排。
            const key = original + '\u0000' + translation;
            if (this._key === key && d.style.display !== 'none') {
                this.position();
                overlaySyncTrack(original, translation);
                return;
            }
            this._key = key;

            this.applyStyle(d);

            let html = '';
            if (CFG.showOriginal && original) {
                html += '<div style="font-size:' + Math.max(11, CFG.fontSize - 7) + 'px;'
                    + 'font-weight:400;opacity:.72;margin-bottom:2px">'
                    + escapeHtml(original) + '</div>';
            }
            html += '<div style="font-size:' + CFG.fontSize + 'px">'
                + escapeHtml(translation || original) + '</div>';
            setHTML(d, html);

            // 定位：贴在字幕区上方或下方
            d.style.display = 'block';
            this.position();

            overlaySyncTrack(original, translation);
        },

        clear() {
            this._key = null;   // ⚡ 优化：指纹作废，下次显示必定重建 HTML
            if (this.el) this.el.style.display = 'none';
            Fullscreen.hideTrack();
        },

        /** 只重算位置、不重建 HTML：reposition() 原来直接再调 show()，拖窗口边缘时每帧都要重建
         *  一遍 innerHTML 再读 offsetWidth（强制同步重排），而内容根本没变。 */
        position() {
            const d = this.el;
            if (!d || !CFG.region) return;
            // 区域按视频当前位置重新锚定，滚动过也不会飘
            const r = resolveRegion(CFG.region);
            const w = d.offsetWidth, h = d.offsetHeight;
            let left = r.x + r.w / 2 - w / 2;
            left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
            const off = Number(CFG.offsetY) || 0;
            let top;
            if (CFG.overlayTop) {
                top = r.y - h - 8 + off;
                if (top < 8) top = r.y + r.h + 8 + off;   // 上面放不下就放下边
            } else {
                top = r.y + r.h + 8 + off;
                if (top + h > window.innerHeight - 8) top = r.y - h - 8 + off;
            }
            d.style.left = left + 'px';
            d.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, top)) + 'px';
        },

        reposition() {
            if (this.el && this.el.style.display !== 'none' && this.last) {
                this.position();
            }
        },
    };

    // ═══════════════════════════════════════════════════════════════
    //  82-fullscreen.js — 全屏适配
    //
    //  对外提供：uiHost、Fullscreen
    //  依赖：CFG、log、warn、Overlay、UI
    // ═══════════════════════════════════════════════════════════════
    // 浏览器进全屏时**只渲染「全屏元素及其子树」**，挂在 body 上的面板和字幕层会被整个隐藏
    // —— 表现就是"一全屏字幕就没了"（实测全屏后 overlay / panel 都不在全屏子树内）。
    //
    // 截图那一侧不用管：区域存的是相对视频内容框的比例，全屏变大后 resolveRegion 会自动重锚定。
    //
    // 两种全屏分开处理：① 全屏元素是播放器容器（YouTube、B 站等多数播放器）→ 把元素搬进去，
    // 退出时搬回 body；② 全屏元素就是 <video> 本身 → <video> 是替换元素，塞进去的子节点
    // 不参与渲染（实测 getBoundingClientRect 全是 0），只能改用**原生字幕轨**：cue 由浏览器
    // 画在视频画面内部，而全屏渲染的正是视频画面本身，所以能显示。
    function uiHost() {
        return Fullscreen.uiHost();
    }

    const Fullscreen = {
        host: null,         // 当前承载我们元素的全屏容器（仅情况 ①）
        track: null,        // 原生字幕轨（仅情况 ②）
        trackVideo: null,
        cue: null,

        init() {
            // webkit 前缀给老 Safari / 老 Chrome 兜底
            document.addEventListener('fullscreenchange', () => this.sync());
            document.addEventListener('webkitfullscreenchange', () => this.sync());
        },

        current() {
            try {
                return document.fullscreenElement || document.webkitFullscreenElement || null;
            } catch (e) { return null; }
        },

        videoFullscreen() {
            const fs = this.current();
            return (fs && (fs.tagName === 'VIDEO' || fs.tagName === 'AUDIO')) ? fs : null;
        },

        uiHost() {
            const fs = this.current();
            // <video> 进不去（子节点不渲染，走了也没用）；iframe 也进不去 —— 那是另一个文档
            if (fs && fs.tagName !== 'VIDEO' && fs.tagName !== 'AUDIO'
                && fs.tagName !== 'IFRAME') {
                return fs;
            }
            return document.body;
        },

        sync() {
            const host = this.uiHost();

            if (host !== this.host) {
                this.host = host;
                for (const el of [Overlay.el, UI.root, UI.pillEl]) {
                    if (el && el.parentNode !== host) host.appendChild(el);
                }
                log('全屏状态变化，UI 已挂到 ' + (host === document.body ? 'body' : host.tagName));
                if (this.videoFullscreen()) {
                    UI.setStatus('已进入全屏：<video> 直接全屏，改用系统字幕轨显示', 'warn');
                } else if (host !== document.body) {
                    UI.setStatus('已进入全屏：字幕层已跟随', 'ok');
                }
            }

            // 退出 <video> 全屏时把字幕轨收掉，不然它会一直挂在那儿
            if (!this.videoFullscreen()) this.hideTrack();

            Overlay.reposition();
        },

        /**
         * 保证视频上挂着我们自己的那条字幕轨，返回它。
         * ⚠️ 退出全屏**不能**靠 removeTextTrack 清理：实测本机 Chrome 里这个 API 根本没实现，try/catch
         * 包着调用只会静默失败，每进一次全屏就多挂一条轨 —— 所以复用同一条轨，不用时 mode='disabled'。
         */
        ensureTrack(video) {
            if (this.track && this.trackVideo === video) return this.track;

            // 换了视频元素（SPA 换集）：旧轨留着没用。能删就删，删不掉就关掉。
            if (this.track) {
                try { this.track.mode = 'disabled'; } catch (e) { }
                if (this.trackVideo && typeof this.trackVideo.removeTextTrack === 'function') {
                    try { this.trackVideo.removeTextTrack(this.track); } catch (e) { }
                }
            }
            this.cue = null;

            const track = video.addTextTrack('subtitles', '字幕翻译', CFG.tgtLang || 'zh');
            this.track = track;
            this.trackVideo = video;
            return track;
        },

        /** 用原生字幕轨显示译文 —— <video> 直接全屏时唯一可行的办法；全程复用同一条 cue（改文字和时间），不断 addCue 的话播一小时会堆出几千条。 */
        showOnTrack(video, text) {
            if (!video || !text) return;
            try {
                const track = this.ensureTrack(video);
                track.mode = 'showing';
                const now = video.currentTime || 0;
                if (!this.cue) {
                    this.cue = new VTTCue(now, now + 3600, text);
                    track.addCue(this.cue);
                } else {
                    this.cue.text = text;
                    this.cue.startTime = now;
                    this.cue.endTime = now + 3600;
                }
            } catch (e) {
                // 有些站点会锁死 textTracks；失败就当没有这个兜底，别影响主流程
                warn('原生字幕轨不可用：', e);
            }
        },

        /** 收起原生字幕轨。只关显示、不删轨道 —— 删不掉，见 ensureTrack 的说明 */
        hideTrack() {
            if (this.cue && this.track) {
                try { this.track.removeCue(this.cue); } catch (e) { }
            }
            this.cue = null;
            if (this.track) {
                try { this.track.mode = 'disabled'; } catch (e) { }
            }
        },
    };

    // ═══════════════════════════════════════════════════════════════
    //  84-html.js — HTML 转义、Trusted Types 与颜色
    //
    //  Trusted Types 兼容层：YouTube、Gmail、Google 搜索等站点用 CSP 的
    //  require-trusted-types-for 'script' 禁掉了直接给 innerHTML 赋字符串，
    //  不注册策略的话面板建不出来、字幕也渲染不出来（整个脚本等于没装）。
    //  setHTML() 是全脚本写 innerHTML 的唯一入口。
    //
    //  对外提供：HTML_ESCAPES、escapeHtml、TT_POLICY、setHTML、hexToRgb
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    // 单次扫描替换：4 个链式 replace 要扫 4 遍、产生 3 个中间字符串，而每次渲染字幕都会调用。
    const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
    }

    /**
     * Trusted Types 兼容层：YouTube、Gmail、Google 搜索等站点用 CSP 的 require-trusted-types-for
     * 'script' 禁掉了直接给 innerHTML 赋字符串（直接写抛 TypeError），结果面板建不出来、字幕也渲染不
     * 出来（整个脚本等于没装）。自己注册一个策略就能正常写，策略名撞车或站点限死策略名时退回普通赋值。
     */
    const TT_POLICY = (() => {
        let api = null;
        try {
            if (typeof trustedTypes !== 'undefined' && trustedTypes
                && typeof trustedTypes.createPolicy === 'function') {
                api = trustedTypes;
            } else if (typeof window !== 'undefined' && window.trustedTypes
                && typeof window.trustedTypes.createPolicy === 'function') {
                api = window.trustedTypes;
            }
        } catch (e) { api = null; }
        if (!api) return null;

        const make = (name) => api.createPolicy(name, { createHTML: (s) => s });
        try { return make('h1sub-html'); } catch (e) { /* 名字已被占用 */ }
        try {
            return make('h1sub-html-' + Math.random().toString(36).slice(2, 9));
        } catch (e) { /* 站点不允许自建策略 */ }
        return null;
    })();

    /** 全脚本写 innerHTML 的唯一入口 */
    function setHTML(el, html) {
        if (!el) return;
        if (TT_POLICY) { el.innerHTML = TT_POLICY.createHTML(String(html)); return; }
        el.innerHTML = html;
    }

    /** '#rrggbb' → [r,g,b]，解析失败回退白色 */
    function hexToRgb(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return [255, 255, 255];
        const n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    // ═══════════════════════════════════════════════════════════════
    //  86-selector.js — 区域框选器
    //
    //  框选用的遮罩 / 选区框 / 提示条，以及拖拽、预览、Esc 与失焦兜底。
    //  两个容易踩的坑都写在代码注释里：遮罩必须 pointer-events:none，
    //  window 的 blur 兜底**不能**用捕获阶段（否则页内任何元素失焦都会取消框选）。
    //
    //  对外提供：RegionSelector
    //  依赖：CFG、UI、Capturer、findVideo、anchorRegion、rememberRegion、Pipeline、
    //              isConfigured
    // ═══════════════════════════════════════════════════════════════
    const RegionSelector = {
        active: false,

        /** 造框选用的三个覆盖层（遮罩 / 选区框 / 提示条）：纯构造，所以从 begin() 里单独拎出来 */
        createOverlay() {
            const mask = document.createElement('div');
            mask.style.cssText = [
                // z-index 必须**低于面板**（2147483500）、高于字幕层（2147483000）：原来比面板高，
                // 面板连同预览区被压在一层 35% 黑纱下（拖拽时再叠 box 阴影），看起来就像"预览消失了"。
                'position:fixed', 'inset:0', 'z-index:2147483400',
                'background:rgba(0,0,0,0.35)',
                // 不吃鼠标事件：mouseup 丢在窗口外（拖出浏览器 / alt-tab）时 dragging 清不掉、
                // cleanup 也不会跑，遮罩会把整页的点击都吞掉；拖拽监听挂在 document 捕获阶段。
                'pointer-events:none',
            ].join(';');

            const box = document.createElement('div');
            box.style.cssText = [
                'position:fixed', 'border:2px solid #22d3ee',
                'background:rgba(34,211,238,0.18)',
                // 阴影负责把选区以外压暗（遮罩 0.35 + 这里 0.35）；box 只在拖拽时显示，静止时不会太黑。
                'box-shadow:0 0 0 9999px rgba(0,0,0,0.35)',
                'pointer-events:none', 'display:none',
            ].join(';');

            const tip = document.createElement('div');
            tip.textContent = '按住鼠标左键拖拽，框住视频里的字幕区域；按 Esc 取消';
            tip.style.cssText = [
                'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
                'background:#111', 'color:#fff', 'padding:8px 16px', 'border-radius:6px',
                'font:13px/1.5 "Microsoft YaHei",sans-serif', 'z-index:2147483601',
                'pointer-events:none',
            ].join(';');

            document.body.appendChild(mask);
            document.body.appendChild(box);
            document.body.appendChild(tip);
            return { mask, box, tip };
        },

        begin() {
            if (this.active) return;
            this.active = true;

            const { mask, box, tip } = this.createOverlay();

            // 框选期间露出预览区：首次框选时 CFG.region 还是空的，syncRegion() 会把预览整个藏掉，用户无从对照；退出时 cleanup() 会还原。
            if (UI.els.preview_wrap) UI.els.preview_wrap.style.display = 'block';

            // 十字光标改挂在根元素上：遮罩已经 pointer-events:none 了
            const prevCursor = document.documentElement.style.cursor;
            document.documentElement.style.cursor = 'crosshair';

            let sx = 0, sy = 0, dragging = false;

            const onDown = (e) => {
                if (e.button !== 0) return;
                dragging = true;
                sx = e.clientX; sy = e.clientY;
                box.style.display = 'block';
                box.style.left = sx + 'px';
                box.style.top = sy + 'px';
                box.style.width = '0px';
                box.style.height = '0px';
            };
            // 拖拽时实时截出"当前框住的这块"喂给预览：否则预览里始终是**上一次**的区域，
            // 框选过程中判断不出这次框得对不对。用 rAF 合并 —— mousemove 一秒几十次，每次截图 ~0.7ms。
            let previewRaf = 0;
            const previewDrag = (x, y, w, h) => {
                if (previewRaf) return;
                previewRaf = requestAnimationFrame(() => {
                    previewRaf = 0;
                    if (w < 20 || h < 8) return;      // 太小，截了也没意义
                    try {
                        const c = Capturer.grab({ x, y, w, h }, findVideo());
                        if (c) UI.setPreview(c);
                    } catch (e) {
                        // 拖拽途中截不到很正常（框到视频外、还没授权共享…），静默跳过，绝不能打断框选
                    }
                });
            };

            /** 按当前的 CFG.region 重截一张喂给预览，只在**区域定下来之后**调用：cleanup() 是在 onUp 里
             *  「设置新区域之前」跑的，在那里截会截到上一次的区域，框完反而显示旧画面。 */
            const refreshPreview = () => {
                if (!CFG.region) return;
                try {
                    const c = Capturer.grab(CFG.region, findVideo());
                    if (c) UI.setPreview(c);
                } catch (e) {
                    // 截不到就算了（还没找到视频、没授权共享…），别打断流程
                }
            };

            const onMove = (e) => {
                if (!dragging) return;
                const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
                const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
                box.style.left = x + 'px';
                box.style.top = y + 'px';
                box.style.width = w + 'px';
                box.style.height = h + 'px';
                previewDrag(x, y, w, h);
            };
            const onUp = (e) => {
                if (!dragging) return;
                dragging = false;
                const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
                const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
                cleanup();
                if (w < 20 || h < 8) {
                    UI.setStatus('框选太小，已取消', 'warn');
                    return;
                }
                CFG.region = anchorRegion(x, y, w, h);
                rememberRegion(CFG.region);   // 按网站记住，换站不会串
                UI.syncRegion();
                UI.setStatus('字幕区域已设定：' + w + '×' + h + '（已记住本站）', 'ok');
                Pipeline.invalidate();
                Pipeline.lastThumb = null;
                Pipeline.lastOriginal = '';

                // 框完立刻截一帧（不用等点「开始」才发现框歪了）：密钥配好了就顺带识别一次，把整条链路
                // 验证掉；没配则只截不认，免得刚框完就弹个 401 吓人。（视频暂停时也能截，适合"暂停着慢慢框"。）
                if (isConfigured()) UI.manualShot();
                else refreshPreview();
            };
            const onKey = (e) => {
                if (e.key === 'Escape') {
                    cleanup();
                    UI.setStatus('已取消框选', 'warn');
                    refreshPreview();            // 还原成当前实际区域的画面
                }
            };

            const cleanup = () => {
                this.active = false;
                dragging = false;
                document.removeEventListener('mousedown', onDown, true);
                document.removeEventListener('mousemove', onMove, true);
                document.removeEventListener('mouseup', onUp, true);
                document.removeEventListener('keydown', onKey, true);
                // 这里的 capture 标志必须和下面 addEventListener 那一处完全一致，否则摘不掉：
                // 上一轮的 onBlur 会一直留着，拿着已删掉的遮罩去 cleanup，反而搅乱本轮状态。
                window.removeEventListener('blur', onBlur);
                document.documentElement.style.cursor = prevCursor;
                mask.remove(); box.remove(); tip.remove();

                // 只负责拆干净 + 还原预览区显隐。这里**不要**去截预览：onUp 是先调 cleanup、
                // 再设置新区域的，在这儿截只会截到上一次的区域；需要重截的调用方自己调 refreshPreview()。
                UI.syncRegion();
            };

            // 兜底：拖到窗口外松手 / alt-tab 走掉时 mouseup 就收不到了。
            // ⚠️ 这里**绝对不能**加捕获阶段（第三个参数不能是 true）：blur 自身不冒泡，但捕获阶段从
            // window 一路往下走，页面上**任何元素**失焦都会被这个监听抓到 —— 用户点完面板上的「框选字幕区」
            // 按钮（处于聚焦态）再移到视频上按下左键时，焦点从按钮移走派发的 blur 会让框选还没开始就被
            // cleanup 掉，表现就是"框选功能用不了"；不加 capture 只有焦点真的离开窗口时才触发。
            const onBlur = () => {
                if (!this.active) return;
                cleanup();
                UI.setStatus('框选已取消（窗口失去焦点）', 'warn');
                refreshPreview();
            };

            document.addEventListener('mousedown', onDown, true);
            document.addEventListener('mousemove', onMove, true);
            document.addEventListener('mouseup', onUp, true);
            document.addEventListener('keydown', onKey, true);
            window.addEventListener('blur', onBlur);
        },
    };

    // ═══════════════════════════════════════════════════════════════
    //  88-diag.js — 诊断模式（区域对齐检查 + 报告导出）
    //
    //  既是给用户自查用的取证工具，也是自动化测试的观察窗口。
    //
    //  对外提供：SCRIPT_VERSION、Diag
    //  依赖：CFG、findVideo、getContentBox、Capturer、Pipeline、UI、openModal、
    //              shouldDisableThinking、baiSupport、baiPair、baiBrokenPairs、
    //              baiPairKey、baiMayPivot、baiBrowser、wtOrder、wtStats、isTopFrame
    // ═══════════════════════════════════════════════════════════════
    const SCRIPT_VERSION = '1.12.0';

    const Diag = {
        modal: null,
        records: [],        // 最近识别记录（新→旧）
        tainted: false,     // 是否触发过画布污染
        lastYoudao: null,   // 最近一次有道的返回摘要
        lastError: null,    // 最近一次报错（会进诊断报告）
        baiProbe: null,     // 最近一次「检测浏览器 AI」的结果（build() 是同步的，只能存现成的）
        wtSelftest: null,   // 最近一次「测试各接口」的结果
        wtLastError: '',    // 免费接口最近一次全挂的原因

        record(entry) {
            entry.time = new Date().toLocaleTimeString();
            this.records.unshift(entry);
            if (this.records.length > 40) this.records.pop();
        },

        /** 生成纯文本诊断报告，用户可直接复制发出来 */
        build() {
            const L = [];
            const p = (s) => L.push(s);
            const v = findVideo();

            p('===== 硬字幕翻译 诊断报告 =====');
            p('时间     : ' + new Date().toLocaleString());
            p('脚本版本 : ' + SCRIPT_VERSION);
            p('页面     : ' + location.href.slice(0, 120));
            p('');

            p('--- 视频环境 ---');
            if (!v) {
                p('视频元素 : ❌ 未找到');
            } else {
                const r = v.getBoundingClientRect();
                const box = getContentBox(v);
                let fit = '?';
                try { fit = getComputedStyle(v).objectFit; } catch (e) { }
                p('视频元素 : ✅ 找到（页面共 ' + document.querySelectorAll('video').length + ' 个）');
                p('  videoWidth x videoHeight : ' + v.videoWidth + ' x ' + v.videoHeight);
                p('  元素矩形(l,t,w,h)        : ' + [r.left, r.top, r.width, r.height].map(Math.round).join(', '));
                p('  object-fit               : ' + fit);
                p('  推算的画面区(l,t,w,h)    : ' + [box.left, box.top, box.width, box.height].map(Math.round).join(', '));
                p('  paused / ended           : ' + v.paused + ' / ' + v.ended);
                p('  readyState               : ' + v.readyState);
                p('  currentSrc               : ' + String(v.currentSrc || '(空)').slice(0, 100));
                p('  视口 / DPR               : ' + window.innerWidth + 'x' + window.innerHeight
                    + ' / ' + window.devicePixelRatio);
            }
            p('');

            p('--- 截图后端 ---');
            p('  当前模式       : ' + Capturer.mode);
            p('  曾触发画布污染 : ' + (this.tainted ? '是（已切到标签页捕获）' : '否'));
            p('');

            p('--- 字幕区域 ---');
            if (!CFG.region) {
                p('  ❌ 尚未设定');
            } else {
                const g = CFG.region;
                p('  region(页面坐标 x,y,w,h) : ' + [g.x, g.y, g.w, g.h].map(Math.round).join(', '));
                if (v && v.videoWidth) {
                    const box = getContentBox(v);
                    const vw = v.videoWidth, vh = v.videoHeight;
                    const sx = Math.round(((g.x - box.left) / box.width) * vw);
                    const sy = Math.round(((g.y - box.top) / box.height) * vh);
                    const sw = Math.round((g.w / box.width) * vw);
                    const sh = Math.round((g.h / box.height) * vh);
                    p('  换算到视频像素坐标       : x=' + sx + ' y=' + sy + ' w=' + sw + ' h=' + sh);
                }
            }
            p('');

            p('--- 引擎配置 ---');
            p('  engine       : ' + CFG.engine);
            if (CFG.engine === 'youdao-img') {
                p('  有道 appKey  : ' + (CFG.youdaoAppKey ? CFG.youdaoAppKey : '❌ 未填'));
                p('  appSecret    : ' + (CFG.youdaoAppSecret ? '已填(' + CFG.youdaoAppSecret.length + '字符)' : '❌ 未填'));
                p('  语言方向     : ' + CFG.youdaoFrom + ' -> ' + CFG.youdaoTo);
                p('  大模型pro版  : ' + (CFG.youdaoLLM ? '开' : '关'));
            } else if (CFG.engine === 'web-translate') {
                p('  识别         : Umi-OCR 本机识别（' + CFG.umiBase + '）');
                p('  翻译接口     : ' + (CFG.wtEngine || 'auto') + '（降级链 ' + wtOrder().join(' → ') + '）');
                p('  最小间隔     : ' + CFG.wtMinInterval + 'ms');
                p('  API Key      : 不需要（逆向免费网页接口）');
                p('  ⚠️ 注意      : 非公开接口，随时可能失效');
            } else if (CFG.engine === 'browser-ai') {
                p('  识别方式     : ' + (CFG.baiOcr === 'builtin'
                    ? '浏览器内置多模态读图'
                    : 'Umi-OCR 本机识别（' + CFG.umiBase + '）'));
                p('  翻译方式     : ' + (CFG.baiTrans || 'auto')
                    + '（流式显示 ' + (CFG.baiStream ? '开' : '关')
                    + '，经英语中转 ' + (CFG.baiPivot ? '开' : '关') + '）');
                p('  语言方向     : ' + CFG.srcLang + ' -> ' + CFG.tgtLang);
                p('  API Key      : 不需要（完全离线，不产生费用）');
            } else {
                p('  apiBase      : ' + CFG.apiBase);
                p('  model        : ' + CFG.model);
                p('  apiKey       : ' + (CFG.apiKey ? '已填(' + CFG.apiKey.length + '字符)' : '❌ 未填'));
                p('  思考模式     : ' + (CFG.thinkingMode || 'auto')
                    + (shouldDisableThinking() ? '（本次会发送"关闭"参数）' : '（不发送该参数）'));
                p('  最大输出     : ' + CFG.maxTokens + ' tokens');
            }
            p('  参数         : 间隔 ' + CFG.interval + 'ms, 智能跳过 ' + CFG.smartSkip
                + ', 相似度阈值 ' + CFG.textSimThreshold);
            p('');

            if (CFG.engine === 'browser-ai' || this.baiProbe) {
                p('--- 浏览器内置 AI（离线）---');
                const sup = baiSupport();
                const ver = baiBrowser();
                p('  浏览器内核   : ' + ver.text + (ver.known
                    ? (ver.ok ? '（满足 ' + ver.required + '）' : '（⚠️ 低于 ' + ver.required + '）')
                    : '（内置 AI 只在 ' + ver.required + ' 上提供）'));
                p('  可用 API     : Translator ' + (sup.translator ? '有' : '无')
                    + ' / LanguageModel ' + (sup.lm ? '有' : '无')
                    + ' / LanguageDetector ' + (sup.detector ? '有' : '无'));
                let secure = false;
                try { secure = !!window.isSecureContext; } catch (e) { }
                p('  安全上下文   : ' + (secure ? '是' : '否（需要 HTTPS 或 localhost）'));
                p('  框架位置     : ' + (isTopFrame() ? '顶层窗口' : 'iframe 内'));
                const bpair = baiPair();
                p('  语言代码     : ' + (bpair ? bpair.src + ' -> ' + bpair.tgt
                    : '❌ 认不出「' + CFG.srcLang + ' / ' + CFG.tgtLang + '」'));
                // 已经试出来的"坏语言对"。Edge 的 ja→中文 就在这里现形
                const brokenKeys = Object.keys(baiBrokenPairs);
                if (brokenKeys.length) {
                    for (const k of brokenKeys) {
                        p('  直连失败的语言对: ' + k + '（' + baiBrokenPairs[k] + '）');
                    }
                    if (bpair && baiBrokenPairs[baiPairKey(bpair)]) {
                        p('  当前方向     : ' + (baiMayPivot(bpair)
                            ? '已改走经英语中转（' + bpair.src + ' -> en -> ' + bpair.tgt + '）'
                            : '⚠️ 未开启经英语中转 —— 请勾选该项或改用其它引擎'));
                    }
                }
                if (this.baiProbe) {
                    p('  上次检测结果 ：');
                    for (const r of this.baiProbe) p('    ' + r.label + ' : ' + r.value);
                } else {
                    p('  （还没点过「① 检测浏览器 AI」，这里只有同步能拿到的信息）');
                }
                p('');
            }

            p('--- 运行统计 ---');
            const s = Pipeline.stats;
            p('  截图 ' + s.shots + ' / 调API ' + s.apiCalls + ' / 跳过 ' + s.skipped + ' / 错误 ' + s.errors);
            p('  运行中 : ' + Pipeline.running);
            p('  状态行 : ' + (UI.els.status ? UI.els.status.textContent : '-'));
            p('');

            if (this.lastYoudao) {
                p('--- 最近一次有道返回 ---');
                p('  errorCode : ' + this.lastYoudao.errorCode);
                p('  识别区域数: ' + this.lastYoudao.regionCount);
                p('  boundingBox: ' + (this.lastYoudao.boxes.join(' | ') || '(无)'));
                p('');
            }

            if (CFG.engine === 'web-translate' || this.wtSelftest) {
                p('--- 免费网页接口（逆向）---');
                const ids = Object.keys(wtStats);
                if (!ids.length) p('  （还没有调用记录）');
                for (const id of ids) {
                    const s = wtStats[id];
                    p('  ' + id.padEnd(8) + ' 成功 ' + s.ok + ' / 失败 ' + s.fail
                        + (s.lastError ? '　最近错误: ' + s.lastError : ''));
                }
                if (this.wtSelftest) {
                    p('  上次测活结果：');
                    for (const r of this.wtSelftest) {
                        p('    ' + (r.ok ? '✅ ' : '❌ ') + r.label + '（' + r.ms + 'ms）'
                            + (r.ok ? '：' + r.out : '：' + r.err));
                    }
                } else {
                    p('  （还没点过「测试各接口」）');
                }
                p('');
            }

            if (this.lastError) {
                p('--- 最近一次错误（重点看这里）---');
                p('  时间: ' + this.lastError.time);
                p('  内容: ' + this.lastError.msg);
                if (this.lastError.stack) {
                    p('  位置: ' + this.lastError.stack.split('\n').slice(1).join(' | '));
                }
                p('');
            }

            p('--- 最近识别记录（新→旧）---');
            if (!this.records.length) p('  (无)');
            for (const r of this.records) {
                p('  [' + r.time + '] ' + r.engine + (r.ms != null ? ' ' + r.ms + 'ms' : ''));
                p('        原文: ' + (r.original || '(空)'));
                p('        译文: ' + (r.translation || '(空)'));
            }
            return L.join('\n');
        },

        open() {
            if (this.modal) { this.refresh(); return; }
            const ui = openModal({
                title: '诊断模式 — 字幕区域对齐检查',
                closeId: 'h1sub-diag-close',
                width: 'min(900px,95vw)',
                z: 2147483640,
                modalStyle: 'max-height:93vh;display:flex;flex-direction:column',
                headStyle: 'padding:10px 12px;border-bottom:1px solid #2c313a',
                bodyStyle: 'padding:10px 12px;overflow:auto',
                buttons: [
                    { id: 'h1sub-diag-refresh', label: '刷新' },
                    { id: 'h1sub-diag-copy', label: '复制报告' },
                ],
                body: [
                    '<div style="display:flex;gap:10px;flex-wrap:wrap">',
                    '  <div style="flex:1;min-width:290px">',
                    '    <div style="color:#7dd3fc;margin-bottom:4px">① 视频画面 + 红框 = 脚本实际截取范围</div>',
                    '    <canvas id="h1sub-diag-frame" style="width:100%;background:#000;border:1px solid #2c313a;border-radius:6px"></canvas>',
                    '  </div>',
                    '  <div style="flex:1;min-width:290px">',
                    '    <div style="color:#7dd3fc;margin-bottom:4px">② 脚本实际截到的图（OCR 的输入）</div>',
                    '    <canvas id="h1sub-diag-crop" style="width:100%;background:#000;border:1px solid #2c313a;border-radius:6px"></canvas>',
                    '  </div>',
                    '</div>',
                    '<div id="h1sub-diag-hint" style="margin:9px 0;color:#fbbf24"></div>',
                    '<div style="color:#7dd3fc;margin:6px 0 4px">③ 诊断报告（点「复制报告」即可发出来）</div>',
                    '<textarea id="h1sub-diag-report" readonly style="width:100%;height:230px;background:#0f1116;',
                    'color:#cbd5e1;border:1px solid #2c313a;border-radius:6px;padding:8px;',
                    'font:11px/1.5 Consolas,monospace;box-sizing:border-box"></textarea>',
                ].join(''),
            });
            this.modal = ui.root;
            ui.$('#h1sub-diag-close').onclick = () => { ui.close(); this.modal = null; };
            ui.$('#h1sub-diag-refresh').onclick = () => this.refresh();
            ui.$('#h1sub-diag-copy').onclick = () => this.copy();
            this.refresh();
        },

        refresh() {
            if (!this.modal) return;
            const v = findVideo();

            // ① 整帧 + 红框（即使画布被污染也能显示，因为我们不读它的像素）
            const fc = this.modal.querySelector('#h1sub-diag-frame');
            if (v && v.videoWidth) {
                fc.width = v.videoWidth;
                fc.height = v.videoHeight;
                const x = fc.getContext('2d');
                x.fillStyle = '#000';
                x.fillRect(0, 0, fc.width, fc.height);
                try { x.drawImage(v, 0, 0); } catch (e) { /* 忽略 */ }
                if (CFG.region) {
                    const box = getContentBox(v);
                    const g = CFG.region;
                    const sx = ((g.x - box.left) / box.width) * fc.width;
                    const sy = ((g.y - box.top) / box.height) * fc.height;
                    const sw = (g.w / box.width) * fc.width;
                    const sh = (g.h / box.height) * fc.height;
                    x.strokeStyle = '#ff2d55';
                    x.lineWidth = Math.max(2, fc.width / 400);
                    x.strokeRect(sx, sy, sw, sh);
                    x.fillStyle = 'rgba(255,45,85,.16)';
                    x.fillRect(sx, sy, sw, sh);
                }
            } else {
                fc.width = 320; fc.height = 180;
            }

            // ② 实际截图
            const cc = this.modal.querySelector('#h1sub-diag-crop');
            let cropErr = null;
            try {
                const crop = CFG.region ? Capturer.grab(CFG.region) : null;
                if (crop) {
                    cc.width = crop.width;
                    cc.height = crop.height;
                    cc.getContext('2d').drawImage(crop, 0, 0);
                } else {
                    cc.width = 320; cc.height = 40;
                    const x = cc.getContext('2d');
                    x.fillStyle = '#000'; x.fillRect(0, 0, 320, 40);
                }
            } catch (e) {
                cropErr = e;
                if (e.code === 'TAINTED') this.tainted = true;
                cc.width = 420; cc.height = 44;
                const x = cc.getContext('2d');
                x.fillStyle = '#1a0505'; x.fillRect(0, 0, 420, 44);
                x.fillStyle = '#f87171'; x.font = '13px sans-serif';
                x.fillText('截图失败: ' + String(e.message).slice(0, 46), 8, 27);
            }

            const hint = this.modal.querySelector('#h1sub-diag-hint');
            if (!CFG.region) hint.textContent = '⚠️ 还没框选字幕区域 —— 请先点面板上的「① 框选字幕区」';
            else if (!v) hint.textContent = '⚠️ 没找到视频元素 —— 请确认播放页已打开、视频已加载';
            else if (cropErr && cropErr.code === 'TAINTED') {
                hint.textContent = '⚠️ 视频跨域且未发 CORS 头，画布被污染 → 点「开始」会自动请求「共享此标签页」授权';
            } else {
                hint.textContent = '👀 检查①里的红框是否正好套住原字幕文字。红框偏了 = 框选时框偏了，重新框一次。'
                    + '再对比②，确认 OCR 拿到的是字幕而不是背景画面。';
            }

            this.modal.querySelector('#h1sub-diag-report').value = this.build();
        },

        async copy() {
            const txt = this.build();
            try {
                await navigator.clipboard.writeText(txt);
                UI.setStatus('✅ 诊断报告已复制到剪贴板', 'ok');
            } catch (e) {
                const ta = this.modal.querySelector('#h1sub-diag-report');
                ta.removeAttribute('readonly');
                ta.focus(); ta.select();
                let ok = false;
                try { ok = document.execCommand('copy'); } catch (e2) { }
                ta.setAttribute('readonly', 'readonly');
                UI.setStatus(ok ? '✅ 已复制' : '⚠️ 自动复制失败，请手动全选报告文本复制', ok ? 'ok' : 'warn');
            }
        },
    };

    // ═══════════════════════════════════════════════════════════════
    //  90-panel-html.js — 控制面板：HTML 骨架
    //
    //  只放结构，不放任何行为。里面所有 id 都是 UI.mount() 缓存元素引用和
    //  测试断言依赖的，别改。
    //
    //  对外提供：panelHTML
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    /** 面板的 HTML 骨架：两百多行，塞在 mount() 里会把装配逻辑淹掉；里面所有 id 都是 mount() 缓存元素引用和测试断言依赖的，别改。 */
    function panelHTML() {
        return [
            '<div id="h1sub-head" style="display:flex;align-items:center;gap:7px;padding:8px 10px;background:#1c1f26;cursor:move">',
            '  <b style="font-size:13px">硬字幕翻译</b>',
            '  <span id="h1sub-host" style="flex:1;color:#5c6478;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>',
            '  <span id="h1sub-dot" style="width:8px;height:8px;border-radius:50%;background:#666;flex:none"></span>',
            '  <span id="h1sub-collapse" title="收起成小按钮" style="cursor:pointer;padding:0 4px;opacity:.7">—</span>',
            '  <span id="h1sub-ban" title="在本站永久隐藏面板" style="cursor:pointer;padding:0 4px;opacity:.7">🚫</span>',
            '  <span id="h1sub-close" title="关闭（收成右下角小按钮）" style="cursor:pointer;padding:0 4px;opacity:.7">×</span>',
            '</div>',
            '<div id="h1sub-body" style="padding:10px;max-height:74vh;overflow:auto">',

            '  <div style="display:flex;gap:6px;margin-bottom:8px">',
            '    <button id="h1sub-region" style="flex:1">① 框选字幕区</button>',
            '    <button id="h1sub-run" style="flex:1">开始</button>',
            '  </div>',
            '  <div id="h1sub-region-info" style="color:#8b93a7;margin-bottom:6px">区域：未设定</div>',
            '  <div id="h1sub-preview-wrap" style="margin-bottom:8px;border:1px solid #2c313a;border-radius:6px;overflow:hidden;background:#000;display:none">',
            '    <canvas id="h1sub-preview" style="display:block;width:100%"></canvas>',
            '  </div>',

            '  <details id="h1sub-help" style="margin:0 0 9px;background:#0f1116;border:1px solid #2c313a;border-radius:6px">',
            '    <summary style="cursor:pointer;padding:6px 9px;color:#7dd3fc;user-select:none">❓ 使用说明（3 步上手）</summary>',
            '    <div style="padding:2px 10px 10px;color:#9aa3b8;line-height:1.75;user-select:text">',
            '      <b style="color:#e6e8ee">1️⃣ 配引擎</b><br>',
            '      「快捷预设」一键填好地址和模型 → 填你自己的 API Key → 点「测试 API」看到绿色成功。<br>',
            '      💾 配好后点「<b style="color:#9aa3b8">保存当前配置</b>」存成一套档案，',
            '      以后在「我的配置」下拉框里<b style="color:#9aa3b8">一键切换</b>不同的大模型，不用重打 Key。<br>',
            '      <span style="color:#fbbf24">⚠️ 注意：模型必须支持图片输入。</span>',
            '      DeepSeek 这边统一用 <b>deepseek-flash</b>（支持图片，两个 v4-flash 旧名同样可以）；',
            '      deepseek-v4-pro 和 deepseek-chat 不支持图片，选到它们要配「Umi-OCR 本地识别」引擎。<br><br>',
            '      <b style="color:#e6e8ee">2️⃣ 框字幕</b><br>',
            '      点「① 框选字幕区」，在画面上<b>只框住字幕那一行</b>。框太大会把画面一起 OCR 进去。<br><br>',
            '      <b style="color:#e6e8ee">3️⃣ 开始</b><br>',
            '      点「开始」，中文译文会浮在原字幕位置，自动跟随。<br><br>',
            '      <b style="color:#e6e8ee">🔌 想完全离线（不要 Key、不联网、不花钱）？</b><br>',
            '      引擎选「浏览器内置 AI」→ 点「② 准备离线模型」，等语言包下载完就能用；',
            '      识别方式建议配 Umi-OCR（识别率最高）。<br>',
            '      前提：Chrome 138+ 桌面版（或 Edge）、页面是 HTTPS 或 localhost、',
            '      且不是跨域 iframe。<br><br>',
            '      <b style="color:#e6e8ee">🔍 框歪了 / 识别不准？</b><br>',
            '      点「🔍 诊断模式」，左边看红框（脚本实际截取范围），右边看实际截到的图。<br>',
            '      里面的「复制报告」能一键导出排查信息。<br><br>',
            '      <b style="color:#e6e8ee">🎬 画面读不出来（视频跨域）？</b><br>',
            '      「截图方式」改成「标签页捕获」→ 点「申请共享授权」→ 弹窗里选<b>当前标签页</b>。<br>',
            '      <span style="color:#fbbf24">注意：这种模式下别让译文框压住原字幕，否则会被一起截进去。</span><br><br>',
            '      <b style="color:#e6e8ee">💾 换电脑 / 备份配置</b><br>',
            '      高级 →「导出配置」出 JSON，「导入配置」粘回去。<br><br>',
            '      <b style="color:#e6e8ee">🌐 这个脚本在所有网站都能用</b><br>',
            '      页面上没视频时，它会收成右下角一个小胶囊，不挡内容；<br>',
            '      视频一出现就自动展开。<b>不想在某站出现？</b>点标题栏的 🚫，<br>',
            '      以后想恢复：高级 →「恢复「本站禁用」的网站」。<br>',
            '      框选区域会<b>按网站分别记住</b>，换站不会串台。',
            '    </div>',
            '  </details>',

            '  <div class="h1sub-sec">识别 / 翻译引擎</div>',
            '  <label>引擎',
            '    <select id="h1sub-engine">',
            '      <option value="openai-vision">视觉大模型（OCR+翻译一步，推荐）</option>',
            '      <option value="umi-ocr">Umi-OCR 本地识别（识别率最高·零下载）</option>',
            '      <option value="browser-ai">浏览器内置 AI（完全离线·不要 Key·不要联网）</option>',
            '      <option value="web-translate">免费网页接口（不要 Key·需本机 Umi-OCR）</option>',
            '      <option value="youdao-img">有道图片翻译 API（OCR+翻译一步）</option>',
            '    </select>',
            '  </label>',
            '  <div id="h1sub-openai">',
            '    <label>我的配置<select id="h1sub-profile"></select></label>',
            '    <div style="display:flex;gap:6px;margin:-3px 0 9px">',
            '      <button id="h1sub-profile-save" style="flex:1">💾 保存当前配置</button>',
            '      <button id="h1sub-profile-del">删除</button>',
            '    </div>',
            '    <label>快捷预设<select id="h1sub-preset"></select></label>',
            '    <label>API 地址<input id="h1sub-apiBase" placeholder="选上面的预设自动填入"></label>',
            '    <label>API Key<input id="h1sub-apiKey" type="password" placeholder="sk-..."></label>',
            '    <label>模型<input id="h1sub-model" placeholder="deepseek-flash"></label>',
            '    <div id="h1sub-model-hint" style="margin:-3px 0 7px;min-height:0"></div>',
            '    <div id="h1sub-preset-note" style="color:#fbbf24;margin:-3px 0 7px;min-height:0"></div>',
            '  </div>',
            '  <div id="h1sub-youdao" style="display:none">',
            '    <label>有道 appKey（应用ID）<input id="h1sub-youdaoAppKey" placeholder="控制台 → 应用管理 查看"></label>',
            '    <label>有道 appSecret（应用密钥）<input id="h1sub-youdaoAppSecret" type="password"></label>',
            '    <div style="display:flex;gap:6px">',
            '      <label style="flex:1">源语言<input id="h1sub-youdaoFrom" placeholder="auto"></label>',
            '      <label style="flex:1">目标语言<input id="h1sub-youdaoTo" placeholder="zh-CHS"></label>',
            '    </div>',
            '    <label style="flex-direction:row;align-items:center;gap:6px">',
            '      <input id="h1sub-youdaoLLM" type="checkbox" style="width:auto"> 用有道翻译大模型 pro 版',
            '    </label>',
            '  </div>',
            '  <div id="h1sub-browserai" style="display:none">',
            '    <div style="color:#5c6478;margin:-2px 0 7px">',
            '      用 <b style="color:#9aa3b8">浏览器自带</b>的模型完成翻译：',
            '      <b style="color:#e6e8ee">不要 API Key、不产生任何费用</b>。<br>',
            '      <b style="color:#fbbf24">版本要求：Chrome ≥ 138 / Edge ≥ 148</b>',
            '      —— 这是<b>内核功能</b>，低于这个版本 Translator / LanguageModel',
            '      这两个 API 压根不存在。<br>',
            '      <b style="color:#e6e8ee">Chrome</b>：端侧模型，不联网、原文不出设备。<br>',
            '      <b style="color:#e6e8ee">Edge</b>：同名 API 但是<b style="color:#fbbf24">另一套实现</b>',
            '      —— 实测「日语 → 中文」直接报错、且没有多模态大模型（见下方注意事项）。<br>',
            '      另外还要求页面是 HTTPS 或 localhost，且不在跨域 iframe 里。',
            '    </div>',
            '    <div id="h1sub-bai-ver" style="margin:0 0 7px"></div>',
            '    <label>识别方式',
            '      <select id="h1sub-baiOcr">',
            '        <option value="umi">Umi-OCR 本机识别（识别率最高·推荐）</option>',
            '        <option value="builtin">浏览器内置多模态读图（零安装·识别率一般）</option>',
            '      </select>',
            '    </label>',
            '    <label>翻译方式',
            '      <select id="h1sub-baiTrans">',
            '        <option value="auto">自动（优先端侧翻译模型，不支持就换端侧大模型）</option>',
            '        <option value="translator">只用端侧翻译模型（快·推荐）</option>',
            '        <option value="prompt">只用端侧大模型翻译（实验·中文效果一般）</option>',
            '      </select>',
            '    </label>',
            '    <label style="flex-direction:row;align-items:center;gap:6px">',
            '      <input id="h1sub-baiStream" type="checkbox" style="width:auto"> 流式显示（边生成边出字）',
            '    </label>',
            '    <label style="flex-direction:row;align-items:center;gap:6px">',
            '      <input id="h1sub-baiPivot" type="checkbox" style="width:auto"> 语言对不可用时经英语中转',
            '    </label>',
            '    <div style="color:#5c6478;margin:-3px 0 7px">',
            '      <b style="color:#fbbf24">Edge 用户注意：</b>Edge 的内置翻译对',
            '      <b style="color:#e6e8ee">「日语 → 中文」必报 Generic failures</b>，',
            '      勾上这项就会改走「日语 → 英语 → 中文」，能跑通但译文质量会略降。<br>',
            '      Edge 也<b style="color:#e6e8ee">没有</b>多模态大模型，',
            '      所以「识别方式」不能用「浏览器内置读图」，请用 Umi-OCR。',
            '    </div>',
            '    <div style="display:flex;gap:6px">',
            '      <button id="h1sub-bai-probe" style="flex:1">① 检测浏览器 AI</button>',
            '      <button id="h1sub-bai-prepare" style="flex:1">② 准备离线模型</button>',
            '    </div>',
            '    <progress id="h1sub-bai-bar" max="1" value="0" style="display:none;margin-top:6px"></progress>',
            '    <div id="h1sub-bai-status" style="margin-top:5px;min-height:0;white-space:pre-wrap"></div>',
            '  </div>',
            '  <div id="h1sub-webtranslate" style="display:none">',
            '    <div style="color:#5c6478;margin:-2px 0 7px">',
            '      复用翻译网站<b style="color:#9aa3b8">自己前端在用的接口</b>：',
            '      <b style="color:#e6e8ee">不要 API Key、不花钱</b>。<br>',
            '      识别仍由<b style="color:#9aa3b8">本机 Umi-OCR</b>负责（必须先装好并开着 HTTP 服务）。<br>',
            '      <span style="color:#fbbf24">⚠️ 这些是各家的内部接口，不是公开 API</span>：',
            '      服务条款上通常不允许第三方直接调用，且随时可能改版 / 限流 / 封 IP。',
            '      请仅作个人自用，不要刷量；要稳定请走官方 API 或本地模型。<br>',
            '      脚本已内置「降级链 + 限速 + 缓存」，下面可以逐个接口测活。',
            '    </div>',
            '    <label>翻译接口',
            '      <select id="h1sub-wtEngine">',
            '        <option value="auto">自动降级（腾讯 → 彩云 → 必应）</option>',
            '        <option value="tencent">只用腾讯交互翻译（最省事·无需 token）</option>',
            '        <option value="caiyun">只用彩云小译（前端公开 token）</option>',
            '        <option value="bing">只用必应翻译（最稳·要抓 token）</option>',
            '      </select>',
            '    </label>',
            '    <label>最小请求间隔(ms)<input id="h1sub-wtMinInterval" type="number" min="0" step="100"></label>',
            '    <div style="color:#5c6478;margin:-3px 0 7px">',
            '      间隔越大越不容易被限流。字幕一句一句来，300~2000ms 足够。',
            '    </div>',
            '    <button id="h1sub-wt-test">测试各接口</button>',
            '    <div id="h1sub-wt-status" style="margin-top:5px;min-height:0;white-space:pre-wrap"></div>',
            '  </div>',
            '  <div id="h1sub-umionly" style="display:none">',
            '    <div style="color:#5c6478;margin:-2px 0 7px">',
            '      需要先在电脑上装好并运行 <b style="color:#9aa3b8">Umi-OCR</b>',
            '      （免费开源、离线，自带 PaddleOCR 引擎，识别率很高）。<br>',
            '      <b style="color:#e6e8ee">下载地址：</b>',
            '      <a href="https://github.com/hiroi-sora/Umi-OCR/releases/latest"',
            '         target="_blank" rel="noopener" style="color:#22d3ee">',
            '        github.com/hiroi-sora/Umi-OCR/releases/latest</a><br>',
            '      <b style="color:#e6e8ee">国内镜像（免注册·无限速）：</b>',
            '      <a href="https://hiroi-sora.lanzoul.com/s/umi-ocr"',
            '         target="_blank" rel="noopener" style="color:#22d3ee">',
            '        hiroi-sora.lanzoul.com/s/umi-ocr</a><br><br>',
            '      装好后打开 Umi-OCR →「全局设置」勾选<b style="color:#9aa3b8">高级</b> →',
            '      打开<b style="color:#9aa3b8">HTTP 服务</b>（默认端口 1224）。<br>',
            '      浏览器这边一个字节都不用下载。<br>',
            '      <span style="color:#fbbf24">注：Umi-OCR 只负责把字幕认成文字，不做翻译</span>',
            '      —— 译文由「识别 / 翻译引擎」里选中的那个后端出（大模型 API 或浏览器内置 AI）。',
            '      但它已经把字认好了，所以翻译只需要',
            '      <b style="color:#9aa3b8">文本模型</b>，比用视觉模型便宜得多；',
            '      配「浏览器内置 AI」引擎时，识别和翻译就都在本机完成了。',
            '    </div>',
            '    <label>服务地址<input id="h1sub-umiBase" placeholder="http://127.0.0.1:1224"></label>',
            '    <label>识别语言<select id="h1sub-umiLang"></select></label>',
            '    <button id="h1sub-umi-test">测试连接</button>',
            '    <div id="h1sub-umi-status" style="margin-top:5px;min-height:0;white-space:pre-wrap"></div>',
            '  </div>',

            '  <div class="h1sub-sec">截图方式</div>',
            '  <label>模式',
            '    <select id="h1sub-captureMode">',
            '      <option value="auto">自动（读视频失败就切标签页捕获）</option>',
            '      <option value="element">直接读视频元素（最快，无需授权）</option>',
            '      <option value="display">标签页捕获（万能，需授权一次）</option>',
            '    </select>',
            '  </label>',
            '  <div style="display:flex;gap:6px">',
            '    <button id="h1sub-sharescreen" style="flex:1">申请共享授权</button>',
            '    <button id="h1sub-stopscreen" style="flex:1">停止共享</button>',
            '  </div>',
            '  <div id="h1sub-capture-hint" style="color:#5c6478;margin-top:5px"></div>',

            '  <div class="h1sub-sec">语言</div>',
            '  <label>原文语言<input id="h1sub-srcLang" placeholder="日语"></label>',
            '  <label>目标语言<input id="h1sub-tgtLang" placeholder="简体中文"></label>',

            '  <div class="h1sub-sec">节奏</div>',
            '  <label>截图间隔(ms)<input id="h1sub-interval" type="number" min="300" step="100"></label>',
            '  <label style="flex-direction:row;align-items:center;gap:6px">',
            '    <input id="h1sub-smartSkip" type="checkbox" style="width:auto"> 无文字时跳过调用（省 API 费用）',
            '  </label>',
            '  <label>相似度阈值 <span id="h1sub-simVal" style="color:#8b93a7"></span>',
            '    <input id="h1sub-sim" type="range" min="0" max="0.8" step="0.02">',
            '  </label>',

            '  <div class="h1sub-sec">外观</div>',
            '  <label>字号 <span id="h1sub-fontVal" style="color:#8b93a7"></span>',
            '    <input id="h1sub-fontSize" type="range" min="12" max="48" step="1">',
            '  </label>',
            '  <label>背景不透明度 <span id="h1sub-opacityVal" style="color:#8b93a7"></span>',
            '    <input id="h1sub-bgOpacity" type="range" min="0" max="1" step="0.02">',
            '  </label>',
            '  <label>垂直微调 <span id="h1sub-offsetVal" style="color:#8b93a7"></span>',
            '    <input id="h1sub-offsetY" type="range" min="-200" max="200" step="2">',
            '  </label>',
            '  <label>译文颜色<input id="h1sub-textColor" type="color" style="height:28px;padding:2px"></label>',
            '  <label style="flex-direction:row;align-items:center;gap:6px">',
            '    <input id="h1sub-showOriginal" type="checkbox" style="width:auto"> 同时显示原文',
            '  </label>',
            '  <label style="flex-direction:row;align-items:center;gap:6px">',
            '    <input id="h1sub-overlayTop" type="checkbox" style="width:auto"> 译文显示在字幕上方',
            '  </label>',
            '  <label style="flex-direction:row;align-items:center;gap:6px">',
            '    <input id="h1sub-outline" type="checkbox" style="width:auto"> 文字加描边（亮背景更清楚）',
            '  </label>',

            '  <div class="h1sub-sec">高级</div>',
            '  <label>思考模式（思维链）',
            '    <select id="h1sub-thinkingMode">',
            '      <option value="auto">自动（DeepSeek 接口自动关闭，推荐）</option>',
            '      <option value="off">总是关闭</option>',
            '      <option value="on">跟随平台默认（DeepSeek 默认开启）</option>',
            '    </select>',
            '  </label>',
            '  <div id="h1sub-thinking-hint" style="color:#5c6478;margin:-3px 0 7px"></div>',
            '  <label>最大输出 token<input id="h1sub-maxTokens" type="number" min="64" step="64"></label>',
            '  <label>额外提示词<textarea id="h1sub-extraPrompt" rows="2" placeholder="例如：人名保持音译"></textarea></label>',
            '  <div style="display:flex;gap:6px;margin-top:6px">',
            '    <button id="h1sub-diag" style="flex:1;background:#3b2f0e;border-color:#a16207">🔍 诊断模式</button>',
            '  </div>',
            '  <div style="display:flex;gap:6px;margin-top:6px">',
            '    <button id="h1sub-test" style="flex:1">测试 API</button>',
            '    <button id="h1sub-shot" style="flex:1">手动截一帧</button>',
            '  </div>',
            '  <div style="display:flex;gap:6px;margin-top:6px">',
            '    <button id="h1sub-export" style="flex:1">导出配置</button>',
            '    <button id="h1sub-import" style="flex:1">导入配置</button>',
            '  </div>',
            '  <div style="display:flex;gap:6px;margin-top:6px">',
            '    <button id="h1sub-unban" style="flex:1">恢复「本站禁用」的网站</button>',
            '  </div>',
            '  <div id="h1sub-ban-info" style="color:#5c6478;margin-top:5px"></div>',
            '  <div style="display:flex;gap:6px;margin-top:6px">',
            '    <button id="h1sub-reset" style="flex:1">恢复默认</button>',
            '    <button id="h1sub-clearcache" style="flex:1">清空缓存</button>',
            '  </div>',

            '  <div class="h1sub-sec">状态</div>',
            '  <div id="h1sub-status" style="color:#8b93a7;min-height:34px">就绪</div>',
            '  <div id="h1sub-stats" style="color:#5c6478;margin-top:4px"></div>',

            '  <div class="h1sub-sec">最近识别</div>',
            '  <div id="h1sub-hist" style="color:#9aa3b8;max-height:120px;overflow:auto"></div>',
            '</div>',
        ].join('\n');
    }

    // ═══════════════════════════════════════════════════════════════
    //  92-panel-css.js — 控制面板：样式表
    //
    //  对外提供：panelCSS
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    /** 面板的样式表。后半段是给**弹窗**用的：那些弹窗挂在 body 上、不在 #h1sub-panel 里，`#h1sub-panel
     *  button` 那套选择器作用不到它们；不单独配一套，按钮就会退化成网站的重置样式（浅灰字贴深灰底看不清）。 */
    function panelCSS() {
        return [
            '#h1sub-panel .h1sub-sec{margin:10px 0 5px;padding-top:7px;border-top:1px solid #262b34;color:#7dd3fc;font-weight:700}',
            '#h1sub-panel label{display:flex;flex-direction:column;gap:3px;margin-bottom:7px;color:#9aa3b8}',
            '#h1sub-panel input,#h1sub-panel select,#h1sub-panel textarea{',
            '  background:#0f1116;border:1px solid #2c313a;border-radius:5px;color:#e6e8ee;',
            '  padding:5px 7px;font:12px inherit;outline:none;width:100%;box-sizing:border-box}',
            '#h1sub-panel input:focus,#h1sub-panel select:focus,#h1sub-panel textarea:focus{border-color:#22d3ee}',
            '#h1sub-panel input[type=range]{padding:0}',
            '#h1sub-panel progress{width:100%;height:6px;border:0;border-radius:3px;display:block}',
            '#h1sub-panel button{background:#262b34;border:1px solid #333a46;border-radius:5px;',
            '  color:#e6e8ee;padding:6px 8px;cursor:pointer;font:12px inherit}',
            '#h1sub-panel button:hover{background:#313846}',
            '#h1sub-panel button.on{background:#0e7490;border-color:#22d3ee}',
            '#h1sub-panel button.primary{background:#0e7490;border-color:#22d3ee}',

            '.h1sub-modal button{background:#2f3644;border:1px solid #4a5568;border-radius:5px;',
            '  color:#ffffff;padding:6px 12px;cursor:pointer;font:12px inherit;font-weight:600;',
            '  line-height:1.4;white-space:nowrap}',
            '.h1sub-modal button:hover{background:#3d4657;border-color:#22d3ee}',
            '.h1sub-modal button:active{background:#0e7490;border-color:#22d3ee}',
            '.h1sub-modal button:disabled{opacity:.55;cursor:default}',
            '.h1sub-modal .h1sub-x{color:#cbd5e1;cursor:pointer;padding:2px 8px;font-size:17px;',
            '  line-height:1;border-radius:4px}',
            '.h1sub-modal .h1sub-x:hover{background:#313846;color:#fff}',
        ].join('\n');
    }

    // ═══════════════════════════════════════════════════════════════
    //  94-modal.js — 通用弹窗骨架
    //
    //  诊断 / 导出 / 导入三个弹窗共用这一套遮罩层、标题栏和关闭按钮。
    //  所有 id 都由调用方给出，一个都不能改 —— 测试断言和用户习惯都依赖它们。
    //
    //  对外提供：openModal
    //  依赖：escapeHtml、setHTML
    // ═══════════════════════════════════════════════════════════════
    /**
     * 统一的弹窗骨架。
     *
     * 三个弹窗原来各自抄了一遍遮罩层 / 标题栏 / 关闭按钮的 HTML 与样式，改一次配色要改三处，还漏配过
     * 弹窗按钮样式 —— 在有些站点上会变成浅灰字贴深灰底。所有 id 都由调用方给出，一个都不能改（测试断言依赖）。
     *
     * @param {object} o
     *   title 标题文字；closeId × 按钮的 id；body 内容区 HTML；buttons [{id,label,style}] 右侧按钮
     *   width 弹窗宽度（默认 min(680px,94vw)）；z 层级（默认 2147483641）
     *   headStyle 标题栏追加样式（诊断模式是带下边框的）；bodyStyle 内容区容器样式
     *   modalStyle .h1sub-modal 上的追加样式（默认 padding:14px）
     * @returns {{root, body, close, $}} $ 是 root.querySelector 的简写
     */
    function openModal(o) {
        const root = document.createElement('div');
        root.style.cssText = 'position:fixed;inset:0;z-index:' + (o.z || 2147483641)
            + ';background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center';

        const buttons = (o.buttons || []).map((b) =>
            '<button id="' + b.id + '"' + (b.style ? ' style="' + b.style + '"' : '') + '>'
            + escapeHtml(b.label) + '</button>').join('');

        setHTML(root,
            '<div class="h1sub-modal" style="background:#15171c;color:#e6e8ee;'
            + 'border:1px solid #2c313a;border-radius:10px;'
            + 'width:' + (o.width || 'min(680px,94vw)') + ';'
            + (o.modalStyle || 'padding:14px') + ';font:12px sans-serif">'
            + '<div style="display:flex;align-items:center;gap:8px;'
            + (o.headStyle || 'margin-bottom:8px') + '">'
            + '<b style="flex:1;font-size:13px">' + escapeHtml(o.title || '') + '</b>'
            + buttons
            + '<span id="' + o.closeId + '" class="h1sub-x">×</span>'
            + '</div>'
            + '<div data-h1sub-body' + (o.bodyStyle ? ' style="' + o.bodyStyle + '"' : '') + '></div>'
            + '</div>');

        const body = root.querySelector('[data-h1sub-body]');
        if (o.body) setHTML(body, o.body);
        document.body.appendChild(root);

        const close = () => root.remove();
        root.querySelector('#' + o.closeId).onclick = close;
        return { root, body, close, $: (sel) => root.querySelector(sel) };
    }

    // ═══════════════════════════════════════════════════════════════
    //  96-panel-ui.js — 控制面板：控件绑定、配置档案、导入导出与状态显示
    //
    //  面板的全部行为：装配、拖动、折叠成小胶囊、所有控件的双向绑定、
    //  多套 API 配置档案、Umi-OCR 连接测试、配置导入导出、
    //  状态栏 / 统计 / 历史记录、手动截图与 API 测试。
    //
    //  bind() 只负责列清单，具体接线在各自的 bindXxx() 里 ——
    //  想知道「哪个按钮对应哪段逻辑」，看 bind() 就够了。
    //
    //  对外提供：UI
    //  依赖：CFG、DEFAULTS、API_PRESETS、saveCfg、saveCfgKeys、sanitizeCfg、
    //              cloneDefault、NS、UMI_LANGS、DS_VISION_MODELS、isNoVisionModel、
    //              isStaleDeepSeekModel、shouldDisableThinking、umiBase、umiProbe、
    //              callUmiOCR、callYoudaoImage、callChat、recognizeAndTranslate、
    //              baiPair、baiProbe、baiPrepare、baiReset、baiBrowser、baiVersionNote、
    //              langCode、wtSelftest、
    //              Capturer、Pipeline、Overlay、Diag、Fullscreen、RegionSelector、
    //              openModal、setHTML、escapeHtml、STATUS_COLORS、panelHTML、panelCSS、
    //              banCurrentHost、cache
    // ═══════════════════════════════════════════════════════════════
    //
    // ⚡ 优化：「最近识别」保留的条数提为具名常量。纯属给将来调参留个入口，
    //    行为与原来写死的 30 一致。
    const HIST_MAX = 30;

    const UI = {
        root: null,
        collapsed: false,
        els: {},

        mount() {
            if (this.root) return;

            const root = document.createElement('div');
            root.id = 'h1sub-panel';
            root.style.cssText = [
                'position:fixed', 'right:16px', 'bottom:16px', 'width:320px',
                'z-index:2147483500', 'background:#15171c', 'color:#e6e8ee',
                'border:1px solid #2c313a', 'border-radius:10px',
                'box-shadow:0 10px 30px rgba(0,0,0,.5)',
                'font:12px/1.6 "Microsoft YaHei","PingFang SC",sans-serif',
                'overflow:hidden', 'user-select:none',
            ].join(';');

            setHTML(root, panelHTML());

            const style = document.createElement('style');
            style.textContent = panelCSS();
            document.head.appendChild(style);
            uiHost().appendChild(root);
            this.root = root;

            const ids = ['head', 'host', 'dot', 'collapse', 'close', 'ban', 'body', 'region', 'run', 'region-info',
                'preview-wrap', 'preview', 'engine', 'openai',
                'preset', 'preset-note', 'apiBase', 'apiKey', 'model', 'model-hint',
                'profile', 'profile-save', 'profile-del',
                'youdao', 'youdaoAppKey', 'youdaoAppSecret', 'youdaoFrom', 'youdaoTo', 'youdaoLLM',
                'browserai', 'bai-ver', 'baiOcr', 'baiTrans', 'baiStream', 'baiPivot', 'bai-probe', 'bai-prepare',
                'bai-bar', 'bai-status',
                'webtranslate', 'wtEngine', 'wtMinInterval', 'wt-test', 'wt-status',
                'umionly', 'umiBase', 'umiLang', 'umi-test', 'umi-status',
                'captureMode', 'sharescreen', 'stopscreen', 'capture-hint',
                'srcLang', 'tgtLang', 'interval', 'smartSkip', 'sim', 'simVal',
                'fontSize', 'fontVal', 'bgOpacity', 'opacityVal', 'offsetY', 'offsetVal',
                'textColor', 'outline', 'showOriginal', 'overlayTop',
                'extraPrompt', 'thinkingMode', 'thinking-hint', 'maxTokens',
                'test', 'shot', 'export', 'import', 'unban', 'ban-info',
                'reset', 'clearcache',
                'diag', 'status', 'stats', 'hist'];
            for (const id of ids) {
                this.els[id.replace(/-/g, '_')] = root.querySelector('#h1sub-' + id);
            }

            this.bind();
            this.loadToUI();
            this.syncRegion();
            this.applyLayout();
        },

        /** 恢复上次的面板位置和宽度 */
        applyLayout() {
            if (CFG.panelWidth) {
                this.root.style.width = Math.max(260, Math.min(760, Number(CFG.panelWidth))) + 'px';
            }
            const p = CFG.panelPos;
            if (p && typeof p.left === 'number' && typeof p.top === 'number') {
                this.root.style.right = 'auto';
                this.root.style.bottom = 'auto';
                this.root.style.left = Math.max(0, Math.min(window.innerWidth - 60, p.left)) + 'px';
                this.root.style.top = Math.max(0, Math.min(window.innerHeight - 40, p.top)) + 'px';
            }
        },

        // ── 收起状态的小胶囊 ──
        // 全站运行后，没有视频的页面不该被大面板挡住，所以先收成一个小按钮。
        pillMode: false,
        pillEl: null,

        ensurePill() {
            if (this.pillEl) return this.pillEl;
            const b = document.createElement('div');
            b.id = 'h1sub-pill';
            setHTML(b, '<span style="font-size:10px">▶</span> 字幕翻译');
            b.title = '点击打开「硬字幕翻译」面板';
            b.style.cssText = [
                'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483500',
                'background:#1c1f26', 'color:#7dd3fc', 'border:1px solid #2c313a',
                'border-radius:999px', 'padding:6px 13px', 'cursor:pointer',
                'font:12px/1.5 "Microsoft YaHei","PingFang SC",sans-serif',
                'box-shadow:0 4px 14px rgba(0,0,0,.45)', 'user-select:none',
                'display:none', 'align-items:center', 'gap:6px', 'opacity:.8',
                'transition:opacity .15s',
            ].join(';');
            b.addEventListener('mouseenter', () => { b.style.opacity = '1'; });
            b.addEventListener('mouseleave', () => { b.style.opacity = '.8'; });
            b.addEventListener('click', () => this.leavePillMode());
            uiHost().appendChild(b);
            this.pillEl = b;
            return b;
        },

        /** 收成小胶囊（页面上没有视频时，或用户点关闭时） */
        enterPillMode() {
            this.pillMode = true;
            this.root.style.display = 'none';
            const p = this.ensurePill();
            p.style.display = 'flex';
        },

        leavePillMode() {
            this.pillMode = false;
            if (this.pillEl) this.pillEl.style.display = 'none';
            this.root.style.display = 'block';
            this.applyLayout();
        },

        /** 彻底从页面移除（本站禁用时用） */
        destroy() {
            Pipeline.stop();
            // 不主动停的话，getDisplayMedia 的共享会一直开着：浏览器顶部一直显示"正在共享此标签页"、
            // 隐藏的 video 还在解码，而脚本里那个「停止共享」按钮已经跟着面板一起没了。
            try { Capturer.stopDisplayCapture(); } catch (e) { /* ignore */ }
            if (this.pillEl) { this.pillEl.remove(); this.pillEl = null; }
            if (this.root) this.root.remove();
            this.root = null;       // 不置空的话 mountUI() 会一直以为面板还在
            this.els = {};
            if (this._hrefTimer) { clearInterval(this._hrefTimer); this._hrefTimer = null; }
            Fullscreen.hideTrack();
            if (this._onResize) {
                window.removeEventListener('resize', this._onResize);
                this._onResize = null;
            }
            // 面板拖动挂在 document 上的两个监听也要摘，不然重新挂载后越攒越多
            if (this._onDragMove) {
                document.removeEventListener('mousemove', this._onDragMove);
                this._onDragMove = null;
            }
            if (this._onDragUp) {
                document.removeEventListener('mouseup', this._onDragUp);
                this._onDragUp = null;
            }
            if (this._drag) this._drag.on = false;
            if (Overlay.el) { Overlay.el.remove(); Overlay.el = null; }
        },

        /** 把所有控件接上行为：原先是 290 多行的单方法，现按面板分区拆成几个具名方法，
         *  这里只负责列清单 —— 想知道「哪个按钮对应哪段逻辑」，看这里就够了。 */
        bind() {
            this.bindPanelChrome();
            this.bindProfiles();
            this.bindUmi();
            this.bindBrowserAI();
            this.bindWebTranslate();
            this.bindConfigInputs();
            this.bindPresets();
            this.bindCaptureControls();
            this.bindConfigIO();
            this.bindTools();
            this.bindViewport();
        },

        /** 标题栏（折叠 / 关闭 / 本站禁用）、面板拖动与宽度调节，以及两个主按钮 */
        bindPanelChrome() {
            const e = this.els;

            // 折叠 / 关闭（关闭 = 收成右下角小胶囊，随时能点回来）
            e.close.onclick = () => this.enterPillMode();
            e.collapse.onclick = () => {
                this.collapsed = !this.collapsed;
                e.body.style.display = this.collapsed ? 'none' : 'block';
                e.collapse.textContent = this.collapsed ? '+' : '—';
            };

            e.ban.onclick = () => banCurrentHost();

            // 拖动。两个 document 级监听存到实例上，交给 destroy() 摘掉（不摘每次重挂都会越攒越多）
            const drag = this._drag = { on: false, dx: 0, dy: 0 };
            e.head.addEventListener('mousedown', (ev) => {
                if (ev.target === e.close || ev.target === e.collapse) return;
                drag.on = true;
                const r = this.root.getBoundingClientRect();
                drag.dx = ev.clientX - r.left;
                drag.dy = ev.clientY - r.top;
                ev.preventDefault();
            });
            this._onDragMove = (ev) => {
                if (!drag.on) return;
                this.root.style.right = 'auto';
                this.root.style.bottom = 'auto';
                this.root.style.left = Math.max(0, ev.clientX - drag.dx) + 'px';
                this.root.style.top = Math.max(0, ev.clientY - drag.dy) + 'px';
            };
            this._onDragUp = () => {
                if (!drag.on) return;
                drag.on = false;
                const r = this.root.getBoundingClientRect();
                CFG.panelPos = { left: Math.round(r.left), top: Math.round(r.top) };
                saveCfgKeys(CFG, ['panelPos']);
            };
            document.addEventListener('mousemove', this._onDragMove);
            document.addEventListener('mouseup', this._onDragUp);

            const grip = document.createElement('div');
            grip.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:5px;'
                + 'cursor:ew-resize;z-index:5';
            this.root.appendChild(grip);
            grip.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const startX = ev.clientX;
                const startW = this.root.offsetWidth;
                const onMove = (e2) => {
                    const w = Math.max(260, Math.min(760, startW + (startX - e2.clientX)));
                    this.root.style.width = w + 'px';
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    CFG.panelWidth = this.root.offsetWidth;
                    saveCfgKeys(CFG, ['panelWidth']);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            e.region.onclick = () => RegionSelector.begin();
            e.run.onclick = () => Pipeline.toggle();
        },

        bindProfiles() {
            const e = this.els;
            if (e.profile) {
                e.profile.onchange = () => {
                    if (e.profile.value) this.applyProfile(e.profile.value);
                };
            }
            if (e.profile_save) {
                e.profile_save.onclick = (ev) => { ev.preventDefault(); this.saveProfile(); };
            }
            if (e.profile_del) {
                e.profile_del.onclick = (ev) => { ev.preventDefault(); this.deleteProfile(); };
            }
        },

        bindUmi() {
            const e = this.els;
            if (e.umi_test) {
                e.umi_test.onclick = (ev) => { ev.preventDefault(); this.testUmi(); };
            }
        },

        /** 浏览器内置 AI（完全离线）的两个按钮。「准备」必须在**点击的调用栈**里发起：
         *  端侧模型还没下载时，浏览器只在有用户手势时允许建会话（否则直接拒绝），所以这里不 await。 */
        bindBrowserAI() {
            const e = this.els;
            const self = this;
            if (e.bai_probe) {
                e.bai_probe.onclick = (ev) => { ev.preventDefault(); self.probeBrowserAI(); };
            }
            if (e.bai_prepare) {
                e.bai_prepare.onclick = (ev) => { ev.preventDefault(); self.prepareBrowserAI(); };
            }
        },

        /** 免费网页接口逐个测活：逆向接口随时可能失效，「能不能用」不该靠猜，点一下就知道谁还活着 */
        bindWebTranslate() {
            const e = this.els;
            const self = this;
            if (e.wt_test) {
                e.wt_test.onclick = (ev) => { ev.preventDefault(); self.testWebTranslate(); };
            }
        },

        setWtStatus(text, color) {
            const el = this.els.wt_status;
            if (el) { el.textContent = text; el.style.color = color || '#aeb4c4'; }
        },

        async testWebTranslate() {
            const btn = this.els.wt_test;
            if (btn) btn.disabled = true;
            const pair = (langCode(CFG.srcLang) || 'ja') + ' → ' + (langCode(CFG.tgtLang) || 'zh');
            this.setWtStatus('⏳ 正在逐个测试（' + pair + '）…', '#22d3ee');
            this.setStatus('正在测试免费翻译接口…', 'busy');
            try {
                const rows = await wtSelftest();
                Diag.wtSelftest = rows;
                this.setWtStatus(rows.map(r => (r.ok ? '✅ ' : '❌ ') + r.label
                    + (r.ok ? '：' + r.out.slice(0, 24) : '：' + r.err) + '（' + r.ms + 'ms）').join('\n'),
                    rows.some(r => r.ok) ? '#4ade80' : '#f87171');
                const alive = rows.filter(r => r.ok).length;
                this.setStatus(alive ? '✅ 免费接口可用 ' + alive + '/' + rows.length
                    : '❌ 免费接口都不可用（可能改版了，或网络不通）', alive ? 'ok' : 'err');
            } catch (e) {
                this.setWtStatus('❌ ' + e.message, '#f87171');
                this.setStatus('测试失败：' + e.message, 'err');
            } finally {
                if (btn) btn.disabled = false;
            }
        },

        setBaiStatus(text, color) {
            const el = this.els.bai_status;
            if (el) { el.textContent = text; el.style.color = color || '#aeb4c4'; }
        },

        /** 进度条。ratio 传 null 表示收起 */
        setBaiBar(ratio) {
            const b = this.els.bai_bar;
            if (!b) return;
            if (ratio == null) { b.style.display = 'none'; b.value = 0; return; }
            b.style.display = 'block';
            b.value = Math.max(0, Math.min(1, Number(ratio) || 0));
        },

        /** 探测内置 AI：支持哪些 API、语言对能不能用、要不要先下载 */
        async probeBrowserAI() {
            const btn = this.els.bai_probe;
            if (btn) btn.disabled = true;
            this.setBaiStatus('⏳ 正在检测浏览器内置 AI…', '#22d3ee');
            this.setStatus('正在检测浏览器内置 AI…', 'busy');
            try {
                const rows = await baiProbe();
                Diag.baiProbe = rows;      // 存一份给诊断报告（build() 是同步的，不能现算）
                this.setBaiStatus(rows.map(r => r.label + '：' + r.value).join('\n'), '#aeb4c4');
                const bad = rows.filter(r => r.kind === 'bad');
                this.setStatus(bad.length
                    ? '内置 AI 有 ' + bad.length + ' 项不可用 —— 看上面的检测结果'
                    : '✅ 浏览器内置 AI 可用', bad.length ? 'warn' : 'ok');
            } catch (e) {
                this.setBaiStatus('❌ ' + e.message, '#f87171');
                this.setStatus('检测失败：' + e.message, 'err');
            } finally {
                if (btn) btn.disabled = false;
            }
        },

        /** 准备（必要时下载）离线模型 —— 必须在点击调用栈里发起 */
        async prepareBrowserAI() {
            const btn = this.els.bai_prepare;
            if (btn) btn.disabled = true;
            this.setBaiBar(0);
            this.setBaiStatus('⏳ 正在准备离线模型…', '#22d3ee');
            this.setStatus('正在准备离线模型…', 'busy');
            try {
                const ready = await baiPrepare((msg, ratio) => {
                    if (ratio >= 1) { this.setBaiBar(null); return; }
                    if (msg) this.setBaiStatus('⏳ ' + msg, '#22d3ee');
                    this.setBaiBar(ratio);
                });
                const p = baiPair();
                this.setBaiStatus('✅ 已就绪：' + ready.join('、')
                    + (p ? '\n语言方向：' + p.src + ' → ' + p.tgt : ''), '#4ade80');
                this.setStatus('✅ 离线模型已就绪，可以点「开始」了', 'ok');
            } catch (e) {
                this.setBaiStatus('❌ ' + e.message, '#f87171');
                this.setStatus('准备离线模型失败：' + e.message, 'err');
            } finally {
                this.setBaiBar(null);
                if (btn) btn.disabled = false;
            }
        },

        /** 所有配置项控件的双向绑定。
         *  bindInput 普通输入框 / 下拉框 / 复选框（change 落盘）、bindRange 滑块（input 预览、change 落盘）；
         *  写回后的联动刷新统一收在 onChangeEffects 里，免得每加一项要在好几处补 if。 */
        bindConfigInputs() {
            const e = this.els;
            const self = this;

            /** 某个配置项变了之后，界面 / 缓存要跟着做的调整 */
            const onChangeEffects = (key) => {
                if (key === 'engine') self.syncEngineUI();
                // 离线引擎换了识别方式 → Umi-OCR 配置区的显隐要跟着变
                if (key === 'baiOcr') self.syncEngineUI();
                // 换了语言方向 / 引擎 / 离线模式，端侧会话（按语言对和模式缓存）就得重建
                if (['srcLang', 'tgtLang', 'engine', 'baiOcr', 'baiTrans', 'baiPivot'].includes(key)) baiReset();
                // 免费接口换了引擎 / 限速，之前的节奏记录作废
                if (key === 'wtEngine' || key === 'wtMinInterval') wtReset();
                if (key === 'captureMode') self.syncCaptureUI();
                // auto 模式要看 API 地址判断，地址变了提示也得跟着变
                if (key === 'thinkingMode' || key === 'apiBase') self.syncThinkingUI();
                if (key === 'model' || key === 'apiBase') self.syncModelHint();
                // 地址 / Key / 模型任一改动，都可能让"当前配置"对不上任何档案
                if (key === 'model' || key === 'apiBase' || key === 'apiKey') {
                    self.syncProfileSelection();
                }
                if (['showOriginal', 'overlayTop', 'fontSize', 'bgOpacity',
                    'textColor', 'outline', 'offsetY'].includes(key)) {
                    Overlay.clear();
                    Overlay.last = null;
                    Pipeline.lastThumb = null;
                    Pipeline.lastOriginal = '';
                }
                // 换了语言 / 模型 / 提示词后，缓存里的旧译文就不对了（最典型的是改了目标语言）
                if (['tgtLang', 'srcLang', 'model', 'apiBase', 'extraPrompt',
                    'engine', 'baiOcr', 'baiTrans', 'baiPivot', 'wtEngine'].includes(key)) {
                    cache.clear();
                    Pipeline.lastOriginal = '';
                    Pipeline.lastTranslation = '';
                }
            };

            const bindInput = (key, el, cast) => {
                if (!el) return;                 // 控件不存在就跳过，别让一个 null 拖垮整个绑定
                el.addEventListener('change', () => {
                    CFG[key] = cast ? cast(el.value) : el.value;
                    // 只写这一个键：全量 saveCfg 要动 30+ 个存储项，而这里每次只改一项
                    saveCfgKeys(CFG, [key]);
                    onChangeEffects(key);
                });
            };

            // 滑块：拖动时即时预览，松开才落盘
            const bindRange = (key, el, labelEl, fmt, cast) => {
                if (!el) return;
                const apply = (save) => {
                    CFG[key] = cast(el.value);
                    if (labelEl) labelEl.textContent = fmt(CFG[key]);
                    Overlay.clear();
                    if (save) saveCfgKeys(CFG, [key]);
                };
                el.addEventListener('input', () => apply(false));
                el.addEventListener('change', () => apply(true));
            };

            bindInput('engine', e.engine);
            bindInput('apiBase', e.apiBase);
            bindInput('apiKey', e.apiKey);
            bindInput('model', e.model);
            bindInput('youdaoAppKey', e.youdaoAppKey);
            bindInput('youdaoAppSecret', e.youdaoAppSecret);
            bindInput('youdaoFrom', e.youdaoFrom);
            bindInput('youdaoTo', e.youdaoTo);
            bindInput('youdaoLLM', e.youdaoLLM, () => e.youdaoLLM.checked);
            bindInput('umiBase', e.umiBase);
            bindInput('umiLang', e.umiLang);
            bindInput('baiOcr', e.baiOcr);
            bindInput('baiTrans', e.baiTrans);
            bindInput('baiStream', e.baiStream, () => e.baiStream.checked);
            bindInput('baiPivot', e.baiPivot, () => e.baiPivot.checked);
            bindInput('wtEngine', e.wtEngine);
            bindInput('wtMinInterval', e.wtMinInterval, Number);
            bindInput('captureMode', e.captureMode);
            bindInput('srcLang', e.srcLang);
            bindInput('tgtLang', e.tgtLang);
            bindInput('interval', e.interval, Number);
            bindInput('extraPrompt', e.extraPrompt);
            bindInput('thinkingMode', e.thinkingMode);
            bindInput('maxTokens', e.maxTokens, Number);
            bindInput('smartSkip', e.smartSkip, () => e.smartSkip.checked);
            bindInput('showOriginal', e.showOriginal, () => e.showOriginal.checked);
            bindInput('overlayTop', e.overlayTop, () => e.overlayTop.checked);
            bindInput('outline', e.outline, () => e.outline.checked);
            bindInput('textColor', e.textColor);

            bindRange('fontSize', e.fontSize, e.fontVal, v => v + ' px', Number);
            bindRange('bgOpacity', e.bgOpacity, e.opacityVal, v => Math.round(v * 100) + '%', Number);
            bindRange('offsetY', e.offsetY, e.offsetVal, v => (v > 0 ? '+' : '') + v + ' px', Number);

            // 相似度阈值不在这两套里：它的展示格式和回写规则都不一样
            const applySim = (save) => {
                CFG.textSimThreshold = Number(e.sim.value);
                e.simVal.textContent = CFG.textSimThreshold.toFixed(2);
                if (save) saveCfgKeys(CFG, ['textSimThreshold']);
            };
            e.sim.addEventListener('input', () => applySim(false));
            e.sim.addEventListener('change', () => applySim(true));
        },

        /** 平台预设下拉：一键填地址和模型，顺带提示模型支不支持图片 */
        bindPresets() {
            const e = this.els;
            const self = this;

            API_PRESETS.forEach((p, i) => {
                const o = document.createElement('option');
                o.value = String(i);
                o.textContent = p.name;
                e.preset.appendChild(o);
            });
            e.preset.onchange = () => {
                const p = API_PRESETS[Number(e.preset.value)];
                if (!p || !p.base) { e.preset_note.textContent = ''; return; }
                CFG.apiBase = p.base;
                CFG.model = p.model;
                e.apiBase.value = p.base;
                e.model.value = p.model;

                // 选到不支持图片的模型时自动切到 Umi-OCR（本机识别），免得配好了却一直报错
                const noVision = isNoVisionModel(p.model);
                let msg;
                if (noVision && CFG.engine === 'openai-vision') {
                    CFG.engine = 'umi-ocr';
                    e.engine.value = 'umi-ocr';
                    msg = '⚠️ ' + p.note + ' → 已自动切到「Umi-OCR 本地识别」引擎';
                } else if (noVision) {
                    msg = '⚠️ ' + p.note;
                } else {
                    msg = '✅ 已填入地址和模型（支持图片输入），只差 API Key';
                    if (p.note) msg += '　' + p.note;
                }
                saveCfgKeys(CFG, ['apiBase', 'model', 'engine']);
                self.syncEngineUI();
                self.syncModelHint();
                self.syncProfileSelection();
                e.preset_note.textContent = msg;
                self.setStatus('已应用预设：' + p.name, 'ok');
            };
        },

        bindCaptureControls() {
            const e = this.els;
            const self = this;

            e.sharescreen.onclick = async () => {
                try {
                    self.setStatus('请在弹窗里选「此标签页」并点共享…', 'busy');
                    await Capturer.startDisplayCapture();
                    self.applyCaptureMode('display', '✅ 标签页捕获已启动');
                } catch (err) {
                    self.setStatus('共享授权失败：' + err.message, 'err');
                }
            };
            e.stopscreen.onclick = () => {
                Capturer.stopDisplayCapture();
                self.applyCaptureMode('auto', '已停止共享，回到直接读视频模式');
            };
        },

        /** 配置导出 / 导入，以及恢复被禁用的网站 */
        bindConfigIO() {
            const e = this.els;
            const self = this;

            e.export.onclick = () => self.exportCfg();
            e.import.onclick = () => self.importCfg();

            e.unban.onclick = () => {
                const list = Array.isArray(CFG.disabledHosts) ? CFG.disabledHosts : [];
                if (!list.length) {
                    self.setStatus('没有被禁用的网站', 'warn');
                    return;
                }
                if (!confirm('清空禁用列表？以下网站会重新显示面板：\n\n' + list.join('\n'))) return;
                CFG.disabledHosts = [];
                saveCfgKeys(CFG, ['disabledHosts']);
                self.renderBanInfo();
                self.setStatus('✅ 已清空禁用列表（共 ' + list.length + ' 个网站）', 'ok');
            };
        },

        bindTools() {
            const e = this.els;
            const self = this;

            e.diag.onclick = () => Diag.open();
            e.test.onclick = () => self.testApi();
            e.shot.onclick = () => self.manualShot();

            e.reset.onclick = () => {
                if (!confirm('恢复所有设置为默认值？\n（API Key / 有道密钥 / 本站框选区域都会被清空）')) return;
                for (const k in DEFAULTS) {
                    const dv = cloneDefault(DEFAULTS[k]);   // 必须拷贝，否则会连默认值一起改掉
                    try { GM_setValue(NS + k, dv); } catch (err) { }
                    CFG[k] = dv;
                }
                self.loadToUI();
                self.syncRegion();
                self.syncCaptureUI();
                self.setStatus('已恢复默认', 'ok');
            };

            e.clearcache.onclick = () => {
                cache.clear();
                self.setStatus('翻译缓存已清空', 'ok');
            };
        },

        /** 窗口尺寸变化时重新定位字幕。
         *  拖窗口时 resize 连发几十次，而 reposition 要读 offsetWidth 触发同步重排，
         *  所以用 rAF 合并成每帧最多一次；存到 this 上是为了 destroy() 时能摘掉。 */
        bindViewport() {
            let resizeRaf = 0;
            this._onResize = () => {
                if (resizeRaf) return;
                resizeRaf = requestAnimationFrame(() => {
                    resizeRaf = 0;
                    Overlay.reposition();
                });
            };
            window.addEventListener('resize', this._onResize);
        },

        /** 切换截图方式并同步相关 UI。「申请共享授权」「停止共享」「画布被污染自动切换」
         *  三处的写配置 → 落盘 → 刷新控件 → 刷新提示是同一段流程，收在这里。 */
        applyCaptureMode(mode, statusMsg, statusKind) {
            CFG.captureMode = mode;
            saveCfgKeys(CFG, ['captureMode']);
            this.loadToUI();
            this.syncCaptureUI();
            if (statusMsg) this.setStatus(statusMsg, statusKind || 'ok');
        },

        syncCaptureUI() {
            const h = this.els.capture_hint;
            if (!h) return;
            if (Capturer.mode === 'display') {
                h.textContent = '当前：🎬 标签页捕获（即使视频跨域也能用；注意译文框别压住字幕区，否则会被一起截进去）';
                h.style.color = '#4ade80';
            } else {
                h.textContent = '当前：📺 直接读视频元素（最快、无需授权；若视频跨域会提示切换）';
                h.style.color = '#5c6478';
            }
        },

        /** 模型名提示：手动输入也能检查出「不支持图片」 */
        syncModelHint() {
            const el = this.els.model_hint;
            if (!el) return;
            const model = (CFG.model || '').trim();
            const isDS = /deepseek/i.test(CFG.apiBase || '');

            if (!model) {
                el.textContent = isDS ? 'DeepSeek 请填 deepseek-flash（支持图片）' : '';
                el.style.color = '#fbbf24';
                return;
            }
            if (isNoVisionModel(model)) {
                el.textContent = '⚠️ ' + model + ' 不支持图片输入 —— 视觉引擎会报错。'
                    + '请改用支持图片的模型，或把引擎切成「Umi-OCR 本地识别」。';
                el.style.color = '#f87171';
                return;
            }
            if (isDS && isStaleDeepSeekModel(model)) {
                el.textContent = '⚠️ DeepSeek 这边只有 deepseek-flash 支持图片输入，'
                    + '建议把模型改成 deepseek-flash。';
                el.style.color = '#fbbf24';
                return;
            }
            if (isDS && DS_VISION_MODELS.indexOf(model.trim().toLowerCase()) >= 0) {
                el.textContent = '✅ ' + model + ' 支持图片输入，可用于视觉引擎。';
                el.style.color = '#4ade80';
                return;
            }
            el.textContent = '';
        },

        syncThinkingUI() {
            const el = this.els.thinking_hint;
            if (!el) return;
            const mode = CFG.thinkingMode || 'auto';
            if (shouldDisableThinking()) {
                el.textContent = '✅ 会发送「关闭思考模式」参数 —— 字幕 OCR 不需要思维链，这样更快更省，'
                    + '也不会出现「只返回推理、没有正文」。';
                el.style.color = '#4ade80';
            } else if (mode === 'on') {
                el.textContent = '⚠️ 思考模式可能开着。思维链会先吃掉一大段输出预算，'
                    + '若报「只返回推理没有正文」，请改成「自动」或把最大输出调大。';
                el.style.color = '#fbbf24';
            } else {
                el.textContent = '不会发送思考模式参数（非 DeepSeek 接口一般没这个开关）。';
                el.style.color = '#5c6478';
            }
        },

        renderBanInfo() {
            const el = this.els.ban_info;
            if (!el) return;
            const list = Array.isArray(CFG.disabledHosts) ? CFG.disabledHosts : [];
            if (!list.length) {
                el.textContent = '当前没有禁用任何网站';
                el.style.color = '#5c6478';
            } else {
                el.textContent = '已禁用 ' + list.length + ' 个网站：'
                    + list.slice(0, 4).join('、') + (list.length > 4 ? ' 等' : '');
                el.style.color = '#fbbf24';
            }
        },

        exportCfg() {
            const out = {};
            for (const k in DEFAULTS) out[k] = CFG[k];
            delete out.regionsByHost;   // 各站的页面坐标，换机器没意义，导出时去掉更干净
            const txt = JSON.stringify(out, null, 2);

            const ui = openModal({
                title: '导出配置（含 API Key，别随便分享）',
                closeId: 'h1sub-exp-close',
                buttons: [{ id: 'h1sub-exp-copy', label: '复制' }],
                body: '<textarea id="h1sub-exp-ta" readonly style="width:100%;height:300px;background:#0f1116;'
                    + 'color:#cbd5e1;border:1px solid #2c313a;border-radius:6px;padding:8px;'
                    + 'font:11px/1.5 Consolas,monospace;box-sizing:border-box"></textarea>',
            });

            const ta = ui.$('#h1sub-exp-ta');
            ta.value = txt;
            ui.$('#h1sub-exp-copy').onclick = async () => {
                ta.removeAttribute('readonly'); ta.select();
                let ok = false;
                try { ok = document.execCommand('copy'); } catch (e) { }
                ta.setAttribute('readonly', 'readonly');
                if (!ok) { try { await navigator.clipboard.writeText(txt); ok = true; } catch (e) { } }
                this.setStatus(ok ? '✅ 配置已复制' : '请手动全选复制', ok ? 'ok' : 'warn');
            };
        },

        importCfg() {
            const ui = openModal({
                title: '导入配置 —— 粘贴之前导出的 JSON',
                closeId: 'h1sub-imp-close',
                buttons: [{ id: 'h1sub-imp-ok', label: '导入' }],
                body: '<textarea id="h1sub-imp-ta" placeholder=\'{"engine":"openai-vision", ...}\' '
                    + 'style="width:100%;height:300px;background:#0f1116;color:#cbd5e1;'
                    + 'border:1px solid #2c313a;border-radius:6px;padding:8px;'
                    + 'font:11px/1.5 Consolas,monospace;box-sizing:border-box"></textarea>'
                    + '<div id="h1sub-imp-msg" style="margin-top:6px;color:#8b93a7"></div>',
            });
            const close = ui.close;
            ui.$('#h1sub-imp-ok').onclick = () => {
                const msg = ui.$('#h1sub-imp-msg');
                let obj;
                try {
                    obj = JSON.parse(ui.$('#h1sub-imp-ta').value);
                } catch (e) {
                    msg.textContent = '❌ JSON 解析失败：' + e.message;
                    msg.style.color = '#f87171';
                    return;
                }
                if (!obj || typeof obj !== 'object') {
                    msg.textContent = '❌ 内容不是一个配置对象';
                    msg.style.color = '#f87171';
                    return;
                }
                let n = 0;
                for (const k in DEFAULTS) {
                    if (k in obj) {
                        CFG[k] = obj[k];
                        n++;
                    }
                }
                // 外部粘进来的 JSON 是不可信输入：类型、区间、引擎名都要兜住，
                // 尤其是 fontSize —— 它会被直接拼进 innerHTML
                sanitizeCfg(CFG);
                saveCfg(CFG);
                this.loadToUI();
                this.syncRegion();
                this.syncCaptureUI();
                this.renderBanInfo();
                this.setStatus('✅ 已导入 ' + n + ' 项配置', 'ok');
                close();
            };
        },

        syncEngineUI() {
            const eng = CFG.engine;
            const isBai = eng === 'browser-ai';
            const isWt = eng === 'web-translate';
            // 有道引擎不需要 OpenAI 的地址 / Key / 模型；Umi-OCR / 免费网页接口只用它做识别，
            // 仍要靠 OpenAI 配置出译文；浏览器内置 AI 连翻译都在本机做，API 配置区一并藏掉。
            this.els.openai.style.display = (eng === 'youdao-img' || isBai || isWt) ? 'none' : 'block';
            this.els.youdao.style.display = eng === 'youdao-img' ? 'block' : 'none';
            this.els.browserai.style.display = isBai ? 'block' : 'none';
            this.els.webtranslate.style.display = isWt ? 'block' : 'none';
            // 这三类都要用 Umi-OCR 的地址 / 语言控件：umi-ocr、免费网页接口、离线引擎选「Umi-OCR 识别」
            const needUmi = eng === 'umi-ocr' || isWt || (isBai && CFG.baiOcr !== 'builtin');
            this.els.umionly.style.display = needUmi ? 'block' : 'none';
            if (isBai) this.renderBaiVersion();
        },

        /** 把内核版本门槛的结果贴在面板上。用独立的 #h1sub-bai-ver，不去动 #h1sub-bai-status ——
         *  后者要留给「检测 / 准备」的输出，不能一改配置就被冲掉。 */
        renderBaiVersion() {
            const el = this.els.bai_ver;
            if (!el) return;
            const b = baiBrowser();
            const note = baiVersionNote();
            if (note) {
                el.textContent = note;
                el.style.color = '#fbbf24';
            } else {
                el.textContent = '✅ 浏览器内核：' + b.text + '（满足 ' + b.required + '）';
                el.style.color = '#4ade80';
            }
        },

        // ── 多套 API 配置档案 ──────────────────────────────────
        //  存的是「地址 + Key + 模型 + 思考模式 + 最大 token」整套，换供应商不用再翻控制台找 Key。

        /** 重建配置下拉框；selectName 指定重建后选中哪一项 */
        renderProfiles(selectName) {
            const sel = this.els.profile;
            if (!sel) return;
            if (!Array.isArray(CFG.apiProfiles)) CFG.apiProfiles = [];

            setHTML(sel, '');
            const ph = document.createElement('option');
            ph.value = '';
            ph.textContent = CFG.apiProfiles.length
                ? '— 点这里切换我的配置 —'
                : '（还没有保存的配置）';
            sel.appendChild(ph);

            for (const p of CFG.apiProfiles) {
                const o = document.createElement('option');
                o.value = p.name;
                o.textContent = p.name + (p.model ? '（' + p.model + '）' : '');
                sel.appendChild(o);
            }

            if (selectName !== undefined) {
                sel.value = CFG.apiProfiles.some(p => p.name === selectName) ? selectName : '';
            } else {
                this.syncProfileSelection();
            }
        },

        /** 让下拉框反映「当前生效的配置」。手动改了地址 / Key / 模型就对不上任何档案了，
         *  这时回到占位项，表示"当前是未保存的改动" —— 比留着一个对不上的名字诚实。 */
        syncProfileSelection() {
            const sel = this.els.profile;
            if (!sel || !Array.isArray(CFG.apiProfiles)) return;
            const hit = CFG.apiProfiles.find(p =>
                (p.apiBase || '') === (CFG.apiBase || '')
                && (p.apiKey || '') === (CFG.apiKey || '')
                && (p.model || '') === (CFG.model || ''));
            sel.value = hit ? hit.name : '';
        },

        /** 把当前配置存成（或覆盖）一个命名档案。返回存下的记录。 */
        upsertProfile(name) {
            const clean = String(name == null ? '' : name).trim();
            if (!clean) return null;
            if (!Array.isArray(CFG.apiProfiles)) CFG.apiProfiles = [];

            const rec = {
                name: clean,
                apiBase: CFG.apiBase || '',
                apiKey: CFG.apiKey || '',
                model: CFG.model || '',
                thinkingMode: CFG.thinkingMode,
                maxTokens: CFG.maxTokens,
            };
            // 同名直接覆盖，免得列表里堆出一串重复项
            CFG.apiProfiles = CFG.apiProfiles.filter(p => p.name !== clean);
            CFG.apiProfiles.push(rec);
            saveCfgKeys(CFG, ['apiProfiles']);
            this.renderProfiles(clean);
            return rec;
        },

        applyProfile(name) {
            const p = (CFG.apiProfiles || []).find(x => x.name === name);
            if (!p) return false;

            CFG.apiBase = p.apiBase || '';
            CFG.apiKey = p.apiKey || '';
            CFG.model = p.model || '';
            if (p.thinkingMode) CFG.thinkingMode = p.thinkingMode;
            if (p.maxTokens) CFG.maxTokens = p.maxTokens;

            const e = this.els;
            e.apiBase.value = CFG.apiBase;
            e.apiKey.value = CFG.apiKey;
            e.model.value = CFG.model;
            if (e.thinkingMode) e.thinkingMode.value = CFG.thinkingMode;
            if (e.maxTokens) e.maxTokens.value = CFG.maxTokens;

            saveCfgKeys(CFG, ['apiBase', 'apiKey', 'model', 'thinkingMode', 'maxTokens']);
            this.syncModelHint();
            this.syncThinkingUI();
            this.syncEngineUI();
            this.renderProfiles(name);
            this.setStatus('已切换到配置「' + name + '」', 'ok');
            return true;
        },

        /** 删除一个配置档案（点两次才真的删，避免误触丢掉 Key） */
        deleteProfile(name, ev) {
            const target = name || (this.els.profile && this.els.profile.value);
            if (!target) {
                this.setStatus('先在下拉框里选一个要删除的配置', 'warn');
                this._delArm = null;
                return false;
            }

            const btn = this.els.profile_del;
            if (this._delArm !== target) {
                this._delArm = target;
                if (btn) btn.textContent = '再点一次删除';
                this.setStatus('再点一次「删除」就真的删掉「' + target + '」（含保存的 API Key）', 'warn');
                clearTimeout(this._delTimer);
                this._delTimer = setTimeout(() => {
                    this._delArm = null;
                    if (btn) btn.textContent = '删除';
                }, 4000);
                return false;
            }

            this._delArm = null;
            clearTimeout(this._delTimer);
            if (btn) btn.textContent = '删除';
            CFG.apiProfiles = (CFG.apiProfiles || []).filter(p => p.name !== target);
            saveCfgKeys(CFG, ['apiProfiles']);
            this.renderProfiles();
            this.setStatus('已删除配置「' + target + '」', 'ok');
            return true;
        },

        askProfileName(defaultName) {
            return new Promise(resolve => {
                const m = document.createElement('div');
                m.style.cssText = 'position:fixed;inset:0;z-index:2147483642;background:rgba(0,0,0,.75);'
                    + 'display:flex;align-items:center;justify-content:center';
                setHTML(m, '<div class="h1sub-modal" style="background:#15171c;color:#e6e8ee;'
                    + 'border:1px solid #2c313a;border-radius:10px;width:min(420px,92vw);'
                    + 'padding:16px;font:12px sans-serif">'
                    + '<b style="font-size:13px">保存当前 API 配置</b>'
                    + '<div style="color:#8b93a7;margin:6px 0 10px">'
                    + '给这套配置起个名字，以后在下拉框里一键切换。</div>'
                    + '<input id="h1sub-pn-input" style="width:100%;background:#0f1116;'
                    + 'border:1px solid #2c313a;border-radius:5px;color:#e6e8ee;padding:6px 8px;'
                    + 'font:12px inherit;box-sizing:border-box;outline:none">'
                    + '<div id="h1sub-pn-msg" style="color:#f87171;min-height:16px;margin-top:6px"></div>'
                    + '<div style="display:flex;gap:8px;justify-content:flex-end">'
                    + '<button id="h1sub-pn-cancel">取消</button>'
                    + '<button id="h1sub-pn-ok" style="background:#0e7490;border-color:#22d3ee">保存</button>'
                    + '</div></div>');
                document.body.appendChild(m);

                const input = m.querySelector('#h1sub-pn-input');
                const msg = m.querySelector('#h1sub-pn-msg');
                input.value = defaultName || '';
                input.focus();
                input.select();

                const done = (v) => { m.remove(); resolve(v); };
                m.querySelector('#h1sub-pn-cancel').onclick = () => done(null);
                m.querySelector('#h1sub-pn-ok').onclick = () => {
                    const v = input.value.trim();
                    if (!v) { msg.textContent = '名字不能为空'; return; }
                    done(v);
                };
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') { ev.preventDefault(); m.querySelector('#h1sub-pn-ok').click(); }
                    if (ev.key === 'Escape') done(null);
                });
            });
        },

        async saveProfile() {
            if (!CFG.apiBase && !CFG.model) {
                this.setStatus('先把 API 地址和模型填好，再保存', 'warn');
                return null;
            }
            let def = CFG.model || '配置';
            try {
                const host = new URL(CFG.apiBase).host.replace(/^api\./, '');
                if (host) def = host.split('.')[0] + ' · ' + (CFG.model || '配置');
            } catch (e) { /* 地址还没填完整就用模型名兜底 */ }

            const name = await this.askProfileName(def);
            if (!name) return null;

            const rec = this.upsertProfile(name);
            if (rec) this.setStatus('✅ 已保存配置「' + name + '」', 'ok');
            return rec;
        },

        // ── Umi-OCR（本机离线识别）────────────────────────────

        fillUmiLangs() {
            const sel = this.els.umiLang;
            if (!sel || sel.options.length) return;
            for (const l of UMI_LANGS) {
                const o = document.createElement('option');
                o.value = l.code;
                o.textContent = l.name;
                sel.appendChild(o);
            }
            // 也允许使用接口返回的其它语言
            if (CFG.umiLang && !UMI_LANGS.some(l => l.code === CFG.umiLang)) {
                const o = document.createElement('option');
                o.value = CFG.umiLang;
                o.textContent = CFG.umiLang;
                sel.appendChild(o);
            }
        },

        setUmiStatus(text, color) {
            const el = this.els.umi_status;
            if (el) { el.textContent = text; el.style.color = color || '#aeb4c4'; }
        },

        async testUmi() {
            const btn = this.els.umi_test;
            if (btn) btn.disabled = true;
            this.setUmiStatus('⏳ 正在连接 ' + umiBase() + ' …', '#22d3ee');
            this.setStatus('正在测试 Umi-OCR 连接…', 'busy');
            try {
                const opt = await umiProbe();
                const langs = (opt['ocr.language'] && opt['ocr.language'].optionsList)
                    ? opt['ocr.language'].optionsList.map(x => x[1]).join('、')
                    : '';

                // 光接口活着不算数，真识别一张小图确认引擎能出结果
                let probe = '';
                try {
                    const c = document.createElement('canvas');
                    c.width = 320; c.height = 80;
                    const g = c.getContext('2d');
                    g.fillStyle = '#000'; g.fillRect(0, 0, 320, 80);
                    g.fillStyle = '#fff';
                    g.font = 'bold 44px Arial, sans-serif';
                    g.textBaseline = 'middle';
                    g.fillText('TEST 123', 14, 42);
                    const t0 = Date.now();
                    const got = await callUmiOCR(c.toDataURL('image/png'));
                    probe = '\n试跑识别「TEST 123」→ 得到「' + (got || '(空)') + '」，耗时 '
                        + (Date.now() - t0) + 'ms';
                } catch (e2) {
                    probe = '\n试跑识别失败：' + e2.message;
                }

                this.setUmiStatus('✅ 连接成功！' + probe
                    + (langs ? '\n可用语言：' + langs : ''), '#4ade80');
                this.setStatus('✅ Umi-OCR 可用', 'ok');
            } catch (e) {
                this.setUmiStatus('❌ ' + e.message, '#f87171');
                this.setStatus('Umi-OCR 连接失败', 'err');
            } finally {
                if (btn) btn.disabled = false;
            }
        },

        // ── 控件 ⇄ 配置同步 ─────────────────────────────────

        /** 把 CFG 的当前值一次性刷到所有控件上（挂载后、切模式后调用） */
        loadToUI() {
            const e = this.els;
            e.engine.value = CFG.engine;
            e.apiBase.value = CFG.apiBase;
            e.apiKey.value = CFG.apiKey;
            e.model.value = CFG.model;
            e.youdaoAppKey.value = CFG.youdaoAppKey;
            e.youdaoAppSecret.value = CFG.youdaoAppSecret;
            e.youdaoFrom.value = CFG.youdaoFrom;
            e.youdaoTo.value = CFG.youdaoTo;
            e.youdaoLLM.checked = !!CFG.youdaoLLM;
            this.renderProfiles();
            this.fillUmiLangs();
            e.umiBase.value = CFG.umiBase;
            e.umiLang.value = CFG.umiLang;
            e.baiOcr.value = CFG.baiOcr || 'umi';
            e.baiTrans.value = CFG.baiTrans || 'auto';
            e.baiStream.checked = !!CFG.baiStream;
            e.baiPivot.checked = !!CFG.baiPivot;
            e.wtEngine.value = CFG.wtEngine || 'auto';
            e.wtMinInterval.value = CFG.wtMinInterval;
            e.srcLang.value = CFG.srcLang;
            e.tgtLang.value = CFG.tgtLang;
            e.interval.value = CFG.interval;
            e.smartSkip.checked = !!CFG.smartSkip;
            e.sim.value = CFG.textSimThreshold;
            e.simVal.textContent = Number(CFG.textSimThreshold).toFixed(2);
            e.captureMode.value = CFG.captureMode || 'auto';

            e.fontSize.value = CFG.fontSize;
            e.fontVal.textContent = Number(CFG.fontSize) + ' px';
            e.bgOpacity.value = CFG.bgOpacity;
            e.opacityVal.textContent = Math.round(Number(CFG.bgOpacity) * 100) + '%';
            e.offsetY.value = CFG.offsetY;
            e.offsetVal.textContent = (CFG.offsetY > 0 ? '+' : '') + Number(CFG.offsetY) + ' px';
            e.textColor.value = CFG.textColor || '#ffffff';
            e.outline.checked = !!CFG.outline;

            e.showOriginal.checked = !!CFG.showOriginal;
            e.overlayTop.checked = !!CFG.overlayTop;
            e.extraPrompt.value = CFG.extraPrompt || '';
            e.host.textContent = location.hostname;
            e.host.title = location.href;
            this.syncEngineUI();
            this.syncCaptureUI();
            this.syncThinkingUI();
            this.syncModelHint();
            this.renderBanInfo();
            this.setBaiBar(null);
            this.setBaiStatus(CFG.engine === 'browser-ai'
                ? '点「① 检测浏览器 AI」看这台机器支不支持；首次使用还要点「② 准备离线模型」'
                : '', '#5c6478');
        },

        syncRegion() {
            const e = this.els;
            if (CFG.region) {
                const r = CFG.region;
                e.region_info.textContent = '区域：' + Math.round(r.w) + '×' + Math.round(r.h)
                    + ' @ (' + Math.round(r.x) + ',' + Math.round(r.y) + ')';
                e.region_info.style.color = '#4ade80';
                e.preview_wrap.style.display = 'block';
            } else {
                e.region_info.textContent = '区域：未设定';
                e.region_info.style.color = '#8b93a7';
                e.preview_wrap.style.display = 'none';
            }
        },

        setPreview(canvas) {
            const p = this.els.preview;
            if (!p) return;
            // 面板收成小胶囊 / 内容折叠起来时预览区根本看不见，每轮还缩放画一遍就是纯浪费
            if (this.pillMode || this.collapsed) return;
            if (this.root && this.root.style.display === 'none') return;
            if (p.width !== canvas.width || p.height !== canvas.height) {
                p.width = canvas.width;
                p.height = canvas.height;
            }
            p.getContext('2d').drawImage(canvas, 0, 0);
        },

        setEdge(ed) {
            if (!this.els.stats) return;
            this.els.stats.dataset.edge = ed.toFixed(3);
            this.renderStats();
        },

        renderStats() {
            const s = Pipeline.stats;
            const ed = this.els.stats.dataset.edge || '-';
            const txt = '截图 ' + s.shots + ' · API ' + s.apiCalls
                + ' · 跳过 ' + s.skipped + ' · 错误 ' + s.errors + ' · 边缘 ' + ed;
            // ⚡ 优化：统计内容只在计数变化时才变，而 setStatus 每帧都会调到这里，
            //    内容一样就不写 textContent（省掉一次 DOM 写入与随之而来的重排）
            if (txt === this._statsText) return;
            this._statsText = txt;
            this.els.stats.textContent = txt;
        },

        setStatus(msg, kind) {
            const el = this.els.status;
            if (!el) return;
            // ⚡ 优化：状态栏每帧都被 Pipeline 设置（运行中…→识别中…→已翻译…），
            //    同一状态反复设置时跳过 textContent / style.color 写入；指纹 = kind + 文案（文案同、颜色变仍更新）。
            const key = (kind || 'idle') + '\u0000' + msg;
            if (key !== this._statusKey) {
                this._statusKey = key;
                el.textContent = msg;
                el.style.color = STATUS_COLORS[kind] || STATUS_COLORS.idle;
            }
            const dot = this.els.dot;
            if (dot) {
                const bg = Pipeline.running ? '#4ade80' : '#666';
                // ⚡ 优化：记一份上次写进去的值再比较。不能直接比较
                //    dot.style.background：CSSOM 会把 #4ade80 规范化成 "rgb(74, 222, 128)"，永不相等
                if (this._dotBg !== bg) {
                    this._dotBg = bg;
                    dot.style.background = bg;
                }
            }
            this.renderStats();
        },

        setRunning(on) {
            const b = this.els.run;
            if (!b) return;
            b.textContent = on ? '停止' : '开始';
            b.classList.toggle('on', on);
            if (this.els.dot) {
                const bg = on ? '#4ade80' : '#666';
                this._dotBg = bg;   // ⚡ 优化：同步指纹，免得 setStatus 又白写一次
                this.els.dot.style.background = bg;
            }
        },

        pushHistory(o, t) {
            const el = this.els.hist;
            if (!el) return;
            const div = document.createElement('div');
            div.style.cssText = 'padding:4px 0;border-bottom:1px solid #23272f';
            // 注意：原来是把译文那段拼到 setHTML 的返回值上（返回值被丢弃），历史记录里一直只有原文
            setHTML(div,
                '<div style="color:#6b7280">' + escapeHtml(o) + '</div>'
                + '<div style="color:#e6e8ee">' + escapeHtml(t) + '</div>');
            el.insertBefore(div, el.firstChild);
            while (el.childElementCount > HIST_MAX) el.removeChild(el.lastChild);
        },

        async testApi() {
            this.setStatus('正在测试…', 'busy');
            try {
                if (CFG.engine === 'youdao-img') {
                    // 临时生成一张带文字的小图，用来验证「签名 + 接口 + 识别」全链路
                    const c = document.createElement('canvas');
                    c.width = 360; c.height = 90;
                    const x = c.getContext('2d');
                    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 360, 90);
                    x.fillStyle = '#000000';
                    x.font = 'bold 44px sans-serif';
                    x.fillText('Hello', 20, 62);
                    const r = await callYoudaoImage(c.toDataURL('image/jpeg', 0.9));
                    if (r.translation) {
                        this.setStatus('有道接口正常，识别译文：' + r.translation.slice(0, 30), 'ok');
                    } else {
                        this.setStatus('有道接口通了（签名正确），但测试图没识别出文字', 'warn');
                    }
                    return;
                }
                const r = await callChat({
                    model: CFG.model,
                    max_tokens: 20,
                    messages: [{ role: 'user', content: '回复两个字：正常' }],
                });
                this.setStatus('API 正常，模型返回：' + r.slice(0, 40), 'ok');
            } catch (e) {
                this.setStatus('API 测试失败：' + e.message, 'err');
            }
        },

        async manualShot() {
            if (!CFG.region) { this.setStatus('请先框选区域', 'warn'); return; }
            this.setStatus('正在截取一帧…', 'busy');
            try {
                const c = Capturer.grab(CFG.region);
                if (!c) { this.setStatus('截图失败（找不到视频？）', 'err'); return; }
                this.setPreview(c);
                this.setStatus('正在识别…', 'busy');
                const t0 = performance.now();
                const res = await recognizeAndTranslate(c);
                const dt = Math.round(performance.now() - t0);
                if (!res.original && !res.translation) {
                    this.setStatus('这一帧没有识别到字幕（' + dt + 'ms）', 'warn');
                    return;
                }
                Overlay.show(res.original, res.translation);
                this.pushHistory(res.original, res.translation);
                this.setStatus('成功（' + dt + 'ms）', 'ok');
            } catch (e) {
                if (e.code === 'TAINTED') {
                    this.setStatus('视频跨域，画布被污染 —— 请把「截图方式」改成「标签页捕获」并点「申请共享授权」', 'warn');
                } else if (e.code === 'NO_DISPLAY') {
                    this.setStatus('还没授权标签页共享 —— 请点「申请共享授权」', 'warn');
                } else {
                    this.setStatus('失败：' + e.message, 'err');
                }
            }
        },
    };

    // ═══════════════════════════════════════════════════════════════
    //  98-boot.js — 启动装配
    //
    //  isConfigured() 决定首次运行要不要把使用说明摊开；
    //  boot() 判断本站是否被禁用、当前在不在 iframe 里，再决定挂面板还是收成小胶囊；
    //  mountUI() 真正装配面板、暴露 window.__H1SUB__ 测试钩子、注册油猴菜单，
    //  并挂上"视频后加载"与"SPA 换页"两个监听。
    //
    //  对外提供：isConfigured、boot、mountUI
    //  依赖：CFG、saveCfgKeys、log、warn、isHostDisabled、syncRegionForHost、
    //              Fullscreen、isTopFrame、findVideo、watchForVideo、UI、
    //              RegionSelector、Pipeline、Overlay、SCRIPT_VERSION、Capturer、Diag、
    //              banCurrentHost、baiSupport、invalidateFindVideoCache
    // ═══════════════════════════════════════════════════════════════
    function isConfigured() {
        // 浏览器内置 AI 不要 Key，但得有这个能力；没有就别装作配好了
        if (CFG.engine === 'browser-ai') {
            const s = baiSupport();
            return !!(s.translator || s.lm);
        }
        // 免费网页接口同样不要 Key（识别靠本机 Umi-OCR，装没装是另一回事）
        if (CFG.engine === 'web-translate') return true;
        if (CFG.engine === 'youdao-img') return !!(CFG.youdaoAppKey && CFG.youdaoAppSecret);
        return !!CFG.apiKey;
    }

    function boot() {
        // ① 本站被用户禁用 → 什么都不做
        if (isHostDisabled()) {
            log('本站（' + location.hostname + '）已在禁用列表中，脚本不介入');
            return;
        }

        // ② 换了网站，先恢复本站的框选区域（页面坐标跨站没有意义）
        syncRegionForHost();

        // ③ 全屏时浏览器只渲染全屏元素及其子树，得把 UI 搬进去 —— 见 Fullscreen
        Fullscreen.init();

        const top = isTopFrame();

        // ③ iframe：只有真的出现「像样的视频」才挂面板（否则每个广告 / 统计 iframe 都会长出一个）；顶层窗口没视频时先收成小胶囊。
        if (!top && !findVideo()) {
            watchForVideo(() => {
                log('在嵌入的播放器里找到视频');
                mountUI();
                UI.setStatus('✅ 在页面内嵌播放器里找到了视频，可以开始', 'ok');
            });
            return;
        }

        mountUI();
        if (top && !findVideo()) UI.enterPillMode();
    }

    function mountUI() {
        if (UI.root) return;          // 已经挂过了
        UI.mount();
        log('面板已加载。配置 API 后点「① 框选字幕区」，再点「开始」。');

        if (!isConfigured()) {
            if (UI.collapsed) {
                UI.collapsed = false;
                UI.els.body.style.display = 'block';
                UI.els.collapse.textContent = '—';
            }
            const help = UI.root.querySelector('#h1sub-help');
            if (help) help.open = true;
            UI.setStatus(CFG.onboarded
                ? '⚠️ 还没配置密钥 —— 选「快捷预设」→ 填 API Key → 点「测试 API」'
                : '👋 第一次用：展开上面的「❓ 使用说明」，3 步就能跑起来', 'warn');
            CFG.onboarded = true;
            saveCfgKeys(CFG, ['onboarded']);
        }

        // ── 调试 / 测试钩子：暴露内部对象供自动化测试与诊断报告只读使用，不影响正常运行 ──
        try {
            window.__H1SUB__ = {
                version: SCRIPT_VERSION,
                CFG, Pipeline, Capturer, Overlay, UI, RegionSelector, Diag, DEFAULTS,
                recognizeAndTranslate, callYoudaoImage, translateByVision, translateText,
                callChat, callChatCore, apiUrl, buildChatBody, shouldDisableThinking, extractContent,
                isNoVisionModel, isStaleDeepSeekModel, NO_VISION_MODELS, DS_VISION_MODELS,
                callUmiOCR, umiProbe, recognizeByUmi, UMI_LANGS, umiBase,
                BAI_OCR_MODES, BAI_TRANS_MODES, BAI_AVAIL_TEXT, BAI_MIN_VERSION,
                baiBrowser, baiVersionNote,
                baiSupport, baiApi, baiPair, langCode, baiFrameNote, baiAvailability,
                baiAvailText, baiProbe, baiPrepare, baiReset, baiJoinChunk,
                baiTranslate, baiOcrByBuiltin, recognizeByBrowserAI,
                baiBrokenPairs, baiPairKey, baiMayPivot, baiIsPairFailure,
                baiCollapseRepeat, baiPolish,
                WT_ENGINES, WT_DEFAULT_ORDER, WT_ENGINE_CHOICES, wtStats, wtOrder,
                wtLangPair, wtTranslate, wtSelftest, wtReset, recognizeByWebTranslate,
                renderProfiles: (n) => UI.renderProfiles(n),
                syncProfileSelection: () => UI.syncProfileSelection(),
                upsertProfile: (n) => UI.upsertProfile(n),
                applyProfile: (n) => UI.applyProfile(n),
                deleteProfile: (n) => UI.deleteProfile(n),
                saveProfile: () => UI.saveProfile(),
                testUmi: () => UI.testUmi(),
                sha256Hex, sha256HexJS, youdaoTruncate, uuidHex,
                TT_POLICY, setHTML, escapeHtml, hexToRgb, openModal,
                cacheGet, cachePut, panelHTML, panelCSS,
                textSimilarity, thumbnail, thumbDiff, edgeDensity, parseModelJson,
                findVideo, getContentBox, resolveRegion, anchorRegion,
                sanitizeCfg, ENGINES, Fullscreen, uiHost, isHostDisabled, isTopFrame, watchForVideo,
                isConfigured, invalidateFindVideoCache,
                rememberRegion, syncRegionForHost,
                saveCfg: () => saveCfg(CFG),
                report: () => Diag.build(),
            };
            log('已暴露 window.__H1SUB__（供测试/诊断）');
        } catch (e) {
            warn('暴露调试钩子失败', e);
        }

        GM_registerMenuCommand('显示/隐藏 字幕翻译面板', () => {
            if (UI.pillMode) { UI.leavePillMode(); return; }
            if (!UI.root) { mountUI(); UI.leavePillMode(); return; }
            UI.root.style.display = UI.root.style.display === 'none' ? 'block' : 'none';
        });
        GM_registerMenuCommand('框选字幕区域', () => RegionSelector.begin());
        GM_registerMenuCommand('开始/停止', () => Pipeline.toggle());
        GM_registerMenuCommand('在本站禁用（不再显示面板）', () => banCurrentHost());

        // 视频可能是后加载 / SPA 切页后才出现
        watchForVideo(() => {
            log('已找到视频元素');
            UI.setStatus('✅ 已找到视频，可以开始', 'ok');
            // 之前因为没有视频而收成了小胶囊 → 现在自动展开
            if (UI.pillMode) UI.leavePillMode();
        });

        // SPA 路由切换后重新看本站的区域要不要换。只比较 pathname + search：站点在播放过程中会改
        // hash（章节/时间戳跳转）和查询串（埋点、无限滚动），拿 href 比较会让字幕莫名其妙自己停掉。
        let lastHref = location.pathname + location.search;
        // 用 UI._hrefTimer 而不是 this._hrefTimer：mountUI 是普通函数，this 是 undefined，会抛掉整个挂载流程
        UI._hrefTimer = setInterval(() => {
            const now = location.pathname + location.search;
            if (now === lastHref) return;
            lastHref = now;
            log('页面地址变化，重新检查');
            Pipeline.stop();
            Pipeline.lastThumb = null;
            Pipeline.lastOriginal = '';
            Overlay.clear();
            invalidateFindVideoCache();   // ⚡ 优化：跳页了，findVideo 的缓存立刻作废
            UI.syncRegion();
        }, 1500);
    }

    if (document.body) boot();
    else window.addEventListener('DOMContentLoaded', boot);
})();
