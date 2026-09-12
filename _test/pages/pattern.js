// 测试图案：4列×3行 唯一色块网格 + 底部字幕带
// 色块颜色两两差异极大，因此「裁出来的区域该是什么颜色」可以被精确断言。
(function () {
    'use strict';

    const W = 640, H = 360;
    const COLS = 4, ROWS = 3;
    const BAND_Y = 300;                 // 字幕带起始 y
    const BAND_H = H - BAND_Y;          // 60
    const CW = W / COLS;                // 160
    const CH = BAND_Y / ROWS;           // 100

    const CELL_COLORS = [
        [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]],
        [[255, 0, 255], [0, 255, 255], [255, 128, 0], [128, 0, 255]],
        [[0, 128, 0], [128, 0, 0], [0, 0, 128], [128, 128, 128]],
    ];

    const SUBTITLE_TEXT = 'SUBTITLE TEST 01';

    function drawPattern(ctx) {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const col = CELL_COLORS[r][c];
                ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
                ctx.fillRect(c * CW, r * CH, CW, CH);
            }
        }
        // 字幕带：黑底白字
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, BAND_Y, W, BAND_H);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(SUBTITLE_TEXT, 20, BAND_Y + BAND_H / 2);
    }

    window.__PATTERN__ = {
        W, H, COLS, ROWS, BAND_Y, BAND_H, CW, CH,
        CELL_COLORS, SUBTITLE_TEXT, drawPattern,
        /** 某个色块在「视频画面坐标」里的矩形 */
        cellRect(r, c) {
            return { x: c * CW, y: r * CH, w: CW, h: CH, color: CELL_COLORS[r][c] };
        },
        /** 字幕带在「视频画面坐标」里的矩形 */
        bandRect() {
            return { x: 0, y: BAND_Y, w: W, h: BAND_H };
        },
    };
})();
