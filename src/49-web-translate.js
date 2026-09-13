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
