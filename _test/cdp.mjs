// 零依赖 CDP 封装：用 Node 内置 WebSocket 驱动 Chrome
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Chrome 可执行文件路径。
// 默认取 Windows 常见安装位置，可用环境变量 CHROME_PATH 覆盖
// （非默认安装路径、其它操作系统、或装了 Chromium 的情况）：
//     PowerShell:  $env:CHROME_PATH = 'D:\Apps\Chrome\chrome.exe'
//     bash:        export CHROME_PATH=/usr/bin/google-chrome
export const CHROME = process.env.CHROME_PATH
    || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export class Cdp {
    constructor(ws, proc, profile) {
        this.ws = ws;
        this.proc = proc;
        this.profile = profile;
        this.id = 0;
        this.pending = new Map();
        this.consoleErrors = [];
        this.consoleLogs = [];
        this.pageErrors = [];
        this._closed = false;
    }

    static async launch({ port = 9333, extraArgs = [] } = {}) {
        const profile = path.join(os.tmpdir(), 'h1sub-' + Date.now() + '-' + Math.floor(Math.random() * 1e4));
        fs.mkdirSync(profile, { recursive: true });
        const args = [
            '--headless=new',
            '--disable-gpu',
            '--no-sandbox',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            '--mute-audio',
            '--autoplay-policy=no-user-gesture-required',
            '--window-size=1280,900',
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${profile}`,
            'about:blank',
            ...extraArgs,
        ];
        const proc = spawn(CHROME, args, { stdio: 'ignore' });
        const ver = await Cdp.waitPort(port);
        const ws = new WebSocket(ver.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
            ws.onopen = res;
            ws.onerror = () => rej(new Error('CDP WebSocket 连接失败'));
        });
        const cdp = new Cdp(ws, proc, profile);
        cdp.version = ver.Browser;
        cdp.port = port;
        ws.addEventListener('message', (ev) => cdp._onMessage(ev));
        return cdp;
    }

    static async waitPort(port, timeoutMs = 25000) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            try {
                const r = await fetch(`http://127.0.0.1:${port}/json/version`);
                if (r.ok) return await r.json();
            } catch (e) { /* 未就绪 */ }
            await new Promise(r => setTimeout(r, 250));
        }
        throw new Error('Chrome 调试端口未就绪（端口 ' + port + '）');
    }

    _onMessage(ev) {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }

        if (m.id && this.pending.has(m.id)) {
            const { resolve, reject } = this.pending.get(m.id);
            this.pending.delete(m.id);
            if (m.error) {
                reject(new Error(m.error.message + (m.error.data ? ' | ' + m.error.data : '')));
            } else {
                resolve(m.result);
            }
            return;
        }

        // 收集页面里的异常与 console —— 用来断言"脚本没报错"
        const sid = m.sessionId || '(root)';
        if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params.exceptionDetails;
            this.pageErrors.push({ sessionId: sid, text: d.exception?.description || d.text || 'unknown' });
        } else if (m.method === 'Runtime.consoleAPICalled') {
            const txt = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
            if (m.params.type === 'error') this.consoleErrors.push({ sessionId: sid, text: txt });
            this.consoleLogs.push({ sessionId: sid, type: m.params.type, text: txt });
        }
    }

    /** 取某个会话的页面异常 */
    errorsFor(sessionId) {
        return this.pageErrors.filter(e => e.sessionId === sessionId).map(e => e.text);
    }

    logsFor(sessionId, type) {
        return this.consoleLogs
            .filter(l => l.sessionId === sessionId && (!type || l.type === type))
            .map(l => l.text);
    }

    send(method, params = {}, sessionId) {
        return new Promise((resolve, reject) => {
            const id = ++this.id;
            this.pending.set(id, { resolve, reject });
            const msg = { id, method, params };
            if (sessionId) msg.sessionId = sessionId;
            this.ws.send(JSON.stringify(msg));
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error('CDP 调用超时: ' + method));
                }
            }, 60000);
        });
    }

    async attachToPage() {
        const { targetInfos } = await this.send('Target.getTargets');
        const page = targetInfos.find(t => t.type === 'page');
        if (!page) throw new Error('找不到 page target');
        const { sessionId } = await this.send('Target.attachToTarget', {
            targetId: page.targetId, flatten: true,
        });
        this.sessionId = sessionId;
        await this.send('Page.enable', {}, sessionId);
        await this.send('Runtime.enable', {}, sessionId);
        return sessionId;
    }

    async evaluate(expression, { awaitPromise = false, returnByValue = true, sessionId, userGesture = false } = {}) {
        const r = await this.send('Runtime.evaluate', {
            expression, awaitPromise, returnByValue, userGesture,
        }, sessionId || this.sessionId);
        if (r.exceptionDetails) {
            const d = r.exceptionDetails;
            throw new Error('页面内异常: ' + (d.exception?.description || d.text));
        }
        return r.result.value;
    }

    /** 新建一个独立页面（每个测试场景一个，避免注入脚本互相污染） */
    async newPage() {
        const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
        await this.send('Page.enable', {}, sessionId);
        await this.send('Runtime.enable', {}, sessionId);
        return { targetId, sessionId };
    }

    async closePage(targetId) {
        try { await this.send('Target.closeTarget', { targetId }); } catch (e) { }
    }

    /** 在指定会话里注入「新文档执行前」脚本 */
    async addInitScript(source, sessionId) {
        await this.send('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId || this.sessionId);
    }

    async navigate(sessionId, url, { waitFor = null, timeoutMs = 30000 } = {}) {
        await this.send('Page.navigate', { url }, sessionId);
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            try {
                const ready = await this.evaluate('document.readyState', { sessionId });
                if (ready === 'complete') {
                    if (!waitFor) return;
                    const ok = await this.evaluate(
                        `(()=>{try{return !!(${waitFor})}catch(e){return false}})()`, { sessionId });
                    if (ok) return;
                }
            } catch (e) { /* 导航中 */ }
            await new Promise(r => setTimeout(r, 150));
        }
        throw new Error('等待超时: ' + url + ' (waitFor=' + waitFor + ')');
    }

    async goto(url, { waitFor = null, timeoutMs = 30000 } = {}) {
        await this.send('Page.navigate', { url }, this.sessionId);
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            try {
                const ready = await this.evaluate('document.readyState');
                if (ready === 'complete') {
                    if (!waitFor) return;
                    const ok = await this.evaluate(`(()=>{try{return !!(${waitFor})}catch(e){return false}})()`);
                    if (ok) return;
                }
            } catch (e) { /* 导航中 */ }
            await new Promise(r => setTimeout(r, 200));
        }
        throw new Error('页面加载/等待条件超时: ' + url);
    }

    async screenshot(file, sessionId) {
        const r = await this.send('Page.captureScreenshot', { format: 'png' },
            sessionId || this.sessionId);
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        return file;
    }

    close() {
        if (this._closed) return;
        this._closed = true;
        try { this.ws.close(); } catch (e) { }
        try { this.proc.kill(); } catch (e) { }
        setTimeout(() => {
            try { fs.rmSync(this.profile, { recursive: true, force: true }); } catch (e) { }
        }, 400);
    }
}

