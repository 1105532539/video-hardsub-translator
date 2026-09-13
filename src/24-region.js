    // ═══════════════════════════════════════════════════════════════
    //  24-region.js — 区域锚定与坐标换算
    //
    //  对外提供：getContentBox、resolveRegion、anchorRegion
    //  依赖：findVideo
    // ═══════════════════════════════════════════════════════════════
    /**
     * 计算 <video> 元素里「真实画面」所占的矩形。object-fit 会产生黑边，坐标映射
     * 必须基于真实画面而不是元素本身。
     */
    function getContentBox(video) {
        const r = video.getBoundingClientRect();
        const vw = video.videoWidth || 0;
        const vh = video.videoHeight || 0;
        if (!vw || !vh) {
            return { left: r.left, top: r.top, width: r.width, height: r.height };
        }
        let fit = 'contain';
        try { fit = getComputedStyle(video).objectFit || 'contain'; } catch (e) { }
        if (fit === 'fill' || fit === 'none') {
            return { left: r.left, top: r.top, width: r.width, height: r.height };
        }
        const s = fit === 'cover'
            ? Math.max(r.width / vw, r.height / vh)
            : Math.min(r.width / vw, r.height / vh);
        const w = vw * s, h = vh * s;
        return {
            left: r.left + (r.width - w) / 2,
            top: r.top + (r.height - h) / 2,
            width: w,
            height: h,
        };
    }

    /**
     * 把「框选时记下的区域」换算成当前的视口坐标。
     *
     * region.x/y 是框选那一刻的视口坐标，而视频是会动的（滚动、全屏、换集），所以框选
     * 时一并记下当时视频内容框的位置，之后按比例重新锚定 —— 不锚定是**静默出错**：截到
     * 错误像素，OCR 认出一堆乱字，API 照样扣钱，用户看不出哪里不对。
     *
     * 老配置里没有 region.box，就按绝对坐标用（和以前行为一致，不炸）。
     *
     * @param {object} region    框选时记下的区域
     * @param {HTMLVideoElement} [video] 不给我就自己找
     * @param {object} [knownBox] 调用方刚算过的内容框 —— 传进来就少一次
     *                            getBoundingClientRect + getComputedStyle 强制重排
     */
    function resolveRegion(region, video, knownBox) {
        if (!region) return region;
        const was = region.box;
        // 锚点本身也来自可能被导入/被改坏的配置，先确认它是四个有限正数，
        // 否则下面的比例换算会算出 NaN，一路传进 canvas 尺寸里
        if (!was || ![was.left, was.top, was.width, was.height].every(v => Number.isFinite(Number(v)))
            || Number(was.width) <= 0 || Number(was.height) <= 0) {
            return region;
        }
        const v = video || findVideo();
        if (!v) return region;

        const now = knownBox || getContentBox(v);
        const sx = now.width / was.width;
        const sy = now.height / was.height;
        return {
            x: now.left + (region.x - was.left) * sx,
            y: now.top + (region.y - was.top) * sy,
            w: region.w * sx,
            h: region.h * sy,
            // 换算结果本身不再需要锚点，避免二次换算
        };
    }

    /** 框选完成时调用：把"当时的视频位置"一起存进去，供 resolveRegion 用 */
    function anchorRegion(x, y, w, h, video) {
        const r = { x, y, w, h };
        const v = video || findVideo();
        if (v && v.videoWidth) {
            const box = getContentBox(v);
            if (box.width > 0 && box.height > 0) {
                r.box = { left: box.left, top: box.top, width: box.width, height: box.height };
            }
        }
        return r;
    }
