    // ═══════════════════════════════════════════════════════════════
    //  20-video.js — 视频元素定位
    //
    //  对外提供：findVideo、invalidateFindVideoCache
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    // ⚡ 优化：给 findVideo 加 200ms TTL 缓存。它由 watchForVideo 的 rAF 和
    //    RegionSelector 拖拽预览按帧驱动（最高 60 次/秒），而 querySelectorAll +
    //    getBoundingClientRect 是一次强制同步重排；200ms 远短于截图间隔，不影响响应。
    let _fvCache = { el: null, expires: 0 };

    /** 找到页面上"最大"的那个 video 元素（主播放器） */
    function findVideo() {
        const now = performance.now();
        // ⚡ 优化：el.isConnected —— SPA 换页后旧元素会变成游离节点，必须重扫
        if (now < _fvCache.expires
            && (_fvCache.el === null || _fvCache.el.isConnected)) {
            return _fvCache.el;
        }
        const vids = document.querySelectorAll('video');
        let best = null, bestArea = 0;
        for (let i = 0; i < vids.length; i++) {
            const v = vids[i];
            const r = v.getBoundingClientRect();
            const area = r.width * r.height;
            // 过滤掉广告/预览用的超小视频
            if (area > bestArea && r.width > 200 && r.height > 120) {
                best = v; bestArea = area;
            }
        }
        _fvCache.el = best;
        _fvCache.expires = now + 200;
        return best;
    }

    /** 主动作废 findVideo 的缓存 */
    // ⚡ 优化：新增主动作废入口，供 SPA 路由切换时调用，让下一次 findVideo 必然重扫：
    //    换页后 200ms 内可能拿到上一页的元素，而"已经跳走了"只有调用方知道。
    function invalidateFindVideoCache() {
        _fvCache.expires = 0;
    }
