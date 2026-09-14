    // ═══════════════════════════════════════════════════════════════
    //  86-selector.js — 区域框选器
    //
    //  框选用的遮罩 / 选区框 / 提示条，以及拖拽、预览、Esc 与失焦兜底。
    //  两个容易踩的坑都写在代码注释里：遮罩必须 pointer-events:none，
    //  window 的 blur 兜底**不能**用捕获阶段（否则页内任何元素失焦都会取消框选）。
    //
    //  对外提供：RegionSelector
    //  依赖：CFG、UI、Capturer、findVideo、anchorRegion、rememberRegion、Pipeline、
    //              isConfigured
    // ═══════════════════════════════════════════════════════════════
    const RegionSelector = {
        active: false,

        /** 造框选用的三个覆盖层（遮罩 / 选区框 / 提示条）：纯构造，所以从 begin() 里单独拎出来 */
        createOverlay() {
            const mask = document.createElement('div');
            mask.style.cssText = [
                // z-index 必须**低于面板**（2147483500）、高于字幕层（2147483000）：原来比面板高，
                // 面板连同预览区被压在一层 35% 黑纱下（拖拽时再叠 box 阴影），看起来就像"预览消失了"。
                'position:fixed', 'inset:0', 'z-index:2147483400',
                'background:rgba(0,0,0,0.35)',
                // 不吃鼠标事件：mouseup 丢在窗口外（拖出浏览器 / alt-tab）时 dragging 清不掉、
                // cleanup 也不会跑，遮罩会把整页的点击都吞掉；拖拽监听挂在 document 捕获阶段。
                'pointer-events:none',
            ].join(';');

            const box = document.createElement('div');
            box.style.cssText = [
                'position:fixed', 'border:2px solid #22d3ee',
                'background:rgba(34,211,238,0.18)',
                // 阴影负责把选区以外压暗（遮罩 0.35 + 这里 0.35）；box 只在拖拽时显示，静止时不会太黑。
                'box-shadow:0 0 0 9999px rgba(0,0,0,0.35)',
                'pointer-events:none', 'display:none',
            ].join(';');

            const tip = document.createElement('div');
            tip.textContent = '按住鼠标左键拖拽，框住视频里的字幕区域；按 Esc 取消';
            tip.style.cssText = [
                'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
                'background:#111', 'color:#fff', 'padding:8px 16px', 'border-radius:6px',
                'font:13px/1.5 "Microsoft YaHei",sans-serif', 'z-index:2147483601',
                'pointer-events:none',
            ].join(';');

            document.body.appendChild(mask);
            document.body.appendChild(box);
            document.body.appendChild(tip);
            return { mask, box, tip };
        },

        begin() {
            if (this.active) return;
            this.active = true;

            const { mask, box, tip } = this.createOverlay();

            // 框选期间露出预览区：首次框选时 CFG.region 还是空的，syncRegion() 会把预览整个藏掉，用户无从对照；退出时 cleanup() 会还原。
            if (UI.els.preview_wrap) UI.els.preview_wrap.style.display = 'block';

            // 十字光标改挂在根元素上：遮罩已经 pointer-events:none 了
            const prevCursor = document.documentElement.style.cursor;
            document.documentElement.style.cursor = 'crosshair';

            let sx = 0, sy = 0, dragging = false;

            const onDown = (e) => {
                if (e.button !== 0) return;
                dragging = true;
                sx = e.clientX; sy = e.clientY;
                box.style.display = 'block';
                box.style.left = sx + 'px';
                box.style.top = sy + 'px';
                box.style.width = '0px';
                box.style.height = '0px';
            };
            // 拖拽时实时截出"当前框住的这块"喂给预览：否则预览里始终是**上一次**的区域，
            // 框选过程中判断不出这次框得对不对。用 rAF 合并 —— mousemove 一秒几十次，
            // 而一次 Capturer.grab 实测约 0.43 ms（`npm run bench`），不合并就是白烧。
            let previewRaf = 0;
            const previewDrag = (x, y, w, h) => {
                if (previewRaf) return;
                previewRaf = requestAnimationFrame(() => {
                    previewRaf = 0;
                    if (w < 20 || h < 8) return;      // 太小，截了也没意义
                    try {
                        const c = Capturer.grab({ x, y, w, h }, findVideo());
                        if (c) UI.setPreview(c);
                    } catch (e) {
                        // 拖拽途中截不到很正常（框到视频外、还没授权共享…），静默跳过，绝不能打断框选
                    }
                });
            };

            /** 按当前的 CFG.region 重截一张喂给预览，只在**区域定下来之后**调用：cleanup() 是在 onUp 里
             *  「设置新区域之前」跑的，在那里截会截到上一次的区域，框完反而显示旧画面。 */
            const refreshPreview = () => {
                if (!CFG.region) return;
                try {
                    const c = Capturer.grab(CFG.region, findVideo());
                    if (c) UI.setPreview(c);
                } catch (e) {
                    // 截不到就算了（还没找到视频、没授权共享…），别打断流程
                }
            };

            const onMove = (e) => {
                if (!dragging) return;
                const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
                const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
                box.style.left = x + 'px';
                box.style.top = y + 'px';
                box.style.width = w + 'px';
                box.style.height = h + 'px';
                previewDrag(x, y, w, h);
            };
            const onUp = (e) => {
                if (!dragging) return;
                dragging = false;
                const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
                const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
                cleanup();
                if (w < 20 || h < 8) {
                    UI.setStatus('框选太小，已取消', 'warn');
                    return;
                }
                CFG.region = anchorRegion(x, y, w, h);
                rememberRegion(CFG.region);   // 按网站记住，换站不会串
                UI.syncRegion();
                UI.setStatus('字幕区域已设定：' + w + '×' + h + '（已记住本站）', 'ok');
                // 换了区域 = 换了画面含义：上一帧的记录全部作废（含 lastSentThumb，
                // 否则新区域的第一帧会被误判成"已经买过"而跳过）
                Pipeline.resetFrameState();

                // 框完立刻截一帧（不用等点「开始」才发现框歪了）：密钥配好了就顺带识别一次，把整条链路
                // 验证掉；没配则只截不认，免得刚框完就弹个 401 吓人。（视频暂停时也能截，适合"暂停着慢慢框"。）
                if (isConfigured()) UI.manualShot();
                else refreshPreview();
            };
            const onKey = (e) => {
                if (e.key === 'Escape') {
                    cleanup();
                    UI.setStatus('已取消框选', 'warn');
                    refreshPreview();            // 还原成当前实际区域的画面
                }
            };

            const cleanup = () => {
                this.active = false;
                dragging = false;
                document.removeEventListener('mousedown', onDown, true);
                document.removeEventListener('mousemove', onMove, true);
                document.removeEventListener('mouseup', onUp, true);
                document.removeEventListener('keydown', onKey, true);
                // 这里的 capture 标志必须和下面 addEventListener 那一处完全一致，否则摘不掉：
                // 上一轮的 onBlur 会一直留着，拿着已删掉的遮罩去 cleanup，反而搅乱本轮状态。
                window.removeEventListener('blur', onBlur);
                document.documentElement.style.cursor = prevCursor;
                mask.remove(); box.remove(); tip.remove();

                // 只负责拆干净 + 还原预览区显隐。这里**不要**去截预览：onUp 是先调 cleanup、
                // 再设置新区域的，在这儿截只会截到上一次的区域；需要重截的调用方自己调 refreshPreview()。
                UI.syncRegion();
            };

            // 兜底：拖到窗口外松手 / alt-tab 走掉时 mouseup 就收不到了。
            // ⚠️ 这里**绝对不能**加捕获阶段（第三个参数不能是 true）：blur 自身不冒泡，但捕获阶段从
            // window 一路往下走，页面上**任何元素**失焦都会被这个监听抓到 —— 用户点完面板上的「框选字幕区」
            // 按钮（处于聚焦态）再移到视频上按下左键时，焦点从按钮移走派发的 blur 会让框选还没开始就被
            // cleanup 掉，表现就是"框选功能用不了"；不加 capture 只有焦点真的离开窗口时才触发。
            const onBlur = () => {
                if (!this.active) return;
                cleanup();
                UI.setStatus('框选已取消（窗口失去焦点）', 'warn');
                refreshPreview();
            };

            document.addEventListener('mousedown', onDown, true);
            document.addEventListener('mousemove', onMove, true);
            document.addEventListener('mouseup', onUp, true);
            document.addEventListener('keydown', onKey, true);
            window.addEventListener('blur', onBlur);
        },
    };
