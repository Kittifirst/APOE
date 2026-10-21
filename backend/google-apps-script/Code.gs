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
            sheet.getRange(1, 1, 1, 5).setValues([['version', 'active_slot', 'request_id', 'updated_at', 'chunk_count']]);
            sheet.getRange(2, 1, 1, 5).setValues([[0, 2, '', '', 0]]);
            sheet.getRange(3, 1).setValue('Internal game data. Edit settings through the website; do not edit these encoded cells.');
            writeGame_(sheet, defaults[game], 0, 'setup');
            sheet.setFrozenRows(3);
        });
    } finally { lock.releaseLock(); }
}

function doGet() { return json_({ ok: true, service: 'A Place on earth · Google Sheets', schema: 1 }); }
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
                if (body.action === 'snapshot') { states[game] = readGame_(sheet); versions[game] = states[game].version; }
                else versions[game] = sheet.getRange(2, 1).getValue();
            });
            return json_({ ok: true, states: states, versions: versions });
        }
        if (GAME_NAMES.indexOf(body.game) < 0) return json_({ ok: false, code: 400, error: 'ไม่พบเกมนี้' });
        var sheet = gameSheet_(spreadsheet, body.game);
        var current = readGame_(sheet);
        if (body.action === 'get') return json_({ ok: true, value: current.value, version: current.version });
        if (body.action === 'draw') {
            if (body.game !== 'wheel' && body.game !== 'claw') return json_({ ok: false, code: 400, error: 'เกมนี้ไม่รองรับการสุ่ม' });
            if (typeof body.requestId !== 'string' || !/^[\w-]{16,100}$/.test(body.requestId)) return json_({ ok: false, code: 400, error: 'รหัสการสุ่มไม่ถูกต้อง' });
            var existing = current.value.logs.find(function (log) { return log.id === body.requestId; });
            if (existing) {
                var original = current.value.settings.items.find(function (item) { return item.id === existing.prizeId; });
                return json_({ ok: true, value: current.value, version: current.version, prize: { id: existing.prizeId, label: existing.label, color: original ? original.color : '#b84720' } });
            }
            var segments = WheelEngine.buildSegments(current.value.settings, current.value.issued);
            if (!segments.some(function (item) { return item.weight > 0; })) return json_({ ok: false, code: 409, error: 'รางวัลหมดแล้ว กรุณาติดต่อผู้ดูแลร้าน' });
            var prize = segments[WheelEngine.chooseWeightedSegment(segments, Math.random)];
            var awarded = WheelState.award(current.value, prize.id, body.requestId, new Date().toISOString());
            writeGame_(sheet, awarded, current.version + 1, body.requestId);
            return json_({ ok: true, value: awarded, version: current.version + 1, prize: { id: prize.id, label: prize.label, color: prize.color } });
        }
        if (body.action !== 'put') return json_({ ok: false, code: 400, error: 'ไม่รู้จักคำสั่งนี้' });
        if (!Number.isSafeInteger(body.version) || body.version !== current.version) return json_({ ok: false, code: 409, error: 'ข้อมูลเปลี่ยนจากเครื่องอื่นแล้ว กรุณาลองบันทึกอีกครั้ง' });
        if (!validState_(body.game, body.value)) return json_({ ok: false, code: 400, error: 'ข้อมูลเกมไม่ถูกต้อง' });
        if (!isAdmin_(body.token) && !guestScore_(body.game, current.value, body.value)) return json_({ ok: false, code: 401, error: 'กรุณาเข้าสู่ระบบผู้ดูแลร้านอีกครั้ง' });
        writeGame_(sheet, body.value, current.version + 1, 'update');
        return json_({ ok: true, value: body.value, version: current.version + 1 });
    } catch (error) {
        console.error(error);
        return json_({ ok: false, code: 500, error: 'ระบบข้อมูลร้านยังไม่พร้อม กรุณาตรวจสอบการตั้งค่า Apps Script' });
    } finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}

function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function gameSheet_(spreadsheet, game) {
    var sheet = spreadsheet.getSheetByName('jao_' + game);
    if (!sheet) throw new Error('Missing sheet. Run setup first.');
    return sheet;
}
function readGame_(sheet) {
    var metadata = sheet.getRange(2, 1, 1, 5).getValues()[0];
    if (!Number.isSafeInteger(metadata[0]) || metadata[4] < 1) throw new Error('Invalid state metadata');
    var encoded = sheet.getRange(5, metadata[1], metadata[4], 1).getValues().map(function (row) { return row[0]; }).join('');
    var value = JSON.parse(Utilities.newBlob(Utilities.base64Decode(encoded)).getDataAsString('UTF-8'));
    return { value: value, version: metadata[0] };
}
function writeGame_(sheet, value, version, requestId) {
    var encoded = Utilities.base64Encode(JSON.stringify(value), Utilities.Charset.UTF_8);
    var rows = [];
    for (var index = 0; index < encoded.length; index += CHUNK_SIZE) rows.push([encoded.slice(index, index + CHUNK_SIZE)]);
    if (sheet.getMaxRows() < rows.length + 4) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 4 - sheet.getMaxRows());
    var slot = Number(sheet.getRange(2, 2).getValue()) === 1 ? 2 : 1;
    // Write an inactive copy first. Publishing metadata switches the committed state in one operation.
    sheet.getRange(5, slot, rows.length, 1).setNumberFormat('@').setValues(rows);
    SpreadsheetApp.flush();
    sheet.getRange(2, 1, 1, 5).setValues([[version, slot, requestId, new Date().toISOString(), rows.length]]);
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
        GAME_NAMES.forEach(function (game) { writeGame_(gameSheet_(spreadsheet, game), data.states[game], data.versions[game] + 1, 'legacy-import'); });
    } finally { lock.releaseLock(); }
}
