// ==UserScript==
// @name         网页视频硬字幕实时翻译（OCR + 第三方大模型 API）
// @namespace    https://github.com/1105532539/video-hardsub-translator
// @version      1.11.1
// @description  任意网站通用：框选视频硬字幕区域，定时截图 → OCR → 调用第三方大模型 API 翻译成中文 → 悬浮字幕显示
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
 *  3. 图片交给 AI（三种引擎，见下）得到中文译文
 *  4. 译文以悬浮字幕的形式盖在视频上
 *
 *  三种识别引擎（面板里可选）：
 *    openai-vision（默认）：把截图直接发给「视觉大模型」，一步完成
 *                        OCR + 翻译。对动画风格的描边/艺术字识别率高，
 *                        只需一次 API 调用。需要支持图片输入的模型。
 *    umi-ocr（识别率最高）：把截图发给本机运行的 Umi-OCR（离线、免费），
 *                        拿到纯文本后再交给大模型翻译。
 *                        识别引擎是 PaddleOCR，比浏览器内置方案强得多，
 *                        而且浏览器这边一个字节都不用下载。
 *    youdao-img：有道图片翻译 API，同样是 OCR + 翻译一步到位，
 *                        按量计费（不是免费额度）。
 *
 *  三种引擎都**不需要浏览器下载任何模型**。
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

