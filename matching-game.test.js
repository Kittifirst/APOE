'use strict';

// Run with: node --test matching-game.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const memory = require('./matching-game.js');

test('default memory game starts with eight pairs and sixteen cards', () => {
    const config = memory.createDefault();
    assert.equal(config.pairs.length, 8);
    assert.equal(memory.makeCards(config).length, 16);
    assert.equal(memory.validate(config), true);
});

test('each pair produces two cards and shuffling changes positions without losing pairs', () => {
    const config = memory.createDefault();
    const cards = memory.makeCards(config, () => 0.1);
    const counts = cards.reduce((result, card) => {
        result[card.pairId] = (result[card.pairId] || 0) + 1;
        return result;
    }, {});
    assert.equal(Object.keys(counts).length, 8);
    assert.ok(Object.values(counts).every(count => count === 2));
    assert.notDeepEqual(cards.map(card => card.key), memory.makeCards(config, () => 0.9).map(card => card.key));
});

test('configuration rejects invalid timer and pair counts', () => {
    const config = memory.createDefault();
    assert.equal(memory.validate({ ...config, timeLimit: 9 }), false);
    assert.equal(memory.validate({ ...config, timeLimit: 601 }), false);
    assert.equal(memory.validate({ ...config, pairs: config.pairs.slice(0, 1) }), false);
});
