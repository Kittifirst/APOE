/* Paste this file and GameModels.gs into the Apps Script project bound to your Sheet. */
var GAME_NAMES = ['wheel', 'claw', 'memory', 'quiz'];
var CHUNK_SIZE = 40000;

function setup() {
    var properties = PropertiesService.getScriptProperties();
    if (!properties.getProperty('ADMIN_PASSWORD')) throw new Error('Set ADMIN_PASSWORD in Project Settings > Script properties first.');
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw new Error('Open Apps Script from your Google Sheet: Extensions > Apps Script.');
    properties.setProperty('SPREADSHEET_ID', spreadsheet.getId());
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
        var defaults = {
            wheel: WheelState.create(WheelEngine.DEFAULT_SETTINGS),
            claw: WheelState.create(CLAW_DEFAULT_SETTINGS),
            memory: MemoryGame.createDefault(),
            quiz: { questions: QuizGame.DEFAULT_QUESTIONS, players: [] }
        };
        GAME_NAMES.forEach(function (game) {
            if (spreadsheet.getSheetByName('jao_' + game)) return;
            var sheet = spreadsheet.insertSheet('jao_' + game);
            sheet.getRange(1, 1, 1, 6).setValues([['version', 'active_slot', 'request_id', 'updated_at', 'chunk_count', 'history_committed']]);
            sheet.getRange(2, 1, 1, 5).setValues([[0, 2, '', '', 0]]);
            sheet.getRange(3, 1).setValue('Internal game data. Edit settings through the website; do not edit these encoded cells.');
            writeGame_(sheet, defaults[game], 0, 'setup', newJournal_(1, openingEvents_(game, defaults[game], 1, 'เริ่มบันทึกประวัติ')));
            sheet.setFrozenRows(3);
        });
        GAME_NAMES.forEach(function (game) {
            if (auditRecord_(spreadsheet, game, gameSheet_(spreadsheet, game)).auditPending) throw new Error('History report could not be written. Run setup again after checking the Sheet permissions.');
        });
    } finally { lock.releaseLock(); }
}

