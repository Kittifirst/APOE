(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./wheel-engine.js'));
    else root.WheelState = factory(root.WheelEngine);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine) {
    'use strict';
    function create(settings) {
        return { version: 2, settings: JSON.parse(JSON.stringify(settings)), issued: {}, logs: [] };
    }
    function validate(state) {
        if (!state || state.version !== 2 || !engine.validateSettings(state.settings).valid) return false;
        if (!state.issued || typeof state.issued !== 'object' || Array.isArray(state.issued) || !Array.isArray(state.logs)) return false;
        if (!Object.values(state.issued).every(value => Number.isSafeInteger(value) && value >= 0)) return false;
        const ids = new Set();
        return state.logs.every(log => {
            if (!log || typeof log.id !== 'string' || !log.id || ids.has(log.id)) return false;
            ids.add(log.id);
            return typeof log.prizeId === 'string' && typeof log.label === 'string' &&
                typeof log.time === 'string' && Number.isFinite(Date.parse(log.time)) &&
                Number.isSafeInteger(log.remaining) && log.remaining >= 0 && log.quantity === 1;
        });
    }
    function award(state, prizeId, id, time) {
        if (!validate(state)) throw new Error('ข้อมูลสต็อกหรือประวัติไม่ถูกต้อง');
        if (state.logs.some(log => log.id === id)) throw new Error('รอบนี้ถูกบันทึกแล้ว');
        const prize = engine.buildSegments(state.settings, state.issued).find(item => item.id === prizeId && item.weight > 0);
        if (!prize) throw new Error('รางวัลนี้หมดหรือไม่สามารถสุ่มได้แล้ว');
        const record = { id, prizeId, label: prize.label, time, quantity: 1, remaining: prize.remaining - 1 };
        const next = {
            ...state,
            issued: { ...state.issued, [prizeId]: engine.issuedCount(prize, state.issued) + 1 },
            logs: [record, ...state.logs]
        };
        if (!validate(next)) throw new Error('ข้อมูลผลรางวัลไม่ถูกต้อง');
        return next;
    }
    function deleteLogs(state, ids) {
        // Deleting history must never replenish awarded stock.
        const selected = new Set(ids);
        return { ...state, logs: state.logs.filter(log => !selected.has(log.id)) };
    }
    function resetStock(state) {
        if (!validate(state)) throw new Error('ข้อมูลสต็อกหรือประวัติไม่ถูกต้อง');
        const next = { ...state, issued: {} };
        if (!validate(next)) throw new Error('ข้อมูลหลังรีเซ็ตไม่ถูกต้อง');
        return next;
    }
    function csv(logs) {
        function cell(value) {
            let text = String(value);
            if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
            return '"' + text.replace(/"/g, '""') + '"';
        }
        const rows = [['รหัสการสุ่ม', 'วันเวลา (UTC)', 'ของรางวัล', 'จำนวนที่ออก', 'คงเหลือหลังสุ่ม']];
        logs.forEach(log => rows.push([log.id, log.time, log.label, log.quantity, log.remaining]));
        return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
    }
    return Object.freeze({ create, validate, award, deleteLogs, resetStock, csv });
});
