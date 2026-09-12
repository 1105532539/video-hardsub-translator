// 测试实验室页面：通过 query 参数构造各种真实环境场景
// 参数：
//   mode=canvas|file|hls|none   视频来源
//   src=<url>                   file/hls 模式的地址
//   crossorigin=0|1             是否设置 crossOrigin='anonymous'
//   fit=contain|cover|fill      object-fit
//   w=960&h=540                 元素尺寸
//   multi=1                     额外塞 2 个诱饵小视频
//   late=<ms>                   延迟插入主视频（模拟后加载）
//   paused=1                    插入后暂停
(async function () {
    'use strict';

    const q = new URLSearchParams(location.search);
    const P = window.__PATTERN__;
    const wrap = document.getElementById('wrap');

    const mode = q.get('mode') || 'canvas';
    const fit = q.get('fit') || 'contain';
    const W = Number(q.get('w') || 960);
    const H = Number(q.get('h') || 540);
    const src = q.get('src') || '';
    const useCrossOrigin = q.get('crossorigin') === '1';
    const multi = q.get('multi') === '1';
    const late = Number(q.get('late') || 0);
    const shouldPause = q.get('paused') === '1';

    const lab = window.__lab = {
        ready: false, mode, fit, W, H, src, useCrossOrigin, multi, late,
        pattern: {
            W: P.W, H: P.H, BAND_Y: P.BAND_Y, BAND_H: P.BAND_H,
            CW: P.CW, CH: P.CH, SUBTITLE_TEXT: P.SUBTITLE_TEXT,
        },
        errors: [],
        mainVideo: null,
        extraVideos: [],
    };

    window.addEventListener('error', e => lab.errors.push('window.error: ' + e.message));
    window.addEventListener('unhandledrejection', e =>
        lab.errors.push('unhandled: ' + (e.reason && e.reason.message)));

    function styleVideo(v, w, h) {
        v.muted = true;
        v.defaultMuted = true;
        v.playsInline = true;
        v.autoplay = true;
        v.loop = true;
        v.setAttribute('muted', '');
        v.setAttribute('playsinline', '');
        v.style.display = 'block';
        v.style.width = w + 'px';
        v.style.height = h + 'px';
        v.style.objectFit = fit;
        v.style.background = '#000';
    }

    function makeCanvasStream(w, h, painter) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        painter(c.getContext('2d'));
        return c.captureStream(30);
    }

    function loadScript(url) {
        return new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = url;
            s.onload = res;
            s.onerror = () => rej(new Error('脚本加载失败 ' + url));
            document.head.appendChild(s);
        });
    }

    async function build() {
        if (mode === 'none') {
            lab.ready = true;
            return;
        }

        // 诱饵视频：故意都小于 findVideo 的 200x120 门槛，用来验证"选的是主播放器"
        if (multi) {
            for (const [dw, dh] of [[120, 68], [160, 90]]) {
                const d = document.createElement('video');
                styleVideo(d, dw, dh);
                d.srcObject = makeCanvasStream(dw, dh, (x) => {
                    x.fillStyle = '#123456';
                    x.fillRect(0, 0, dw, dh);
                });
                wrap.appendChild(d);
                lab.extraVideos.push(d);
                d.play().catch(() => { });
            }
        }

        const v = document.createElement('video');
        styleVideo(v, W, H);
        lab.mainVideo = v;

        if (mode === 'canvas') {
            v.srcObject = makeCanvasStream(P.W, P.H, (x) => P.drawPattern(x));
        } else if (mode === 'file') {
            // 关键：crossorigin=0 时不设该属性 → 跨域且非 CORS 模式 → 污染画布
            if (useCrossOrigin) v.crossOrigin = 'anonymous';
            v.src = src;
        } else if (mode === 'hls') {
            try {
                await loadScript('hls.min.js');
            } catch (e) {
                lab.errors.push(e.message);
            }
            if (window.Hls && window.Hls.isSupported()) {
                const hls = new window.Hls();
                hls.loadSource(src);
                hls.attachMedia(v);
                lab.hls = hls;
            } else {
                v.src = src;
            }
        }

        wrap.appendChild(v);

        await v.play().catch(e => lab.errors.push('play: ' + e.message));
        if (shouldPause) {
            await new Promise(r => setTimeout(r, 600));
            v.pause();
        }

        const t0 = Date.now();
        while (Date.now() - t0 < 20000) {
            if (v.videoWidth > 0 && v.readyState >= 2) break;
            await new Promise(r => setTimeout(r, 150));
        }
        lab.videoWidth = v.videoWidth;
        lab.videoHeight = v.videoHeight;
        lab.paused = v.paused;
        lab.ready = true;
    }

    if (late > 0) setTimeout(() => { build().catch(e => lab.errors.push('build: ' + e.message)); }, late);
    else build().catch(e => lab.errors.push('build: ' + e.message));
})();