function doGet() { return json_({ ok: true, service: 'A Place on earth · Google Sheets', schema: 2, readableHistory: true }); }
function doPost(event) {
    var lock;
    try {
        if (!event || !event.postData || event.postData.contents.length > 4000000) return json_({ ok: false, code: 400, error: 'ข้อมูลคำขอไม่ถูกต้องหรือมีขนาดใหญ่เกินไป' });
        var body = JSON.parse(event.postData.contents);
        if (body.action === 'login') return json_(login_(body));
        var spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
        if (!spreadsheetId) throw new Error('ยังไม่ได้ตั้งค่าฐานข้อมูล กรุณารัน setup ใน Apps Script');
        lock = LockService.getScriptLock();
        if (!lock.tryLock(20000)) return json_({ ok: false, code: 503, error: 'มีผู้ใช้งานพร้อมกัน กรุณาลองใหม่สักครู่' });
        var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
        if (body.action === 'snapshot' || body.action === 'versions') {
            var states = {}, versions = {};
            GAME_NAMES.forEach(function (game) {
                var sheet = gameSheet_(spreadsheet, game);
                if (body.action === 'snapshot') {
                    var record = auditRecord_(spreadsheet, game, sheet);
                    states[game] = { value: record.value, version: record.version }; versions[game] = record.version;
                }
                else versions[game] = sheet.getRange(2, 1).getValue();
            });
            return json_({ ok: true, states: states, versions: versions });
        }
        if (GAME_NAMES.indexOf(body.game) < 0) return json_({ ok: false, code: 400, error: 'ไม่พบเกมนี้' });
        var sheet = gameSheet_(spreadsheet, body.game);
        var current = auditRecord_(spreadsheet, body.game, sheet);
        if (body.action === 'get') return json_({ ok: true, value: current.value, version: current.version });
        if (body.action === 'draw') {
            if (body.game !== 'wheel' && body.game !== 'claw') return json_({ ok: false, code: 400, error: 'เกมนี้ไม่รองรับการสุ่ม' });
            if (typeof body.requestId !== 'string' || !/^[\w-]{16,100}$/.test(body.requestId)) return json_({ ok: false, code: 400, error: 'รหัสการสุ่มไม่ถูกต้อง' });
            var existing = current.value.logs.find(function (log) { return log.id === body.requestId; });
            if (existing) {
                var original = current.value.settings.items.find(function (item) { return item.id === existing.prizeId; });
                return json_({ ok: true, value: current.value, version: current.version, prize: { id: existing.prizeId, label: existing.label, color: original ? original.color : '#b84720' } });
            }
            if (current.auditPending) return historyPending_();
            var oldAward = findHistoryRow_(spreadsheet, body.game, 'draw:' + body.requestId);
            if (oldAward) return json_({ ok: true, value: current.value, version: current.version,
                prize: { id: oldAward[13], label: oldAward[4], color: '#b84720' } });
            var segments = WheelEngine.buildSegments(current.value.settings, current.value.issued);
            if (!segments.some(function (item) { return item.weight > 0; })) return json_({ ok: false, code: 409, error: 'รางวัลหมดแล้ว กรุณาติดต่อผู้ดูแลร้าน' });
            var prize = segments[WheelEngine.chooseWeightedSegment(segments, Math.random)];
            var awarded = WheelState.award(current.value, prize.id, body.requestId, new Date().toISOString());
            var drawEvent = stockEvent_(awarded, prize.id, current.audit.round, 'ออกรางวัล', 'draw:' + body.requestId);
            drawEvent.out = 1; drawEvent.before = drawEvent.remaining + 1;
            commitAudited_(spreadsheet, body.game, sheet, awarded, current.version + 1, body.requestId, current.audit.round, [drawEvent]);
            return json_({ ok: true, value: awarded, version: current.version + 1, prize: { id: prize.id, label: prize.label, color: prize.color } });
        }
        if (body.action === 'play') {
            if (body.game !== 'memory' || !validPlay_(body.play)) return json_({ ok: false, code: 400, error: 'ผลการเล่นไม่ถูกต้อง' });
            var playId = 'play:' + body.play.id + ':' + body.play.stage;
            if (current.audit.events.some(function (event) { return event.id === playId; })) return json_({ ok: true, value: current.value, version: current.version });
            if (current.auditPending) return historyPending_();
            if (!findHistoryRow_(spreadsheet, 'memory', playId)) {
                var playEvent = { id: playId, time: body.play.stage === 'start' ? body.play.startedAt : body.play.endedAt,
                    action: body.play.stage === 'start' ? 'เริ่มเล่น' : 'จบการเล่น', play: body.play,
                    note: 'รับบันทึกเข้าระบบ: ' + thaiTime_(new Date().toISOString()) };
                commitAudited_(spreadsheet, 'memory', sheet, current.value, current.version + 1, playId, current.audit.round, [playEvent]);
                current.version += 1;
            }
            return json_({ ok: true, value: current.value, version: current.version });
        }
        if (body.action !== 'put' && body.action !== 'restock') return json_({ ok: false, code: 400, error: 'ไม่รู้จักคำสั่งนี้' });
        var admin = isAdmin_(body.token);
        if (body.action === 'restock') {
            if (!admin) return json_({ ok: false, code: 401, error: 'กรุณาเข้าสู่ระบบผู้ดูแลร้านอีกครั้ง' });
            if (body.game !== 'wheel' && body.game !== 'claw') return json_({ ok: false, code: 400, error: 'เกมนี้ไม่มีสต็อกรางวัล' });
            if (typeof body.requestId !== 'string' || !/^[\w-]{16,100}$/.test(body.requestId)) return json_({ ok: false, code: 400, error: 'รหัสการรีสต็อกไม่ถูกต้อง' });
            if (current.audit.events.some(function (event) { return event.id === 'restock:' + body.requestId; })) return json_({ ok: true, value: current.value, version: current.version });
            if (current.auditPending) return historyPending_();
            if (findHistoryRow_(spreadsheet, body.game, 'restock:' + body.requestId)) return json_({ ok: true, value: current.value, version: current.version });
        }
        if (current.auditPending) return historyPending_();
        if (!Number.isSafeInteger(body.version) || body.version !== current.version) return json_({ ok: false, code: 409, error: 'ข้อมูลเปลี่ยนจากเครื่องอื่นแล้ว กรุณาลองบันทึกอีกครั้ง' });
        if (body.action === 'restock') {
            body.value = WheelState.resetStock(current.value);
        }
        if (!validState_(body.game, body.value)) return json_({ ok: false, code: 400, error: 'ข้อมูลเกมไม่ถูกต้อง' });
        if (!admin && !guestScore_(body.game, current.value, body.value)) return json_({ ok: false, code: 401, error: 'กรุณาเข้าสู่ระบบผู้ดูแลร้านอีกครั้ง' });
        var reset = body.action === 'restock' || ((body.game === 'wheel' || body.game === 'claw') &&
            Object.keys(current.value.issued).some(function (id) { return (body.value.issued[id] || 0) < current.value.issued[id]; }));
        var round = current.audit.round + (reset ? 1 : 0);
        var events = reset ? restockEvents_(current.value, body.value, round) : changeEvents_(body.game, current.value, body.value, round, admin);
        if (body.action === 'restock') events[0].id = 'restock:' + body.requestId;
        commitAudited_(spreadsheet, body.game, sheet, body.value, current.version + 1, 'update', round, events);
        return json_({ ok: true, value: body.value, version: current.version + 1 });
    } catch (error) {
        console.error(error);
        return json_({ ok: false, code: 500, error: 'ระบบข้อมูลร้านยังไม่พร้อม กรุณาตรวจสอบการตั้งค่า Apps Script' });
    } finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}

