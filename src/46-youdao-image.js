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
