'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./wheel-engine.js');
const ledger = require('./wheel-state.js');
const claw = require('./claw-game.js');

test('claw defaults are valid and provide weighted, stocked prizes', () => {
    assert.equal(engine.validateSettings(claw.DEFAULT_SETTINGS).valid, true);
    const segments = engine.buildSegments(claw.DEFAULT_SETTINGS, {});
    assert.equal(segments.length, claw.DEFAULT_SETTINGS.items.length);
    assert.ok(segments.every(item => item.weight > 0 && item.remaining > 0));
});

test('claw awards consume their own stock and retain CSV-compatible history', () => {
    const before = ledger.create(claw.DEFAULT_SETTINGS);
    const prize = engine.buildSegments(before.settings, before.issued)[0];
    const after = ledger.award(before, prize.id, 'claw-test-1', '2026-09-08T08:00:00.000Z');
    assert.equal(after.issued[prize.id], 1);
    assert.equal(after.logs[0].label, prize.label);
    assert.ok(ledger.csv(after.logs).includes('claw-test-1'));
    assert.equal(claw.STORAGE_KEY, 'all-jao-games.claw.v1');
});
