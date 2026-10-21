'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function backend() {
    const sheets = new Map(), properties = new Map([['ADMIN_PASSWORD', 'test-password']]), sessions = new Map();
    let unavailable = false, held = false, failPublish = false;
    class Sheet {
        constructor() { this.cells = new Map(); this.rows = 1000; }
        getRange(row, col, height = 1, width = 1) {
            const range = {
                getValues: () => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => this.cells.get([row + r, col + c].join(',')) ?? '')),
                setValues: values => {
                    if (failPublish && row === 2) throw new Error('Simulated publish failure');
                    values.forEach((line, r) => line.forEach((value, c) => this.cells.set([row + r, col + c].join(','), value)));
                    return range;
                },
                getValue: () => range.getValues()[0][0], setValue: value => range.setValues([[value]]), setNumberFormat: () => range
            };
            return range;
        }
        getMaxRows() { return this.rows; }
        insertRowsAfter(_, count) { this.rows += count; }
        setFrozenRows() {}
    }
    const spreadsheet = { getId: () => 'test-sheet', getSheetByName: name => sheets.get(name),
        insertSheet: name => { const sheet = new Sheet(); sheets.set(name, sheet); return sheet; } };
    const lock = { waitLock() { assert.equal(held, false); held = true; }, tryLock() { if (unavailable) return false; assert.equal(held, false); held = true; return true; },
        hasLock: () => held, releaseLock() { held = false; } };
    const context = vm.createContext({
        console: { error() {} },
        PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value) }) },
        SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, flush() {} },
        LockService: { getScriptLock: () => lock },
        CacheService: { getScriptCache: () => ({ get: key => sessions.get(key), put: (key, value) => sessions.set(key, value) }) },
        Utilities: { getUuid: randomUUID, Charset: { UTF_8: 'UTF-8' }, base64Encode: text => Buffer.from(text).toString('base64'),
            base64Decode: text => Buffer.from(text, 'base64'), newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }) },
        ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
    });
    vm.runInContext(fs.readFileSync('backend/google-apps-script/GameModels.gs', 'utf8'), context);
    vm.runInContext(fs.readFileSync('backend/google-apps-script/Code.gs', 'utf8'), context);
    context.setup();
    const call = body => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text);
    return { call, sheets, context, properties, setUnavailable: value => { unavailable = value; }, failPublish: value => { failPublish = value; } };
}

function client(server, options = {}) {
    const data = new Map(), listeners = new Map();
    const context = {
        AbortController, setTimeout, clearTimeout, setInterval() {},
        localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) },
        sessionStorage: { getItem: () => '', setItem() {}, removeItem() {} },
        window: { JAO_CONFIG: { googleSheetsUrl: options.demo ? '' : 'https://script.google.com/macros/s/test-endpoint/exec' },
            crypto: { randomUUID }, addEventListener() {} },
        document: { dispatchEvent() {}, addEventListener: (name, callback) => listeners.set(name, callback) },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
        fetch: async (url, init) => {
            assert.equal(init.method, 'POST');
            assert.equal(init.credentials, 'omit');
            assert.equal(init.headers['Content-Type'], 'text/plain;charset=utf-8');
            if (options.offline) throw new Error('Offline');
            const body = JSON.parse(init.body);
            const result = server.call(body);
            if (options.loseDraw && body.action === 'draw') { options.loseDraw = false; throw new Error('Response lost after commit'); }
            if (options.hold && body.action === 'put') await options.hold;
            return { ok: true, json: async () => result };
        }
    };
    vm.runInNewContext(fs.readFileSync('app/storage/google-sheets-store.js', 'utf8'), context);
    return context.window.SharedStore;
}

test('Apps Script initializes four durable game states and setup preserves existing awards', () => {
    const server = backend();
    assert.deepEqual(Object.keys(server.call({ action: 'snapshot' }).states).sort(), ['claw', 'memory', 'quiz', 'wheel']);
    const first = server.call({ action: 'draw', game: 'wheel', requestId: randomUUID() });
    assert.equal(first.ok, true);
    server.context.setup();
    assert.equal(server.call({ action: 'get', game: 'wheel' }).value.logs.length, 1);
});

test('server draws cannot oversell, retrying an ID returns the same award, and lock contention rejects writes', () => {
    const server = backend();
    const id = randomUUID();
    const first = server.call({ action: 'draw', game: 'wheel', requestId: id });
    assert.deepEqual(server.call({ action: 'draw', game: 'wheel', requestId: id }), first);
    for (let i = 0; i < 5; i++) assert.equal(server.call({ action: 'draw', game: 'wheel', requestId: randomUUID() }).ok, true);
    assert.equal(server.call({ action: 'draw', game: 'wheel', requestId: randomUUID() }).code, 409);
    server.setUnavailable(true);
    assert.equal(server.call({ action: 'draw', game: 'claw', requestId: randomUUID() }).code, 503);
    server.setUnavailable(false);
    assert.equal(server.call({ action: 'get', game: 'claw' }).value.logs.length, 0);
});

