    // ═══════════════════════════════════════════════════════════════
    //  22-site.js — 站点级行为：禁用开关、视频出现监听、按站点记忆区域
    //
    //  「本站禁用」「视频后加载」「换站不串台」这三件事都是"按站点"的，
    //  所以收在同一个模块里。
    //
    //  对外提供：isHostDisabled、banCurrentHost、isTopFrame、watchForVideo、
    //              syncRegionForHost、rememberRegion
    //  依赖：CFG、saveCfgKeys、log、findVideo、UI
    // ═══════════════════════════════════════════════════════════════
    /** 当前网站是不是被用户禁用了 */
    function isHostDisabled() {
        const list = Array.isArray(CFG.disabledHosts) ? CFG.disabledHosts : [];
        return list.indexOf(location.hostname) >= 0;
    }

    /** 把当前站点加进禁用列表并移除 UI。面板标题栏的 🚫 和油猴菜单共用这一套 */
    function banCurrentHost() {
        const h = location.hostname;
        if (!confirm('不再在「' + h + '」上显示翻译面板？\n\n'
            + '（以后想恢复：在任意网站打开面板 → 高级 →「恢复「本站禁用」的网站」）')) return;
        const list = Array.isArray(CFG.disabledHosts) ? CFG.disabledHosts.slice() : [];
        if (list.indexOf(h) < 0) list.push(h);
        CFG.disabledHosts = list;
        saveCfgKeys(CFG, ['disabledHosts']);
        UI.destroy();
    }

    /** 当前是否处于顶层窗口（iframe 里要另做判断，避免面板重复挂） */
    function isTopFrame() {
        try { return window.top === window.self; } catch (e) { return true; }
    }

    /**
     * 等页面出现「像样的」视频元素。MutationObserver + 轮询双保险 —— 视频常常是
     * 懒加载 / SPA 切页后才出现。返回一个取消函数。
     */
    function watchForVideo(onFound, timeoutMs = 180000) {
        if (findVideo()) { onFound(); return () => { }; }
        let done = false;
        const stop = () => {
            if (done) return;
            done = true;
            try { obs.disconnect(); } catch (e) { }
            clearInterval(iv);
            clearTimeout(tm);
        };
        const hit = () => {
            if (done) return;
            if (findVideo()) { stop(); onFound(); }
        };
        // DOM 变动可能一秒来几十批，而 findVideo() 要读 getBoundingClientRect（强制
        // 同步重排）。合并成每帧最多一次；后台标签页里 rAF 不跑也没关系，下面还有
        // 1 秒的轮询兜底。
        let queued = false;
        const hitSoon = () => {
            if (done || queued) return;
            queued = true;
            const run = () => { queued = false; hit(); };
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
            else setTimeout(run, 0);
        };
        let obs;
        try {
            obs = new MutationObserver(hitSoon);
            obs.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) { obs = { disconnect() { } }; }
        const iv = setInterval(hit, 1000);
        const tm = setTimeout(stop, timeoutMs);
        return stop;
    }

    /**
     * 换了网站，之前框的区域就没意义了（页面坐标完全不同）。按网站分别恢复/清空。
     */
    function syncRegionForHost() {
        const host = location.hostname;
        if (CFG.region && CFG.regionHost === host) return;   // 已经是本站的，不动

        const saved = (CFG.regionsByHost || {})[host] || null;
        // 之前这里无条件 saveCfg(CFG)：在没有任何区域记录的站上，每打开一个页面
        // 都会把 30+ 个配置项整份重写一遍
        if (CFG.region === saved && CFG.regionHost === (saved ? host : null)) return;

        CFG.region = saved;
        CFG.regionHost = saved ? host : null;
        saveCfgKeys(CFG, ['region', 'regionHost']);
        if (saved) log('已恢复本站（' + host + '）上次框选的区域');
    }

    /** 记住本站的框选区域 */
    function rememberRegion(region) {
        const host = location.hostname;
        CFG.region = region;
        CFG.regionHost = host;
        if (!CFG.regionsByHost || typeof CFG.regionsByHost !== 'object') CFG.regionsByHost = {};
        CFG.regionsByHost[host] = region;
        // 别让它无限膨胀
        const keys = Object.keys(CFG.regionsByHost);
        if (keys.length > 60) delete CFG.regionsByHost[keys[0]];
        saveCfgKeys(CFG, ['region', 'regionHost', 'regionsByHost']);
    }
