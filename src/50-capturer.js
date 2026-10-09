    // ═══════════════════════════════════════════════════════════════
    //  50-capturer.js — 截图器：element / display 两种捕获方式
    //
    //  element 模式直接读 <video> 的画面，最快、无需授权；
    //  跨域 CDN 未发 CORS 头时画布会被污染，此时抛 TAINTED 由主循环切到 display 模式。
    //  display 模式用 getDisplayMedia 捕获标签页，一定能拿到像素，但要用户授权一次。
    //
    //  对外提供：Capturer
    //  依赖：CFG、findVideo、getContentBox、resolveRegion、UI、log、warn
    // ═══════════════════════════════════════════════════════════════
    const Capturer = {
        mode: 'element',        // 当前实际使用的模式
        displayStream: null,
        displayVideo: null,
        // 截图输出画布（crop 的产物）复用同一个：原来每截一帧就新建 canvas + 2d context
        // + 整块像素后备存储（1400×116 约 650KB），而调用方都是「拿到立刻用掉」，没人跨周期持有。
        _out: null,
        _outCtx: null,

        /** 从 <video> 元素直接截图；画布被跨域污染时抛 'TAINTED'。 */
        grabFromElement(region, video) {
            video = video || findVideo();
            if (!video || !video.videoWidth) return null;

            const box = getContentBox(video);
            // 区域是按"框选时视频所在位置"存的比例，视频挪了要跟着挪；box 顺手传进去，省一次布局读取
            region = resolveRegion(region, video, box);

            // 区域和视频画面基本不重叠（滚动太多 / 换了播放器布局 / 老配置没带锚点）时，
            // 下面的 Math.max(0, …) 会把坐标硬夹到边上：截出无关画面、不报错、钱照扣 → 直接判掉。
            const ovW = Math.min(region.x + region.w, box.left + box.width)
                - Math.max(region.x, box.left);
            const ovH = Math.min(region.y + region.h, box.top + box.height)
                - Math.max(region.y, box.top);
            if (ovW < region.w * 0.5 || ovH < region.h * 0.5) return null;

            const fx = (region.x - box.left) / box.width;
            const fy = (region.y - box.top) / box.height;
            const fw = region.w / box.width;
            const fh = region.h / box.height;

            const vw = video.videoWidth, vh = video.videoHeight;
            const sx = Math.max(0, Math.round(fx * vw));
            const sy = Math.max(0, Math.round(fy * vh));
            const sw = Math.min(vw - sx, Math.round(fw * vw));
            const sh = Math.min(vh - sy, Math.round(fh * vh));

            const c = this.crop(video, sx, sy, sw, sh);
            if (!c) return null;

            try { c.getContext('2d').getImageData(0, 0, 1, 1); }
            catch (e) { const err = new Error('TAINTED'); err.code = 'TAINTED'; throw err; }

            return c;
        },

        async startDisplayCapture() {
            if (this.displayStream) return;

            // http 页面不是「安全上下文」，navigator.mediaDevices 直接是 undefined；原来这里一律报
            // "用户取消了授权"，用户会反复重试一个根本弹不出来的窗口。
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                throw new Error('当前页面不是 https，浏览器不允许截屏。'
                    + '请改用「直接读取视频元素」模式，或把脚本切到 https 页面上用');
            }

            let stream;
            try {
                stream = await navigator.mediaDevices.getDisplayMedia({
                    video: { frameRate: 30 },
                    audio: false,
                    preferCurrentTab: true,
                    selfBrowserSurface: 'include',
                });
            } catch (e) {
                // 区分"用户拒绝"和"参数不被支持"——后者换掉扩展选项重试一次
                if (e && e.name === 'NotAllowedError') {
                    throw new Error('你拒绝了屏幕共享授权');
                }
                try {
                    stream = await navigator.mediaDevices.getDisplayMedia({
                        video: { frameRate: 30 }, audio: false,
                    });
                } catch (e2) {
                    throw new Error('无法启动屏幕共享：'
                        + String(e2 && e2.message || e2).slice(0, 120));
                }
            }

            const v = document.createElement('video');
            v.srcObject = stream;
            v.muted = true;
            v.playsInline = true;
            try {
                await v.play();
            } catch (e) {
                // 起播失败就把流关掉，否则会留下"有流但没画面"的僵死状态：之后每次申请都被开头的
                // if (this.displayStream) return 挡掉
                try { stream.getTracks().forEach(t => t.stop()); } catch (e2) { }
                throw new Error('屏幕共享已授权但视频起播失败：' + String(e && e.message).slice(0, 100));
            }

            // 全部成功之后才落状态，保证 displayStream / displayVideo / mode 三者一致
            this.displayStream = stream;
            this.displayVideo = v;
            this.mode = 'display';

            // 选错共享源（整个屏幕 / 另一个窗口）是一类**静默**失败：坐标基准是
            // window.innerWidth/innerHeight，源一变，区域就整体错位 —— 脚本会稳定地截到
            // 无关像素、OCR 出一堆乱字、钱照扣，而且不报错。这里做一个廉价的自检。
            // ⚠️ 结论只记在实例上，**不在这里写状态栏**：调用方（UI.applyCaptureMode /
            //    Pipeline.handleTainted）随后都会写一条"成功"状态，直接写会被覆盖掉，
            //    用户永远看不到（这正是这个自检存在的意义）。
            const settings = stream.getVideoTracks()[0].getSettings
                ? (stream.getVideoTracks()[0].getSettings() || {}) : {};
            this.displayMismatch = this.displaySourceMismatch(settings);

            stream.getVideoTracks()[0].addEventListener('ended', () => {
                warn('屏幕共享已结束，切回 element 模式');
                this.displayStream = null;
                this.displayVideo = null;
                this.displayMismatch = false;
                this.mode = 'element';
                UI.setStatus('共享已结束，已切回直接读取模式', 'warn');
            });
            log('display 捕获已启动');
        },

        stopDisplayCapture() {
            if (this.displayStream) {
                try { this.displayStream.getTracks().forEach(t => t.stop()); } catch (e) { }
            }
            this.displayStream = null;
            this.displayVideo = null;
            if (this.mode === 'display') this.mode = 'element';
            log('已停止 display 捕获');
        },

        /**
         * 把源画面的一块区域裁出来并适度放大：两种捕获方式的裁切算法完全一样、只有源不同，所以收在这里一份。
         * 放大倍率按经验定：字幕只有几十像素高时 OCR 基本认不出来，适度放大会明显提升准确率，但放太大只是白烧 token，所以封顶 3 倍、宽 1400。
         * 注意：返回的是复用画布 this._out，下一次 crop 会覆盖它（需要长期持有的调用方请先自行拷贝）。
         * @returns {HTMLCanvasElement|null} 区域太小（≤1px）时返回 null
         */
        crop(src, sx, sy, sw, sh) {
            if (sw <= 1 || sh <= 1) return null;

            let scale = Math.min(3, Math.max(1, 200 / sh));
            if (sw * scale > 1400) scale = 1400 / sw;
            const w = Math.max(2, Math.round(sw * scale));
            const h = Math.max(2, Math.round(sh * scale));

            // 改 canvas 尺寸会重置 context 的全部状态，所以只在尺寸变化时才重建并重新设置缩放参数
            if (!this._out || this._out.width !== w || this._out.height !== h) {
                const c = this._out || document.createElement('canvas');
                c.width = w;
                c.height = h;
                this._out = c;
                this._outCtx = c.getContext('2d', { willReadFrequently: true });
                this._outCtx.imageSmoothingEnabled = true;
                this._outCtx.imageSmoothingQuality = 'high';
            }
            this._outCtx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
            return this._out;
        },

        /**
         * 共享源和本标签页「看起来不是同一个」吗？只比**宽高比**：
         * 分辨率会因 DPR / 系统缩放而不同（那是正常的，grabFromDisplay 会按比例换算），
         * 宽高比对不上才是真的选错了源。12% 的容差很保守 —— 16:9 与 16:10 只差 11%。
         * 纯提示：不改任何行为，只是把一类静默失败变成看得见的警告。
         */
        displaySourceMismatch(settings) {
            const w = Number(settings && settings.width) || 0;
            const h = Number(settings && settings.height) || 0;
            const ww = window.innerWidth, wh = window.innerHeight;
            if (!w || !h || !ww || !wh) return false;
            const src = w / h, win = ww / wh;
            return Math.abs(src - win) / win > 0.12;
        },

        grabFromDisplay(region) {
            const v = this.displayVideo;
            if (!v || !v.videoWidth) return null;
            const track = this.displayStream.getVideoTracks()[0];
            const s = track.getSettings ? (track.getSettings() || {}) : {};
            const scaleX = (s.width || v.videoWidth) / window.innerWidth;
            const scaleY = (s.height || v.videoHeight) / window.innerHeight;

            return this.crop(v,
                Math.max(0, Math.round(region.x * scaleX)),
                Math.max(0, Math.round(region.y * scaleY)),
                Math.round(region.w * scaleX),
                Math.round(region.h * scaleY));
        },

        /** 统一入口：遵循面板里的「截图方式」设置；video 由 step() 传进来（它刚查过一次，没必要再查） */
        grab(region, video) {
            const pref = CFG.captureMode || 'auto';
            if (pref === 'display') {
                if (!this.displayStream) {
                    const err = new Error('还没授权标签页共享');
                    err.code = 'NO_DISPLAY';
                    throw err;
                }
                return this.grabFromDisplay(region);
            }
            if (pref === 'element') return this.grabFromElement(region, video);
            // auto：按运行时实际探测到的模式走
            return this.mode === 'display'
                ? this.grabFromDisplay(region)
                : this.grabFromElement(region, video);
        },
    };