(function () {
    'use strict';

    // 同一个文档里只初始化一次
    if (window.__H1SUB_LOADED__) return;
    window.__H1SUB_LOADED__ = true;

    // ═══════════════════════════════════════════════════════════════
    // 一、配置
    // ═══════════════════════════════════════════════════════════════

    const NS = 'h1sub.';

    const DEFAULTS = {
        // ---- 识别 / 翻译引擎 ----
        //   openai-vision : OpenAI 兼容视觉大模型，一步完成 OCR + 翻译
        //   umi-ocr       : 本机 Umi-OCR 做识别（PaddleOCR），再交给大模型翻译
        //   youdao-img    : 有道智云图片翻译 API，一步完成 OCR + 翻译
        engine: 'openai-vision',

        // ---- OpenAI 兼容接口 ----
        apiBase: 'https://api.deepseek.com',    // 结尾不要带 /
        apiKey: '',
        model: 'deepseek-flash',                // openai-vision 必须用支持图片的模型

        // 思考模式（思维链）。对字幕 OCR 这种任务，思维链只会拖慢速度、
        // 吃掉输出预算，还可能让 content 返回空，所以默认关掉。
        //   auto : 检测到 DeepSeek 接口就自动关闭，其它平台不动（推荐）
        //   off  : 总是发送关闭参数
        //   on   : 不发送该参数，跟随平台默认（DeepSeek 默认是开启的）
        thinkingMode: 'auto',

        // 单次回复的最大 token 数。开着思考模式时会被思维链吃掉，
        // 所以给得宽裕一些（这只是上限，用不到不会多花钱）。
        maxTokens: 1024,

        // 多套 API 配置档案：[{name, apiBase, apiKey, model, thinkingMode, maxTokens}]
        // 存下来就能在面板上一键切换不同的大模型供应商，不用每次重打 Key。
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

    /** 深拷贝默认值。对象/数组类默认值必须拷贝，
     *  否则 CFG 和 DEFAULTS 会指向同一个对象，运行时一改就把默认值污染了。 */
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

    /** 当前支持的三种引擎 */
    const ENGINES = ['openai-vision', 'umi-ocr', 'youdao-img'];

    // 数值型配置的合法区间，和面板上控件的 min/max 保持一致
    const NUM_RANGES = {
        fontSize: [12, 48],
        bgOpacity: [0, 1],
        offsetY: [-200, 200],
        interval: [300, 60000],
        textSimThreshold: [0, 0.8],
    };

    /**
     * 把一份配置修正到「能用」的状态。加载和导入都要过这一道。
     *
     * 主要挡两类问题：
     *  1. 老版本残留 —— 早年存在过 'local' / 'openai-text' 这类引擎名。
     *     直接赋给 <select> 会让它 selectedIndex = -1：下拉框显示空白，
     *     而运行时却悄悄按视觉引擎跑，用户看不出哪里不对。
     *  2. 导入的 JSON 完全没做类型校验，而 fontSize 恰好是唯一一个被直接
     *     拼进 innerHTML 的配置值 —— 粘一份构造过的配置就能注入 HTML。
     */
    function sanitizeCfg(cfg) {
        if (!cfg || typeof cfg !== 'object') return cfg;

        if (ENGINES.indexOf(cfg.engine) < 0) cfg.engine = DEFAULTS.engine;

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
            if (![g.x, g.y, g.w, g.h].every(v => Number.isFinite(Number(v)))
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

    /** 只写指定的几个键。全量写一次要动 30+ 个存储项，没必要 */
    function saveCfgKeys(cfg, keys) {
        for (const k of keys) {
            try { GM_setValue(NS + k, cfg[k]); } catch (e) { /* ignore */ }
        }
    }

    const CFG = loadCfg();

    // ── API 平台预设：面板里一键填入地址+模型，省得手打 ──
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

    // DeepSeek 侧能用于视觉引擎的模型名。
    // 两个 v4-flash 旧名已被官方标记为「仍接受，请求由最新 Flash 模型处理」，
    // 所以它们同样支持图片输入，不能当成纯文本模型。
    const DS_VISION_MODELS = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'];

    // 已知不支持图片输入的模型名 —— 手动输入时面板会提醒
    const NO_VISION_MODELS = [
        'deepseek-v4-pro',
        'deepseek-chat', 'deepseek-reasoner',        // 历史上的纯文本模型名
        'gpt-3.5-turbo', 'moonshot-v1-8k', 'qwen-max', 'glm-4-plus',
    ];

    // 名字里带这些字样的一律当"能看图"处理。
    // 不加这条的话，下面的前缀规则会把 'moonshot-v1-8k-vision-preview'
    // 这个视觉模型误判成纯文本（它确实以 'moonshot-v1-8k' 开头），
    // 结果就是用户选了列表里标着"视觉"的 Kimi 预设，引擎却被自动切走。
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
    // 二、日志
    // ═══════════════════════════════════════════════════════════════

    const LOG_PREFIX = '[字幕翻译]';
    function log(...a) { console.log(LOG_PREFIX, ...a); }
    function warn(...a) { console.warn(LOG_PREFIX, ...a); }

    // ═══════════════════════════════════════════════════════════════
    // 热路径常量（截图循环每 1.2s 走一遍，魔数集中在这里便于调参）
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
    // 三、工具函数
    // ═══════════════════════════════════════════════════════════════

    /** 找到页面上"最大"的那个 video 元素（主播放器）。
     *  每个截图周期都会调一次，直接遍历 NodeList，不产生 Array.from 的中间数组。 */
    function findVideo() {
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
        return best;
    }

    // ═══════════════════════════════════════════════════════════════
    //  全站运行相关的小工具
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
     * 等页面出现「像样的」视频元素。
     * 用 MutationObserver + 轮询双保险，因为视频常常是懒加载 / SPA 切页后才出现。
     * 返回一个取消函数。
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
        // DOM 变动可能一秒来几十批，而 findVideo() 要读 getBoundingClientRect，
        // 是一次强制同步重排。每批都查一遍，在任何持续变动的页面上都很浪费。
        // 合并成每帧最多一次；后台标签页里 rAF 不跑也没关系，
        // 下面还有 1 秒的轮询兜底。
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
     * 换了网站，之前框的区域就没意义了（页面坐标完全不同）。
     * 这里按网站分别恢复/清空。
     */
    function syncRegionForHost() {
        const host = location.hostname;
        if (CFG.region && CFG.regionHost === host) return;   // 已经是本站的，不动

        const saved = (CFG.regionsByHost || {})[host] || null;
        // 之前这里无条件 saveCfg(CFG)：在没有任何区域记录的站上，
        // 每打开一个页面都会把 30+ 个配置项整份重写一遍，纯属白写
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

    /**
     * 计算 <video> 元素里「真实画面」所占的矩形。
     * 因为 object-fit 会产生黑边，坐标映射必须基于真实画面而不是元素本身。
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
     * region.x/y 是框选那一刻的视口坐标，而视频是会动的：页面滚动、
     * 切全屏、换集、刷新后播放器位置不同……任何一种都会让区域和画面对不上。
     * 所以框选时一并记下当时视频内容框的位置，之后按比例重新锚定。
     *
     * 不锚定的话是**静默出错**：截到的是错误像素，OCR 认出一堆乱七八糟的字，
     * API 照样扣钱，用户完全看不出哪里不对。
     *
     * 老配置里没有 region.box，那就按绝对坐标用（和以前行为一致，不炸）。
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

    /**
     * 复用的离屏画布。
     * 这两个函数每轮（约 1.2 秒）各调一次，原来每次都在新建 canvas +
     * 2d context + ImageData —— 而 willReadFrequently 的提示对一次性画布
     * 毫无意义（它本来就是用来让"同一个" context 走 CPU 后端的）。
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
     *  注意：返回的数组会被 Pipeline.lastThumb 长期持有做对比，
     *  所以每次必须新建 —— 能复用的只有画布，数组不能复用。 */
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
     * 边缘密度：字幕是「高对比度、边缘锐利」的文字，
     * 用它来粗略判断这个区域里到底有没有文字，从而跳过大部分无效 API 调用。
     *
     * 只留两行灰度做滚动比较（水平边看同行左右、垂直边看上下行），
     * 结果和「先算完整灰度矩阵再扫一遍」逐位相同，但省掉每次调用
     * 一块 160×48 的 Float32Array（约 30KB）和一遍完整扫描。
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
            // 第一行没有上一行可对比，和旧实现一样从第二行起计数
            if (y > 0) {
                for (let i = 1; i < EDGE_W; i++) {
                    if (Math.abs(cur[i] - cur[i - 1]) > EDGE_GRAD
                        || Math.abs(cur[i] - prev[i]) > EDGE_GRAD) cnt++;
                }
            }
            const t = prev; prev = cur; cur = t;   // 滚动交换行缓冲
        }
        return cnt / (EDGE_W * EDGE_H);
    }

    /** 归一化编辑距离，用来判断两次 OCR 结果是不是"同一句话" */
    // DP 滚动行用模块级 scratch 缓冲：每次识别出新字幕都可能调一次，
    // 不再每回 new 两个普通数组（稀疏、装箱，还要 GC）。
    // Int32 足够：超长输入在下面会被 40000 上限挡掉。
    let SIM_BUF_A = new Int32Array(64);
    let SIM_BUF_B = new Int32Array(64);

    function textSimilarity(a, b) {
        a = (a || '').replace(/\s+/g, '');
        b = (b || '').replace(/\s+/g, '');
        // 最常见的输入就是同一句（整帧没变、或 OCR 结果一字不差），
        // 直接给 1，不必跑一遍 O(m×n) 的动态规划。
        // 两边都为空也走这条，结果同样是 1。
        if (a === b) return 1;
        if (!a || !b) return 0;
        // 列数取较短的那边：滚动行更短，缓存更友好。
        // 编辑距离与方向无关，1 - dist/max(m,n) 也对称，结果不受影响。
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

    // ═══════════════════════════════════════════════════════════════
    // 四、HTTP（用 GM_xmlhttpRequest 绕过 CORS）
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
    // 四之二、有道智云鉴权与图片翻译接口
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

    /**
     * 纯 JS SHA-256。
     * 有道签名必须是 sha256，而 crypto.subtle 只在 https 等「安全上下文」才存在，
     * 所以自带一份实现作为回退。（已用 Node 的 crypto 逐字节比对验证通过）
     */
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

    /** 优先用浏览器原生实现，不可用则回退纯 JS */
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

    /**
     * 有道的 input 截断规则：
     *   q 长度 <= 20  →  input = q
     *   q 长度 >  20  →  input = q 前10字符 + q长度 + q 后10字符
     */
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

    /**
     * 有道智云「图片翻译」接口：一次调用完成 OCR + 翻译。
     * 文档：https://ai.youdao.com/DOCSIRMA/html/trans/api/tpfy/index.html
     */
    // ═══════════════════════════════════════════════════════════════
    // Umi-OCR：调用本机运行的 Umi-OCR 的 HTTP 接口
    // ═══════════════════════════════════════════════════════════════
    //
    //  为什么专门支持它：浏览器内置 OCR 需要下载 WASM 内核和十几 MB 语言包，
    //  国内经常连 CDN 都连不上（实测 jsdelivr 通了但页面 CSP 仍会拦掉脚本注入）。
    //  Umi-OCR 把这件事整个搬到浏览器外面 —— 它自带 PaddleOCR 引擎，离线运行，
    //  识别率比浏览器内置方案高一个档次，而且浏览器这边一个字节都不用下。
    //
    //  前提：本机装好并运行 Umi-OCR，且在「全局设置 → 高级」里允许 HTTP 服务。

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

    /**
     * 调 Umi-OCR 识别一张图，返回识别出的文字。
     * 注意接口要求 base64 不带 data:...;base64, 前缀。
     */
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

    async function callYoudaoImage(dataUrl) {
        if (!CFG.youdaoAppKey || !CFG.youdaoAppSecret) {
            throw new Error('请先填写有道 appKey 和 appSecret');
        }

        // ⚠️ 有道明确要求：base64 不能包含 data:image/...;base64, 这一截图片头
        const b64 = stripDataUrlPrefix(dataUrl);

        const salt = uuidHex();
        const curtime = String(Math.round(Date.now() / 1000));
        const input = youdaoTruncate(b64);
        // sign = sha256(应用ID + input + salt + curtime + 应用密钥)
        // 注意：计算签名时 q 不能做 URL encode，编码只发生在发送前
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

        // 记录到诊断报告，方便定位问题
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

        // resRegions 是数组，每个元素含 context(原文) / tranContent(译文) / boundingBox
        const original = regions.map(x => (x.context || '').trim()).filter(Boolean).join('\n').trim();
        const translation = regions.map(x => (x.tranContent || '').trim()).filter(Boolean).join('\n').trim();
        return { original, translation };
    }

    // ═══════════════════════════════════════════════════════════════
    // 五、截图器
    // ═══════════════════════════════════════════════════════════════

    const Capturer = {
        mode: 'element',        // 当前实际使用的模式
        displayStream: null,
        displayVideo: null,
        // 截图输出画布（crop 的产物）复用同一个：原来每截一帧就新建
        // canvas + 2d context + 整块像素后备存储（1400×116 约 650KB），
        // 而所有调用方都是「拿到立刻用掉」（编码 / 画预览 / 读像素），
        // 没人跨周期持有，所以反复用同一个是安全的。
        _out: null,
        _outCtx: null,

        /**
         * 从 <video> 元素直接截图。
         * 返回 canvas；若画布被跨域污染，抛 'TAINTED'。
         */
        grabFromElement(region, video) {
            video = video || findVideo();
            if (!video || !video.videoWidth) return null;

            const box = getContentBox(video);
            // 区域是按"框选时视频所在位置"存的比例，视频挪了要跟着挪。
            // box 刚算出来，顺手传进去，别让它再读一遍布局
            region = resolveRegion(region, video, box);

            // 区域和视频画面基本不重叠了（滚动太多 / 换了播放器布局 /
            // 老配置没带锚点）→ 下面的 Math.max(0, …) 会把坐标硬夹到边上，
            // 于是截出一块完全无关的画面：不报错、不返回 null，钱照扣。
            // 这里直接判掉，让调用方提示"请重新框选"。
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

            // 探测画布是否被污染
            try { c.getContext('2d').getImageData(0, 0, 1, 1); }
            catch (e) { const err = new Error('TAINTED'); err.code = 'TAINTED'; throw err; }

            return c;
        },

        /** 请求用户授权共享当前标签页，并开始捕获 */
        async startDisplayCapture() {
            if (this.displayStream) return;

            // http 页面不是「安全上下文」，navigator.mediaDevices 直接是 undefined。
            // 原来这里一律报"用户取消了授权"，用户会反复重试一个根本弹不出来的窗口。
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
                // 起播失败就把流关掉，否则会留下一个"有流但没画面"的僵死状态：
                // 之后每次申请都被开头的 if (this.displayStream) return 挡掉
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

        /** 停止标签页捕获，切回直接读视频元素 */
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
         * 把源画面的一块区域裁出来并适度放大。
         *
         * 「直接读 video」和「读标签页共享流」两种方式的裁切算法完全一样，
         * 只有源不同，所以收在这里一份。放大倍率是按经验定的：字幕只有
         * 几十像素高时 OCR 基本认不出来，适度放大会明显提升准确率；
         * 但放太大只是白烧 token，所以封顶 3 倍、宽 1400。
         *
         * 注意：返回的是复用画布 this._out，下一次 crop 会覆盖它 ——
         * 需要长期持有的调用方请先自行拷贝（目前没有这样的调用方）。
         *
         * @returns {HTMLCanvasElement|null} 区域太小（≤1px）时返回 null
         */
        crop(src, sx, sy, sw, sh) {
            if (sw <= 1 || sh <= 1) return null;

            let scale = Math.min(3, Math.max(1, 200 / sh));
            if (sw * scale > 1400) scale = 1400 / sw;
            const w = Math.max(2, Math.round(sw * scale));
            const h = Math.max(2, Math.round(sh * scale));

            // 改 canvas 尺寸会重置 context 的全部状态，
            // 所以只在尺寸变化时才重建并重新设置缩放参数
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

        /** 从标签页捕获流里截图 */
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

        /** 统一入口：遵循面板里的「截图方式」设置。
         *  video 由 step() 传进来 —— 它刚查过一次，没必要再查第二遍 */
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
    // 六、翻译引擎
    // ═══════════════════════════════════════════════════════════════

    const cache = new Map();          // 原文 -> 译文
    const CACHE_MAX = 500;

    /**
     * 取缓存。Map 的迭代顺序就是插入顺序，所以「命中后删掉再塞回去」
     * 等于把这条挪到队尾 —— 淘汰时丢的永远是最久没用过的那条。
     * 原来是纯先进先出：一句反复出现的台词，只要中间插进 500 条新字幕
     * 就会被挤掉，然后重新花钱翻一遍。
     */
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

    /**
     * 判断该不该给这个接口发「关闭思考模式」参数。
     * 不能无脑发 —— 不认识这个字段的平台（OpenAI、Gemini 等）可能直接报 400。
     */
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

    /**
     * 从返回的 message 里取出正文。
     * 兼容三种情况：
     *   1. content 是普通字符串（绝大多数）
     *   2. content 是内容块数组（部分平台）
     *   3. content 为空但有 reasoning_content（思考模式把预算吃光了）
     */
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
            // 把常见错误翻译成人话
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

    /**
     * vision 模式：截图直接丢给视觉大模型，一步出结果。
     */
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
                    // 注意：图片必须放在 user 消息里。
                    // DeepSeek 明确不接受 system / assistant 消息里的图片（会 400）。
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

    /**
     * 只做翻译（输入已经是文本），带缓存。
     * 本地 OCR / Umi-OCR 认出文字后只需要调这一步，不用再发图片。
     */
    async function translateText(original) {
        const text = String(original || '').trim();
        if (!text) return '';

        // 用 has 而不是真值判断：模型偶尔会返回空内容，
        // 空字符串是 falsy，用 `if (hit)` 的话这种缓存永远命中不了，
        // 同一句会被反复送到付费接口去重翻。
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
     * 统一入口：按当前引擎选择识别/翻译路径。
     * 返回值统一为 { original, translation }。
     */
    async function recognizeAndTranslate(canvas) {
        if (CFG.engine === 'youdao-img') {
            return await callYoudaoImage(canvasToJpeg(canvas, 0.9));
        }
        if (CFG.engine === 'umi-ocr') {
            return await recognizeByUmi(canvas);
        }
        // openai-vision（默认）
        return await translateByVision(canvasToJpeg(canvas, 0.85));
    }

    // ═══════════════════════════════════════════════════════════════
    // 七、主循环
    // ═══════════════════════════════════════════════════════════════

    const Pipeline = {
        running: false,
        busy: false,
        timer: null,
        // 每次 start / stop / 换区域都 +1。异步结果回来时对不上就说明
        // 这次识别已经作废了，直接丢掉。
        gen: 0,
        lastThumb: null,
        lastOriginal: '',
        lastTranslation: '',
        emptyStreak: 0,
        stats: { shots: 0, apiCalls: 0, skipped: 0, errors: 0 },

        /** 作废所有还在飞的结果（用户点了停止 / 重选了区域 / 页面跳走了） */
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
            // 停止就得把字幕收掉：不然最后一句会一直挂在画面上，
            // 用户以为还在翻译（视频换了集/暂停了尤其容易误会）。
            // 同时把「上一句」也清掉 —— 否则重新开始后，
            // 第一句如果和停之前那句一样，会被当成重复句直接吞掉。
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
                // 记进诊断报告，方便用户直接复制出来排查
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

        /**
         * 跑一轮：看看画面 → 该跳过就跳过 → 调引擎 → 显示译文。
         *
         * 这几件事原来全挤在同一个 160 行的方法里，想给任何一处守卫加句
         * 日志都得先通读全文。现在主流程只剩下面这几行，细节去各自的
         * 方法里看；哪个分支什么时候返回，从名字就能读出来。
         */
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

        /**
         * 前置检查：有没有视频、有没有框选、能不能截、上一轮回来没有。
         * @returns {boolean} true 表示可以继续跑这一轮
         */
        ensureReady(video) {
            if (!video || !CFG.region) {
                // 什么都不说会让人以为卡死了：状态栏一直停在"运行中…"
                this.missVideo = (this.missVideo || 0) + 1;
                if (!video) {
                    // 连续找不到就报出来，30 轮（默认间隔下约 36 秒）之后收手，
                    // 免得在没视频的页面上一直空转
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

        /**
         * 截一帧。画布被污染（视频跨域）时走 handleTainted 那条岔路，
         * 它会中断当前运行、引导用户改用标签页捕获。
         * @returns {HTMLCanvasElement|null} null 表示这一轮不用继续了
         */
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
                // 区域跑到视频画面外面去了（滚动过 / 播放器重新布局 / 换了集），
                // 这时 grab 会返回 null。不提示的话用户只会看到"运行中…"不动。
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

        /**
         * 画面没变、或者区域里根本没文字 → 这一轮不用花 API 钱。
         * @returns {boolean} true 表示跳过
         */
        shouldSkipFrame(canvas) {
            // ---- 变化检测 ----
            const thumb = thumbnail(canvas);
            const d = thumbDiff(thumb, this.lastThumb);
            const noChange = this.lastThumb && d < NO_CHANGE_DIFF;

            // 上一轮识别到文字、且画面几乎没变 → 直接跳过。
            // 预览也放在这后面：画面一模一样时重画一遍 drawImage 纯属白费。
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

        /**
         * 调识别 / 翻译引擎。
         * @returns {{original, translation, ms}|null} null 表示结果已作废
         */
        async recognize(canvas, myGen) {
            this.busy = true;
            UI.setStatus('识别中…', 'busy');
            const t0 = performance.now();
            let res;
            try {
                this.stats.apiCalls++;
                res = await recognizeAndTranslate(canvas);
            } finally {
                this.busy = false;
            }

            // 请求飞在路上时用户可能点了停止、重选了区域、或页面跳走了。
            // 这种情况下结果是给"上一轮"的，再画上去就是显示一句过期的字幕
            // （SPA 跳页时尤其明显：Overlay.clear() 之后旧字幕又冒出来）。
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

        /** 拿到结果之后的四种走向：没字幕 / 只有原文 / 与上句雷同 / 正常显示 */
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

            // ② 认出了原文但没拿到译文（模型返回空、接口抽风）：
            //    不能往下走 —— Overlay 里渲染的是 `translation || original`，
            //    直接放行会把没翻译的外文原文当译文显示，状态还报"已翻译"。
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
    // 八、字幕悬浮层
    // ═══════════════════════════════════════════════════════════════

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

        /** 把面板里的外观配置套到字幕元素上 */
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

            // <video> 自己全屏时，DOM 字幕层根本不会被渲染（它是替换元素，
            // 子节点不参与绘制），只能把译文同时塞进原生字幕轨。
            // 普通全屏不用管 —— 那时候 UI 已经被搬进全屏容器了。
            const vfs = Fullscreen.videoFullscreen();
            if (vfs) {
                Fullscreen.showOnTrack(vfs, CFG.showOriginal && original
                    ? original + '\n' + (translation || original)
                    : (translation || original));
            }
        },

        clear() {
            if (this.el) this.el.style.display = 'none';
            Fullscreen.hideTrack();
        },

        /**
         * 只重算位置，不重建 HTML。
         * 之前 reposition() 直接再调一次 show()：拖窗口边缘时每帧都要重建
         * 一遍 innerHTML 再读一次 offsetWidth（强制同步重排），而内容根本
         * 没变。拆开之后拖多久都只做两次写样式。
         */
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
    // 全屏适配
    //
    // 浏览器进全屏时**只渲染「全屏元素及其子树」**，挂在 body 上的面板和
    // 字幕层会被整个隐藏掉 —— 表现就是"一全屏字幕就没了"。
    // （实测：全屏后 overlay / panel 都不在全屏子树内。）
    //
    // 截图那一侧不用管：区域存的是相对视频内容框的比例，视频全屏变大后
    // resolveRegion 会自动重新锚定，实测截图仍然正确。
    //
    // 两种全屏要分开处理：
    //   ① 全屏元素是播放器容器（YouTube、B 站等绝大多数播放器都这样）
    //      → 把我们的元素搬进这个容器里就行，退出时搬回 body。
    //   ② 全屏元素就是 <video> 本身（站点用浏览器自带控件时的默认行为）
    //      → <video> 是替换元素，塞进去的子节点根本不参与渲染
    //        （实测：塞进去的 div，getBoundingClientRect 全是 0）。
    //        这时改用**原生字幕轨**：cue 由浏览器画在视频画面内部，
    //        而全屏渲染的正是视频画面本身，所以能显示。
    // ═══════════════════════════════════════════════════════════════

    /** 面板 / 字幕层当前应该挂在哪个元素下 */
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

        /** 当前全屏元素（兼容前缀写法） */
        current() {
            try {
                return document.fullscreenElement || document.webkitFullscreenElement || null;
            } catch (e) { return null; }
        },

        /** 全屏的如果是 <video> 本身，返回它；否则 null */
        videoFullscreen() {
            const fs = this.current();
            return (fs && (fs.tagName === 'VIDEO' || fs.tagName === 'AUDIO')) ? fs : null;
        },

        /** 把 UI 挂哪儿：能进全屏元素就进去，进不去就退回 body */
        uiHost() {
            const fs = this.current();
            // <video> 进不去（子节点不渲染，走了也没用）；
            // iframe 也进不去 —— 那是另一个文档，我们的元素塞不进它内部
            if (fs && fs.tagName !== 'VIDEO' && fs.tagName !== 'AUDIO'
                && fs.tagName !== 'IFRAME') {
                return fs;
            }
            return document.body;
        },

        /** 全屏状态变化：给现有的 UI 元素搬个家 */
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
         *
         * ⚠️ 退出全屏时**不能**靠 removeTextTrack 清理 ——
         * 实测本机 Chrome 里 `typeof video.removeTextTrack === 'undefined'`，
         * 这个 API 根本没实现。用 try/catch 包着调用只会静默失败，
         * 然后每进一次全屏就多挂一条轨（实测两次就变两条）。
         * 所以改成复用同一条轨：不用时 mode='disabled'，要用时再打开。
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

        /**
         * 用原生字幕轨显示译文 —— <video> 直接全屏时唯一可行的办法。
         * 全程复用同一条 cue：改文字和时间，而不是不断 addCue，
         * 否则播一小时会堆出几千条。
         */
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

    // 单次扫描替换。不用 4 个链式 replace —— 那样要扫 4 遍、产生 3 个
    // 中间字符串，而这个函数每次渲染字幕都会调用。
    const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
    }

    /**
     * Trusted Types 兼容层。
     *
     * YouTube、Gmail、Google 搜索等站点用 CSP 的 require-trusted-types-for 'script'
     * 禁掉了直接给 innerHTML 赋字符串 —— 直接写会抛 TypeError，
     * 结果就是面板建不出来、字幕也渲染不出来（整个脚本等于没装）。
     *
     * 自己注册一个策略就能正常写。策略名撞车（同一文档里跑了两遍脚本）
     * 或站点把策略名限死了，就退回普通赋值，不影响其他站点。
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
    // 九、区域框选器
    // ═══════════════════════════════════════════════════════════════

    const RegionSelector = {
        active: false,

        /**
         * 造框选用的三个覆盖层：全屏遮罩、选区框、顶部提示条。
         * 纯构造、不含任何交互逻辑，所以从 begin() 里单独拎出来。
         */
        createOverlay() {
            const mask = document.createElement('div');
            mask.style.cssText = [
                // z-index 必须**低于面板**（面板是 2147483500）。
                // 原来这里比面板高，结果整个面板连同预览区都被压在
                // 一层 35% 黑纱下面；拖拽时 box 的 9999px 阴影再叠一层，
                // 合计暗到约 58%，看起来就像"预览消失了"。
                // 现在只压暗页面本身（视频 + 字幕层），面板保持清晰可读。
                // 仍然高于字幕层（2147483000），所以字幕层跟着一起变暗。
                'position:fixed', 'inset:0', 'z-index:2147483400',
                'background:rgba(0,0,0,0.35)',
                // 不吃鼠标事件：万一 mouseup 丢在窗口外（拖出浏览器 / alt-tab），
                // dragging 清不掉、cleanup 也就不会跑，遮罩会把整页的点击都吞掉。
                // 拖拽监听是挂在 document 捕获阶段的，遮罩不需要接收事件。
                'pointer-events:none',
            ].join(';');

            const box = document.createElement('div');
            box.style.cssText = [
                'position:fixed', 'border:2px solid #22d3ee',
                'background:rgba(34,211,238,0.18)',
                // 阴影负责把选区以外的部分压暗。遮罩只压 0.35，这里再叠 0.35，
                // 不过 box 只在拖拽时显示，所以静止时页面不会太黑。
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

            // 框选期间把预览区露出来：第一次框选时 CFG.region 还是空的，
            // syncRegion() 会把整个预览藏掉，用户根本无从对照。
            // 退出框选时 cleanup() 会再调一次 syncRegion() 还原。
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
            // 拖拽时把"当前框住的这块"实时截出来喂给面板预览。
            // 不这么做的话，预览里显示的始终是**上一次**框的区域，
            // 框选过程中看了也判断不出这次框得对不对。
            // 用 rAF 合并：mousemove 一秒能来几十次，而每次截图要 ~0.7ms。
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
                        // 拖拽途中截不到很正常（框到视频外面、还没授权共享…），
                        // 静默跳过就行，绝不能打断框选
                    }
                });
            };

            /**
             * 按当前的 CFG.region 重截一张喂给预览。
             *
             * 注意只在**区域已经定下来之后**调用。cleanup() 是在 onUp 里
             * 「设置新区域之前」跑的，所以在 cleanup 里截会截到上一次的区域，
             * 框完反而显示旧画面。
             */
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
                // 换区域后，正在飞的那次识别是给旧区域的，作废掉
                Pipeline.invalidate();
                Pipeline.lastThumb = null;
                Pipeline.lastOriginal = '';

                // 框完立刻截一帧 —— 马上就能看到脚本到底截到了什么，
                // 不用等点了「开始」才发现框歪了。
                // 密钥配好了就顺带识别一次，把整条链路一起验证掉；
                // 没配的话只截不认，免得刚框完就弹个 401 出来吓人。
                // （视频暂停时也能截，正好适合"暂停着慢慢框"的用法。）
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
                // 这里的 capture 标志必须和下面 addEventListener 那一处完全一致，
                // 否则摘不掉：上一轮的 onBlur 会一直留着，拿着已经删掉的遮罩
                // 去 cleanup，反而把本轮的状态搅乱
                window.removeEventListener('blur', onBlur);
                document.documentElement.style.cursor = prevCursor;
                mask.remove(); box.remove(); tip.remove();

                // 只负责拆干净 + 还原预览区的显隐。
                // 这里**不要**去截预览：onUp 是先调 cleanup、再设置新区域的，
                // 在这儿截只会截到上一次的区域，框完反而显示旧画面。
                // 需要重截的调用方自己调 refreshPreview()。
                UI.syncRegion();
            };

            // 兜底：拖到窗口外面松手 / alt-tab 走掉，mouseup 就收不到了。
            //
            // ⚠️ 这里**绝对不能**加捕获阶段（第三个参数不能是 true）。
            // blur 自身不冒泡，但捕获阶段是从 window 一路往下走的，
            // 于是页面上**任何元素**失焦都会被这个监听抓到。
            // 真实场景：用户点完面板上的「框选字幕区」按钮（按钮处于聚焦态），
            // 再移到视频上按下左键 —— 浏览器把焦点从按钮移走，按钮上派发 blur，
            // 框选还没开始就被这里 cleanup 掉了，表现就是"框选功能用不了"。
            // 不加 capture，就只有"焦点真的离开窗口"时才会触发。
            //
            // 注意上面 removeEventListener 那一处的标志也要保持一致。
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
    // 十、诊断模式（区域对齐检查 + 报告导出）
    //      —— 既是给你自查用的取证工具，也是自动化测试的观察窗口
    // ═══════════════════════════════════════════════════════════════

    const SCRIPT_VERSION = '1.11.1';

    const Diag = {
        modal: null,
        records: [],        // 最近识别记录（新→旧）
        tainted: false,     // 是否触发过画布污染
        lastYoudao: null,   // 最近一次有道的返回摘要
        lastError: null,    // 最近一次报错（会进诊断报告）

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

            // 提示
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
    // 十一、控制面板 UI
    // ═══════════════════════════════════════════════════════════════

    /**
     * 面板的 HTML 骨架。
     *
     * 单独抽出来是因为它有两百多行，塞在 mount() 里会把装配逻辑彻底淹掉 ——
     * 想改一个标签得先翻过整块模板。这里只放结构，不放任何行为。
     * 里面所有 id 都是 mount() 缓存元素引用和测试断言依赖的，别改。
     */
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
            '      —— 译文仍由上面的 API 出。但它已经把字认好了，所以翻译只需要',
            '      <b style="color:#9aa3b8">文本模型</b>，比用视觉模型便宜得多。',
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

    /**
     * 面板的样式表。
     *
     * 注意后半段是给**弹窗**用的：诊断 / 导入导出那几个弹窗挂在 body 上，
     * 不在 #h1sub-panel 里，上面那套 `#h1sub-panel button` 选择器一点也
     * 作用不到它们。不单独配一套的话，这些按钮会退化成网站自己的 button
     * 重置样式（很多站点是"透明背景 + 继承文字色"），变成浅灰字贴深灰底，
     * 基本看不清。
     */
    function panelCSS() {
        return [
            '#h1sub-panel .h1sub-sec{margin:10px 0 5px;padding-top:7px;border-top:1px solid #262b34;color:#7dd3fc;font-weight:700}',
            '#h1sub-panel label{display:flex;flex-direction:column;gap:3px;margin-bottom:7px;color:#9aa3b8}',
            '#h1sub-panel input,#h1sub-panel select,#h1sub-panel textarea{',
            '  background:#0f1116;border:1px solid #2c313a;border-radius:5px;color:#e6e8ee;',
            '  padding:5px 7px;font:12px inherit;outline:none;width:100%;box-sizing:border-box}',
            '#h1sub-panel input:focus,#h1sub-panel select:focus,#h1sub-panel textarea:focus{border-color:#22d3ee}',
            '#h1sub-panel input[type=range]{padding:0}',
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

    /**
     * 统一的弹窗骨架。
     *
     * 诊断 / 导出 / 导入三个弹窗原来各自抄了一遍遮罩层、标题栏和关闭按钮的
     * HTML 与样式 —— 改一次配色要改三处，还漏过：弹窗按钮的样式一开始就
     * 忘了配，导致在有些站点上按钮变成浅灰字贴深灰底，基本看不清。
     *
     * 所有 id 都由调用方给出，一个都不能改 —— 测试断言和用户习惯都依赖它们。
     *
     * @param {object} o
     *   title      标题文字
     *   closeId    × 按钮的 id
     *   body       内容区 HTML
     *   buttons    [{id, label, style}] 标题栏右侧的按钮
     *   width      弹窗宽度，默认 min(680px,94vw)
     *   z          层级，默认 2147483641
     *   headStyle  标题栏追加样式（诊断模式用的是带下边框的那种）
     *   modalStyle .h1sub-modal 上的追加样式，默认 padding:14px
     *   bodyStyle  内容区容器的样式
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

            // 缓存元素引用
            const ids = ['head', 'host', 'dot', 'collapse', 'close', 'ban', 'body', 'region', 'run', 'region-info',
                'preview-wrap', 'preview', 'engine', 'openai',
                'preset', 'preset-note', 'apiBase', 'apiKey', 'model', 'model-hint',
                'profile', 'profile-save', 'profile-del',
                'youdao', 'youdaoAppKey', 'youdaoAppSecret', 'youdaoFrom', 'youdaoTo', 'youdaoLLM',
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

        /** 从小胶囊展开成完整面板 */
        leavePillMode() {
            this.pillMode = false;
            if (this.pillEl) this.pillEl.style.display = 'none';
            this.root.style.display = 'block';
            this.applyLayout();
        },

        /** 彻底从页面移除（本站禁用时用） */
        destroy() {
            Pipeline.stop();
            // 不主动停的话，getDisplayMedia 的共享会一直开着：
            // 浏览器顶部一直显示"正在共享此标签页"，隐藏的 video 还在解码，
            // 而脚本里那个「停止共享」按钮已经跟着面板一起没了。
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

        /**
         * 把所有控件接上行为。
         *
         * 这里原来是一个 290 多行的方法，改一个控件要先翻过整块代码。
         * 现在按面板上的分区拆成几个具名方法，这个方法只负责列清单 ——
         * 想知道「哪个按钮对应哪段逻辑」，看这里就够了。
         */
        bind() {
            this.bindPanelChrome();      // 标题栏 / 拖动 / 调宽 / 两个主按钮
            this.bindProfiles();         // 我的配置（多套 API 档案）
            this.bindUmi();              // Umi-OCR 测试连接
            this.bindConfigInputs();     // 所有配置项的双向绑定
            this.bindPresets();          // 平台预设下拉
            this.bindCaptureControls();  // 截图方式
            this.bindConfigIO();         // 导出 / 导入 / 恢复禁用
            this.bindTools();            // 诊断 / 测试 / 截图 / 恢复默认 / 清缓存
            this.bindViewport();         // 窗口尺寸变化
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

            // 本站禁用
            e.ban.onclick = () => banCurrentHost();

            // 拖动。两个 document 级监听存到实例上：destroy() 要把它们摘掉，
            // 否则每次 destroy → mount 都会多漏一对监听（旧的闭包还挂在 document 上）
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
                // 记住面板位置，下次打开还在老地方
                const r = this.root.getBoundingClientRect();
                CFG.panelPos = { left: Math.round(r.left), top: Math.round(r.top) };
                saveCfgKeys(CFG, ['panelPos']);
            };
            document.addEventListener('mousemove', this._onDragMove);
            document.addEventListener('mouseup', this._onDragUp);

            // 拖左边缘调宽度
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

            // 主按钮
            e.region.onclick = () => RegionSelector.begin();
            e.run.onclick = () => Pipeline.toggle();
        },

        /** 我的配置：下拉切换 + 保存 / 删除按钮 */
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

        /** Umi-OCR 的「测试连接」按钮 */
        bindUmi() {
            const e = this.els;
            if (e.umi_test) {
                e.umi_test.onclick = (ev) => { ev.preventDefault(); this.testUmi(); };
            }
        },

        /**
         * 所有配置项控件的双向绑定。
         *
         * 两个小工具：
         *   bindInput —— 普通输入框 / 下拉框 / 复选框，change 时写回 CFG
         *   bindRange —— 滑块，input 时先预览、change 时才落盘
         * 写回之后要联动刷新哪些 UI，统一收在 onChangeEffects 里，
         * 免得每加一个配置项就要在好几处补 if。
         */
        bindConfigInputs() {
            const e = this.els;
            const self = this;

            /** 某个配置项变了之后，界面 / 缓存要跟着做的调整 */
            const onChangeEffects = (key) => {
                if (key === 'engine') self.syncEngineUI();
                if (key === 'captureMode') self.syncCaptureUI();
                // auto 模式要看 API 地址判断，地址变了提示也得跟着变
                if (key === 'thinkingMode' || key === 'apiBase') self.syncThinkingUI();
                // 模型名 / 地址变了，检查一下模型支不支持图片
                if (key === 'model' || key === 'apiBase') self.syncModelHint();
                // 地址 / Key / 模型任一改动，都可能让"当前配置"对不上任何档案
                if (key === 'model' || key === 'apiBase' || key === 'apiKey') {
                    self.syncProfileSelection();
                }
                // 外观类：清掉悬浮层，按新样式重画
                if (['showOriginal', 'overlayTop', 'fontSize', 'bgOpacity',
                    'textColor', 'outline', 'offsetY'].includes(key)) {
                    Overlay.clear();
                    Overlay.last = null;
                    Pipeline.lastThumb = null;
                    Pipeline.lastOriginal = '';
                }
                // 换了语言 / 模型 / 提示词之后，缓存里的旧译文就不再对了
                // （最典型的是改了目标语言，同一句日文还一直出旧语种）
                if (['tgtLang', 'srcLang', 'model', 'apiBase', 'extraPrompt',
                    'engine'].includes(key)) {
                    cache.clear();
                    Pipeline.lastOriginal = '';
                    Pipeline.lastTranslation = '';
                }
            };

            const bindInput = (key, el, cast) => {
                if (!el) return;                 // 控件不存在就跳过，别让一个 null 拖垮整个绑定
                el.addEventListener('change', () => {
                    CFG[key] = cast ? cast(el.value) : el.value;
                    // 只写这一个键：全量 saveCfg 一次要动 30+ 个存储项，
                    // 而这里每次只改了一项
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

                // 选到不支持图片的模型时，自动切到 Umi-OCR（本机识别），
                // 免得配好了却一直报错
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

        /** 截图方式：申请 / 停止标签页共享 */
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

        /** 底部工具按钮：诊断 / 测试 API / 手动截图 / 恢复默认 / 清空缓存 */
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

        /**
         * 窗口尺寸变化时重新定位字幕。
         *
         * 拖窗口边缘时 resize 会连发几十次，而 reposition 要读 offsetWidth
         * 触发同步重排，所以用 rAF 合并成每帧最多一次。
         * 存到 this 上是为了 destroy() 时能摘掉。
         */
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

        /**
         * 切换截图方式并同步相关 UI。
         * 「申请共享授权」「停止共享」「画布被污染自动切换」三处的
         * 写配置 → 落盘 → 刷新控件 → 刷新提示 是同一段流程，收在这里。
         */
        applyCaptureMode(mode, statusMsg, statusKind) {
            CFG.captureMode = mode;
            saveCfgKeys(CFG, ['captureMode']);
            this.loadToUI();
            this.syncCaptureUI();
            if (statusMsg) this.setStatus(statusMsg, statusKind || 'ok');
        },

        /** 截图方式区域的状态提示 */
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
            // 是 DeepSeek 的模型名，但不是能看图的那几个
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

        /** 思考模式提示 */
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

        /** 显示「本站禁用」列表状态 */
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

        /** 导出配置为 JSON 文本 */
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

        /** 从 JSON 文本导入配置 */
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
            // 有道引擎不需要 OpenAI 的地址 / Key / 模型
            // Umi-OCR 只用它做识别，仍要靠 OpenAI 配置出译文
            this.els.openai.style.display = eng === 'youdao-img' ? 'none' : 'block';
            this.els.youdao.style.display = eng === 'youdao-img' ? 'block' : 'none';
            this.els.umionly.style.display = eng === 'umi-ocr' ? 'block' : 'none';
        },

        // ── 多套 API 配置档案 ──────────────────────────────────
        //
        //  存的是「地址 + Key + 模型 + 思考模式 + 最大 token」这一整套。
        //  切换供应商时不用再翻控制台找 Key。

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

        /**
         * 让下拉框反映「当前生效的配置」。
         * 手动改了地址 / Key / 模型之后就对不上任何档案了，这时回到占位项，
         * 表示"当前是未保存的改动" —— 比留着一个对不上的名字诚实。
         */
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

        /** 切换到一个已保存的配置 */
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
                // 第一次点击：进入待确认状态
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

        /** 弹个小窗问名字 */
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

        /** 保存按钮：问名字 → 存下来 */
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

        /** 填充语言下拉框 */
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

        /** 测试能不能连上本机的 Umi-OCR */
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
            // 面板收成小胶囊 / 内容折叠起来时，预览区根本看不见，
            // 这时每轮还把整块截图缩放画一遍就是纯浪费
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
            this.els.stats.textContent = '截图 ' + s.shots + ' · API ' + s.apiCalls
                + ' · 跳过 ' + s.skipped + ' · 错误 ' + s.errors + ' · 边缘 ' + ed;
        },

        setStatus(msg, kind) {
            const el = this.els.status;
            if (!el) return;
            el.textContent = msg;
            el.style.color = STATUS_COLORS[kind] || STATUS_COLORS.idle;
            const dot = this.els.dot;
            if (dot) {
                dot.style.background = Pipeline.running ? '#4ade80' : '#666';
            }
            this.renderStats();
        },

        setRunning(on) {
            const b = this.els.run;
            if (!b) return;
            b.textContent = on ? '停止' : '开始';
            b.classList.toggle('on', on);
            if (this.els.dot) this.els.dot.style.background = on ? '#4ade80' : '#666';
        },

        pushHistory(o, t) {
            const el = this.els.hist;
            if (!el) return;
            const div = document.createElement('div');
            div.style.cssText = 'padding:4px 0;border-bottom:1px solid #23272f';
            // 注意：原来的写法是把译文那段拼到 setHTML 的返回值上，
            // 结果被直接丢弃 —— 历史记录里一直只有原文、没有译文
            setHTML(div,
                '<div style="color:#6b7280">' + escapeHtml(o) + '</div>'
                + '<div style="color:#e6e8ee">' + escapeHtml(t) + '</div>');
            el.insertBefore(div, el.firstChild);
            while (el.childElementCount > 30) el.removeChild(el.lastChild);
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
    // 十二、启动
    // ═══════════════════════════════════════════════════════════════

    /** 当前引擎所需的密钥是否已填好 */
    function isConfigured() {
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

        // ③ iframe 里：只有真的出现「像样的视频」才挂面板。
        //    否则每个广告/统计 iframe 都会长出一个面板。
        //    顶层窗口：没视频时先收成右下角小胶囊，不挡页面。
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

    /** 真正把面板和菜单装到页面上 */
    function mountUI() {
        if (UI.root) return;          // 已经挂过了
        UI.mount();
        log('面板已加载。配置 API 后点「① 框选字幕区」，再点「开始」。');

        // 首次运行 / 还没配好密钥 → 直接把面板展开并给出指引
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

        // ── 调试 / 测试钩子 ──
        // 暴露内部对象，供自动化测试与诊断报告使用。只读用途，不影响正常运行。
        try {
            window.__H1SUB__ = {
                version: SCRIPT_VERSION,
                CFG, Pipeline, Capturer, Overlay, UI, RegionSelector, Diag, DEFAULTS,
                recognizeAndTranslate, callYoudaoImage, translateByVision, translateText,
                callChat, callChatCore, apiUrl, buildChatBody, shouldDisableThinking, extractContent,
                isNoVisionModel, isStaleDeepSeekModel, NO_VISION_MODELS, DS_VISION_MODELS,
                callUmiOCR, umiProbe, recognizeByUmi, UMI_LANGS, umiBase,
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

        // SPA 路由切换后，重新看看本站的区域要不要换。
        // 只比较 pathname + search：站点在播放过程中会改 hash（章节/时间戳跳转）
        // 和查询串（埋点、无限滚动），拿 href 比较会导致字幕莫名其妙自己停掉。
        let lastHref = location.pathname + location.search;
        // 注意用 UI._hrefTimer 而不是 this._hrefTimer —— mountUI 是普通函数，
        // 这里的 this 是 undefined，会直接把整个挂载流程抛掉
        UI._hrefTimer = setInterval(() => {
            const now = location.pathname + location.search;
            if (now === lastHref) return;
            lastHref = now;
            log('页面地址变化，重新检查');
            Pipeline.stop();
            Pipeline.lastThumb = null;
            Pipeline.lastOriginal = '';
            Overlay.clear();
            UI.syncRegion();
        }, 1500);
    }

    if (document.body) boot();
    else window.addEventListener('DOMContentLoaded', boot);

})();
