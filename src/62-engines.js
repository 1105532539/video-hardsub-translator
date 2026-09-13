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