test('admin authentication and version checks protect stock and memory settings', () => {
    const server = backend();
    assert.equal(server.call({ action: 'login', username: 'admin', password: 'wrong' }).code, 401);
    const token = server.call({ action: 'login', username: 'admin', password: 'test-password' }).token;
    const state = server.call({ action: 'get', game: 'memory' });
    state.value.timeLimit = 120;
    const update = { action: 'put', game: 'memory', value: state.value, version: state.version };
    assert.equal(server.call(update).code, 401);
    assert.equal(server.call({ ...update, token }).ok, true);
    assert.equal(server.call({ ...update, token }).code, 409);
    assert.equal(server.call({ action: 'get', game: 'memory' }).value.timeLimit, 120);
});

test('large images span multiple cells and an interrupted inactive write preserves the committed data', () => {
    const server = backend();
    const token = server.call({ action: 'login', username: 'admin', password: 'test-password' }).token;
    const state = server.call({ action: 'get', game: 'memory' });
    state.value.pairs[0].first = 'data:image/png;base64,' + 'A'.repeat(90000);
    assert.equal(server.call({ action: 'put', game: 'memory', value: state.value, version: state.version, token }).ok, true);
    const committed = server.call({ action: 'get', game: 'memory' });
    assert.equal(committed.value.pairs[0].first, state.value.pairs[0].first);
    server.failPublish(true);
    state.value.timeLimit = 220;
    assert.equal(server.call({ action: 'put', game: 'memory', value: state.value, version: committed.version, token }).ok, false);
    assert.deepEqual(server.call({ action: 'get', game: 'memory' }), committed);
});

test('guests can append a quiz score but cannot alter previous players or questions', () => {
    const server = backend();
    const state = server.call({ action: 'get', game: 'quiz' });
    state.value.players.push({ id: randomUUID(), name: 'ลูกค้าคาเฟ่', score: 5, timeMs: 5000, completedAt: new Date().toISOString() });
    assert.equal(server.call({ action: 'put', game: 'quiz', value: state.value, version: 0 }).ok, true);
    state.value.players[0].score = 0;
    assert.equal(server.call({ action: 'put', game: 'quiz', value: state.value, version: 1 }).code, 401);
});

test('owner migration imports a legacy database and refuses to overwrite an active database', () => {
    const server = backend();
    const snapshot = server.call({ action: 'snapshot' });
    const states = Object.fromEntries(Object.entries(snapshot.states).map(([game, record]) => [game, record.value]));
    const data = JSON.stringify({ schema: 1, states, versions: { wheel: 3, claw: 0, memory: 2, quiz: 1 } });
    server.properties.set('IMPORT_FILE_ID', 'test-import');
    server.context.DriveApp = { getFileById: () => ({ getBlob: () => ({ getDataAsString: () => data }) }) };
    server.context.importLegacyData();
    assert.equal(server.call({ action: 'get', game: 'wheel' }).version, 4);
    assert.throws(() => server.context.importLegacyData(), /new, unused database/);
});

test('two cloud clients reject stale admin updates and recover their cache', async () => {
    const server = backend(), a = client(server), b = client(server);
    await Promise.all([a.ready, b.ready]);
    await Promise.all([a.login('admin', 'test-password'), b.login('admin', 'test-password')]);
    const key = 'all-jao-games.memory.v1';
    const state = JSON.parse(a.getItem(key));
    state.timeLimit = 150;
    await a.setItem(key, JSON.stringify(state));
    state.timeLimit = 200;
    await assert.rejects(b.setItem(key, JSON.stringify(state)), /ข้อมูลเปลี่ยนจากเครื่องอื่น/);
    assert.equal(JSON.parse(b.getItem(key)).timeLimit, 150);
});

test('lost draw responses retry with the same ID without consuming another prize', async () => {
    const server = backend(), store = client(server, { loseDraw: true });
    await store.ready;
    const result = await store.draw('claw');
    assert.equal(result.value.logs.length, 1);
    assert.equal(server.call({ action: 'get', game: 'claw' }).version, 1);
});

test('offline cloud mode never falls back to a successful local save; empty URL enables demo', async () => {
    const server = backend(), options = {}, store = client(server, options);
    await store.ready;
    const key = 'all-jao-games.memory.v1';
    const value = store.getItem(key);
    options.offline = true;
    await assert.rejects(store.setItem(key, value), /Google Sheets/);
    assert.throws(() => store.getItem(key), /ยังอ่านข้อมูลร้านไม่ได้/);
    const demo = client(server, { demo: true });
    assert.equal(demo.mode, 'demo');
    demo.setItem(key, value);
    assert.equal(demo.getItem(key), value);
});
