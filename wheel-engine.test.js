'use strict';

// Run with: node --test wheel-engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('./wheel-engine.js');

function item(overrides = {}) {
  return Object.assign({ id: 'prize', label: 'รางวัล', quantity: 1, weight: 1, color: '#C47C54' }, overrides);
}

function settings(items = [item()], equalChance = false) {
  return { equalChance, items };
}

test('defaults are valid and immutable and the browser global matches CommonJS', () => {
  assert.deepEqual(engine.validateSettings(engine.DEFAULT_SETTINGS), { valid: true, errors: [] });
  assert.ok(Object.isFrozen(engine.DEFAULT_SETTINGS.items[0]));
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'wheel-engine.js'), 'utf8'), context);
  assert.equal(context.WheelEngine.buildSegments(context.WheelEngine.DEFAULT_SETTINGS).length, 6);
  assert.equal(context.WheelEngine.pointerIndex(45, 4), 3);
});

test('quantity is stock while each prize has exactly one visual slice', () => {
  const input = settings([item({ quantity: 2 }), item({ id: 'second', label: '  รางวัลสอง  ', quantity: 3, weight: 2 })]);
  const before = JSON.stringify(input);
  const segments = engine.buildSegments(input);
  assert.deepEqual(segments.map(segment => segment.id), ['prize', 'second']);
  assert.deepEqual(segments.map(segment => segment.remaining), [2, 3]);
  assert.deepEqual(segments.map(segment => segment.index), [0, 1]);
  assert.equal(segments[1].label, 'รางวัลสอง');
  segments[0].label = 'changed';
  assert.equal(JSON.stringify(input), before);
  assert.equal(engine.buildSegments(input.items)[0].label, 'รางวัล');
});

test('item chances account for both quantity and per-segment weight', () => {
  const input = settings([
    item({ quantity: 3, weight: 2 }),
    item({ id: 'second', quantity: 2, weight: 1 }),
    item({ id: 'disabled', quantity: 4, weight: 0 })
  ]);
  const probabilities = engine.probabilities(input);
  assert.deepEqual(probabilities.map(prize => prize.probability), [0.75, 0.25, 0]);
  assert.deepEqual(probabilities.map(prize => prize.percent), [75, 25, 0]);
  assert.equal(probabilities.reduce((total, prize) => total + prize.probability, 0), 1);
});

test('weighted selection respects cumulative boundaries and excludes zero weights', () => {
  const segments = [0, 1, 0, 3, 0].map(weight => ({ weight }));
  assert.equal(engine.chooseWeightedSegment(segments, () => 0), 1);
  assert.equal(engine.chooseWeightedSegment(segments, () => 0.249999), 1);
  assert.equal(engine.chooseWeightedSegment(segments, () => 0.25), 3);
  assert.equal(engine.chooseWeightedSegment(segments, () => 1 - Number.EPSILON), 3);
  const counts = Array(5).fill(0);
  for (let step = 0; step < 1000; step += 1) {
    counts[engine.chooseWeightedSegment(segments, () => (step + 0.5) / 1000)] += 1;
  }
  assert.deepEqual(counts, [0, 250, 0, 750, 0]);
});

test('single visual slices preserve per-piece weighted probabilities', () => {
  const segments = engine.buildSegments(settings([
    item({ quantity: 3, weight: 2 }),
    item({ id: 'second', quantity: 2, weight: 1 })
  ]));
  const totals = { prize: 0, second: 0 };
  for (let step = 0; step < 800; step += 1) {
    const selected = engine.chooseWeightedSegment(segments, () => (step + 0.5) / 800);
    totals[segments[selected].id] += 1;
  }
  assert.deepEqual(totals, { prize: 600, second: 200 });
});

