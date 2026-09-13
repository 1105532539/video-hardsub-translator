    // ═══════════════════════════════════════════════════════════════
    //  94-modal.js — 通用弹窗骨架
    //
    //  诊断 / 导出 / 导入三个弹窗共用这一套遮罩层、标题栏和关闭按钮。
    //  所有 id 都由调用方给出，一个都不能改 —— 测试断言和用户习惯都依赖它们。
    //
    //  对外提供：openModal
    //  依赖：escapeHtml、setHTML
    // ═══════════════════════════════════════════════════════════════
    /**
     * 统一的弹窗骨架。
     *
     * 三个弹窗原来各自抄了一遍遮罩层 / 标题栏 / 关闭按钮的 HTML 与样式，改一次配色要改三处，还漏配过
     * 弹窗按钮样式 —— 在有些站点上会变成浅灰字贴深灰底。所有 id 都由调用方给出，一个都不能改（测试断言依赖）。
     *
     * @param {object} o
     *   title 标题文字；closeId × 按钮的 id；body 内容区 HTML；buttons [{id,label,style}] 右侧按钮
     *   width 弹窗宽度（默认 min(680px,94vw)）；z 层级（默认 2147483641）
     *   headStyle 标题栏追加样式（诊断模式是带下边框的）；bodyStyle 内容区容器样式
     *   modalStyle .h1sub-modal 上的追加样式（默认 padding:14px）
     * @returns {{root, body, close, $}} $ 是 root.querySelector 的简写
     */
    function openModal(o) {
        const root = document.createElement('div');
        root.style.cssText = 'position:fixed;inset:0;z-index:' + (o.z || 2147483641)
            + ';background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center';

        const buttons = (o.buttons || []).map((b) =>
            '<button id="' + b.id + '"' + (b.style ? ' style="' + b.style + '"' : '') + '>'
            + escapeHtml(b.label) + '</button>').join('');

        setHTML(root,
            '<div class="h1sub-modal" style="background:#15171c;color:#e6e8ee;'
            + 'border:1px solid #2c313a;border-radius:10px;'
            + 'width:' + (o.width || 'min(680px,94vw)') + ';'
            + (o.modalStyle || 'padding:14px') + ';font:12px sans-serif">'
            + '<div style="display:flex;align-items:center;gap:8px;'
            + (o.headStyle || 'margin-bottom:8px') + '">'
            + '<b style="flex:1;font-size:13px">' + escapeHtml(o.title || '') + '</b>'
            + buttons
            + '<span id="' + o.closeId + '" class="h1sub-x">×</span>'
            + '</div>'
            + '<div data-h1sub-body' + (o.bodyStyle ? ' style="' + o.bodyStyle + '"' : '') + '></div>'
            + '</div>');

        const body = root.querySelector('[data-h1sub-body]');
        if (o.body) setHTML(body, o.body);
        document.body.appendChild(root);

        const close = () => root.remove();
        root.querySelector('#' + o.closeId).onclick = close;
        return { root, body, close, $: (sel) => root.querySelector(sel) };
    }
