'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./wheel-engine.js');
const ledger = require('./wheel-state.js');
const time = '2026-09-07T10:00:00.000Z';
const config = { equalChance: true, items: [
    { id: 'a', label: 'ของขวัญ A', quantity: 2, weight: 10, color: '#aabbcc' },
    { id: 'b', label: 'ของขวัญ B', quantity: 1, weight: 5, color: '#ccbbaa' }
] };

test('award atomically creates a log and consumes one unit without mutating previous state', () => {
    const before = ledger.create(config);
    const after = ledger.award(before, 'a', 'spin-1', time);
    assert.equal(ledger.validate(after), true);
    assert.deepEqual(before.issued, {});
    assert.deepEqual(before.logs, []);
    assert.deepEqual(after.issued, { a: 1 });
    assert.deepEqual(after.logs[0], { id: 'spin-1', prizeId: 'a', label: 'ของขวัญ A', quantity: 1, remaining: 1, time });
    assert.throws(() => ledger.award(after, 'a', 'spin-1', time), /บันทึกแล้ว/);
});

test('inventory reaches zero and cannot oversell after reload or log deletion', () => {
    let state = ledger.award(ledger.create(config), 'a', 'spin-1', time);
    state = ledger.award(state, 'a', 'spin-2', time);
    state = JSON.parse(JSON.stringify(state));
    assert.equal(engine.buildSegments(state.settings, state.issued).some(x => x.id === 'a'), false);
    assert.throws(() => ledger.award(state, 'a', 'spin-3', time), /หมด/);
    state = ledger.deleteLogs(state, ['spin-1', 'spin-2']);
    assert.deepEqual(state.logs, []);
    assert.equal(state.issued.a, 2);
    assert.throws(() => ledger.award(state, 'a', 'spin-3', time), /หมด/);
    state = ledger.award(state, 'b', 'spin-3', time);
    assert.deepEqual(engine.buildSegments(state.settings, state.issued), []);
});

test('editing rates and names preserves stock; increasing total adds only the difference', () => {
    let state = ledger.award(ledger.create(config), 'a', 'spin-1', time);
    state = ledger.award(state, 'a', 'spin-2', time);
    const changed = structuredClone(state);
    changed.settings.items[0].label = 'ชื่อใหม่';
    changed.settings.items[0].weight = 100;
    assert.equal(engine.remainingCount(changed.settings.items[0], changed.issued), 0);
    changed.settings.items[0].quantity = 3;
    assert.equal(engine.remainingCount(changed.settings.items[0], changed.issued), 1);
    const next = ledger.award(changed, 'a', 'spin-3', time);
    assert.equal(next.logs[0].label, 'ชื่อใหม่');
    assert.equal(next.logs[1].label, 'ของขวัญ A');
    assert.equal(next.issued.a, 3);
    assert.throws(() => ledger.award(next, 'a', 'spin-4', time));
});

test('deleting selected rows preserves other logs, counters, and prize definitions', () => {
    let state = ledger.award(ledger.create(config), 'a', 'spin-1', time);
    state = ledger.award(state, 'b', 'spin-2', time);
    const next = ledger.deleteLogs(state, ['spin-1']);
    assert.deepEqual(next.logs.map(x => x.id), ['spin-2']);
    assert.deepEqual(next.issued, state.issued);
    assert.deepEqual(next.settings, state.settings);
    assert.equal(state.logs.length, 2);
});

test('resetting stock starts a new round and preserves its history without mutating previous state', () => {
    const issued = ledger.award(ledger.create(config), 'a', 'spin-1', time);
    const next = ledger.resetStock(issued);
    assert.deepEqual(issued.issued, { a: 1 });
    assert.equal(issued.logs.length, 1);
    assert.deepEqual(next.issued, {});
    assert.deepEqual(next.logs, issued.logs);
    assert.deepEqual(next.settings, issued.settings);
    assert.equal(engine.buildSegments(next.settings, next.issued).length, 2);
});

test('CSV preserves Thai, escapes commas and quotes, and neutralizes formulas', () => {
    const logs = [
        { id: '1', time, label: 'ของขวัญ, "พิเศษ"\nบรรทัดสอง', quantity: 1, remaining: 0 },
        { id: '2', time, label: '=HYPERLINK("bad")', quantity: 1, remaining: 5 },
        { id: '3', time, label: '  +1+2', quantity: 1, remaining: 4 }
    ];
    const csv = ledger.csv(logs);
    assert.equal(csv.charCodeAt(0), 0xFEFF);
    assert.ok(csv.includes('"ของขวัญ, ""พิเศษ""\nบรรทัดสอง"'));
    assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
    assert.ok(csv.includes('"\'  +1+2"'));
    assert.ok(csv.includes('คงเหลือหลังสุ่ม'));
});

test('invalid saved stock and malformed or duplicate logs are rejected', () => {
    const state = ledger.create(config);
    assert.equal(ledger.validate({ ...state, issued: { a: -1 } }), false);
    assert.equal(ledger.validate({ ...state, issued: { a: '1' } }), false);
    assert.equal(ledger.validate({ ...state, logs: [null] }), false);
    assert.equal(ledger.validate({ ...state, version: 1 }), false);
    const saved = ledger.award(state, 'a', 'one', time);
    assert.equal(ledger.validate({ ...saved, logs: [...saved.logs, ...saved.logs] }), false);
    assert.throws(() => ledger.award(state, 'missing', 'one', time));
    assert.throws(() => ledger.award(state, 'a', 'one', 'invalid date'));
});
