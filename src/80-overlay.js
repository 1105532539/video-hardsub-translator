    // ═══════════════════════════════════════════════════════════════
    //  80-overlay.js — 悬浮字幕层
    //
    //  译文的显示与定位。position() 与 show() 是分开的：拖窗口时每帧都要
    //  重算位置，但内容没变，不该重建 innerHTML 再触发一次强制重排。
    //
    //  对外提供：Overlay
    //  依赖：CFG、uiHost、hexToRgb、escapeHtml、setHTML、resolveRegion、
    //              Fullscreen
    // ═══════════════════════════════════════════════════════════════
    /** <video> 自己全屏时 DOM 字幕层不会被渲染（它是替换元素，子节点不参与绘制），只能把译文同时塞进
     *  原生字幕轨；普通全屏不用管 —— 那时 UI 已被搬进全屏容器。
     *  ⚡ 优化：抽成具名函数供 show() 两条路径共用 —— 指纹命中提前 return 时也必须走，否则译文停在上一句。 */
    function overlaySyncTrack(original, translation) {
        const vfs = Fullscreen.videoFullscreen();
        if (!vfs) return;
        Fullscreen.showOnTrack(vfs, CFG.showOriginal && original
            ? original + '\n' + (translation || original)
            : (translation || original));
    }

    const Overlay = {
        el: null,

        ensure() {
            if (this.el) return this.el;
            const d = document.createElement('div');
            d.id = 'h1sub-overlay';
            d.style.cssText = [
                'position:fixed',
                'z-index:2147483000',
                'pointer-events:none',
                'max-width:90vw',
                'padding:6px 14px',
                'border-radius:8px',
                'text-align:center',
                'line-height:1.45',
                'font-family:"Microsoft YaHei","PingFang SC",sans-serif',
                'font-weight:700',
                'display:none',
                'white-space:pre-wrap',
                'word-break:break-word',
                'transition:opacity .12s',
            ].join(';');
            uiHost().appendChild(d);
            this.el = d;
            return d;
        },

        applyStyle(d) {
            const op = Math.max(0, Math.min(1, Number(CFG.bgOpacity)));
            const rgb = hexToRgb(CFG.textColor || '#ffffff');
            d.style.background = 'rgba(0,0,0,' + op.toFixed(2) + ')';
            d.style.color = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
            // 描边：亮画面上也能看清
            d.style.textShadow = CFG.outline
                ? '0 0 4px #000,0 0 4px #000,1px 1px 0 #000,-1px -1px 0 #000,'
                + '1px -1px 0 #000,-1px 1px 0 #000,0 2px 6px rgba(0,0,0,.95)'
                : '0 2px 4px rgba(0,0,0,.95)';
        },

        show(original, translation) {
            if (!CFG.region) return;
            const d = this.ensure();
            this.last = { o: original, t: translation };   // 供 reposition 使用

            // ⚡ 优化：内容没变就只重算位置 —— resize 拖动 / manualShot / 流式回调都用同样内容反复调
            //    show()，而重建 innerHTML 后紧跟的 position() 要读 offsetWidth，每次都触发强制重排。
            const key = original + '\u0000' + translation;
            if (this._key === key && d.style.display !== 'none') {
                this.position();
                overlaySyncTrack(original, translation);
                return;
            }
            this._key = key;

            this.applyStyle(d);

            let html = '';
            if (CFG.showOriginal && original) {
                html += '<div style="font-size:' + Math.max(11, CFG.fontSize - 7) + 'px;'
                    + 'font-weight:400;opacity:.72;margin-bottom:2px">'
                    + escapeHtml(original) + '</div>';
            }
            html += '<div style="font-size:' + CFG.fontSize + 'px">'
                + escapeHtml(translation || original) + '</div>';
            setHTML(d, html);

            // 定位：贴在字幕区上方或下方
            d.style.display = 'block';
            this.position();

            overlaySyncTrack(original, translation);
        },

        clear() {
            this._key = null;   // ⚡ 优化：指纹作废，下次显示必定重建 HTML
            if (this.el) this.el.style.display = 'none';
            Fullscreen.hideTrack();
        },

        /** 只重算位置、不重建 HTML：reposition() 原来直接再调 show()，拖窗口边缘时每帧都要重建
         *  一遍 innerHTML 再读 offsetWidth（强制同步重排），而内容根本没变。 */
        position() {
            const d = this.el;
            if (!d || !CFG.region) return;
            // 区域按视频当前位置重新锚定，滚动过也不会飘
            const r = resolveRegion(CFG.region);
            const w = d.offsetWidth, h = d.offsetHeight;
            let left = r.x + r.w / 2 - w / 2;
            left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
            const off = Number(CFG.offsetY) || 0;
            let top;
            if (CFG.overlayTop) {
                top = r.y - h - 8 + off;
                if (top < 8) top = r.y + r.h + 8 + off;   // 上面放不下就放下边
            } else {
                top = r.y + r.h + 8 + off;
                if (top + h > window.innerHeight - 8) top = r.y - h - 8 + off;
            }
            d.style.left = left + 'px';
            d.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, top)) + 'px';
        },

        reposition() {
            if (this.el && this.el.style.display !== 'none' && this.last) {
                this.position();
            }
        },
    };
