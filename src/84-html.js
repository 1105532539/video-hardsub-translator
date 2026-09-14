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

    /**
     * 十六进制颜色 → [r,g,b]；解析失败回退白色。
     *
     * 支持 CSS 的全部十六进制写法：`#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA`。
     * 为什么必须覆盖这些：sanitizeCfg 的校验正则是 `^#[0-9a-fA-F]{3,8}$`
     * （docs/ARCHITECTURE.md 也把白名单写成「#RGB~#RRGGBBAA」），也就是说
     * **短式和带 alpha 的值能通过校验**。而这里原来只认恰好 6 位，其余一律
     * 静默回退成白色 —— 用户从「导入配置」带进 `#f00` 或 `#ff000080` 时会
     * 设了个颜色却显示成白色，且没有任何提示。
     * 现在按 CSS 语义展开短式，4/8 位取前 6 位（alpha 由 bgOpacity 单独控制，
     * 不在这里混进来，避免动到既有的不透明度行为）。
     */
    function hexToRgb(hex) {
        const s = String(hex == null ? '' : hex).trim().replace(/^#/, '');
        // 只接受 3/4/6/8 位十六进制（4 位 = 带 alpha 的短式）
        if (!/^[0-9a-f]+$/i.test(s)) return [255, 255, 255];
        let r, g, b;
        if (s.length === 3 || s.length === 4) {
            r = parseInt(s[0] + s[0], 16);
            g = parseInt(s[1] + s[1], 16);
            b = parseInt(s[2] + s[2], 16);
        } else if (s.length === 6 || s.length === 8) {
            r = parseInt(s.slice(0, 2), 16);
            g = parseInt(s.slice(2, 4), 16);
            b = parseInt(s.slice(4, 6), 16);
        } else {
            return [255, 255, 255];
        }
        return [r, g, b];
    }
