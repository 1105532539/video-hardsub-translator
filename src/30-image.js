    // ═══════════════════════════════════════════════════════════════
    //  30-image.js — 截图分析与文本相似度（热路径）
    //
    //  决定"这帧要不要花钱调 API"的三个判断都在这儿：
    //    画面是否变化（thumbnail + thumbDiff）
    //    区域里有没有文字（edgeDensity）
    //    这句是不是和上一句重复（textSimilarity）
    //  离屏画布与 DP 滚动行缓冲都复用，不每轮新建。
    //
    //  对外提供：thumbnail、thumbDiff、edgeDensity、textSimilarity
    //  依赖：THUMB_W、THUMB_H、EDGE_W、EDGE_H、EDGE_GRAD、EDGE_MIN
    // ═══════════════════════════════════════════════════════════════
    /**
     * 复用的离屏画布。这两个函数每轮（约 1.2 秒）各调一次，原来每次都在新建
     * canvas + 2d context + ImageData —— 而 willReadFrequently 的提示本来就是让
     * "同一个" context 走 CPU 后端的，对一次性画布毫无意义。
     */
    const THUMB_BUF = {};
    const EDGE_BUF = {};

    function scratch(store, w, h) {
        if (!store.c || store.c.width !== w || store.c.height !== h) {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            store.c = c;
            store.x = c.getContext('2d', { willReadFrequently: true });
        }
        return store.x;
    }

    /** 生成 32x16 灰度缩略图，用于「画面是否变化」的快速判断。
     *  返回的数组会被 Pipeline.lastThumb 长期持有做对比，所以每次必须新建 ——
     *  能复用的只有画布，数组不能复用。 */
    function thumbnail(canvas) {
        const x = scratch(THUMB_BUF, THUMB_W, THUMB_H);
        x.drawImage(canvas, 0, 0, THUMB_W, THUMB_H);
        const d = x.getImageData(0, 0, THUMB_W, THUMB_H).data;
        const g = new Float32Array(THUMB_W * THUMB_H);
        for (let i = 0; i < g.length; i++) {
            g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
        }
        return g;
    }

    function thumbDiff(a, b) {
        if (!a || !b) return 1;
        let s = 0;
        for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
        return s / a.length / 255;
    }

    /**
     * 边缘密度：粗略判断区域里到底有没有文字，跳过大部分无效 API 调用。
     * 只留两行灰度做滚动比较（水平边看同行左右、垂直边看上下行），结果和「先算完整
     * 灰度矩阵再扫一遍」逐位相同，但省掉每次一块 160×48 的 Float32Array（约 30KB）。
     */
    const EDGE_ROWS = [new Float32Array(EDGE_W), new Float32Array(EDGE_W)];

    function edgeDensity(canvas) {
        const x = scratch(EDGE_BUF, EDGE_W, EDGE_H);
        x.drawImage(canvas, 0, 0, EDGE_W, EDGE_H);
        const d = x.getImageData(0, 0, EDGE_W, EDGE_H).data;
        let cnt = 0;
        let prev = EDGE_ROWS[0], cur = EDGE_ROWS[1];
        for (let y = 0; y < EDGE_H; y++) {
            const rowOff = y * EDGE_W * 4;
            for (let i = 0; i < EDGE_W; i++) {
                const p = rowOff + i * 4;
                cur[i] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
            }
            // 和旧实现一样，第一行没有上一行可对比，从第二行起计数
            if (y > 0) {
                for (let i = 1; i < EDGE_W; i++) {
                    if (Math.abs(cur[i] - cur[i - 1]) > EDGE_GRAD
                        || Math.abs(cur[i] - prev[i]) > EDGE_GRAD) cnt++;
                }
            }
            const t = prev; prev = cur; cur = t;
        }
        return cnt / (EDGE_W * EDGE_H);
    }

    /** 归一化编辑距离，用来判断两次 OCR 结果是不是"同一句话"。
     *  DP 滚动行用模块级缓冲（每次识别出新字幕都可能调一次），不再每回 new 两个
     *  普通数组（稀疏、装箱，还要 GC）；Int32 足够，超长输入会被下面 40000 挡掉。 */
    let SIM_BUF_A = new Int32Array(64);
    let SIM_BUF_B = new Int32Array(64);

    function textSimilarity(a, b) {
        a = (a || '').replace(/\s+/g, '');
        b = (b || '').replace(/\s+/g, '');
        // 最常见的输入就是同一句（整帧没变、或 OCR 结果一字不差），直接给 1，
        // 不必跑一遍 O(m×n) 的动态规划；两边都为空也走这条，结果同样是 1。
        if (a === b) return 1;
        if (!a || !b) return 0;
        // ⚡ 优化：进 DP 前先用相似度上界剪枝 —— 编辑距离至少等于长度差，所以相似度不
        //    可能超过 1 - |la-lb| / maxLen，长度差悬殊的对子（3 字 vs 30 字）原来要跑完
        //    O(m·n) 才返回 0。取 0.2 是最保守的：默认阈值 0.28 意味着 sim > 0.72 才算同一
        //    句，够不到 0.2 的串绝无可能被判重复，所以不改变任何既有结论。
        const la = a.length, lb = b.length;
        const maxLen = la > lb ? la : lb;
        const upper = 1 - (maxLen - (la < lb ? la : lb)) / maxLen;
        if (upper < 0.2) return 0;
        // 列数取较短的那边：滚动行更短，缓存更友好。编辑距离与方向无关，
        // 1 - dist/max(m,n) 也对称，结果不受影响。
        if (a.length < b.length) { const t = a; a = b; b = t; }
        const m = a.length, n = b.length;
        if (m * n > 40000) return 0;   // 太长就不算了（相等已在上面短路）
        if (SIM_BUF_A.length < n + 1) {
            SIM_BUF_A = new Int32Array(n + 1);
            SIM_BUF_B = new Int32Array(n + 1);
        }
        let prev = SIM_BUF_A, cur = SIM_BUF_B;
        for (let j = 0; j <= n; j++) prev[j] = j;
        for (let i = 1; i <= m; i++) {
            cur[0] = i;
            const ca = a.charCodeAt(i - 1);   // charCodeAt 比较比逐字符取字符串快
            for (let j = 1; j <= n; j++) {
                const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
                const del = prev[j] + 1, ins = cur[j - 1] + 1, sub = prev[j - 1] + cost;
                cur[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
            }
            const t = prev; prev = cur; cur = t;
        }
        const dist = prev[n];
        return 1 - dist / Math.max(m, n);
    }
