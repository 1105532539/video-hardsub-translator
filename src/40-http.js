    // ═══════════════════════════════════════════════════════════════
    //  40-http.js — HTTP：用 GM_xmlhttpRequest 绕过 CORS，并且**可以被取消**
    //
    //  发请求之外，这里还管「止损」：主循环每发起一轮识别就开一个**取消作用域**，
    //  这期间创建的请求都登记在里面；用户点停止 / 换区域 / 切到后台时把这些请求真正
    //  abort 掉。以前只靠 gen 计数器丢弃迟到的结果 —— 结果是不画到屏幕上了，但请求
    //  还在服务端跑完，那段 token（默认上限 1024）照样计费。
    //
    //  对外提供：gmRequest、beginAbortScope、endAbortScope、abortActiveScope、
    //              isAbortError、abortError
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    /** 主动取消请求时抛出的错误。带 aborted 标记，主循环据此「不当成失败」。 */
    function abortError() {
        const e = new Error('请求已取消（结果已经不需要了，停止计费）');
        e.aborted = true;
        return e;
    }

    /** 这个错误是不是「我们自己取消的」（而不是网络/配置问题） */
    function isAbortError(e) { return !!(e && e.aborted); }

    /**
     * 当前生效的取消作用域。用「一进一出」的方式标记这段时间内创建的请求：
     * 主循环在调引擎之前 beginAbortScope()，调用结束后 endAbortScope()。
     * 这是有意为之的简化 —— 不做参数穿透（那要改 5 个引擎和它们各自的调用链，漏一处
     * 就少一条取消路径）。代价是：**同一瞬间**由别的入口（手动截一帧、诊断、测试连接）
     * 创建的请求也会被登记进来；这些入口都是一次性的人工操作，最坏结果是它跟着报一句
     * 「请求已取消」，不会静默算错，也不会误改配置。
     */
    let ACTIVE_SCOPE = null;

    /** 开一个取消作用域；句柄交给 endAbortScope() / abortActiveScope() */
    function beginAbortScope() {
        const scope = { aborted: false, reqs: new Set(), prev: ACTIVE_SCOPE };
        ACTIVE_SCOPE = scope;
        return scope;
    }

    /** 正常走完，关掉作用域（嵌套调用时只关自己那一层，外层原样恢复） */
    function endAbortScope(scope) {
        if (scope && scope.reqs) scope.reqs.clear();
        if (ACTIVE_SCOPE === scope) ACTIVE_SCOPE = scope.prev || null;
    }

    /** 取消当前作用域里所有在飞请求（停止 / 换区域 / 切后台 / 换页时调） */
    function abortActiveScope() {
        const s = ACTIVE_SCOPE;
        if (!s) return;
        // ⚠️ 先把作用域摘掉，再取消：被取消的那一轮还要走一段收尾（异常向上传播、
        //    finally 释放），这期间别的入口（测试连接 / 手动截一帧 / 诊断）如果发出请求，
        //    会因为「作用域已取消」而连发都不发就报失败 —— 那不是它们该承受的。
        ACTIVE_SCOPE = s.prev || null;
        if (s.aborted) return;
        s.aborted = true;
        // 先复制再遍历：rec.abort() 会同步走 finish() → 从集合里删元素，
        // 直接遍历 Set 会漏掉后面的项。
        for (const rec of Array.from(s.reqs)) rec.abort();
        s.reqs.clear();
    }

    /**
     * 发一个 GM 请求；当前有取消作用域时会被登记进去，作用域取消时一并中断。
     *
     * abort() 里主动把 Promise 结算掉：GM_xmlhttpRequest 的返回值**并非**所有管理器
     * 都会回调 onabort（Tampermonkey 会，其它实现不一），只依赖 onabort 的话
     * Promise 有可能永远悬着，主循环就一直卡在 busy 上。
     */
    function gmRequest(opts) {
        const scope = ACTIVE_SCOPE;
        // 作用域已经取消了：连请求都不用发出去
        if (scope && scope.aborted) return Promise.reject(abortError());

        return new Promise((resolve, reject) => {
            let settled = false;
            let handle = null;

            const finish = (fail, value) => {
                if (settled) return;
                settled = true;
                if (scope) scope.reqs.delete(rec);
                if (fail) reject(value); else resolve(value);
            };

            const rec = {
                abort() {
                    try { handle && handle.abort && handle.abort(); } catch (e) { /* 已经结束了 */ }
                    finish(true, abortError());
                },
            };

            try {
                handle = GM_xmlhttpRequest({
                    method: opts.method || 'POST',
                    url: opts.url,
                    headers: opts.headers || {},
                    data: opts.data,
                    timeout: opts.timeout || 45000,
                    responseType: 'text',
                    onload: (r) => finish(false, r),
                    onerror: () => finish(true, new Error('网络请求失败（检查地址/代理）')),
                    ontimeout: () => finish(true, new Error('请求超时')),
                    onabort: () => finish(true, abortError()),
                });
            } catch (e) {
                // 管理器同步抛错（地址非法等）：当场结算，不要留下悬着的 Promise
                finish(true, e instanceof Error ? e : new Error(String(e)));
                return;
            }
            if (scope) scope.reqs.add(rec);
        });
    }