// ── 极简静态服务器（可指定是否发送 CORS 头，用来制造/避免画布污染）──
export function startServer({ port, root, cors = true }) {
    return import('node:http').then(({ default: http }) => new Promise((resolve) => {
        const MIME = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.mjs': 'text/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.webm': 'video/webm',
            '.mp4': 'video/mp4',
            '.png': 'image/png',
        };
        const server = http.createServer((req, res) => {
            let p = decodeURIComponent(req.url.split('?')[0]);
            if (p === '/') p = '/lab.html';
            const file = path.join(root, p);
            if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404); res.end('not found'); return;
            }
            const buf = fs.readFileSync(file);
            const headers = {
                'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
                'Content-Length': buf.length,
                'Accept-Ranges': 'bytes',
            };
            if (cors) headers['Access-Control-Allow-Origin'] = '*';
            // 支持 Range，视频元素常需要
            const range = req.headers.range;
            if (range) {
                const m = /bytes=(\d+)-(\d*)/.exec(range);
                if (m) {
                    const start = parseInt(m[1], 10);
                    const end = m[2] ? parseInt(m[2], 10) : buf.length - 1;
                    const slice = buf.subarray(start, end + 1);
                    res.writeHead(206, {
                        ...headers,
                        'Content-Range': `bytes ${start}-${end}/${buf.length}`,
                        'Content-Length': slice.length,
                    });
                    res.end(slice);
                    return;
                }
            }
            res.writeHead(200, headers);
            res.end(buf);
        });
        server.listen(port, '127.0.0.1', () => resolve({
            port, server, close: () => new Promise(r => server.close(r)),
        }));
    }));
}
