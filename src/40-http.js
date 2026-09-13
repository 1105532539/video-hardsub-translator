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
