'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function backend() {
    const sheets = new Map(), properties = new Map([['ADMIN_PASSWORD', 'test-password']]), sessions = new Map();
    let unavailable = false, held = false, failPublish = false, failReport = false, failAuditAck = false;
    class Sheet {
        constructor(name) { this.name = name; this.cells = new Map(); this.rows = 1000; }
        getRange(row, col, height = 1, width = 1) {
            const range = {
                getValues: () => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => this.cells.get([row + r, col + c].join(',')) ?? '')),
                setValues: values => {
                    if (failPublish && row === 2 && this.name.startsWith('jao_')) throw new Error('Simulated publish failure');
                    if (failAuditAck && row === 2 && col === 6 && this.name.startsWith('jao_')) throw new Error('Simulated history acknowledgement failure');
                    if (failReport && row > 1 && !this.name.startsWith('jao_')) throw new Error('Simulated history failure');
                    values.forEach((line, r) => line.forEach((value, c) => this.cells.set([row + r, col + c].join(','), value)));
                    return range;
                },
                getValue: () => range.getValues()[0][0], setValue: value => range.setValues([[value]]), setNumberFormat: () => range,
                setBackground: () => range, setFontColor: () => range, setFontWeight: () => range, setWrap: () => range, createFilter: () => range,
                clearContent: () => { for (let r = row; r < row + height; r++) for (let c = col; c < col + width; c++) this.cells.delete([r, c].join(',')); return range; }
            };
            return range;
        }
        getMaxRows() { return this.rows; }
        insertRowsAfter(_, count) { this.rows += count; }
        setFrozenRows() {}
        setColumnWidths() {}
        getLastRow() { return Math.max(0, ...[...this.cells.keys()].map(key => Number(key.split(',')[0]))); }
    }
    const spreadsheet = { getId: () => 'test-sheet', getSheetByName: name => sheets.get(name),
        insertSheet: name => { const sheet = new Sheet(name); sheets.set(name, sheet); return sheet; } };
    const lock = { waitLock() { assert.equal(held, false); held = true; }, tryLock() { if (unavailable) return false; assert.equal(held, false); held = true; return true; },
        hasLock: () => held, releaseLock() { held = false; } };
    const context = vm.createContext({
        console: { error() {} },
        PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value) }) },
        SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, flush() {} },
        LockService: { getScriptLock: () => lock },
        CacheService: { getScriptCache: () => ({ get: key => sessions.get(key), put: (key, value) => sessions.set(key, value) }) },
        Utilities: { getUuid: randomUUID, Charset: { UTF_8: 'UTF-8' }, base64Encode: text => Buffer.from(text).toString('base64'),
            base64Decode: text => Buffer.from(text, 'base64'), newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
            formatDate: (date, zone, pattern) => {
                assert.equal(zone, 'Asia/Bangkok');
                const local = new Date(date.getTime() + 7 * 3600000).toISOString();
                return pattern === 'yyyy-MM-dd' ? local.slice(0, 10) : pattern === 'HH:mm:ss' ? local.slice(11, 19) : local.slice(0, 19).replace('T', ' ');
            } },
        ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
    });
    vm.runInContext(fs.readFileSync('backend/google-apps-script/GameModels.gs', 'utf8'), context);
    vm.runInContext(fs.readFileSync('backend/google-apps-script/Code.gs', 'utf8'), context);
    context.setup();
    const call = body => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text);
    return { call, sheets, context, properties, setUnavailable: value => { unavailable = value; }, failPublish: value => { failPublish = value; }, failReport: value => { failReport = value; }, failAuditAck: value => { failAuditAck = value; } };
}