function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function historyPending_() { return json_({ ok: false, code: 503, error: 'ประวัติก่อนหน้ายังบันทึกลงตารางไม่ครบ กรุณาลองใหม่สักครู่' }); }
function gameSheet_(spreadsheet, game) {
    var sheet = spreadsheet.getSheetByName('jao_' + game);
    if (!sheet) throw new Error('Missing sheet. Run setup first.');
    return sheet;
}
function readStoredGame_(sheet) {
    var metadata = sheet.getRange(2, 1, 1, 6).getValues()[0];
    if (!Number.isSafeInteger(metadata[0]) || metadata[4] < 1) throw new Error('Invalid state metadata');
    var encoded = sheet.getRange(5, metadata[1], metadata[4], 1).getValues().map(function (row) { return row[0]; }).join('');
    var stored = JSON.parse(Utilities.newBlob(Utilities.base64Decode(encoded)).getDataAsString('UTF-8'));
    return { value: stored.__jaoStore === 2 ? stored.value : stored, version: metadata[0],
        audit: stored.__jaoStore === 2 ? stored.audit : null, auditAck: metadata[5] };
}
function readGame_(sheet) { var record = readStoredGame_(sheet); return { value: record.value, version: record.version }; }
function writeGame_(sheet, value, version, requestId, audit) {
    var encoded = Utilities.base64Encode(JSON.stringify({ __jaoStore: 2, value: value, audit: audit }), Utilities.Charset.UTF_8);
    var rows = [];
    for (var index = 0; index < encoded.length; index += CHUNK_SIZE) rows.push([encoded.slice(index, index + CHUNK_SIZE)]);
    if (sheet.getMaxRows() < rows.length + 4) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 4 - sheet.getMaxRows());
    var slot = Number(sheet.getRange(2, 2).getValue()) === 1 ? 2 : 1;
    // Write an inactive copy first. Publishing metadata switches the committed state in one operation.
    sheet.getRange(5, slot, rows.length, 1).setNumberFormat('@').setValues(rows);
    SpreadsheetApp.flush();
    sheet.getRange(2, 1, 1, 6).setValues([[version, slot, requestId, new Date().toISOString(), rows.length, '']]);
    SpreadsheetApp.flush();
}
function validState_(game, value) {
    if (game === 'memory') return MemoryGame.validate(value);
    if (game === 'quiz') return QuizGame.validateState(value) && new Set(value.players.map(function (p) { return p.id; })).size === value.players.length;
    return WheelState.validate(value) && value.settings.items.every(function (item) { return item.quantity >= WheelEngine.issuedCount(item, value.issued); });
}
function guestScore_(game, previous, next) {
    if (game !== 'quiz' || JSON.stringify(previous.questions) !== JSON.stringify(next.questions) || next.players.length !== previous.players.length + 1) return false;
    if (JSON.stringify(previous.players) !== JSON.stringify(next.players.slice(0, -1))) return false;
    var player = next.players[next.players.length - 1];
    return player.name.trim().length > 0 && player.name.length <= 50 && Number.isFinite(Date.parse(player.completedAt)) &&
        !previous.players.some(function (p) { return p.id === player.id; });
}
function login_(body) {
    var properties = PropertiesService.getScriptProperties();
    var password = properties.getProperty('ADMIN_PASSWORD');
    var username = properties.getProperty('ADMIN_USERNAME') || 'admin';
    if (!password || body.username !== username || body.password !== password) return { ok: false, code: 401, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    var token = Utilities.getUuid() + Utilities.getUuid();
    CacheService.getScriptCache().put('admin:' + token, 'yes', 3600);
    return { ok: true, token: token };
}
function isAdmin_(token) { return typeof token === 'string' && token.length < 100 && CacheService.getScriptCache().get('admin:' + token) === 'yes'; }

// Owner-only editor function. This is deliberately not exposed by doPost.
function importLegacyData() {
    var properties = PropertiesService.getScriptProperties();
    var fileId = properties.getProperty('IMPORT_FILE_ID');
    if (!fileId) throw new Error('Set IMPORT_FILE_ID to your private JSON file in Google Drive.');
    var data = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8'));
    if (!data || data.schema !== 1 || !data.states || !data.versions || !GAME_NAMES.every(function (game) {
        return Number.isSafeInteger(data.versions[game]) && data.versions[game] >= 0 && validState_(game, data.states[game]);
    })) throw new Error('Invalid legacy database. Nothing was imported.');
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
        var spreadsheet = SpreadsheetApp.openById(properties.getProperty('SPREADSHEET_ID'));
        if (!GAME_NAMES.every(function (game) { return gameSheet_(spreadsheet, game).getRange(2, 1).getValue() === 0; })) {
            throw new Error('Import is only allowed into a new, unused database. Create a new Sheet to preserve current data.');
        }
        GAME_NAMES.forEach(function (game) {
            var events = legacyEvents_(game, data.states[game]).concat(openingEvents_(game, data.states[game], 1, 'นำเข้าข้อมูลเดิม'));
            commitAudited_(spreadsheet, game, gameSheet_(spreadsheet, game), data.states[game], data.versions[game] + 1, 'legacy-import', 1, events);
        });
    } finally { lock.releaseLock(); }
}

