    // ═══════════════════════════════════════════════════════════════
    //  92-panel-css.js — 控制面板：样式表
    //
    //  对外提供：panelCSS
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    /** 面板的样式表。后半段是给**弹窗**用的：那些弹窗挂在 body 上、不在 #h1sub-panel 里，`#h1sub-panel
     *  button` 那套选择器作用不到它们；不单独配一套，按钮就会退化成网站的重置样式（浅灰字贴深灰底看不清）。 */
    function panelCSS() {
        return [
            '#h1sub-panel .h1sub-sec{margin:10px 0 5px;padding-top:7px;border-top:1px solid #262b34;color:#7dd3fc;font-weight:700}',
            '#h1sub-panel label{display:flex;flex-direction:column;gap:3px;margin-bottom:7px;color:#9aa3b8}',
            '#h1sub-panel input,#h1sub-panel select,#h1sub-panel textarea{',
            '  background:#0f1116;border:1px solid #2c313a;border-radius:5px;color:#e6e8ee;',
            '  padding:5px 7px;font:12px inherit;outline:none;width:100%;box-sizing:border-box}',
            '#h1sub-panel input:focus,#h1sub-panel select:focus,#h1sub-panel textarea:focus{border-color:#22d3ee}',
            '#h1sub-panel input[type=range]{padding:0}',
            '#h1sub-panel progress{width:100%;height:6px;border:0;border-radius:3px;display:block}',
            '#h1sub-panel button{background:#262b34;border:1px solid #333a46;border-radius:5px;',
            '  color:#e6e8ee;padding:6px 8px;cursor:pointer;font:12px inherit}',
            '#h1sub-panel button:hover{background:#313846}',
            '#h1sub-panel button.on{background:#0e7490;border-color:#22d3ee}',
            '#h1sub-panel button.primary{background:#0e7490;border-color:#22d3ee}',

            '.h1sub-modal button{background:#2f3644;border:1px solid #4a5568;border-radius:5px;',
            '  color:#ffffff;padding:6px 12px;cursor:pointer;font:12px inherit;font-weight:600;',
            '  line-height:1.4;white-space:nowrap}',
            '.h1sub-modal button:hover{background:#3d4657;border-color:#22d3ee}',
            '.h1sub-modal button:active{background:#0e7490;border-color:#22d3ee}',
            '.h1sub-modal button:disabled{opacity:.55;cursor:default}',
            '.h1sub-modal .h1sub-x{color:#cbd5e1;cursor:pointer;padding:2px 8px;font-size:17px;',
            '  line-height:1;border-radius:4px}',
            '.h1sub-modal .h1sub-x:hover{background:#313846;color:#fff}',
        ].join('\n');
    }
