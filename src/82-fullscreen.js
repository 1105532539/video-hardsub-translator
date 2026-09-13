    // ═══════════════════════════════════════════════════════════════
    //  82-fullscreen.js — 全屏适配
    //
    //  对外提供：uiHost、Fullscreen
    //  依赖：CFG、log、warn、Overlay、UI
    // ═══════════════════════════════════════════════════════════════
    // 浏览器进全屏时**只渲染「全屏元素及其子树」**，挂在 body 上的面板和字幕层会被整个隐藏
    // —— 表现就是"一全屏字幕就没了"（实测全屏后 overlay / panel 都不在全屏子树内）。
    //
    // 截图那一侧不用管：区域存的是相对视频内容框的比例，全屏变大后 resolveRegion 会自动重锚定。
    //
    // 两种全屏分开处理：① 全屏元素是播放器容器（YouTube、B 站等多数播放器）→ 把元素搬进去，
    // 退出时搬回 body；② 全屏元素就是 <video> 本身 → <video> 是替换元素，塞进去的子节点
    // 不参与渲染（实测 getBoundingClientRect 全是 0），只能改用**原生字幕轨**：cue 由浏览器
    // 画在视频画面内部，而全屏渲染的正是视频画面本身，所以能显示。
    function uiHost() {
        return Fullscreen.uiHost();
    }

    const Fullscreen = {
        host: null,         // 当前承载我们元素的全屏容器（仅情况 ①）
        track: null,        // 原生字幕轨（仅情况 ②）
        trackVideo: null,
        cue: null,

        init() {
            // webkit 前缀给老 Safari / 老 Chrome 兜底
            document.addEventListener('fullscreenchange', () => this.sync());
            document.addEventListener('webkitfullscreenchange', () => this.sync());
        },

        current() {
            try {
                return document.fullscreenElement || document.webkitFullscreenElement || null;
            } catch (e) { return null; }
        },

        videoFullscreen() {
            const fs = this.current();
            return (fs && (fs.tagName === 'VIDEO' || fs.tagName === 'AUDIO')) ? fs : null;
        },

        uiHost() {
            const fs = this.current();
            // <video> 进不去（子节点不渲染，走了也没用）；iframe 也进不去 —— 那是另一个文档
            if (fs && fs.tagName !== 'VIDEO' && fs.tagName !== 'AUDIO'
                && fs.tagName !== 'IFRAME') {
                return fs;
            }
            return document.body;
        },

        sync() {
            const host = this.uiHost();

            if (host !== this.host) {
                this.host = host;
                for (const el of [Overlay.el, UI.root, UI.pillEl]) {
                    if (el && el.parentNode !== host) host.appendChild(el);
                }
                log('全屏状态变化，UI 已挂到 ' + (host === document.body ? 'body' : host.tagName));
                if (this.videoFullscreen()) {
                    UI.setStatus('已进入全屏：<video> 直接全屏，改用系统字幕轨显示', 'warn');
                } else if (host !== document.body) {
                    UI.setStatus('已进入全屏：字幕层已跟随', 'ok');
                }
            }

            // 退出 <video> 全屏时把字幕轨收掉，不然它会一直挂在那儿
            if (!this.videoFullscreen()) this.hideTrack();

            Overlay.reposition();
        },

        /**
         * 保证视频上挂着我们自己的那条字幕轨，返回它。
         * ⚠️ 退出全屏**不能**靠 removeTextTrack 清理：实测本机 Chrome 里这个 API 根本没实现，try/catch
         * 包着调用只会静默失败，每进一次全屏就多挂一条轨 —— 所以复用同一条轨，不用时 mode='disabled'。
         */
        ensureTrack(video) {
            if (this.track && this.trackVideo === video) return this.track;

            // 换了视频元素（SPA 换集）：旧轨留着没用。能删就删，删不掉就关掉。
            if (this.track) {
                try { this.track.mode = 'disabled'; } catch (e) { }
                if (this.trackVideo && typeof this.trackVideo.removeTextTrack === 'function') {
                    try { this.trackVideo.removeTextTrack(this.track); } catch (e) { }
                }
            }
            this.cue = null;

            const track = video.addTextTrack('subtitles', '字幕翻译', CFG.tgtLang || 'zh');
            this.track = track;
            this.trackVideo = video;
            return track;
        },

        /** 用原生字幕轨显示译文 —— <video> 直接全屏时唯一可行的办法；全程复用同一条 cue（改文字和时间），不断 addCue 的话播一小时会堆出几千条。 */
        showOnTrack(video, text) {
            if (!video || !text) return;
            try {
                const track = this.ensureTrack(video);
                track.mode = 'showing';
                const now = video.currentTime || 0;
                if (!this.cue) {
                    this.cue = new VTTCue(now, now + 3600, text);
                    track.addCue(this.cue);
                } else {
                    this.cue.text = text;
                    this.cue.startTime = now;
                    this.cue.endTime = now + 3600;
                }
            } catch (e) {
                // 有些站点会锁死 textTracks；失败就当没有这个兜底，别影响主流程
                warn('原生字幕轨不可用：', e);
            }
        },

        /** 收起原生字幕轨。只关显示、不删轨道 —— 删不掉，见 ensureTrack 的说明 */
        hideTrack() {
            if (this.cue && this.track) {
                try { this.track.removeCue(this.cue); } catch (e) { }
            }
            this.cue = null;
            if (this.track) {
                try { this.track.mode = 'disabled'; } catch (e) { }
            }
        },
    };
