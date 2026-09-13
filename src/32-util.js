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