test('equal chance mode overrides zero configured weights and weighted mode rejects all zero weights', () => {
  const input = settings([item({ weight: 0 })], true);
  assert.equal(engine.validateSettings(input).valid, true);
  assert.equal(engine.validateSettings({ ...input, equalChance: false }).valid, false);
  assert.equal(engine.buildSegments(input).length, 1);
  assert.equal(engine.probabilities(input)[0].probability, 1);
  assert.equal(engine.chooseWeightedSegment(engine.buildSegments(input)), 0);
  assert.equal(engine.probabilities(input.items)[0].probability, 0);
  assert.throws(() => engine.chooseWeightedSegment(engine.buildSegments(input.items)), RangeError);
});

test('equal chance weights remaining physical stock without duplicating slices', () => {
  const input = settings([
    item({ quantity: 3, weight: 0 }),
    item({ id: 'second', quantity: 1, weight: 1000 })
  ], true);
  const before = JSON.stringify(input);
  const segments = engine.buildSegments(input);
  assert.deepEqual(segments.map(segment => segment.weight), [3, 1]);
  assert.deepEqual(segments.map(segment => segment.configuredWeight), [0, 1000]);
  assert.deepEqual(engine.probabilities(input).map(prize => prize.probability), [0.75, 0.25]);
  assert.deepEqual(engine.probabilities(input).map(prize => prize.weight), [0, 1000]);
  assert.deepEqual(engine.probabilities(input).map(prize => prize.effectiveWeight), [1, 1]);
  assert.deepEqual(engine.probabilities({ ...input, equalChance: false }).map(prize => prize.probability), [0, 1]);
  assert.equal(JSON.stringify(input), before);
  const counts = [0, 0];
  for (let step = 0; step < 400; step += 1) {
    counts[engine.chooseWeightedSegment(segments, () => (step + 0.5) / 400)] += 1;
  }
  assert.deepEqual(counts, [300, 100]);
});

test('settings reject invalid item values, counts, identifiers and modes', () => {
  for (const invalidItem of [
    item({ label: '' }), item({ label: '   ' }), item({ label: 'ก'.repeat(61) }),
    item({ quantity: 0 }), item({ quantity: 1.5 }), item({ quantity: engine.MAX_QUANTITY + 1 }), item({ quantity: '2' }),
    item({ weight: -1 }), item({ weight: 1001 }), item({ weight: Infinity }), item({ weight: NaN }), item({ weight: '1' }),
    item({ color: 'orange' }), item({ color: '#12345' }), item({ color: '#GGGGGG' }),
    item({ id: '' }), null
  ]) {
    assert.equal(engine.validateSettings(settings([invalidItem])).valid, false, JSON.stringify(invalidItem));
  }
  assert.equal(engine.validateSettings(settings([])).valid, false);
  assert.equal(engine.validateSettings(settings([item(), item()])).valid, false);
  assert.equal(engine.validateSettings(settings([item({ quantity: 60 }), item({ id: 'second' })])).valid, true);
  assert.equal(engine.validateSettings(settings(Array.from({ length: 31 }, (_, id) => item({ id: String(id) })))).valid, false);
  assert.equal(engine.validateSettings({ equalChance: 'true', items: [item()] }).valid, false);
  for (const invalid of [null, undefined, [], 1, { equalChance: false, items: null }]) {
    assert.equal(engine.validateSettings(invalid).valid, false);
  }
  assert.throws(() => engine.buildSegments(settings([item({ quantity: engine.MAX_QUANTITY + 1 })])), RangeError);
});

test('stock can exceed 60 pieces while visual wheel stays within 30 items', () => {
  assert.equal(engine.validateSettings(settings([item({ quantity: engine.MAX_QUANTITY, weight: 1000, label: 'ก'.repeat(60), color: '#AbC' })])).valid, true);
  assert.equal(engine.validateSettings(settings(Array.from({ length: 30 }, (_, id) => item({ id: String(id), quantity: 2, weight: 0.25 })))).valid, true);
});

