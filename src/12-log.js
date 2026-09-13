    // ═══════════════════════════════════════════════════════════════
    //  12-log.js — 日志
    //
    //  对外提供：LOG_PREFIX、log、warn
    //  依赖：无
    // ═══════════════════════════════════════════════════════════════
    const LOG_PREFIX = '[字幕翻译]';
    function log(...a) { console.log(LOG_PREFIX, ...a); }
    function warn(...a) { console.warn(LOG_PREFIX, ...a); }
