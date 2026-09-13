    // ═══════════════════════════════════════════════════════════════
    //  84-html.js — HTML 转义、Trusted Types 与颜色
    //
    //  Trusted Types 兼容层：YouTube、Gmail、Google 搜索等站点用 CSP 的
    //  require-trusted-types-for 'script' 禁掉了直接给 innerHTML 赋字符串，
    //  不注册策略的话面板建不出来、字幕也渲染不出来（整个脚本等于没装）。
    //  setHTML() 是全脚本写 innerHTML 的唯一入口。
    //
    //  对外提供：HTML_ESCAPES、escapeHtml、TT_POLICY、setHTML、hexToRgb
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    // 单次扫描替换：4 个链式 replace 要扫 4 遍、产生 3 个中间字符串，而每次渲染字幕都会调用。
    const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
    }

    /**
     * Trusted Types 兼容层：YouTube、Gmail、Google 搜索等站点用 CSP 的 require-trusted-types-for
     * 'script' 禁掉了直接给 innerHTML 赋字符串（直接写抛 TypeError），结果面板建不出来、字幕也渲染不
     * 出来（整个脚本等于没装）。自己注册一个策略就能正常写，策略名撞车或站点限死策略名时退回普通赋值。
     */
    const TT_POLICY = (() => {
        let api = null;
        try {
            if (typeof trustedTypes !== 'undefined' && trustedTypes
                && typeof trustedTypes.createPolicy === 'function') {
                api = trustedTypes;
            } else if (typeof window !== 'undefined' && window.trustedTypes
                && typeof window.trustedTypes.createPolicy === 'function') {
                api = window.trustedTypes;
            }
        } catch (e) { api = null; }
        if (!api) return null;

        const make = (name) => api.createPolicy(name, { createHTML: (s) => s });
        try { return make('h1sub-html'); } catch (e) { /* 名字已被占用 */ }
        try {
            return make('h1sub-html-' + Math.random().toString(36).slice(2, 9));
        } catch (e) { /* 站点不允许自建策略 */ }
        return null;
    })();

    /** 全脚本写 innerHTML 的唯一入口 */
    function setHTML(el, html) {
        if (!el) return;
        if (TT_POLICY) { el.innerHTML = TT_POLICY.createHTML(String(html)); return; }
        el.innerHTML = html;
    }

    /** '#rrggbb' → [r,g,b]，解析失败回退白色 */
    function hexToRgb(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return [255, 255, 255];
        const n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
