    // ═══════════════════════════════════════════════════════════════
    //  14-constants.js — 热路径常量与配色
    //
    //  截图循环默认每 1.2 秒走一遍（`CFG.interval`；出错退避、切到后台、
    //  视频暂停时会变慢或停下），魔数集中在这里便于调参。
    //
    //  对外提供：THUMB_W、THUMB_H、EDGE_W、EDGE_H、EDGE_GRAD、EDGE_MIN、
    //              NO_CHANGE_DIFF、STATUS_COLORS
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    const THUMB_W = 32, THUMB_H = 16;   // 「画面是否变化」缩略图尺寸
    const EDGE_W = 160, EDGE_H = 48;    // 「区域里有没有文字」采样尺寸
    const EDGE_GRAD = 45;               // 相邻像素灰度差超过此值记作一条边
    const EDGE_MIN = 0.035;             // 边缘密度低于此值视为「无文字」，跳过 API
    const NO_CHANGE_DIFF = 0.004;       // 缩略图平均差低于此值视为「画面没变」

    /** 状态栏配色（setStatus 的 kind → 颜色） */
    const STATUS_COLORS = {
        err: '#f87171',
        warn: '#fbbf24',
        ok: '#4ade80',
        busy: '#22d3ee',
        idle: '#8b93a7',
    };