// Readable reports are append-only. The encoded state contains the last committed
// report batch, so a failed Sheets write can be retried before the next mutation.
var HISTORY_NAMES = { wheel: 'ประวัติวงล้อ', claw: 'ประวัติตู้คีบ', memory: 'ประวัติจับคู่', quiz: 'ประวัติควิซ' };
var STOCK_HEADERS = ['วันที่ (ไทย)', 'เวลา (ไทย)', 'รอบสต็อก', 'รายการ', 'ของรางวัล', 'ออกครั้งนี้', 'ออกสะสมในรอบ', 'เหลือก่อนรายการ', 'เหลือหลังรายการ', 'จำนวนที่ตั้งไว้', 'ผู้ทำรายการ', 'หมายเหตุ', 'รหัสรายการ', 'รหัสรางวัล'];
var MEMORY_HEADERS = ['วันที่ (ไทย)', 'เวลา (ไทย)', 'รายการ', 'ผลการเล่น', 'จับคู่ได้', 'คู่ทั้งหมด', 'เวลาใช้ (วินาที)', 'เริ่มเล่น (ไทย)', 'จบเล่น (ไทย)', 'หมายเหตุ', 'รหัสรายการ'];
var QUIZ_HEADERS = ['วันที่ (ไทย)', 'เวลา (ไทย)', 'รายการ', 'ชื่อผู้เล่น', 'คะแนน', 'คะแนนเต็ม', 'เวลาใช้ (วินาที)', 'จบเล่น (ไทย)', 'หมายเหตุ', 'รหัสรายการ'];
var INVENTORY_HEADERS = ['เกม', 'รอบสต็อก', 'ของรางวัล', 'จำนวนที่ตั้งไว้', 'ออกสะสมในรอบ', 'คงเหลือ', 'ปรับปรุงล่าสุด (ไทย)', 'รหัสรางวัล'];

