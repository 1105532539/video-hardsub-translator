    // ═══════════════════════════════════════════════════════════════
    //  98-boot.js — 启动装配
    //
    //  isConfigured() 决定首次运行要不要把使用说明摊开；
    //  boot() 判断本站是否被禁用、当前在不在 iframe 里，再决定挂面板还是收成小胶囊；
    //  mountUI() 真正装配面板、暴露 window.__H1SUB__ 测试钩子、注册油猴菜单，
    //  并挂上"视频后加载"与"SPA 换页"两个监听。
    //
    //  对外提供：isConfigured、boot、mountUI
    //  依赖：* —— 本模块末尾的 window.__H1SUB__ 调试钩子从每个模块重导出上百个
    //              名字（它是刻意的测试 / 诊断接口，见 docs/API.md「内部 JS API」），
    //              逐个列举既无意义也没人维护，所以声明为通配；build.mjs 认得它。
    //              除此之外真正用到的是：CFG、saveCfgKeys、log、warn、isHostDisabled、
    //              syncRegionForHost、Fullscreen、isTopFrame、findVideo、watchForVideo、
    //              UI、RegionSelector、Pipeline、Overlay、SCRIPT_VERSION、Capturer、
    //              Diag、banCurrentHost、baiSupport、invalidateFindVideoCache
    // ═══════════════════════════════════════════════════════════════
    function isConfigured() {
        // 浏览器内置 AI 不要 Key，但得有这个能力；没有就别装作配好了
        if (CFG.engine === 'browser-ai') {
            const s = baiSupport();
            return !!(s.translator || s.lm);
        }
        // 免费网页接口同样不要 Key（识别靠本机 Umi-OCR，装没装是另一回事）
        if (CFG.engine === 'web-translate') return true;
        if (CFG.engine === 'youdao-img') return !!(CFG.youdaoAppKey && CFG.youdaoAppSecret);
        return !!CFG.apiKey;
    }

    function boot() {
        // ① 本站被用户禁用 → 什么都不做
        if (isHostDisabled()) {
            log('本站（' + location.hostname + '）已在禁用列表中，脚本不介入');
            return;
        }

        // ② 换了网站，先恢复本站的框选区域（页面坐标跨站没有意义）
        syncRegionForHost();

        // ③ 全屏时浏览器只渲染全屏元素及其子树，得把 UI 搬进去 —— 见 Fullscreen
        Fullscreen.init();

        const top = isTopFrame();

        // ③ iframe：只有真的出现「像样的视频」才挂面板（否则每个广告 / 统计 iframe 都会长出一个）。
        if (!top && !findVideo()) {
            watchForVideo(() => {
                log('在嵌入的播放器里找到视频');
                mountUI();
                UI.setStatus('✅ 在页面内嵌播放器里找到了视频，可以开始', 'ok');
            });
            return;
        }

        mountUI();
    }

    function mountUI() {
        if (UI.root) return;          // 已经挂过了
        UI.mount();
        log('面板已加载。配置 API 后点「框选字幕区」，再点「开始」。');

        if (!isConfigured()) {
            // 把使用说明摊开：面板是收起的，用户点开胶囊时应该直接看到怎么配，
            // 而不是一个空面板。（面板本身默认收起，见本函数末尾那段判定）
            if (UI.collapsed) {
                UI.collapsed = false;
                UI.els.body.style.display = 'block';
                UI.els.collapse.textContent = '—';
            }
            const help = UI.root.querySelector('#h1sub-help');
            if (help) help.open = true;
            UI.setStatus(CFG.onboarded
                ? '⚠️ 还没配置密钥 —— 点右下角胶囊展开面板，选「快捷预设」→ 填 API Key'
                : '👋 第一次用：点右下角的胶囊展开面板，里面「❓ 使用说明」几步就能跑起来', 'warn');
            CFG.onboarded = true;
            saveCfgKeys(CFG, ['onboarded']);
        }

        // 打开页面时面板是展开还是收成小胶囊：
        //   没视频 → 一律收起（大面板挡在没视频的页面上没有意义）
        //   有视频 → 按用户上次的选择（CFG.panelOpen，**默认收起**）
        // 注意这里**不写盘** —— 开机时只读取选择，只有用户主动点开关才 rememberPanelOpen()。
        if (!findVideo() || !CFG.panelOpen) UI.enterPillMode();
        else UI.leavePillMode();

        // ── 调试 / 测试钩子：暴露内部对象供自动化测试与诊断报告只读使用，不影响正常运行 ──
        try {
            window.__H1SUB__ = {
                version: SCRIPT_VERSION,
                CFG, Pipeline, Capturer, Overlay, UI, RegionSelector, Diag, DEFAULTS,
                recognizeAndTranslate, callYoudaoImage, translateByVision, translateText,
                callChat, callChatCore, apiUrl, buildChatBody, shouldDisableThinking, extractContent,
                isNoVisionModel, isStaleDeepSeekModel, NO_VISION_MODELS, DS_VISION_MODELS,
                callUmiOCR, umiProbe, recognizeByUmi, UMI_LANGS, umiBase,
                BAI_OCR_MODES, BAI_TRANS_MODES, BAI_AVAIL_TEXT, BAI_MIN_VERSION,
                baiBrowser, baiVersionNote,
                baiSupport, baiApi, baiPair, langCode, baiFrameNote, baiAvailability,
                baiAvailText, baiProbe, baiPrepare, baiReset, baiJoinChunk,
                baiTranslate, baiOcrByBuiltin, baiOcrSession, baiCanvasBlob, recognizeByBrowserAI,
                baiBrokenPairs, baiPairKey, baiMayPivot, baiIsPairFailure,
                baiCollapseRepeat, baiPolish,
                WT_ENGINES, WT_DEFAULT_ORDER, WT_ENGINE_CHOICES, wtStats, wtOrder,
                wtLangPair, wtTranslate, wtSelftest, wtReset, recognizeByWebTranslate,
                renderProfiles: (n) => UI.renderProfiles(n),
                syncProfileSelection: () => UI.syncProfileSelection(),
                upsertProfile: (n) => UI.upsertProfile(n),
                applyProfile: (n) => UI.applyProfile(n),
                deleteProfile: (n) => UI.deleteProfile(n),
                saveProfile: () => UI.saveProfile(),
                testUmi: () => UI.testUmi(),
                sha256Hex, sha256HexJS, youdaoTruncate, uuidHex,
                TT_POLICY, setHTML, escapeHtml, hexToRgb, openModal,
                cacheGet, cachePut, panelHTML, panelCSS,
                textSimilarity, thumbnail, thumbDiff, edgeDensity, parseModelJson,
                classifyError,
                findVideo, getContentBox, resolveRegion, anchorRegion,
                sanitizeCfg, ENGINES, Fullscreen, uiHost, isHostDisabled, isTopFrame, watchForVideo,
                isConfigured, invalidateFindVideoCache,
                rememberRegion, syncRegionForHost,
                saveCfg: () => saveCfg(CFG),
                report: () => Diag.build(),
            };
            log('已暴露 window.__H1SUB__（供测试/诊断）');
        } catch (e) {
            warn('暴露调试钩子失败', e);
        }

                GM_registerMenuCommand('显示/隐藏 字幕翻译面板', () => {
            if (!UI.root) { mountUI(); UI.leavePillMode(); UI.rememberPanelOpen(true); return; }
            // 统一走胶囊模式，并记住这次选择（和点标题栏的 × / 点胶囊一致）
            if (UI.pillMode) { UI.leavePillMode(); UI.rememberPanelOpen(true); }
            else { UI.enterPillMode(); UI.rememberPanelOpen(false); }
        });
        GM_registerMenuCommand('框选字幕区域', () => RegionSelector.begin());
        GM_registerMenuCommand('开始/停止', () => Pipeline.toggle());
        GM_registerMenuCommand('在本站禁用（不再显示面板）', () => banCurrentHost());

        // 视频可能是后加载 / SPA 切页后才出现。
        // ⚠️ 这里**不再自动展开面板** —— 用户明确要的是「打开新页面默认收起」，
        //    所以视频出现时只更新状态栏，展开与否由用户点右下角的胶囊决定。
        watchForVideo(() => {
            log('已找到视频元素');
            UI.setStatus(UI.pillMode
                ? '✅ 已找到视频 —— 点右下角胶囊展开面板，点「开始」'
                : '✅ 已找到视频，可以开始', 'ok');
        });

        // 切到后台就暂停翻译：视频在后台标签页会继续播放，`video.paused` 是 false，
        // 主循环那道闸门拦不住 —— 会一直截图并调用付费接口，而没人看得到结果。
        // 这里只挂一个 document 级监听，不做任何轮询。
        document.addEventListener('visibilitychange', () => {
            if (!CFG.pauseWhenHidden) return;
            if (document.hidden) Pipeline.pauseForHidden();
            else Pipeline.resumeFromHidden();
        });

        // SPA 路由切换后重新看本站的区域要不要换。只比较 pathname + search：站点在播放过程中会改
        // hash（章节/时间戳跳转）和查询串（埋点、无限滚动），拿 href 比较会让字幕莫名其妙自己停掉。
        let lastHref = location.pathname + location.search;
        // 用 UI._hrefTimer 而不是 this._hrefTimer：mountUI 是普通函数，this 是 undefined，会抛掉整个挂载流程
        UI._hrefTimer = setInterval(() => {
            const now = location.pathname + location.search;
            if (now === lastHref) return;
            lastHref = now;
            log('页面地址变化，重新检查');
            Pipeline.stop();
            Pipeline.resetFrameState();
            Overlay.clear();
            invalidateFindVideoCache();   // ⚡ 优化：跳页了，findVideo 的缓存立刻作废
            UI.syncRegion();
        }, 1500);
    }

    if (document.body) boot();
    else window.addEventListener('DOMContentLoaded', boot);
