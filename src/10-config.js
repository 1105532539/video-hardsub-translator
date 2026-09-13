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