function client(server, options = {}) {
    const data = options.data || new Map(), listeners = new Map();
    const context = {
        AbortController, setTimeout, clearTimeout, setInterval() {},
        localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
            removeItem: key => data.delete(key), key: index => [...data.keys()][index] ?? null, get length() { return data.size; } },
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
            if (options.losePlay && body.action === 'play') { options.losePlay = false; throw new Error('Play response lost after commit'); }
            if (options.loseRestock && body.action === 'restock') { options.loseRestock = false; throw new Error('Restock response lost after commit'); }
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

function reportRows(server, name) {
    const sheet = server.sheets.get(name);
    const width = name === 'ประวัติจับคู่' ? 11 : name === 'ประวัติควิซ' ? 10 : name === 'สรุปสต็อก' ? 8 : 14;
    return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
}
function adminToken(server) { return server.call({ action: 'login', username: 'admin', password: 'test-password' }).token; }
function memoryPlay(stage = 'finish', overrides = {}) {
    return { id: randomUUID(), stage, outcome: stage === 'start' ? 'started' : 'won', total: 8,
        matched: stage === 'start' ? 0 : 8, durationMs: stage === 'start' ? 0 : 5000,
        startedAt: '2026-10-22T18:30:00.000Z', endedAt: stage === 'start' ? '' : '2026-10-22T18:30:05.000Z', ...overrides };
}

test('readable histories use Bangkok dates, preserve numeric inventory, and deduplicate draw retries', () => {
    const server = backend(), id = randomUUID();
    const first = server.call({ action: 'draw', game: 'wheel', requestId: id });
    assert.equal(first.ok, true);
    server.call({ action: 'draw', game: 'wheel', requestId: id });
    const rows = reportRows(server, 'ประวัติวงล้อ').filter(row => row[12] === 'draw:' + id);
    assert.equal(rows.length, 1);
    const row = rows[0], item = first.value.settings.items.find(prize => prize.id === first.prize.id);
    assert.equal(row[3], 'ออกรางวัล');
    assert.equal(row[4], first.prize.label);
    assert.equal(row[5], 1); assert.equal(row[6], 1);
    assert.equal(row[7], item.quantity); assert.equal(row[8], item.quantity - 1);
    assert.equal(row[9], item.quantity);
    assert.equal(server.context.thaiTime_('2026-10-22T18:30:00.000Z'), '2026-10-23 01:30:00');
    const inventory = reportRows(server, 'สรุปสต็อก').find(stock => stock[0] === 'วงล้อ' && stock[7] === first.prize.id);
    assert.equal(inventory[4], 1); assert.equal(inventory[5], item.quantity - 1);
});

test('restocking creates a new round separator, preserves old awards and retries exactly once', () => {
    for (const game of ['wheel', 'claw']) {
        const server = backend(), token = adminToken(server);
        const award = server.call({ action: 'draw', game, requestId: randomUUID() });
        const request = { action: 'restock', game, version: award.version, requestId: randomUUID(), token };
        assert.equal(server.call({ ...request, token: '' }).code, 401);
        const reset = server.call(request);
        assert.equal(reset.ok, true);
        assert.equal(reset.value.logs.length, 1);
        assert.deepEqual(reset.value.issued, {});
        assert.equal(server.call(request).version, reset.version);
        const reportName = game === 'wheel' ? 'ประวัติวงล้อ' : 'ประวัติตู้คีบ';
        const rows = reportRows(server, reportName);
        const boundaries = rows.filter(row => row[3] === 'รีสต็อก / เริ่มรอบใหม่');
        assert.equal(boundaries.length, 1); assert.equal(boundaries[0][2], 2);
        const next = server.call({ action: 'draw', game, requestId: randomUUID() });
        assert.equal(next.value.logs.length, 2);
        const draws = reportRows(server, reportName).filter(row => row[3] === 'ออกรางวัล');
        assert.deepEqual(draws.map(row => row[2]), [1, 2]);
        assert.equal(draws[1][6], 1);
        const previousCount = reportRows(server, reportName).length;
        server.context.setup();
        assert.equal(reportRows(server, reportName).length, previousCount);
    }
});

test('a failed report write is repaired from the committed journal without issuing another prize', () => {
    const server = backend(), id = randomUUID();
    server.failReport(true);
    assert.equal(server.call({ action: 'draw', game: 'wheel', requestId: id }).ok, true);
    assert.equal(server.context.readGame_(server.sheets.get('jao_wheel')).value.logs.length, 1);
    assert.equal(server.call({ action: 'draw', game: 'wheel', requestId: id }).ok, true);
    assert.equal(server.call({ action: 'draw', game: 'wheel', requestId: randomUUID() }).code, 503);
    server.failReport(false);
    const recovered = server.call({ action: 'draw', game: 'wheel', requestId: id });
    assert.equal(recovered.ok, true); assert.equal(recovered.value.logs.length, 1);
    assert.equal(reportRows(server, 'ประวัติวงล้อ').filter(row => row[12] === 'draw:' + id).length, 1);
});

test('a failed state publication cannot leave a phantom award in the readable history', () => {
    const server = backend(), id = randomUUID();
    server.failPublish(true);
    assert.equal(server.call({ action: 'draw', game: 'claw', requestId: id }).ok, false);
    server.failPublish(false);
    assert.equal(server.call({ action: 'get', game: 'claw' }).value.logs.length, 0);
    assert.equal(reportRows(server, 'ประวัติตู้คีบ').filter(row => row[12] === 'draw:' + id).length, 0);
});

test('retrying after history was appended but not acknowledged cannot duplicate report rows', () => {
    const server = backend(), id = randomUUID();
    server.failAuditAck(true);
    assert.equal(server.call({ action: 'draw', game: 'wheel', requestId: id }).ok, true);
    assert.equal(reportRows(server, 'ประวัติวงล้อ').filter(row => row[12] === 'draw:' + id).length, 1);
    server.failAuditAck(false);
    assert.equal(server.call({ action: 'draw', game: 'wheel', requestId: id }).ok, true);
    assert.equal(reportRows(server, 'ประวัติวงล้อ').filter(row => row[12] === 'draw:' + id).length, 1);
});

test('deleting website histories preserves Sheets audit rows and cannot replay a deleted draw ID', () => {
    const server = backend(), id = randomUUID(), token = adminToken(server);
    const award = server.call({ action: 'draw', game: 'wheel', requestId: id });
    const value = { ...award.value, logs: [] };
    assert.equal(server.call({ action: 'put', game: 'wheel', value, version: award.version, token }).ok, true);
    const retry = server.call({ action: 'draw', game: 'wheel', requestId: id });
    assert.equal(retry.ok, true); assert.equal(retry.value.logs.length, 0);
    assert.deepEqual(retry.value.issued, award.value.issued);
    assert.equal(reportRows(server, 'ประวัติวงล้อ').filter(row => row[12] === 'draw:' + id).length, 1);
    assert.ok(reportRows(server, 'ประวัติวงล้อ').some(row => row[3] === 'ลบประวัติจากหน้าเว็บ'));
});

test('quiz results remain readable after leaderboard deletion and player names cannot become formulas', () => {
    const server = backend(), token = adminToken(server);
    const current = server.call({ action: 'get', game: 'quiz' });
    const player = { id: randomUUID(), name: '=IMPORTXML("test")', score: 4, timeMs: 7500, completedAt: '2026-10-22T18:30:00.000Z' };
    current.value.players.push(player);
    const saved = server.call({ action: 'put', game: 'quiz', value: current.value, version: current.version });
    assert.equal(saved.ok, true);
    const row = reportRows(server, 'ประวัติควิซ').find(record => record[9] === 'quiz:' + player.id);
    assert.equal(row[0], '2026-10-23'); assert.equal(row[1], '01:30:00');
    assert.equal(row[3], "'" + player.name); assert.equal(row[4], 4); assert.equal(row[6], 7.5);
    saved.value.players = [];
    assert.equal(server.call({ action: 'put', game: 'quiz', value: saved.value, version: saved.version, token }).ok, true);
    assert.equal(reportRows(server, 'ประวัติควิซ').filter(record => record[9] === 'quiz:' + player.id).length, 1);
});

test('memory history records start, win, timeout and cancellation with safe validation and no duplicate finishes', () => {
    const server = backend();
    const start = memoryPlay('start');
    assert.equal(server.call({ action: 'play', game: 'memory', play: start }).ok, true);
    const finish = memoryPlay('finish', { id: start.id });
    assert.equal(server.call({ action: 'play', game: 'memory', play: finish }).ok, true);
    assert.equal(server.call({ action: 'play', game: 'memory', play: finish }).ok, true);
    for (const outcome of ['timeout', 'cancelled']) {
        assert.equal(server.call({ action: 'play', game: 'memory', play: memoryPlay('finish', { outcome, matched: 3 }) }).ok, true);
    }
    assert.equal(server.call({ action: 'play', game: 'memory', play: memoryPlay('finish', { matched: 9 }) }).code, 400);
    const rows = reportRows(server, 'ประวัติจับคู่');
    assert.equal(rows.filter(row => row[10] === 'play:' + finish.id + ':finish').length, 1);
    assert.deepEqual(rows.filter(row => row[3]).map(row => row[3]), ['เริ่มเล่น', 'จับคู่ครบ', 'หมดเวลา', 'ออกจากเกม / เริ่มใหม่']);
    assert.equal(rows.find(row => row[3] === 'จับคู่ครบ')[6], 5);
    assert.equal(rows.find(row => row[3] === 'จับคู่ครบ')[0], '2026-10-23');
    assert.equal(rows.find(row => row[3] === 'จับคู่ครบ')[1], '01:30:05');
});

test('legacy encoded states are upgraded without losing stock, versions or surviving historical results', () => {
    const server = backend();
    const award = server.call({ action: 'draw', game: 'wheel', requestId: randomUUID() });
    const before = server.call({ action: 'snapshot' });
    for (const game of ['wheel', 'claw', 'memory', 'quiz']) {
        const record = before.states[game], sheet = server.sheets.get('jao_' + game);
        const encoded = Buffer.from(JSON.stringify(record.value)).toString('base64');
        const chunks = encoded.match(/.{1,40000}/g).map(chunk => [chunk]);
        sheet.getRange(5, 1, chunks.length, 1).setValues(chunks);
        sheet.getRange(2, 1, 1, 6).setValues([[record.version, 1, 'old-data', '', chunks.length, '']]);
    }
    for (const name of [...server.sheets.keys()]) if (!name.startsWith('jao_')) server.sheets.delete(name);
    server.context.setup();
    assert.deepEqual(server.call({ action: 'snapshot' }), before);
    const rows = reportRows(server, 'ประวัติวงล้อ').filter(row => row[3] === 'รางวัลเดิม');
    assert.equal(rows.length, 1); assert.equal(rows[0][2], 'เดิม'); assert.equal(rows[0][4], award.prize.label);
    const count = reportRows(server, 'ประวัติวงล้อ').length;
    server.context.setup();
    assert.equal(reportRows(server, 'ประวัติวงล้อ').length, count);
});

test('memory results queued while offline survive a new client and lost responses do not duplicate rows', async () => {
    const server = backend(), data = new Map(), options = { data };
    const first = client(server, options);
    await first.ready;
    const play = memoryPlay();
    options.offline = true;
    await assert.rejects(first.recordPlay('memory', play), /Google Sheets/);
    assert.equal([...data.keys()].filter(key => key.startsWith('jao.pending-play.v1:')).length, 1);
    const second = client(server, { data, losePlay: true });
    await second.ready;
    await second.retryPlays();
    assert.equal([...data.keys()].filter(key => key.startsWith('jao.pending-play.v1:')).length, 0);
    assert.equal(reportRows(server, 'ประวัติจับคู่').filter(row => row[10] === 'play:' + play.id + ':finish').length, 1);
});

test('a lost restock response preserves exactly one new stock round', async () => {
    const server = backend(), store = client(server, { loseRestock: true });
    await store.ready; await store.login('admin', 'test-password');
    const result = await store.restock('wheel');
    assert.equal(result.version, 1);
    const boundaries = reportRows(server, 'ประวัติวงล้อ').filter(row => row[3] === 'รีสต็อก / เริ่มรอบใหม่');
    assert.equal(boundaries.length, 1); assert.equal(boundaries[0][2], 2);
});

test('two offline tabs cannot overwrite each other\'s pending memory history', async () => {
    const server = backend(), data = new Map(), optionsA = { data }, optionsB = { data };
    const a = client(server, optionsA), b = client(server, optionsB);
    await Promise.all([a.ready, b.ready]);
    optionsA.offline = true; optionsB.offline = true;
    const plays = [memoryPlay(), memoryPlay('finish', { outcome: 'cancelled', matched: 2 })];
    await assert.rejects(a.recordPlay('memory', plays[0]));
    await assert.rejects(b.recordPlay('memory', plays[1]));
    assert.equal([...data.keys()].filter(key => key.startsWith('jao.pending-play.v1:')).length, 2);
    const recovered = client(server, { data });
    await recovered.ready; await recovered.retryPlays();
    for (const play of plays) assert.equal(reportRows(server, 'ประวัติจับคู่').filter(row => row[10] === 'play:' + play.id + ':finish').length, 1);
    assert.equal([...data.keys()].filter(key => key.startsWith('jao.pending-play.v1:')).length, 0);
});
