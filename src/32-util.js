    // ═══════════════════════════════════════════════════════════════
    //  32-util.js — 通用小工具
    //
    //  对外提供：parseModelJson、sleep、canvasToJpeg、stripDataUrlPrefix、
    //              stripWrappingQuotes、classifyError、LANG_ALIASES、langCode
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

    /**
     * 把一次失败归类，供主循环决定「退避重试」还是「停下来让用户改配置」。
     *
     * 优先用异常上带的 `httpStatus`（60-chat.js 的 callChatCore 会挂上去），
     * 拿不到再退回文案匹配 —— Umi-OCR / 有道 / 免费网页接口那几条路径没带状态码。
     *
     * @returns {'config'|'quota'|'ratelimit'|'network'|'other'}
     *   config    = 配置错了，重试永远不会好（Key / 地址 / 模型名 / 未授权）
     *   quota     = 余额或额度问题（402），重试也没用但要给用户时间充值
     *   ratelimit = 429 / 频率限制，退避后通常能恢复
     *   network   = 超时 / 断网 / 5xx，多半是暂时的
     */
    function classifyError(e) {
        const status = Number(e && e.httpStatus);
        if (Number.isFinite(status) && status > 0) {
            if (status === 429 || status === 1411) return 'ratelimit';
            if (status === 402) return 'quota';
            if (status === 401 || status === 403 || status === 404) return 'config';
            if (status >= 500) return 'network';
            if (status >= 400) return 'other';
        }

        const m = String((e && e.message) || e || '');
        if (/请求超时|超时|timeout|网络请求失败|NetworkError|Failed to fetch/i.test(m)) return 'network';
        if (/额度|余额|欠费|402/.test(m)) return 'quota';
        if (/太频繁|频率受限|429|1411/.test(m)) return 'ratelimit';
        if (/API Key|appKey|appSecret|未填|地址|模型名|401|403|404|110|108|202|205/i.test(m)) return 'config';
        if (/HTTP 5\d\d/.test(m)) return 'network';
        return 'other';
    }

    /**
     * canvas → JPEG data URL。
     *
     * 质量参数按**去哪**而定，不是随手写的（实测：1400×116 的字幕条在这个区间里，
     * 0.9 的产物约 85 KB，0.85 省 15%，0.95 多 27%，1.0 直接翻到 3 倍）：
     *   - 0.85  openai-vision —— **唯一真正上传到付费云端的**那条路，取最省的一档
     *   - 0.90  youdao-img —— 按量计费，同样要省
     *   - 0.92  umi-ocr / web-translate / browser-ai（配 Umi-OCR 时）——
     *           只发给 `127.0.0.1` 的本机服务，不出设备、不按字节计费，所以给高一点换识别率
     * 端侧读图那条路不走这里（它用 `toBlob`，压根不经过网络）。
     */
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
