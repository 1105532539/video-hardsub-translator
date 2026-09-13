    // ═══════════════════════════════════════════════════════════════
    //  42-youdao-sign.js — 签名素材：SHA-256、UUID 与有道错误码
    //
    //  对外提供：rotr、SHA256_K、sha256HexJS、sha256Hex、youdaoTruncate、uuidHex、
    //              YOUDAO_ERR
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

    const SHA256_K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    /** 纯 JS SHA-256 回退：有道签名必须用 sha256，而 crypto.subtle 只在 https 等「安全上下文」
     *  才存在（已用 Node 的 crypto 逐字节比对验证通过）。 */
    function sha256HexJS(str) {
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
            let c = str.charCodeAt(i);
            if (c < 0x80) {
                bytes.push(c);
            } else if (c < 0x800) {
                bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
            } else if (c < 0xd800 || c >= 0xe000) {
                bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            } else {
                i++;
                c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63),
                    0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            }
        }

        const bitLen = bytes.length * 8;
        bytes.push(0x80);
        while (bytes.length % 64 !== 56) bytes.push(0);
        const hi = Math.floor(bitLen / 4294967296);
        const lo = bitLen >>> 0;
        bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
        bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

        let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        const w = new Array(64);

        for (let i = 0; i < bytes.length; i += 64) {
            for (let j = 0; j < 16; j++) {
                w[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16)
                     | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3];
            }
            for (let j = 16; j < 64; j++) {
                const x = w[j - 15], y = w[j - 2];
                const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
                const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
                w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
            }
            let [a, b, c, d, e, f, g, h] = H;
            for (let j = 0; j < 64; j++) {
                const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                const ch = (e & f) ^ (~e & g);
                const t1 = (h + S1 + ch + SHA256_K[j] + w[j]) | 0;
                const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const t2 = (S0 + maj) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0;
                d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            H = [(H[0] + a) | 0, (H[1] + b) | 0, (H[2] + c) | 0, (H[3] + d) | 0,
                 (H[4] + e) | 0, (H[5] + f) | 0, (H[6] + g) | 0, (H[7] + h) | 0];
        }
        return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
    }

    async function sha256Hex(str) {
        try {
            if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
                const buf = new TextEncoder().encode(str);
                const d = await crypto.subtle.digest('SHA-256', buf);
                return Array.from(new Uint8Array(d))
                    .map(b => b.toString(16).padStart(2, '0')).join('');
            }
        } catch (e) { /* 落到纯 JS 实现 */ }
        return sha256HexJS(str);
    }

    /** 有道的 input 截断规则：q 长度 ≤ 20 → input = q；q 长度 > 20 →
     *  input = q 前 10 字符 + q 长度 + q 后 10 字符。 */
    function youdaoTruncate(q) {
        const len = q.length;
        if (len <= 20) return q;
        return q.substring(0, 10) + len + q.substring(len - 10, len);
    }

    function uuidHex() {
        try {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                return crypto.randomUUID().replace(/-/g, '').toUpperCase();
            }
        } catch (e) { /* ignore */ }
        let s = '';
        for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
        return s.toUpperCase();
    }

    /** 有道常见错误码，便于定位问题 */
    const YOUDAO_ERR = {
        '101': '缺少必填参数',
        '102': '不支持的语言类型（检查 from / to 代码）',
        '103': '翻译文本过长',
        '108': '应用ID无效：appKey 填错，或应用没绑定「图片翻译」服务实例',
        '110': '无相关服务的有效实例：需要在控制台创建「图片翻译」实例并绑定到该应用',
        '113': 'q 不能为空',
        '114': '不支持的图片传输方式',
        '202': '签名校验失败：appSecret 错误，或 base64 里带了 data: 图片头',
        '203': '访问IP不在白名单',
        '205': '接口与应用平台类型不一致：创建应用时要选「API」而不是 Android/iOS SDK',
        '206': '时间戳无效导致签名失败：检查本机系统时间',
        '207': '重放请求：salt 重复了（正常不会发生，每次都是新 UUID）',
        '401': '账户已欠费，体验金用完了',
        '411': '访问频率受限',
        '1004': '识别图片过大',
        '1201': '图片 base64 解密失败：确认传的是纯 base64，不含 data: 前缀',
        '1301': 'OCR 段落识别失败',
        '1411': '访问频率受限',
        '1412': '超过最大识别字节数',
        '2003': '不支持的语言识别类型',
    };
