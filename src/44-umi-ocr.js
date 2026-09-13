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