test('the stationary top pointer tracks clockwise CSS rotation', () => {
  assert.deepEqual([0, 45, 90, 135, 180, 225, 270, 315, 360].map(rotation => engine.pointerIndex(rotation, 4)), [0, 3, 3, 2, 2, 1, 1, 0, 0]);
  assert.deepEqual([-45, -90, -135, -360].map(rotation => engine.pointerIndex(rotation, 4)), [0, 1, 1, 0]);
  assert.equal(engine.pointerIndex(3600 + 135, 4), 2);
  assert.equal(engine.pointerIndex(-3600 - 135, 4), 1);
  assert.equal(engine.pointerIndex(123.456, 1), 0);
});

test('every target centers the winning segment after the requested complete turns', () => {
  for (let count = 1; count <= 60; count += 1) {
    for (let index = 0; index < count; index += 1) {
      for (const current of [-731.2, 0, 47.25, 36000.8]) {
        const rotation = engine.rotationForSegment(current, index, count);
        assert.equal(engine.pointerIndex(rotation, count), index, `count=${count}, index=${index}, current=${current}`);
        assert.ok(rotation >= current + 6 * 360);
        assert.ok(rotation < current + 7 * 360 + 1e-8);
      }
    }
  }
  assert.equal(engine.rotationForSegment(315, 0, 4, 0), 315);
  assert.equal(engine.rotationForSegment(0, 0, 4, 0), 315);
});

test('invalid randomness and geometry fail explicitly instead of announcing an invalid winner', () => {
  for (const random of [-0.1, 1, NaN, Infinity, '0.5']) {
    assert.throws(() => engine.chooseWeightedSegment([{ weight: 1 }], () => random), RangeError);
  }
  for (const segments of [[], null, [{ weight: -1 }], [{ weight: NaN }], [{ weight: engine.MAX_WEIGHT * engine.MAX_QUANTITY + 1 }]]) {
    assert.throws(() => engine.chooseWeightedSegment(segments), RangeError);
  }
  for (const [rotation, count] of [[NaN, 4], [Infinity, 4], [0, 0], [0, 1.2], [0, 61]]) {
    assert.throws(() => engine.pointerIndex(rotation, count), RangeError);
  }
  assert.throws(() => engine.rotationForSegment(0, -1, 4), RangeError);
  assert.throws(() => engine.rotationForSegment(0, 4, 4), RangeError);
  assert.throws(() => engine.rotationForSegment(0, 0, 4, -1), RangeError);
  assert.throws(() => engine.rotationForSegment(0, 0, 4, 0.5), RangeError);
});

test('exhausted stock disappears and cannot be selected in either mode', () => {
  const input = settings([item({ quantity: 2 }), item({ id: 'second', quantity: 3 })]);
  for (const equalChance of [false, true]) {
    const config = { ...input, equalChance };
    assert.deepEqual(engine.buildSegments(config, { prize: 2 }).map(x => x.id), ['second']);
    assert.deepEqual(engine.probabilities(config, { prize: 2 }).map(x => x.probability), [0, 1]);
    assert.deepEqual(engine.buildSegments(config, { prize: 2, second: 3 }), []);
    assert.deepEqual(engine.probabilities(config, { prize: 2, second: 3 }).map(x => x.percent), [0, 0]);
  }
});

test('probabilities and weights update using remaining stock; large stock is compact', () => {
  const config = settings([item({ quantity: 1000, weight: 2 }), item({ id: 'second', quantity: 20, weight: 1 })]);
  const issued = { prize: 990 };
  assert.equal(engine.buildSegments(config, issued).length, 2);
  assert.deepEqual(engine.buildSegments(config, issued).map(x => x.weight), [20, 20]);
  assert.deepEqual(engine.probabilities(config, issued).map(x => x.percent), [50, 50]);
  assert.deepEqual(engine.probabilities({ ...config, equalChance: true }, issued).map(x => x.remaining), [10, 20]);
  assert.equal(engine.remainingCount(config.items[0], { prize: 1001 }), 0);
});