function thaiTime_(time, pattern) { return Utilities.formatDate(new Date(time), 'Asia/Bangkok', pattern || 'yyyy-MM-dd HH:mm:ss'); }
function newJournal_(round, events) { return { transactionId: Utilities.getUuid(), round: round, events: events }; }
function adminName_() { return 'ผู้ดูแล: ' + (PropertiesService.getScriptProperties().getProperty('ADMIN_USERNAME') || 'admin'); }
function stockEvent_(value, id, round, action, eventId) {
    var item = value.settings.items.find(function (prize) { return prize.id === id; });
    var issued = WheelEngine.issuedCount(item, value.issued);
    return { id: eventId || Utilities.getUuid(), time: new Date().toISOString(), round: round, action: action,
        prizeId: id, label: item.label, out: 0, issued: issued, before: item.quantity - issued,
        remaining: item.quantity - issued, total: item.quantity, actor: action === 'ออกรางวัล' ? 'ผู้เล่น' : adminName_() };
}
function openingEvents_(game, value, round, action) {
    var boundary = { id: Utilities.getUuid(), time: new Date().toISOString(), round: round, action: action, boundary: true, actor: adminName_() };
    if (game !== 'wheel' && game !== 'claw') return [boundary];
    return [boundary].concat(value.settings.items.map(function (item) {
        return stockEvent_(value, item.id, round, 'ยอดยกมา');
    }));
}
function restockEvents_(previous, next, round) {
    var events = openingEvents_('wheel', next, round, 'รีสต็อก / เริ่มรอบใหม่');
    events[0].note = 'จบรอบ ' + (round - 1) + ' · ประวัติและยอดจ่ายรอบเดิมยังอยู่ครบ';
    events.slice(1).forEach(function (event) {
        var item = previous.settings.items.find(function (prize) { return prize.id === event.prizeId; });
        event.action = 'เติมสต็อก';
        event.before = item ? item.quantity - WheelEngine.issuedCount(item, previous.issued) : 0;
        event.note = 'รอบก่อนออกแล้ว ' + (item ? WheelEngine.issuedCount(item, previous.issued) : 0) + ' ชิ้น';
    });
    return events;
}
function legacyEvents_(game, value) {
    if (game === 'memory') return [];
    if (game === 'quiz') return value.players.slice().sort(function (a, b) { return Date.parse(a.completedAt) - Date.parse(b.completedAt); }).map(function (player) {
        return { id: 'quiz:' + player.id, time: player.completedAt, action: 'ผลควิซเดิม', player: player, note: 'นำเข้าประวัติที่ยังมีอยู่ก่อนเปิดรายงาน' };
    });
    return value.logs.slice().sort(function (a, b) { return Date.parse(a.time) - Date.parse(b.time); }).map(function (log) {
        return { id: 'draw:' + log.id, time: log.time, round: 'เดิม', action: 'รางวัลเดิม', prizeId: log.prizeId, label: log.label,
            out: 1, remaining: log.remaining, before: log.remaining + 1, actor: 'ผู้เล่น',
            note: 'ไม่ทราบรอบและยอดสะสมเดิม · นำเข้าจากประวัติที่ยังมีอยู่' };
    });
}
function changeEvents_(game, previous, next, round, admin) {
    var now = new Date().toISOString(), events = [];
    if (game === 'quiz') {
        var known = new Set(previous.players.map(function (player) { return player.id; }));
        next.players.forEach(function (player) {
            if (!known.has(player.id)) events.push({ id: 'quiz:' + player.id, time: player.completedAt, action: 'จบควิซ', player: player });
        });
        var removed = previous.players.filter(function (player) { return !next.players.some(function (p) { return p.id === player.id; }); }).length;
        if (admin && (removed || JSON.stringify(previous.questions) !== JSON.stringify(next.questions))) {
            events.push({ id: Utilities.getUuid(), time: now, action: 'ผู้ดูแลปรับข้อมูล', note: adminName_() + ' · คำถาม ' + previous.questions.length + ' → ' + next.questions.length + ' ข้อ · ลบคะแนนจากหน้าเว็บ ' + removed + ' รายการ (ประวัติในชีตยังอยู่)' });
        }
    } else if (game === 'memory') {
        events.push({ id: Utilities.getUuid(), time: now, action: 'ผู้ดูแลตั้งค่าเกม', note: adminName_() + ' · เวลา ' + previous.timeLimit + ' → ' + next.timeLimit + ' วินาที · จำนวนคู่ ' + previous.pairs.length + ' → ' + next.pairs.length + ' คู่' });
    } else {
        next.settings.items.forEach(function (item) {
            var old = previous.settings.items.find(function (p) { return p.id === item.id; });
            if (!old || JSON.stringify(old) !== JSON.stringify(item) || previous.settings.equalChance !== next.settings.equalChance) {
                var event = stockEvent_(next, item.id, round, old ? 'ปรับตั้งค่ารางวัล' : 'เพิ่มรางวัล');
                event.before = old ? old.quantity - WheelEngine.issuedCount(old, previous.issued) : 0;
                event.note = old ? 'ก่อนแก้: ' + old.label + ' · จำนวน ' + old.quantity + ' · น้ำหนัก ' + old.weight + ' → ' + item.weight : 'เพิ่มของรางวัลเข้ารอบปัจจุบัน';
                events.push(event);
            }
        });
        previous.settings.items.forEach(function (item) {
            if (!next.settings.items.some(function (p) { return p.id === item.id; })) events.push(stockEvent_(previous, item.id, round, 'นำรางวัลออกจากเกม'));
        });
        var deleted = previous.logs.filter(function (log) { return !next.logs.some(function (l) { return l.id === log.id; }); }).length;
        if (deleted) events.push({ id: Utilities.getUuid(), time: now, round: round, action: 'ลบประวัติจากหน้าเว็บ', actor: adminName_(), note: deleted + ' รายการ · ประวัติในชีตและสต็อกยังอยู่ครบ' });
    }
    return events;
}
function validPlay_(play) {
    return play && typeof play.id === 'string' && /^[\w-]{16,100}$/.test(play.id) && ['start', 'finish'].indexOf(play.stage) >= 0 &&
        ['started', 'won', 'timeout', 'cancelled'].indexOf(play.outcome) >= 0 &&
        (play.stage === 'start' ? play.outcome === 'started' && play.matched === 0 : play.outcome !== 'started') &&
        Number.isInteger(play.total) && play.total >= 2 && play.total <= 30 && Number.isInteger(play.matched) && play.matched >= 0 && play.matched <= play.total &&
        (play.outcome !== 'won' || play.matched === play.total) && Number.isFinite(play.durationMs) && play.durationMs >= 0 && play.durationMs <= 86400000 &&
        Number.isFinite(Date.parse(play.startedAt)) && (play.stage === 'start' || (Number.isFinite(Date.parse(play.endedAt)) && Date.parse(play.endedAt) >= Date.parse(play.startedAt)));
}
function reportHeaders_(game) { return game === 'memory' ? MEMORY_HEADERS : game === 'quiz' ? QUIZ_HEADERS : STOCK_HEADERS; }
function reportSheet_(spreadsheet, name, headers) {
    var sheet = spreadsheet.getSheetByName(name);
    if (sheet) return sheet;
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setBackground('#392641').setFontColor('#fff3df').setFontWeight('bold').setWrap(true);
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, headers.length, 150);
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).createFilter();
    return sheet;
}
function safeCell_(value) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') return value;
    var text = value.slice(0, 49000);
    return /^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
}
function eventRow_(game, event) {
    var date = thaiTime_(event.time, 'yyyy-MM-dd'), time = thaiTime_(event.time, 'HH:mm:ss');
    if (game === 'memory') {
        var play = event.play || {};
        var outcomes = { started: 'เริ่มเล่น', won: 'จับคู่ครบ', timeout: 'หมดเวลา', cancelled: 'ออกจากเกม / เริ่มใหม่' };
        return [date, time, event.action, outcomes[play.outcome] || '', play.matched, play.total,
            play.durationMs === undefined ? '' : play.durationMs / 1000, play.startedAt ? thaiTime_(play.startedAt) : '', play.endedAt ? thaiTime_(play.endedAt) : '', event.note, event.id];
    }
    if (game === 'quiz') {
        var player = event.player || {};
        return [date, time, event.action, player.name, player.score, player.score === undefined ? '' : 5,
            player.timeMs === undefined ? '' : player.timeMs / 1000, player.completedAt ? thaiTime_(player.completedAt) : '', event.note, event.id];
    }
    return [date, time, event.round, event.action, event.label, event.out, event.issued, event.before,
        event.remaining, event.total, event.actor, event.note, event.id, event.prizeId];
}
function historyIds_(sheet, game) {
    var rows = sheet.getLastRow() - 1, column = game === 'memory' ? 11 : game === 'quiz' ? 10 : 13;
    return rows > 0 ? sheet.getRange(2, column, rows, 1).getValues().map(function (row) { return row[0]; }) : [];
}
function findHistoryRow_(spreadsheet, game, id) {
    var sheet = reportSheet_(spreadsheet, HISTORY_NAMES[game], reportHeaders_(game));
    var index = historyIds_(sheet, game).indexOf(id);
    return index < 0 ? null : sheet.getRange(index + 2, 1, 1, reportHeaders_(game).length).getValues()[0];
}
function appendHistory_(spreadsheet, game, events) {
    var headers = reportHeaders_(game), sheet = reportSheet_(spreadsheet, HISTORY_NAMES[game], headers);
    var known = new Set(historyIds_(sheet, game));
    var added = events.filter(function (event) { if (known.has(event.id)) return false; known.add(event.id); return true; });
    if (!added.length) return;
    var first = sheet.getLastRow() + 1;
    if (sheet.getMaxRows() < first + added.length - 1) sheet.insertRowsAfter(sheet.getMaxRows(), first + added.length - 1 - sheet.getMaxRows());
    sheet.getRange(first, 1, added.length, headers.length).setValues(added.map(function (event) { return eventRow_(game, event).map(safeCell_); }));
    added.forEach(function (event, index) {
        if (event.boundary) sheet.getRange(first + index, 1, 1, headers.length).setBackground('#eed9b9').setFontWeight('bold');
    });
}
function syncInventory_(spreadsheet) {
    var rows = [], now = thaiTime_(new Date().toISOString());
    ['wheel', 'claw'].forEach(function (game) {
        var record = readStoredGame_(gameSheet_(spreadsheet, game));
        record.value.settings.items.forEach(function (item) {
            var issued = WheelEngine.issuedCount(item, record.value.issued);
            rows.push([game === 'wheel' ? 'วงล้อ' : 'ตู้คีบ', record.audit ? record.audit.round : 1, item.label, item.quantity, issued, item.quantity - issued, now, item.id].map(safeCell_));
        });
    });
    var sheet = reportSheet_(spreadsheet, 'สรุปสต็อก', INVENTORY_HEADERS), previousLast = sheet.getLastRow();
    if (sheet.getMaxRows() < rows.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
    if (rows.length) sheet.getRange(2, 1, rows.length, INVENTORY_HEADERS.length).setValues(rows);
    if (previousLast > rows.length + 1) sheet.getRange(rows.length + 2, 1, previousLast - rows.length - 1, INVENTORY_HEADERS.length).clearContent();
}
function flushJournal_(spreadsheet, game, sheet, record) {
    if (record.auditAck === record.audit.transactionId) return;
    appendHistory_(spreadsheet, game, record.audit.events);
    if (game === 'wheel' || game === 'claw') syncInventory_(spreadsheet);
    SpreadsheetApp.flush();
    sheet.getRange(2, 6).setValue(record.audit.transactionId);
    SpreadsheetApp.flush();
    record.auditAck = record.audit.transactionId;
}
function auditRecord_(spreadsheet, game, sheet) {
    var record = readStoredGame_(sheet);
    if (!record.audit) {
        var events = legacyEvents_(game, record.value).concat(openingEvents_(game, record.value, 1, 'เริ่มบันทึกประวัติ'));
        writeGame_(sheet, record.value, record.version, 'history-upgrade', newJournal_(1, events));
        sheet.getRange(1, 6).setValue('history_committed');
        record = readStoredGame_(sheet);
    }
    try { flushJournal_(spreadsheet, game, sheet, record); }
    catch (error) { console.error(error); record.auditPending = true; }
    return record;
}
function commitAudited_(spreadsheet, game, sheet, value, version, requestId, round, events) {
    writeGame_(sheet, value, version, requestId, newJournal_(round, events));
    // The award and its report batch are already committed together. A report
    // failure must not tell a player to draw again and consume another prize.
    try { flushJournal_(spreadsheet, game, sheet, readStoredGame_(sheet)); }
    catch (error) { console.error(error); }
}
