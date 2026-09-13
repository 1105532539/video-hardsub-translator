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
