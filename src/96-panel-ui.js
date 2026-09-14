    // ═══════════════════════════════════════════════════════════════
    //  96-panel-ui.js — 控制面板：控件绑定、配置档案、导入导出与状态显示
    //
    //  面板的全部行为：装配、拖动、折叠成小胶囊、所有控件的双向绑定、
    //  多套 API 配置档案、Umi-OCR 连接测试、配置导入导出、
    //  状态栏 / 统计 / 历史记录、手动截图与 API 测试。
    //
    //  bind() 只负责列清单，具体接线在各自的 bindXxx() 里 ——
    //  想知道「哪个按钮对应哪段逻辑」，看 bind() 就够了。
    //
    //  对外提供：UI
    //  依赖：CFG、DEFAULTS、API_PRESETS、saveCfg、saveCfgKeys、sanitizeCfg、
    //              cloneDefault、NS、UMI_LANGS、DS_VISION_MODELS、isNoVisionModel、
    //              isStaleDeepSeekModel、shouldDisableThinking、umiBase、umiProbe、
    //              callUmiOCR、callYoudaoImage、callChat、recognizeAndTranslate、
    //              baiPair、baiProbe、baiPrepare、baiReset、baiBrowser、baiVersionNote、
    //              langCode、wtSelftest、wtReset、uiHost、
    //              Capturer、Pipeline、Overlay、Diag、Fullscreen、RegionSelector、
    //              openModal、setHTML、escapeHtml、STATUS_COLORS、panelHTML、panelCSS、
    //              banCurrentHost、cache
    // ═══════════════════════════════════════════════════════════════
    //
    // ⚡ 优化：「最近识别」保留的条数提为具名常量。纯属给将来调参留个入口，
    //    行为与原来写死的 30 一致。
    const HIST_MAX = 30;

    const UI = {
        root: null,
        collapsed: false,
        els: {},

        mount() {
            if (this.root) return;

            const root = document.createElement('div');
            root.id = 'h1sub-panel';
            root.style.cssText = [
                'position:fixed', 'right:16px', 'bottom:16px', 'width:320px',
                'z-index:2147483500', 'background:#15171c', 'color:#e6e8ee',
                'border:1px solid #2c313a', 'border-radius:10px',
                'box-shadow:0 10px 30px rgba(0,0,0,.5)',
                'font:12px/1.6 "Microsoft YaHei","PingFang SC",sans-serif',
                'overflow:hidden', 'user-select:none',
            ].join(';');

            setHTML(root, panelHTML());

            const style = document.createElement('style');
            style.textContent = panelCSS();
            document.head.appendChild(style);
            uiHost().appendChild(root);
            this.root = root;

            const ids = ['head', 'host', 'dot', 'collapse', 'close', 'ban', 'body', 'region', 'run', 'region-info',
                'preview-wrap', 'preview', 'engine', 'openai',
                'preset', 'preset-note', 'apiBase', 'apiKey', 'model', 'model-hint',
                'profile', 'profile-save', 'profile-del',
                'youdao', 'youdaoAppKey', 'youdaoAppSecret', 'youdaoFrom', 'youdaoTo', 'youdaoLLM',
                'browserai', 'bai-ver', 'baiOcr', 'baiTrans', 'baiStream', 'baiPivot', 'bai-probe', 'bai-prepare',
                'bai-bar', 'bai-status',
                'webtranslate', 'wtEngine', 'wtMinInterval', 'wt-test', 'wt-status',
                'umionly', 'umiBase', 'umiLang', 'umi-test', 'umi-status',
                'captureMode', 'sharescreen', 'stopscreen', 'capture-hint',
                'srcLang', 'tgtLang', 'interval', 'smartSkip', 'pauseWhenHidden', 'sim', 'simVal',
                'fontSize', 'fontVal', 'bgOpacity', 'opacityVal', 'offsetY', 'offsetVal',
                'textColor', 'outline', 'showOriginal', 'overlayTop',
                'extraPrompt', 'thinkingMode', 'thinking-hint', 'maxTokens',
                'test', 'shot', 'export', 'import', 'unban', 'ban-info',
                'reset', 'clearcache',
                'diag', 'status', 'stats', 'hist'];
            for (const id of ids) {
                this.els[id.replace(/-/g, '_')] = root.querySelector('#h1sub-' + id);
            }

            this.bind();
            this.loadToUI();
            this.syncRegion();
            this.applyLayout();
        },

        /** 恢复上次的面板位置和宽度 */
        applyLayout() {
            if (CFG.panelWidth) {
                this.root.style.width = Math.max(260, Math.min(760, Number(CFG.panelWidth))) + 'px';
            }
            const p = CFG.panelPos;
            if (p && typeof p.left === 'number' && typeof p.top === 'number') {
                this.root.style.right = 'auto';
                this.root.style.bottom = 'auto';
                this.root.style.left = Math.max(0, Math.min(window.innerWidth - 60, p.left)) + 'px';
                this.root.style.top = Math.max(0, Math.min(window.innerHeight - 40, p.top)) + 'px';
            }
        },

        // ── 收起状态的小胶囊 ──
        // 全站运行后，没有视频的页面不该被大面板挡住，所以先收成一个小按钮。
        pillMode: false,
        pillEl: null,

        ensurePill() {
            if (this.pillEl) return this.pillEl;
            const b = document.createElement('div');
            b.id = 'h1sub-pill';
            setHTML(b, '<span style="font-size:10px">▶</span> 字幕翻译');
            b.title = '点击打开「硬字幕翻译」面板';
            b.style.cssText = [
                'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483500',
                'background:#1c1f26', 'color:#7dd3fc', 'border:1px solid #2c313a',
                'border-radius:999px', 'padding:6px 13px', 'cursor:pointer',
                'font:12px/1.5 "Microsoft YaHei","PingFang SC",sans-serif',
                'box-shadow:0 4px 14px rgba(0,0,0,.45)', 'user-select:none',
                'display:none', 'align-items:center', 'gap:6px', 'opacity:.8',
                'transition:opacity .15s',
            ].join(';');
            b.addEventListener('mouseenter', () => { b.style.opacity = '1'; });
            b.addEventListener('mouseleave', () => { b.style.opacity = '.8'; });
            b.addEventListener('click', () => this.leavePillMode());
            uiHost().appendChild(b);
            this.pillEl = b;
            return b;
        },

        /** 收成小胶囊（页面上没有视频时，或用户点关闭时） */
        enterPillMode() {
            this.pillMode = true;
            this.root.style.display = 'none';
            const p = this.ensurePill();
            p.style.display = 'flex';
        },

        leavePillMode() {
            this.pillMode = false;
            if (this.pillEl) this.pillEl.style.display = 'none';
            this.root.style.display = 'block';
            this.applyLayout();
        },

        /** 彻底从页面移除（本站禁用时用） */
        destroy() {
            Pipeline.stop();
            // 不主动停的话，getDisplayMedia 的共享会一直开着：浏览器顶部一直显示"正在共享此标签页"、
            // 隐藏的 video 还在解码，而脚本里那个「停止共享」按钮已经跟着面板一起没了。
            try { Capturer.stopDisplayCapture(); } catch (e) { /* ignore */ }
            if (this.pillEl) { this.pillEl.remove(); this.pillEl = null; }
            if (this.root) this.root.remove();
            this.root = null;       // 不置空的话 mountUI() 会一直以为面板还在
            this.els = {};
            if (this._hrefTimer) { clearInterval(this._hrefTimer); this._hrefTimer = null; }
            Fullscreen.hideTrack();
            if (this._onResize) {
                window.removeEventListener('resize', this._onResize);
                this._onResize = null;
            }
            // 面板拖动挂在 document 上的两个监听也要摘，不然重新挂载后越攒越多
            if (this._onDragMove) {
                document.removeEventListener('mousemove', this._onDragMove);
                this._onDragMove = null;
            }
            if (this._onDragUp) {
                document.removeEventListener('mouseup', this._onDragUp);
                this._onDragUp = null;
            }
            if (this._drag) this._drag.on = false;
            if (Overlay.el) { Overlay.el.remove(); Overlay.el = null; }
        },

        /** 把所有控件接上行为：原先是 290 多行的单方法，现按面板分区拆成几个具名方法，
         *  这里只负责列清单 —— 想知道「哪个按钮对应哪段逻辑」，看这里就够了。 */
        bind() {
            this.bindPanelChrome();
            this.bindProfiles();
            this.bindUmi();
            this.bindBrowserAI();
            this.bindWebTranslate();
            this.bindConfigInputs();
            this.bindPresets();
            this.bindCaptureControls();
            this.bindConfigIO();
            this.bindTools();
            this.bindViewport();
        },

        /** 标题栏（折叠 / 关闭 / 本站禁用）、面板拖动与宽度调节，以及两个主按钮 */
        bindPanelChrome() {
            const e = this.els;

            // 折叠 / 关闭（关闭 = 收成右下角小胶囊，随时能点回来）
            e.close.onclick = () => this.enterPillMode();
            e.collapse.onclick = () => {
                this.collapsed = !this.collapsed;
                e.body.style.display = this.collapsed ? 'none' : 'block';
                e.collapse.textContent = this.collapsed ? '+' : '—';
            };

            e.ban.onclick = () => banCurrentHost();

            // 拖动。两个 document 级监听存到实例上，交给 destroy() 摘掉（不摘每次重挂都会越攒越多）
            const drag = this._drag = { on: false, dx: 0, dy: 0 };
            e.head.addEventListener('mousedown', (ev) => {
                if (ev.target === e.close || ev.target === e.collapse) return;
                drag.on = true;
                const r = this.root.getBoundingClientRect();
                drag.dx = ev.clientX - r.left;
                drag.dy = ev.clientY - r.top;
                ev.preventDefault();
            });
            this._onDragMove = (ev) => {
                if (!drag.on) return;
                this.root.style.right = 'auto';
                this.root.style.bottom = 'auto';
                this.root.style.left = Math.max(0, ev.clientX - drag.dx) + 'px';
                this.root.style.top = Math.max(0, ev.clientY - drag.dy) + 'px';
            };
            this._onDragUp = () => {
                if (!drag.on) return;
                drag.on = false;
                const r = this.root.getBoundingClientRect();
                CFG.panelPos = { left: Math.round(r.left), top: Math.round(r.top) };
                saveCfgKeys(CFG, ['panelPos']);
            };
            document.addEventListener('mousemove', this._onDragMove);
            document.addEventListener('mouseup', this._onDragUp);

            const grip = document.createElement('div');
            grip.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:5px;'
                + 'cursor:ew-resize;z-index:5';
            this.root.appendChild(grip);
            grip.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const startX = ev.clientX;
                const startW = this.root.offsetWidth;
                const onMove = (e2) => {
                    const w = Math.max(260, Math.min(760, startW + (startX - e2.clientX)));
                    this.root.style.width = w + 'px';
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    CFG.panelWidth = this.root.offsetWidth;
                    saveCfgKeys(CFG, ['panelWidth']);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            e.region.onclick = () => RegionSelector.begin();
            e.run.onclick = () => Pipeline.toggle();
        },

        bindProfiles() {
            const e = this.els;
            if (e.profile) {
                e.profile.onchange = () => {
                    if (e.profile.value) this.applyProfile(e.profile.value);
                };
            }
            if (e.profile_save) {
                e.profile_save.onclick = (ev) => { ev.preventDefault(); this.saveProfile(); };
            }
            if (e.profile_del) {
                e.profile_del.onclick = (ev) => { ev.preventDefault(); this.deleteProfile(); };
            }
        },

        bindUmi() {
            const e = this.els;
            if (e.umi_test) {
                e.umi_test.onclick = (ev) => { ev.preventDefault(); this.testUmi(); };
            }
        },

        /** 浏览器内置 AI（完全离线）的两个按钮。「准备」必须在**点击的调用栈**里发起：
         *  端侧模型还没下载时，浏览器只在有用户手势时允许建会话（否则直接拒绝），所以这里不 await。 */
        bindBrowserAI() {
            const e = this.els;
            const self = this;
            if (e.bai_probe) {
                e.bai_probe.onclick = (ev) => { ev.preventDefault(); self.probeBrowserAI(); };
            }
            if (e.bai_prepare) {
                e.bai_prepare.onclick = (ev) => { ev.preventDefault(); self.prepareBrowserAI(); };
            }
        },

        /** 免费网页接口逐个测活：逆向接口随时可能失效，「能不能用」不该靠猜，点一下就知道谁还活着 */
        bindWebTranslate() {
            const e = this.els;
            const self = this;
            if (e.wt_test) {
                e.wt_test.onclick = (ev) => { ev.preventDefault(); self.testWebTranslate(); };
            }
        },

        setWtStatus(text, color) {
            const el = this.els.wt_status;
            if (el) { el.textContent = text; el.style.color = color || '#aeb4c4'; }
        },

        async testWebTranslate() {
            const btn = this.els.wt_test;
            if (btn) btn.disabled = true;
            const pair = (langCode(CFG.srcLang) || 'ja') + ' → ' + (langCode(CFG.tgtLang) || 'zh');
            this.setWtStatus('⏳ 正在逐个测试（' + pair + '）…', '#22d3ee');
            this.setStatus('正在测试免费翻译接口…', 'busy');
            try {
                const rows = await wtSelftest();
                Diag.wtSelftest = rows;
                this.setWtStatus(rows.map(r => (r.ok ? '✅ ' : '❌ ') + r.label
                    + (r.ok ? '：' + r.out.slice(0, 24) : '：' + r.err) + '（' + r.ms + 'ms）').join('\n'),
                    rows.some(r => r.ok) ? '#4ade80' : '#f87171');
                const alive = rows.filter(r => r.ok).length;
                this.setStatus(alive ? '✅ 免费接口可用 ' + alive + '/' + rows.length
                    : '❌ 免费接口都不可用（可能改版了，或网络不通）', alive ? 'ok' : 'err');
            } catch (e) {
                this.setWtStatus('❌ ' + e.message, '#f87171');
                this.setStatus('测试失败：' + e.message, 'err');
            } finally {
                if (btn) btn.disabled = false;
            }
        },

        setBaiStatus(text, color) {
            const el = this.els.bai_status;
            if (el) { el.textContent = text; el.style.color = color || '#aeb4c4'; }
        },

        /** 进度条。ratio 传 null 表示收起 */
        setBaiBar(ratio) {
            const b = this.els.bai_bar;
            if (!b) return;
            if (ratio == null) { b.style.display = 'none'; b.value = 0; return; }
            b.style.display = 'block';
            b.value = Math.max(0, Math.min(1, Number(ratio) || 0));
        },

        /** 探测内置 AI：支持哪些 API、语言对能不能用、要不要先下载 */
        async probeBrowserAI() {
            const btn = this.els.bai_probe;
            if (btn) btn.disabled = true;
            this.setBaiStatus('⏳ 正在检测浏览器内置 AI…', '#22d3ee');
            this.setStatus('正在检测浏览器内置 AI…', 'busy');
            try {
                const rows = await baiProbe();
                Diag.baiProbe = rows;      // 存一份给诊断报告（build() 是同步的，不能现算）
                this.setBaiStatus(rows.map(r => r.label + '：' + r.value).join('\n'), '#aeb4c4');
                const bad = rows.filter(r => r.kind === 'bad');
                this.setStatus(bad.length
                    ? '内置 AI 有 ' + bad.length + ' 项不可用 —— 看上面的检测结果'
                    : '✅ 浏览器内置 AI 可用', bad.length ? 'warn' : 'ok');
            } catch (e) {
                this.setBaiStatus('❌ ' + e.message, '#f87171');
                this.setStatus('检测失败：' + e.message, 'err');
            } finally {
                if (btn) btn.disabled = false;
            }
        },

        /** 准备（必要时下载）离线模型 —— 必须在点击调用栈里发起 */
        async prepareBrowserAI() {
            const btn = this.els.bai_prepare;
            if (btn) btn.disabled = true;
            this.setBaiBar(0);
            this.setBaiStatus('⏳ 正在准备离线模型…', '#22d3ee');
            this.setStatus('正在准备离线模型…', 'busy');
            try {
                const ready = await baiPrepare((msg, ratio) => {
                    if (ratio >= 1) { this.setBaiBar(null); return; }
                    if (msg) this.setBaiStatus('⏳ ' + msg, '#22d3ee');
                    this.setBaiBar(ratio);
                });
                const p = baiPair();
                this.setBaiStatus('✅ 已就绪：' + ready.join('、')
                    + (p ? '\n语言方向：' + p.src + ' → ' + p.tgt : ''), '#4ade80');
                this.setStatus('✅ 离线模型已就绪，可以点「开始」了', 'ok');
            } catch (e) {
                this.setBaiStatus('❌ ' + e.message, '#f87171');
                this.setStatus('准备离线模型失败：' + e.message, 'err');
            } finally {
                this.setBaiBar(null);
                if (btn) btn.disabled = false;
            }
        },

        /** 所有配置项控件的双向绑定。
         *  bindInput 普通输入框 / 下拉框 / 复选框（change 落盘）、bindRange 滑块（input 预览、change 落盘）；
         *  写回后的联动刷新统一收在 onChangeEffects 里，免得每加一项要在好几处补 if。 */
        bindConfigInputs() {
            const e = this.els;
            const self = this;

            /** 某个配置项变了之后，界面 / 缓存要跟着做的调整 */
            const onChangeEffects = (key) => {
                if (key === 'engine') self.syncEngineUI();
                // 离线引擎换了识别方式 → Umi-OCR 配置区的显隐要跟着变
                if (key === 'baiOcr') self.syncEngineUI();
                // 换了语言方向 / 引擎 / 离线模式，端侧会话（按语言对和模式缓存）就得重建
                if (['srcLang', 'tgtLang', 'engine', 'baiOcr', 'baiTrans', 'baiPivot'].includes(key)) baiReset();
                // 免费接口换了引擎 / 限速，之前的节奏记录作废
                if (key === 'wtEngine' || key === 'wtMinInterval') wtReset();
                if (key === 'captureMode') self.syncCaptureUI();
                // auto 模式要看 API 地址判断，地址变了提示也得跟着变
                if (key === 'thinkingMode' || key === 'apiBase') self.syncThinkingUI();
                if (key === 'model' || key === 'apiBase') self.syncModelHint();
                // 地址 / Key / 模型任一改动，都可能让"当前配置"对不上任何档案
                if (key === 'model' || key === 'apiBase' || key === 'apiKey') {
                    self.syncProfileSelection();
                }
                if (['showOriginal', 'overlayTop', 'fontSize', 'bgOpacity',
                    'textColor', 'outline', 'offsetY'].includes(key)) {
                    Overlay.clear();
                    Overlay.last = null;
                    // 外观变了要重画，但画面本身没变 —— 只作废缩略图记录，
                    // 保留 lastSentThumb 免得为同一帧再买一次识别
                    Pipeline.lastThumb = null;
                    Pipeline.lastOriginal = '';
                }
                // 换了语言 / 模型 / 提示词后，缓存里的旧译文就不对了（最典型的是改了目标语言）
                if (['tgtLang', 'srcLang', 'model', 'apiBase', 'extraPrompt',
                    'engine', 'baiOcr', 'baiTrans', 'baiPivot', 'wtEngine'].includes(key)) {
                    cache.clear();
                    Pipeline.lastOriginal = '';
                    Pipeline.lastTranslation = '';
                    // 换了引擎 / 语言，同一帧也要重新识别一次（结果会不同），
                    // 所以这里必须连 lastSentThumb 一起清 —— 否则静止画面会一直跳过。
                    Pipeline.lastSentThumb = null;
                }
            };

            const bindInput = (key, el, cast) => {
                if (!el) return;                 // 控件不存在就跳过，别让一个 null 拖垮整个绑定
                el.addEventListener('change', () => {
                    CFG[key] = cast ? cast(el.value) : el.value;
                    // 只写这一个键：全量 saveCfg 要动 30+ 个存储项，而这里每次只改一项
                    saveCfgKeys(CFG, [key]);
                    onChangeEffects(key);
                });
            };

            // 滑块：拖动时即时预览，松开才落盘
            const bindRange = (key, el, labelEl, fmt, cast) => {
                if (!el) return;
                const apply = (save) => {
                    CFG[key] = cast(el.value);
                    if (labelEl) labelEl.textContent = fmt(CFG[key]);
                    Overlay.clear();
                    if (save) saveCfgKeys(CFG, [key]);
                };
                el.addEventListener('input', () => apply(false));
                el.addEventListener('change', () => apply(true));
            };

            bindInput('engine', e.engine);
            bindInput('apiBase', e.apiBase);
            bindInput('apiKey', e.apiKey);
            bindInput('model', e.model);
            bindInput('youdaoAppKey', e.youdaoAppKey);
            bindInput('youdaoAppSecret', e.youdaoAppSecret);
            bindInput('youdaoFrom', e.youdaoFrom);
            bindInput('youdaoTo', e.youdaoTo);
            bindInput('youdaoLLM', e.youdaoLLM, () => e.youdaoLLM.checked);
            bindInput('umiBase', e.umiBase);
            bindInput('umiLang', e.umiLang);
            bindInput('baiOcr', e.baiOcr);
            bindInput('baiTrans', e.baiTrans);
            bindInput('baiStream', e.baiStream, () => e.baiStream.checked);
            bindInput('baiPivot', e.baiPivot, () => e.baiPivot.checked);
            bindInput('wtEngine', e.wtEngine);
            bindInput('wtMinInterval', e.wtMinInterval, Number);
            bindInput('captureMode', e.captureMode);
            bindInput('srcLang', e.srcLang);
            bindInput('tgtLang', e.tgtLang);
            bindInput('interval', e.interval, Number);
            bindInput('extraPrompt', e.extraPrompt);
            bindInput('thinkingMode', e.thinkingMode);
            bindInput('maxTokens', e.maxTokens, Number);
            bindInput('smartSkip', e.smartSkip, () => e.smartSkip.checked);
            bindInput('pauseWhenHidden', e.pauseWhenHidden, () => e.pauseWhenHidden.checked);
            bindInput('showOriginal', e.showOriginal, () => e.showOriginal.checked);
            bindInput('overlayTop', e.overlayTop, () => e.overlayTop.checked);
            bindInput('outline', e.outline, () => e.outline.checked);
            bindInput('textColor', e.textColor);

            bindRange('fontSize', e.fontSize, e.fontVal, v => v + ' px', Number);
            bindRange('bgOpacity', e.bgOpacity, e.opacityVal, v => Math.round(v * 100) + '%', Number);
            bindRange('offsetY', e.offsetY, e.offsetVal, v => (v > 0 ? '+' : '') + v + ' px', Number);

            // 相似度阈值不在这两套里：它的展示格式和回写规则都不一样
            const applySim = (save) => {
                CFG.textSimThreshold = Number(e.sim.value);
                e.simVal.textContent = CFG.textSimThreshold.toFixed(2);
                if (save) saveCfgKeys(CFG, ['textSimThreshold']);
            };
            e.sim.addEventListener('input', () => applySim(false));
            e.sim.addEventListener('change', () => applySim(true));
        },

        /** 平台预设下拉：一键填地址和模型，顺带提示模型支不支持图片 */
        bindPresets() {
            const e = this.els;
            const self = this;

            API_PRESETS.forEach((p, i) => {
                const o = document.createElement('option');
                o.value = String(i);
                o.textContent = p.name;
                e.preset.appendChild(o);
            });
            e.preset.onchange = () => {
                const p = API_PRESETS[Number(e.preset.value)];
                if (!p || !p.base) { e.preset_note.textContent = ''; return; }
                CFG.apiBase = p.base;
                CFG.model = p.model;
                e.apiBase.value = p.base;
                e.model.value = p.model;

                // 选到不支持图片的模型时自动切到 Umi-OCR（本机识别），免得配好了却一直报错
                const noVision = isNoVisionModel(p.model);
                let msg;
                if (noVision && CFG.engine === 'openai-vision') {
                    CFG.engine = 'umi-ocr';
                    e.engine.value = 'umi-ocr';
                    msg = '⚠️ ' + p.note + ' → 已自动切到「Umi-OCR 本地识别」引擎';
                } else if (noVision) {
                    msg = '⚠️ ' + p.note;
                } else {
                    msg = '✅ 已填入地址和模型（支持图片输入），只差 API Key';
                    if (p.note) msg += '　' + p.note;
                }
                saveCfgKeys(CFG, ['apiBase', 'model', 'engine']);
                self.syncEngineUI();
                self.syncModelHint();
                self.syncProfileSelection();
                e.preset_note.textContent = msg;
                self.setStatus('已应用预设：' + p.name, 'ok');
            };
        },

        bindCaptureControls() {
            const e = this.els;
            const self = this;

            e.sharescreen.onclick = async () => {
                try {
                    self.setStatus('请在弹窗里选「此标签页」并点共享…', 'busy');
                    await Capturer.startDisplayCapture();
                    self.applyCaptureMode('display', '✅ 标签页捕获已启动');
                } catch (err) {
                    self.setStatus('共享授权失败：' + err.message, 'err');
                }
            };
            e.stopscreen.onclick = () => {
                Capturer.stopDisplayCapture();
                self.applyCaptureMode('auto', '已停止共享，回到直接读视频模式');
            };
        },

        /** 配置导出 / 导入，以及恢复被禁用的网站 */
        bindConfigIO() {
            const e = this.els;
            const self = this;

            e.export.onclick = () => self.exportCfg();
            e.import.onclick = () => self.importCfg();

            e.unban.onclick = () => {
                const list = Array.isArray(CFG.disabledHosts) ? CFG.disabledHosts : [];
                if (!list.length) {
                    self.setStatus('没有被禁用的网站', 'warn');
                    return;
                }
                if (!confirm('清空禁用列表？以下网站会重新显示面板：\n\n' + list.join('\n'))) return;
                CFG.disabledHosts = [];
                saveCfgKeys(CFG, ['disabledHosts']);
                self.renderBanInfo();
                self.setStatus('✅ 已清空禁用列表（共 ' + list.length + ' 个网站）', 'ok');
            };
        },

        bindTools() {
            const e = this.els;
            const self = this;

            e.diag.onclick = () => Diag.open();
            e.test.onclick = () => self.testApi();
            e.shot.onclick = () => self.manualShot();

            e.reset.onclick = () => {
                if (!confirm('恢复所有设置为默认值？\n（API Key / 有道密钥 / 本站框选区域都会被清空）')) return;
                for (const k in DEFAULTS) {
                    const dv = cloneDefault(DEFAULTS[k]);   // 必须拷贝，否则会连默认值一起改掉
                    try { GM_setValue(NS + k, dv); } catch (err) { }
                    CFG[k] = dv;
                }
                self.loadToUI();
                self.syncRegion();
                self.syncCaptureUI();
                self.setStatus('已恢复默认', 'ok');
            };

            e.clearcache.onclick = () => {
                cache.clear();
                self.setStatus('翻译缓存已清空', 'ok');
            };
        },

        /** 窗口尺寸变化时重新定位字幕。
         *  拖窗口时 resize 连发几十次，而 reposition 要读 offsetWidth 触发同步重排，
         *  所以用 rAF 合并成每帧最多一次；存到 this 上是为了 destroy() 时能摘掉。 */
        bindViewport() {
            let resizeRaf = 0;
            this._onResize = () => {
                if (resizeRaf) return;
                resizeRaf = requestAnimationFrame(() => {
                    resizeRaf = 0;
                    Overlay.reposition();
                });
            };
            window.addEventListener('resize', this._onResize);
        },

        /** 切换截图方式并同步相关 UI。「申请共享授权」「停止共享」「画布被污染自动切换」
         *  三处的写配置 → 落盘 → 刷新控件 → 刷新提示是同一段流程，收在这里。 */
        applyCaptureMode(mode, statusMsg, statusKind) {
            CFG.captureMode = mode;
            saveCfgKeys(CFG, ['captureMode']);
            this.loadToUI();
            this.syncCaptureUI();
            if (statusMsg) this.setStatus(statusMsg, statusKind || 'ok');
        },

        syncCaptureUI() {
            const h = this.els.capture_hint;
            if (!h) return;
            if (Capturer.mode === 'display') {
                h.textContent = '当前：🎬 标签页捕获（即使视频跨域也能用；注意译文框别压住字幕区，否则会被一起截进去）';
                h.style.color = '#4ade80';
            } else {
                h.textContent = '当前：📺 直接读视频元素（最快、无需授权；若视频跨域会提示切换）';
                h.style.color = '#5c6478';
            }
        },

        /** 模型名提示：手动输入也能检查出「不支持图片」 */
        syncModelHint() {
            const el = this.els.model_hint;
            if (!el) return;
            const model = (CFG.model || '').trim();
            const isDS = /deepseek/i.test(CFG.apiBase || '');

            if (!model) {
                el.textContent = isDS ? 'DeepSeek 请填 deepseek-flash（支持图片）' : '';
                el.style.color = '#fbbf24';
                return;
            }
            if (isNoVisionModel(model)) {
                el.textContent = '⚠️ ' + model + ' 不支持图片输入 —— 视觉引擎会报错。'
                    + '请改用支持图片的模型，或把引擎切成「Umi-OCR 本地识别」。';
                el.style.color = '#f87171';
                return;
            }
            if (isDS && isStaleDeepSeekModel(model)) {
                el.textContent = '⚠️ DeepSeek 这边只有 deepseek-flash 支持图片输入，'
                    + '建议把模型改成 deepseek-flash。';
                el.style.color = '#fbbf24';
                return;
            }
            if (isDS && DS_VISION_MODELS.indexOf(model.trim().toLowerCase()) >= 0) {
                el.textContent = '✅ ' + model + ' 支持图片输入，可用于视觉引擎。';
                el.style.color = '#4ade80';
                return;
            }
            el.textContent = '';
        },

        syncThinkingUI() {
            const el = this.els.thinking_hint;
            if (!el) return;
            const mode = CFG.thinkingMode || 'auto';
            if (shouldDisableThinking()) {
                el.textContent = '✅ 会发送「关闭思考模式」参数 —— 字幕 OCR 不需要思维链，这样更快更省，'
                    + '也不会出现「只返回推理、没有正文」。';
                el.style.color = '#4ade80';
            } else if (mode === 'on') {
                el.textContent = '⚠️ 思考模式可能开着。思维链会先吃掉一大段输出预算，'
                    + '若报「只返回推理没有正文」，请改成「自动」或把最大输出调大。';
                el.style.color = '#fbbf24';
            } else {
                el.textContent = '不会发送思考模式参数（非 DeepSeek 接口一般没这个开关）。';
                el.style.color = '#5c6478';
            }
        },

        renderBanInfo() {
            const el = this.els.ban_info;
            if (!el) return;
            const list = Array.isArray(CFG.disabledHosts) ? CFG.disabledHosts : [];
            if (!list.length) {
                el.textContent = '当前没有禁用任何网站';
                el.style.color = '#5c6478';
            } else {
                el.textContent = '已禁用 ' + list.length + ' 个网站：'
                    + list.slice(0, 4).join('、') + (list.length > 4 ? ' 等' : '');
                el.style.color = '#fbbf24';
            }
        },

        exportCfg() {
            const out = {};
            for (const k in DEFAULTS) out[k] = CFG[k];
            delete out.regionsByHost;   // 各站的页面坐标，换机器没意义，导出时去掉更干净
            const txt = JSON.stringify(out, null, 2);

            const ui = openModal({
                title: '导出配置（含 API Key，别随便分享）',
                closeId: 'h1sub-exp-close',
                buttons: [{ id: 'h1sub-exp-copy', label: '复制' }],
                body: '<textarea id="h1sub-exp-ta" readonly style="width:100%;height:300px;background:#0f1116;'
                    + 'color:#cbd5e1;border:1px solid #2c313a;border-radius:6px;padding:8px;'
                    + 'font:11px/1.5 Consolas,monospace;box-sizing:border-box"></textarea>',
            });

            const ta = ui.$('#h1sub-exp-ta');
            ta.value = txt;
            ui.$('#h1sub-exp-copy').onclick = async () => {
                ta.removeAttribute('readonly'); ta.select();
                let ok = false;
                try { ok = document.execCommand('copy'); } catch (e) { }
                ta.setAttribute('readonly', 'readonly');
                if (!ok) { try { await navigator.clipboard.writeText(txt); ok = true; } catch (e) { } }
                this.setStatus(ok ? '✅ 配置已复制' : '请手动全选复制', ok ? 'ok' : 'warn');
            };
        },

        importCfg() {
            const ui = openModal({
                title: '导入配置 —— 粘贴之前导出的 JSON',
                closeId: 'h1sub-imp-close',
                buttons: [{ id: 'h1sub-imp-ok', label: '导入' }],
                body: '<textarea id="h1sub-imp-ta" placeholder=\'{"engine":"openai-vision", ...}\' '
                    + 'style="width:100%;height:300px;background:#0f1116;color:#cbd5e1;'
                    + 'border:1px solid #2c313a;border-radius:6px;padding:8px;'
                    + 'font:11px/1.5 Consolas,monospace;box-sizing:border-box"></textarea>'
                    + '<div id="h1sub-imp-msg" style="margin-top:6px;color:#8b93a7"></div>',
            });
            const close = ui.close;
            ui.$('#h1sub-imp-ok').onclick = () => {
                const msg = ui.$('#h1sub-imp-msg');
                let obj;
                try {
                    obj = JSON.parse(ui.$('#h1sub-imp-ta').value);
                } catch (e) {
                    msg.textContent = '❌ JSON 解析失败：' + e.message;
                    msg.style.color = '#f87171';
                    return;
                }
                if (!obj || typeof obj !== 'object') {
                    msg.textContent = '❌ 内容不是一个配置对象';
                    msg.style.color = '#f87171';
                    return;
                }
                let n = 0;
                for (const k in DEFAULTS) {
                    if (k in obj) {
                        CFG[k] = obj[k];
                        n++;
                    }
                }
                // 外部粘进来的 JSON 是不可信输入：类型、区间、引擎名都要兜住，
                // 尤其是 fontSize —— 它会被直接拼进 innerHTML
                sanitizeCfg(CFG);
                saveCfg(CFG);
                this.loadToUI();
                this.syncRegion();
                this.syncCaptureUI();
                this.renderBanInfo();
                this.setStatus('✅ 已导入 ' + n + ' 项配置', 'ok');
                close();
            };
        },

        syncEngineUI() {
            const eng = CFG.engine;
            const isBai = eng === 'browser-ai';
            const isWt = eng === 'web-translate';
            // 有道引擎不需要 OpenAI 的地址 / Key / 模型；Umi-OCR / 免费网页接口只用它做识别，
            // 仍要靠 OpenAI 配置出译文；浏览器内置 AI 连翻译都在本机做，API 配置区一并藏掉。
            this.els.openai.style.display = (eng === 'youdao-img' || isBai || isWt) ? 'none' : 'block';
            this.els.youdao.style.display = eng === 'youdao-img' ? 'block' : 'none';
            this.els.browserai.style.display = isBai ? 'block' : 'none';
            this.els.webtranslate.style.display = isWt ? 'block' : 'none';
            // 这三类都要用 Umi-OCR 的地址 / 语言控件：umi-ocr、免费网页接口、离线引擎选「Umi-OCR 识别」
            const needUmi = eng === 'umi-ocr' || isWt || (isBai && CFG.baiOcr !== 'builtin');
            this.els.umionly.style.display = needUmi ? 'block' : 'none';
            if (isBai) this.renderBaiVersion();
        },

        /** 把内核版本门槛的结果贴在面板上。用独立的 #h1sub-bai-ver，不去动 #h1sub-bai-status ——
         *  后者要留给「检测 / 准备」的输出，不能一改配置就被冲掉。 */
        renderBaiVersion() {
            const el = this.els.bai_ver;
            if (!el) return;
            const b = baiBrowser();
            const note = baiVersionNote();
            if (note) {
                el.textContent = note;
                el.style.color = '#fbbf24';
            } else {
                el.textContent = '✅ 浏览器内核：' + b.text + '（满足 ' + b.required + '）';
                el.style.color = '#4ade80';
            }
        },

        // ── 多套 API 配置档案 ──────────────────────────────────
        //  存的是「地址 + Key + 模型 + 思考模式 + 最大 token」整套，换供应商不用再翻控制台找 Key。

        /** 重建配置下拉框；selectName 指定重建后选中哪一项 */
        renderProfiles(selectName) {
            const sel = this.els.profile;
            if (!sel) return;
            if (!Array.isArray(CFG.apiProfiles)) CFG.apiProfiles = [];

            setHTML(sel, '');
            const ph = document.createElement('option');
            ph.value = '';
            ph.textContent = CFG.apiProfiles.length
                ? '— 点这里切换我的配置 —'
                : '（还没有保存的配置）';
            sel.appendChild(ph);

            for (const p of CFG.apiProfiles) {
                const o = document.createElement('option');
                o.value = p.name;
                o.textContent = p.name + (p.model ? '（' + p.model + '）' : '');
                sel.appendChild(o);
            }

            if (selectName !== undefined) {
                sel.value = CFG.apiProfiles.some(p => p.name === selectName) ? selectName : '';
            } else {
                this.syncProfileSelection();
            }
        },

        /** 让下拉框反映「当前生效的配置」。手动改了地址 / Key / 模型就对不上任何档案了，
         *  这时回到占位项，表示"当前是未保存的改动" —— 比留着一个对不上的名字诚实。 */
        syncProfileSelection() {
            const sel = this.els.profile;
            if (!sel || !Array.isArray(CFG.apiProfiles)) return;
            const hit = CFG.apiProfiles.find(p =>
                (p.apiBase || '') === (CFG.apiBase || '')
                && (p.apiKey || '') === (CFG.apiKey || '')
                && (p.model || '') === (CFG.model || ''));
            sel.value = hit ? hit.name : '';
        },

        /** 把当前配置存成（或覆盖）一个命名档案。返回存下的记录。 */
        upsertProfile(name) {
            const clean = String(name == null ? '' : name).trim();
            if (!clean) return null;
            if (!Array.isArray(CFG.apiProfiles)) CFG.apiProfiles = [];

            const rec = {
                name: clean,
                apiBase: CFG.apiBase || '',
                apiKey: CFG.apiKey || '',
                model: CFG.model || '',
                thinkingMode: CFG.thinkingMode,
                maxTokens: CFG.maxTokens,
            };
            // 同名直接覆盖，免得列表里堆出一串重复项
            CFG.apiProfiles = CFG.apiProfiles.filter(p => p.name !== clean);
            CFG.apiProfiles.push(rec);
            saveCfgKeys(CFG, ['apiProfiles']);
            this.renderProfiles(clean);
            return rec;
        },

        applyProfile(name) {
            const p = (CFG.apiProfiles || []).find(x => x.name === name);
            if (!p) return false;

            CFG.apiBase = p.apiBase || '';
            CFG.apiKey = p.apiKey || '';
            CFG.model = p.model || '';
            if (p.thinkingMode) CFG.thinkingMode = p.thinkingMode;
            if (p.maxTokens) CFG.maxTokens = p.maxTokens;

            const e = this.els;
            e.apiBase.value = CFG.apiBase;
            e.apiKey.value = CFG.apiKey;
            e.model.value = CFG.model;
            if (e.thinkingMode) e.thinkingMode.value = CFG.thinkingMode;
            if (e.maxTokens) e.maxTokens.value = CFG.maxTokens;

            saveCfgKeys(CFG, ['apiBase', 'apiKey', 'model', 'thinkingMode', 'maxTokens']);
            this.syncModelHint();
            this.syncThinkingUI();
            this.syncEngineUI();
            this.renderProfiles(name);
            this.setStatus('已切换到配置「' + name + '」', 'ok');
            return true;
        },

        /** 删除一个配置档案（点两次才真的删，避免误触丢掉 Key） */
        deleteProfile(name, ev) {
            const target = name || (this.els.profile && this.els.profile.value);
            if (!target) {
                this.setStatus('先在下拉框里选一个要删除的配置', 'warn');
                this._delArm = null;
                return false;
            }

            const btn = this.els.profile_del;
            if (this._delArm !== target) {
                this._delArm = target;
                if (btn) btn.textContent = '再点一次删除';
                this.setStatus('再点一次「删除」就真的删掉「' + target + '」（含保存的 API Key）', 'warn');
                clearTimeout(this._delTimer);
                this._delTimer = setTimeout(() => {
                    this._delArm = null;
                    if (btn) btn.textContent = '删除';
                }, 4000);
                return false;
            }

            this._delArm = null;
            clearTimeout(this._delTimer);
            if (btn) btn.textContent = '删除';
            CFG.apiProfiles = (CFG.apiProfiles || []).filter(p => p.name !== target);
            saveCfgKeys(CFG, ['apiProfiles']);
            this.renderProfiles();
            this.setStatus('已删除配置「' + target + '」', 'ok');
            return true;
        },

        askProfileName(defaultName) {
            return new Promise(resolve => {
                const m = document.createElement('div');
                m.style.cssText = 'position:fixed;inset:0;z-index:2147483642;background:rgba(0,0,0,.75);'
                    + 'display:flex;align-items:center;justify-content:center';
                setHTML(m, '<div class="h1sub-modal" style="background:#15171c;color:#e6e8ee;'
                    + 'border:1px solid #2c313a;border-radius:10px;width:min(420px,92vw);'
                    + 'padding:16px;font:12px sans-serif">'
                    + '<b style="font-size:13px">保存当前 API 配置</b>'
                    + '<div style="color:#8b93a7;margin:6px 0 10px">'
                    + '给这套配置起个名字，以后在下拉框里一键切换。</div>'
                    + '<input id="h1sub-pn-input" style="width:100%;background:#0f1116;'
                    + 'border:1px solid #2c313a;border-radius:5px;color:#e6e8ee;padding:6px 8px;'
                    + 'font:12px inherit;box-sizing:border-box;outline:none">'
                    + '<div id="h1sub-pn-msg" style="color:#f87171;min-height:16px;margin-top:6px"></div>'
                    + '<div style="display:flex;gap:8px;justify-content:flex-end">'
                    + '<button id="h1sub-pn-cancel">取消</button>'
                    + '<button id="h1sub-pn-ok" style="background:#0e7490;border-color:#22d3ee">保存</button>'
                    + '</div></div>');
                document.body.appendChild(m);

                const input = m.querySelector('#h1sub-pn-input');
                const msg = m.querySelector('#h1sub-pn-msg');
                input.value = defaultName || '';
                input.focus();
                input.select();

                const done = (v) => { m.remove(); resolve(v); };
                m.querySelector('#h1sub-pn-cancel').onclick = () => done(null);
                m.querySelector('#h1sub-pn-ok').onclick = () => {
                    const v = input.value.trim();
                    if (!v) { msg.textContent = '名字不能为空'; return; }
                    done(v);
                };
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') { ev.preventDefault(); m.querySelector('#h1sub-pn-ok').click(); }
                    if (ev.key === 'Escape') done(null);
                });
            });
        },

        async saveProfile() {
            if (!CFG.apiBase && !CFG.model) {
                this.setStatus('先把 API 地址和模型填好，再保存', 'warn');
                return null;
            }
            let def = CFG.model || '配置';
            try {
                const host = new URL(CFG.apiBase).host.replace(/^api\./, '');
                if (host) def = host.split('.')[0] + ' · ' + (CFG.model || '配置');
            } catch (e) { /* 地址还没填完整就用模型名兜底 */ }

            const name = await this.askProfileName(def);
            if (!name) return null;

            const rec = this.upsertProfile(name);
            if (rec) this.setStatus('✅ 已保存配置「' + name + '」', 'ok');
            return rec;
        },

        // ── Umi-OCR（本机离线识别）────────────────────────────

        fillUmiLangs() {
            const sel = this.els.umiLang;
            if (!sel || sel.options.length) return;
            for (const l of UMI_LANGS) {
                const o = document.createElement('option');
                o.value = l.code;
                o.textContent = l.name;
                sel.appendChild(o);
            }
            // 也允许使用接口返回的其它语言
            if (CFG.umiLang && !UMI_LANGS.some(l => l.code === CFG.umiLang)) {
                const o = document.createElement('option');
                o.value = CFG.umiLang;
                o.textContent = CFG.umiLang;
                sel.appendChild(o);
            }
        },

        setUmiStatus(text, color) {
            const el = this.els.umi_status;
            if (el) { el.textContent = text; el.style.color = color || '#aeb4c4'; }
        },

        async testUmi() {
            const btn = this.els.umi_test;
            if (btn) btn.disabled = true;
            this.setUmiStatus('⏳ 正在连接 ' + umiBase() + ' …', '#22d3ee');
            this.setStatus('正在测试 Umi-OCR 连接…', 'busy');
            try {
                const opt = await umiProbe();
                const langs = (opt['ocr.language'] && opt['ocr.language'].optionsList)
                    ? opt['ocr.language'].optionsList.map(x => x[1]).join('、')
                    : '';

                // 光接口活着不算数，真识别一张小图确认引擎能出结果
                let probe = '';
                try {
                    const c = document.createElement('canvas');
                    c.width = 320; c.height = 80;
                    const g = c.getContext('2d');
                    g.fillStyle = '#000'; g.fillRect(0, 0, 320, 80);
                    g.fillStyle = '#fff';
                    g.font = 'bold 44px Arial, sans-serif';
                    g.textBaseline = 'middle';
                    g.fillText('TEST 123', 14, 42);
                    const t0 = Date.now();
                    const got = await callUmiOCR(c.toDataURL('image/png'));
                    probe = '\n试跑识别「TEST 123」→ 得到「' + (got || '(空)') + '」，耗时 '
                        + (Date.now() - t0) + 'ms';
                } catch (e2) {
                    probe = '\n试跑识别失败：' + e2.message;
                }

                this.setUmiStatus('✅ 连接成功！' + probe
                    + (langs ? '\n可用语言：' + langs : ''), '#4ade80');
                this.setStatus('✅ Umi-OCR 可用', 'ok');
            } catch (e) {
                this.setUmiStatus('❌ ' + e.message, '#f87171');
                this.setStatus('Umi-OCR 连接失败', 'err');
            } finally {
                if (btn) btn.disabled = false;
            }
        },

        // ── 控件 ⇄ 配置同步 ─────────────────────────────────

        /** 把 CFG 的当前值一次性刷到所有控件上（挂载后、切模式后调用） */
        loadToUI() {
            const e = this.els;
            e.engine.value = CFG.engine;
            e.apiBase.value = CFG.apiBase;
            e.apiKey.value = CFG.apiKey;
            e.model.value = CFG.model;
            e.youdaoAppKey.value = CFG.youdaoAppKey;
            e.youdaoAppSecret.value = CFG.youdaoAppSecret;
            e.youdaoFrom.value = CFG.youdaoFrom;
            e.youdaoTo.value = CFG.youdaoTo;
            e.youdaoLLM.checked = !!CFG.youdaoLLM;
            this.renderProfiles();
            this.fillUmiLangs();
            e.umiBase.value = CFG.umiBase;
            e.umiLang.value = CFG.umiLang;
            e.baiOcr.value = CFG.baiOcr || 'umi';
            e.baiTrans.value = CFG.baiTrans || 'auto';
            e.baiStream.checked = !!CFG.baiStream;
            e.baiPivot.checked = !!CFG.baiPivot;
            e.wtEngine.value = CFG.wtEngine || 'auto';
            e.wtMinInterval.value = CFG.wtMinInterval;
            e.srcLang.value = CFG.srcLang;
            e.tgtLang.value = CFG.tgtLang;
            e.interval.value = CFG.interval;
            e.smartSkip.checked = !!CFG.smartSkip;
            e.pauseWhenHidden.checked = !!CFG.pauseWhenHidden;
            e.sim.value = CFG.textSimThreshold;
            e.simVal.textContent = Number(CFG.textSimThreshold).toFixed(2);
            e.captureMode.value = CFG.captureMode || 'auto';

            e.fontSize.value = CFG.fontSize;
            e.fontVal.textContent = Number(CFG.fontSize) + ' px';
            e.bgOpacity.value = CFG.bgOpacity;
            e.opacityVal.textContent = Math.round(Number(CFG.bgOpacity) * 100) + '%';
            e.offsetY.value = CFG.offsetY;
            e.offsetVal.textContent = (CFG.offsetY > 0 ? '+' : '') + Number(CFG.offsetY) + ' px';
            e.textColor.value = CFG.textColor || '#ffffff';
            e.outline.checked = !!CFG.outline;

            e.showOriginal.checked = !!CFG.showOriginal;
            e.overlayTop.checked = !!CFG.overlayTop;
            e.extraPrompt.value = CFG.extraPrompt || '';
            e.host.textContent = location.hostname;
            e.host.title = location.href;
            this.syncEngineUI();
            this.syncCaptureUI();
            this.syncThinkingUI();
            this.syncModelHint();
            this.renderBanInfo();
            this.setBaiBar(null);
            this.setBaiStatus(CFG.engine === 'browser-ai'
                ? '点「① 检测浏览器 AI」看这台机器支不支持；首次使用还要点「② 准备离线模型」'
                : '', '#5c6478');
        },

        syncRegion() {
            const e = this.els;
            if (CFG.region) {
                const r = CFG.region;
                e.region_info.textContent = '区域：' + Math.round(r.w) + '×' + Math.round(r.h)
                    + ' @ (' + Math.round(r.x) + ',' + Math.round(r.y) + ')';
                e.region_info.style.color = '#4ade80';
                e.preview_wrap.style.display = 'block';
            } else {
                e.region_info.textContent = '区域：未设定';
                e.region_info.style.color = '#8b93a7';
                e.preview_wrap.style.display = 'none';
            }
        },

        setPreview(canvas) {
            const p = this.els.preview;
            if (!p) return;
            // 面板收成小胶囊 / 内容折叠起来时预览区根本看不见，每轮还缩放画一遍就是纯浪费
            if (this.pillMode || this.collapsed) return;
            if (this.root && this.root.style.display === 'none') return;
            if (p.width !== canvas.width || p.height !== canvas.height) {
                p.width = canvas.width;
                p.height = canvas.height;
            }
            p.getContext('2d').drawImage(canvas, 0, 0);
        },

        setEdge(ed) {
            if (!this.els.stats) return;
            this.els.stats.dataset.edge = ed.toFixed(3);
            this.renderStats();
        },

        renderStats() {
            const s = Pipeline.stats;
            const ed = this.els.stats.dataset.edge || '-';
            const txt = '截图 ' + s.shots + ' · API ' + s.apiCalls
                + ' · 跳过 ' + s.skipped + ' · 错误 ' + s.errors + ' · 边缘 ' + ed;
            // ⚡ 优化：统计内容只在计数变化时才变，而 setStatus 每帧都会调到这里，
            //    内容一样就不写 textContent（省掉一次 DOM 写入与随之而来的重排）
            if (txt === this._statsText) return;
            this._statsText = txt;
            this.els.stats.textContent = txt;
        },

        setStatus(msg, kind) {
            const el = this.els.status;
            if (!el) return;
            // ⚡ 优化：状态栏每帧都被 Pipeline 设置（运行中…→识别中…→已翻译…），
            //    同一状态反复设置时跳过 textContent / style.color 写入；指纹 = kind + 文案（文案同、颜色变仍更新）。
            const key = (kind || 'idle') + '\u0000' + msg;
            if (key !== this._statusKey) {
                this._statusKey = key;
                el.textContent = msg;
                el.style.color = STATUS_COLORS[kind] || STATUS_COLORS.idle;
            }
            const dot = this.els.dot;
            if (dot) {
                const bg = Pipeline.running ? '#4ade80' : '#666';
                // ⚡ 优化：记一份上次写进去的值再比较。不能直接比较
                //    dot.style.background：CSSOM 会把 #4ade80 规范化成 "rgb(74, 222, 128)"，永不相等
                if (this._dotBg !== bg) {
                    this._dotBg = bg;
                    dot.style.background = bg;
                }
            }
            this.renderStats();
        },

        setRunning(on) {
            const b = this.els.run;
            if (!b) return;
            b.textContent = on ? '停止' : '开始';
            b.classList.toggle('on', on);
            if (this.els.dot) {
                const bg = on ? '#4ade80' : '#666';
                this._dotBg = bg;   // ⚡ 优化：同步指纹，免得 setStatus 又白写一次
                this.els.dot.style.background = bg;
            }
        },

        pushHistory(o, t) {
            const el = this.els.hist;
            if (!el) return;
            const div = document.createElement('div');
            div.style.cssText = 'padding:4px 0;border-bottom:1px solid #23272f';
            // 注意：原来是把译文那段拼到 setHTML 的返回值上（返回值被丢弃），历史记录里一直只有原文
            setHTML(div,
                '<div style="color:#6b7280">' + escapeHtml(o) + '</div>'
                + '<div style="color:#e6e8ee">' + escapeHtml(t) + '</div>');
            el.insertBefore(div, el.firstChild);
            while (el.childElementCount > HIST_MAX) el.removeChild(el.lastChild);
        },

        async testApi() {
            this.setStatus('正在测试…', 'busy');
            try {
                if (CFG.engine === 'youdao-img') {
                    // 临时生成一张带文字的小图，用来验证「签名 + 接口 + 识别」全链路
                    const c = document.createElement('canvas');
                    c.width = 360; c.height = 90;
                    const x = c.getContext('2d');
                    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 360, 90);
                    x.fillStyle = '#000000';
                    x.font = 'bold 44px sans-serif';
                    x.fillText('Hello', 20, 62);
                    const r = await callYoudaoImage(c.toDataURL('image/jpeg', 0.9));
                    if (r.translation) {
                        this.setStatus('有道接口正常，识别译文：' + r.translation.slice(0, 30), 'ok');
                    } else {
                        this.setStatus('有道接口通了（签名正确），但测试图没识别出文字', 'warn');
                    }
                    return;
                }
                const r = await callChat({
                    model: CFG.model,
                    max_tokens: 20,
                    messages: [{ role: 'user', content: '回复两个字：正常' }],
                });
                this.setStatus('API 正常，模型返回：' + r.slice(0, 40), 'ok');
            } catch (e) {
                this.setStatus('API 测试失败：' + e.message, 'err');
            }
        },

        async manualShot() {
            if (!CFG.region) { this.setStatus('请先框选区域', 'warn'); return; }
            this.setStatus('正在截取一帧…', 'busy');
            try {
                const c = Capturer.grab(CFG.region);
                if (!c) { this.setStatus('截图失败（找不到视频？）', 'err'); return; }
                this.setPreview(c);
                this.setStatus('正在识别…', 'busy');
                const t0 = performance.now();
                const res = await recognizeAndTranslate(c);
                const dt = Math.round(performance.now() - t0);
                if (!res.original && !res.translation) {
                    this.setStatus('这一帧没有识别到字幕（' + dt + 'ms）', 'warn');
                    return;
                }
                Overlay.show(res.original, res.translation);
                this.pushHistory(res.original, res.translation);
                this.setStatus('成功（' + dt + 'ms）', 'ok');
            } catch (e) {
                if (e.code === 'TAINTED') {
                    this.setStatus('视频跨域，画布被污染 —— 请把「截图方式」改成「标签页捕获」并点「申请共享授权」', 'warn');
                } else if (e.code === 'NO_DISPLAY') {
                    this.setStatus('还没授权标签页共享 —— 请点「申请共享授权」', 'warn');
                } else {
                    this.setStatus('失败：' + e.message, 'err');
                }
            }
        },
    };
