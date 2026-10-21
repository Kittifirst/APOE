'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { JSDOM } = require('jsdom');

function fixture(t, options = {}) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    const dom = new JSDOM(html, { url: 'http://localhost:4173', runScripts: 'dangerously', pretendToBeVisual: true });
    const w = dom.window;
    t.after(() => w.close());
    const errors = [];
    w.addEventListener('error', event => { errors.push(event.error || event.message); event.preventDefault(); });
    let now = 0, counter = 0;
    const tasks = new Map();
    const schedule = (fn, delay, interval) => { const id = ++counter; tasks.set(id, { fn, at: now + Math.max(1, delay || 1), interval }); return id; };
    w.setTimeout = (fn, delay) => schedule(fn, delay, 0);
    w.setInterval = (fn, delay) => schedule(fn, delay, delay);
    w.clearTimeout = w.clearInterval = id => tasks.delete(id);
    w.requestAnimationFrame = fn => schedule(() => fn(now), 16, 0);
    w.cancelAnimationFrame = w.clearTimeout;
    w.performance.now = () => now;
    w.Date.now = () => 1800000000000 + now;
    w.Math.random = () => .23;
    w.scrollTo = () => {};
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (target, key) => key === 'measureText' ? text => ({ width: text.length * 8 }) : () => {}, set: () => true });
    w.matchMedia = () => ({ matches: !!options.reduced, addEventListener() {} });
    w.ResizeObserver = class { observe() {} disconnect() {} };
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
    w.confirm = () => true;
    w.alert = () => {};
    Object.defineProperty(w.navigator, 'locks', { configurable: true, value: options.noLocks ? undefined : { request: async (_key, _options, action) => action({ name: _key }) } });
    if (options.shared) {
        w.XMLHttpRequest = class {
            open(method, url) { this.method = method; this.game = url.split('/').pop(); }
            setRequestHeader() {}
            send(body) {
                const record = options.shared[this.game];
                if (this.method === 'GET') { this.status = 200; this.responseText = JSON.stringify(record); return; }
                const proposed = JSON.parse(body);
                if (proposed.version !== record.version) { this.status = 409; this.responseText = JSON.stringify({ error: 'ข้อมูลเปลี่ยนจากเครื่องอื่น กรุณาลองอีกครั้ง' }); return; }
                options.shared[this.game] = { value: proposed.value, version: record.version + 1 };
                this.status = 200; this.responseText = JSON.stringify({ version: record.version + 1 });
            }
        };
        w.fetch = async () => ({ ok: true, json: async () => Object.fromEntries(Object.entries(options.shared).map(([key, value]) => [key, value.version])) });
    }
    if (options.setup) options.setup(w);
    for (const file of [...(options.shared ? ['app/storage/shared-store.js'] : []), 'games/wheel/wheel-engine.js', 'games/wheel/wheel-state.js', 'games/memory/memory-game.js', 'games/claw/claw-game.js', 'games/quiz/quiz-game.js', 'app/main.js', 'app/motion.js', 'games/wheel/wheel-effects.js']) {
        const script = w.document.createElement('script'); script.textContent = fs.readFileSync(path.join(ROOT, file), 'utf8'); w.document.head.append(script);
    }
    const $ = id => w.document.getElementById(id);
    const click = id => $(id).click();
    const page = () => w.document.querySelector('.page.active').id;
    const go = id => w.switchPage(id);
    const login = () => { $('username').value = 'admin'; $('password').value = '1234'; $('login-form').dispatchEvent(new w.Event('submit', { cancelable: true })); };
    async function advance(ms) {
        const end = now + ms;
        for (let safety = 0; safety < 20000; safety++) {
            for (let tick = 0; tick < 12; tick++) await Promise.resolve();
            const next = [...tasks].filter(([,task]) => task.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
            if (!next) { now = end; await Promise.resolve(); await Promise.resolve(); break; }
            now = next[1].at; tasks.delete(next[0]);
            if (next[1].interval) tasks.set(next[0], { ...next[1], at: now + next[1].interval });
            next[1].fn();
        }
    }
    t.after(() => assert.deepEqual(errors, [], 'No uncaught UI errors'));
    return { w, $, click, go, page, login, advance, errors };
}

test('all ten pages initialize and navigate; guest admin access is blocked', t => {
    const f = fixture(t);
    assert.equal(f.page(), 'page-login');
    for (const id of ['page-admin', 'page-memory-admin', 'page-claw-admin', 'page-quiz-admin']) { f.go(id); assert.equal(f.page(), 'page-login'); }
    f.login(); assert.equal(f.page(), 'page-admin');
    for (const section of f.w.document.querySelectorAll('.page')) { f.go(section.id); assert.equal(f.page(), section.id); }
    assert.equal(f.w.document.querySelectorAll('#page-guest [data-page^="page-"]').length > 4, true);
    assert.equal(f.w.document.querySelectorAll('.game-tabs').length, 8);
});

test('wheel admin and claw admin probability cells remain independent', t => {
    const f = fixture(t); f.login(); f.go('page-claw-admin');
    const before = [...f.$('claw-prize-editor').querySelectorAll('.editor-chance')].map(el => el.textContent);
    assert.equal(before.length, 5);
    f.go('page-admin');
    assert.deepEqual([...f.$('claw-prize-editor').querySelectorAll('.editor-chance')].map(el => el.textContent), before);
    assert.ok([...f.$('prize-editor').querySelectorAll('.editor-chance')].every(el => el.textContent.includes('%')));
});

test('memory flips preserve DOM and focus; restart cancels old mismatch callback', async t => {
    const f = fixture(t); f.go('page-memory'); f.click('memory-start');
    let cards = [...f.$('memory-board').children];
    const first = cards[0]; const second = cards.find(card => card.dataset.key.slice(0,-2) !== first.dataset.key.slice(0,-2));
    first.focus(); first.click();
    assert.equal(f.w.document.activeElement, first);
    assert.equal(f.$('memory-board').firstElementChild, first);
    assert.equal(first.querySelector('.memory-card-front').getAttribute('aria-hidden'), 'false');
    second.click(); f.click('memory-start');
    cards = [...f.$('memory-board').children]; cards[0].click();
    await f.advance(750);
    assert.equal(f.$('memory-board').querySelectorAll('.is-open').length, 1);
});

test('memory cannot flip after deadline and changing pages stops its timer', async t => {
    const f = fixture(t); f.go('page-memory'); f.click('memory-start');
    await f.advance(500); f.go('page-guest');
    const time = f.$('memory-timer').textContent;
    await f.advance(2000); assert.equal(f.$('memory-timer').textContent, time);
    f.go('page-memory'); f.click('memory-start'); await f.advance(89500);
    const cards = [...f.$('memory-board').children];
    cards[0].click(); cards.find(card => card.dataset.key.slice(0,-2) !== cards[0].dataset.key.slice(0,-2)).click();
    await f.advance(1000);
    assert.equal(f.$('memory-timer').textContent, '00:00');
    const opened = f.$('memory-board').querySelectorAll('.is-open').length;
    cards.find(card => !card.classList.contains('is-open')).click();
    assert.equal(f.$('memory-board').querySelectorAll('.is-open').length, opened);
});

function cropFixture(t, options = {}) {
    const images = [], draws = [], exports = [], revoked = [];
    const source = 'data:image/jpeg;base64,Y3JvcHBlZA==';
    const f = fixture(t, { ...options, setup(w) {
        w.Image = class { constructor() { images.push(this); } };
        w.URL.createObjectURL = () => 'blob:crop-' + images.length;
        w.URL.revokeObjectURL = url => revoked.push(url);
        w.HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
            exports.push({ width: this.width, height: this.height, type, quality });
            return source;
        };
    } });
    const preview = f.$('memory-crop-preview');
    preview.getContext = () => ({ fillRect() {}, drawImage(...args) { draws.push(args.slice(1)); } });
    preview.getBoundingClientRect = () => ({ width: 320, height: 320 });
    let captured = null;
    preview.setPointerCapture = id => { captured = id; };
    preview.hasPointerCapture = id => id === captured;
    preview.releasePointerCapture = () => { captured = null; };
    f.login(); f.go('page-memory-admin');
    function upload(key = '0:0', width = 1600, height = 800, load = true) {
        const input = f.$('memory-pair-editor').querySelector('[data-memory-image="' + key + '"]');
        Object.defineProperty(input, 'files', { configurable: true, value: [new f.w.File(['image'], 'test.png', { type: 'image/png' })] });
        input.dispatchEvent(new f.w.Event('change', { bubbles: true }));
        const image = images.at(-1);
        image.naturalWidth = width; image.naturalHeight = height;
        if (load) image.onload();
        return image;
    }
    function pointer(type, x, y, pointerType = 'mouse') {
        const event = new f.w.Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y, pointerType });
        preview.dispatchEvent(event);
    }
    return { ...f, upload, pointer, images, draws, exports, revoked, source };
}

for (const both of [true, false]) test('memory upload crops ' + (both ? 'both sides by default' : 'only the selected side when opted out') + ' and waits for admin save', t => {
    const f = cropFixture(t);
    const original = f.$('memory-pair-editor').querySelector('img').src;
    const otherPair = [...f.$('memory-pair-editor').children[1].querySelectorAll('img')].map(img => img.src);
    f.upload('0:1');
    assert.equal(f.$('memory-crop-both').checked, true);
    if (!both) f.click('memory-crop-both');
    assert.equal(f.$('memory-crop-dialog').open, true);
    assert.equal(f.w.localStorage.getItem('all-jao-games.memory.v1'), null);
    assert.equal(f.$('memory-save-status').classList.contains('unsaved'), false);
    assert.deepEqual(f.draws.at(-1), [400, 0, 800, 800, 0, 0, 512, 512]);
    f.$('memory-crop-zoom').value = '2';
    f.$('memory-crop-zoom').dispatchEvent(new f.w.Event('input'));
    assert.deepEqual(f.draws.at(-1), [600, 200, 400, 400, 0, 0, 512, 512]);
    f.click('memory-crop-apply');
    assert.equal(f.$('memory-crop-dialog').open, false);
    assert.equal(f.$('memory-save-status').classList.contains('unsaved'), true);
    assert.equal(f.w.localStorage.getItem('all-jao-games.memory.v1'), null);
    assert.deepEqual(f.exports, [{ width: 400, height: 400, type: 'image/jpeg', quality: 0.9 }]);
    assert.deepEqual(f.revoked, ['blob:crop-1']);
    assert.equal(f.w.document.activeElement.dataset.memoryImage, '0:1');
    f.click('memory-save');
    const saved = JSON.parse(f.w.localStorage.getItem('all-jao-games.memory.v1'));
    assert.equal(saved.pairs[0].first, both ? f.source : original);
    assert.equal(saved.pairs[0].second, f.source);
    assert.deepEqual([saved.pairs[1].first, saved.pairs[1].second], otherPair);
    f.go('page-memory'); f.click('memory-start');
    assert.equal(f.$('memory-board').querySelector('[data-key="pair-1-a"] img').src, both ? f.source : original);
    assert.equal(f.$('memory-board').querySelector('[data-key="pair-1-b"] img').src, f.source);
});

test('memory crop dragging, keyboard movement and reset stay within landscape and portrait images', t => {
    const f = cropFixture(t);
    f.upload();
    f.pointer('pointerdown', 160, 160);
    f.pointer('pointermove', 320, 160);
    assert.deepEqual(f.draws.at(-1).slice(0, 4), [0, 0, 800, 800]);
    f.pointer('pointermove', -1000, 160);
    assert.deepEqual(f.draws.at(-1).slice(0, 4), [800, 0, 800, 800]);
    f.pointer('pointerup', -1000, 160);
    assert.equal(f.$('memory-crop-preview').classList.contains('is-dragging'), false);
    f.click('memory-crop-reset');
    assert.deepEqual(f.draws.at(-1).slice(0, 4), [400, 0, 800, 800]);
    f.$('memory-crop-preview').dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
    assert.deepEqual(f.draws.at(-1).slice(0, 4), [384, 0, 800, 800]);
    f.click('memory-crop-cancel');
    f.upload('1:0', 600, 1800);
    f.pointer('pointerdown', 160, 160, 'touch');
    f.pointer('pointermove', 160, 2000, 'touch');
    assert.deepEqual(f.draws.at(-1).slice(0, 4), [0, 0, 600, 600]);
    f.pointer('pointercancel', 160, 2000, 'touch');
    f.click('memory-crop-reset');
    assert.deepEqual(f.draws.at(-1).slice(0, 4), [0, 600, 600, 600]);
    f.click('memory-crop-apply');
    assert.equal(f.exports[0].width, 512);
    assert.equal(f.exports[0].height, 512);
});

test('memory crop cancel and native dialog close keep the old image and permit another upload', t => {
    const f = cropFixture(t);
    const originals = [...f.$('memory-pair-editor').querySelectorAll('img')].map(img => img.src);
    f.upload(); f.click('memory-crop-cancel');
    f.upload(); f.$('memory-crop-dialog').close();
    assert.deepEqual([...f.$('memory-pair-editor').querySelectorAll('img')].map(img => img.src), originals);
    assert.equal(f.$('memory-save-status').classList.contains('unsaved'), false);
    assert.equal(f.exports.length, 0);
    assert.deepEqual(f.revoked, ['blob:crop-1', 'blob:crop-2']);
    f.upload('0:0', 32, 64); f.click('memory-crop-apply');
    assert.equal(f.exports[0].width, 32, 'Small pictures are not upscaled');
});

test('memory crop handles unreadable files, late image loads and export failures without changing the draft', t => {
    const f = cropFixture(t);
    const original = f.$('memory-pair-editor').querySelector('img').src;
    const image = f.upload('0:0', 0, 0, false);
    assert.equal(f.$('memory-crop-apply').disabled, true);
    image.onerror();
    assert.match(f.$('memory-crop-status').textContent, /เปิดภาพนี้ไม่ได้/);
    const lateLoad = image.onload;
    f.click('memory-crop-cancel');
    f.upload();
    lateLoad();
    assert.equal(f.$('memory-crop-apply').disabled, false);
    f.w.HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('Cannot encode'); };
    f.click('memory-crop-apply');
    assert.equal(f.$('memory-crop-dialog').open, true);
    assert.match(f.$('memory-crop-status').textContent, /ครอบตัดภาพไม่ได้/);
    assert.equal(f.$('memory-pair-editor').querySelector('img').src, original);
    assert.equal(f.$('memory-save-status').classList.contains('unsaved'), false);
});

test('memory store refresh while cropping does not replace the draft being edited', t => {
    const f = cropFixture(t);
    f.upload();
    f.w.document.dispatchEvent(new f.w.CustomEvent('jao:storechange', { detail: { game: 'memory' } }));
    f.click('memory-crop-apply'); f.click('memory-save');
    assert.equal(JSON.parse(f.w.localStorage.getItem('all-jao-games.memory.v1')).pairs[0].first, f.source);
});

test('quiz finishes all five questions and stores score in the live key', async t => {
    const f = fixture(t); f.go('page-quiz');
    f.$('quiz-name').value = 'ทดสอบ'; f.$('quiz-name-form').dispatchEvent(new f.w.Event('submit', { cancelable: true }));
    for (let i = 0; i < 5; i++) {
        await f.advance(1100);
        f.$('quiz-choices').querySelector('input').click(); f.click('quiz-confirm');
    }
    await f.advance(1);
    assert.equal(f.$('quiz-result').hidden, false);
    const saved = JSON.parse(f.w.localStorage.getItem('all-jao-games.quiz.v1'));
    assert.equal(saved.players.length, 1); assert.equal(saved.players[0].name, 'ทดสอบ');
    assert.equal(saved.players[0].timeMs, 5500);
});

test('quiz storage failure keeps result visible and supports a nonduplicating retry', async t => {
    const f = fixture(t); f.go('page-quiz'); f.$('quiz-name').value = 'Retry';
    f.$('quiz-name-form').dispatchEvent(new f.w.Event('submit', { cancelable: true }));
    const original = f.w.Storage.prototype.setItem;
    f.w.Storage.prototype.setItem = function (key, value) { if (key.includes('.quiz.')) throw new Error('QuotaExceededError'); return original.call(this, key, value); };
    for (let i = 0; i < 5; i++) { await f.advance(100); f.$('quiz-choices').querySelector('input').click(); f.click('quiz-confirm'); }
    await f.advance(1);
    assert.equal(f.$('quiz-result').hidden, false); assert.equal(f.$('quiz-retry-save').hidden, false);
    f.w.Storage.prototype.setItem = original;
    f.click('quiz-retry-save'); f.click('quiz-retry-save');
    assert.equal(JSON.parse(f.w.localStorage.getItem('all-jao-games.quiz.v1')).players.length, 1);
});

test('quiz drafts survive page changes and selecting the current tab does not reset the round', t => {
    const f = fixture(t); f.login(); f.go('page-quiz-admin');
    const question = f.$('quiz-question-editor').querySelector('[data-quiz-field="text"]'); question.value = 'คำถามที่แก้ไว้';
    question.dispatchEvent(new f.w.Event('input', { bubbles: true }));
    f.go('page-admin'); f.go('page-quiz-admin');
    assert.equal(f.$('quiz-question-editor').querySelector('[data-quiz-field="text"]').value, 'คำถามที่แก้ไว้');
    f.go('page-quiz'); f.$('quiz-name').value = 'Same page'; f.$('quiz-name-form').dispatchEvent(new f.w.Event('submit', { cancelable: true }));
    f.go('page-quiz'); assert.equal(f.$('quiz-play').hidden, false);
});

test('blocked session storage does not interrupt initialization', t => {
    const f = fixture(t, { setup(w) { Object.defineProperty(w, 'sessionStorage', { get() { throw new Error('SecurityError'); } }); } });
    f.go('page-guest'); assert.equal(f.page(), 'page-guest');
});

test('two-prize wheel labels remain horizontal and away from the rim', t => {
    const f = fixture(t);
    const labels = [];
    let transform = { x: 0, y: 0, angle: 0 };
    const stack = [];
    const context = {
        clearRect() {}, beginPath() {}, moveTo() {}, arc() {}, closePath() {}, fill() {}, stroke() {},
        save() { stack.push({ ...transform }); },
        restore() { transform = stack.pop(); },
        translate(x, y) { transform.x += x; transform.y += y; },
        rotate(angle) { transform.angle += angle; },
        measureText(text) { return { width: text.length * 20 }; },
        fillText(label, x, y) { labels.push({ label, x: transform.x + x, y: transform.y + y, angle: transform.angle }); }
    };
    f.w.drawWheel({ width: 900, getContext: () => context }, [
        { label: 'Prize A', color: '#94634e' }, { label: 'Prize B', color: '#dcc4a2' }
    ], 270);
    assert.equal(labels.length, 2);
    for (const label of labels) {
        assert.ok(Math.abs(label.angle + 270 * Math.PI / 180) < 1e-8);
        assert.ok(Math.hypot(label.x - 450, label.y - 450) < 350);
    }
});

test('wheel keeps its full spin animation and awards only once', async t => {
    const f = fixture(t, { reduced: true }); f.go('page-wheel');
    f.click('spin-button'); f.click('spin-button'); await f.advance(500);
    assert.equal(f.$('result-dialog').open, false);
    await f.advance(4500);
    assert.equal(f.$('result-dialog').open, true);
    const ledger = JSON.parse(f.w.localStorage.getItem('all-jao-games.wheel.v2'));
    assert.equal(ledger.logs.length, 1); assert.equal(Object.values(ledger.issued).reduce((a,b) => a+b, 0), 1);
});

test('Halloween wheel effects follow game phases, pause off-page, and clean up reward particles', async t => {
    const f = fixture(t);
    const stage = f.$('page-wheel').querySelector('.wheel-stage');
    assert.equal(stage.dataset.motion, 'paused');
    f.go('page-wheel');
    assert.equal(stage.dataset.motion, 'running');
    f.$('spin-button').dispatchEvent(new f.w.MouseEvent('pointerdown', { clientX: 100, clientY: 100 }));
    assert.equal(stage.querySelectorAll('.spell-spark').length, 10);
    f.click('spin-button'); await f.advance(500);
    assert.equal(stage.classList.contains('is-casting'), true);
    await f.advance(4500);
    assert.equal(stage.classList.contains('is-casting'), false);
    assert.equal(f.$('result-dialog').open, true);
    assert.equal(f.$('result-dialog').querySelectorAll('.wheel-treat-piece').length, 24);
    assert.equal(stage.querySelectorAll('.spell-spark').length, 0);
    const saved = JSON.parse(f.w.localStorage.getItem('all-jao-games.wheel.v2'));
    assert.equal(saved.logs.length, 1);
    await f.advance(2200);
    assert.equal(f.$('result-dialog').querySelector('.wheel-treat-burst'), null);
    f.go('page-guest');
    assert.equal(stage.dataset.motion, 'paused');
    assert.deepEqual(f.errors, []);
});

test('reduced motion preserves the Halloween wheel and prize without cosmetic particle animations', async t => {
    const f = fixture(t, { reduced: true });
    f.go('page-wheel');
    const stage = f.$('page-wheel').querySelector('.wheel-stage');
    assert.equal(stage.dataset.motion, 'reduced');
    f.$('spin-button').dispatchEvent(new f.w.MouseEvent('pointerdown', { clientX: 100, clientY: 100 }));
    assert.equal(stage.querySelectorAll('.spell-spark').length, 0);
    f.click('spin-button'); await f.advance(5000);
    assert.equal(f.$('result-dialog').open, true);
    assert.ok(f.$('result-dialog').querySelector('.wheel-prize-orb use[href="#i-pumpkin"]'));
    assert.equal(f.$('result-dialog').querySelector('.wheel-treat-burst'), null);
    assert.equal(JSON.parse(f.w.localStorage.getItem('all-jao-games.wheel.v2')).logs.length, 1);
    assert.deepEqual(f.errors, []);
});

test('cloud wheel waits for the server award and uses updated settings without writing a second award', async t => {
    const rules = require('../games/wheel/wheel-state.js');
    const engine = require('../games/wheel/wheel-engine.js');
    let saved = rules.create(engine.DEFAULT_SETTINGS), release, draws = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const f = fixture(t, { setup(w) {
        w.SharedStore = {
            mode: 'sheets',
            getItem: key => key.includes('.wheel.v2') ? JSON.stringify(saved) : null,
            setItem() { throw new Error('Cloud awards must be committed only by the server draw'); },
            draw: async () => { draws++; await pending; return { value: saved, prize: { id: 'new-menu', label: 'Pumpkin latte', color: '#b84720' } }; }
        };
    } });
    f.go('page-wheel'); f.click('spin-button'); f.click('spin-button');
    await f.advance(100); f.go('page-guest');
    assert.equal(f.page(), 'page-wheel');
    assert.equal(f.$('result-dialog').open, false);
    const updated = rules.create({ equalChance: false, items: [{ id: 'new-menu', label: 'Pumpkin latte', quantity: 1, weight: 1, color: '#b84720' }] });
    saved = rules.award(updated, 'new-menu', 'server-award', new Date().toISOString());
    release(); await f.advance(5000);
    assert.equal(f.$('result-dialog').open, true);
    assert.equal(f.$('result-prize').textContent, 'Pumpkin latte');
    assert.equal(saved.logs.length, 1);
    assert.equal(draws, 1);
    assert.deepEqual(f.errors, []);
});

test('claw prevents page changes during award and corrupted stock cannot be overwritten', async t => {
    const f = fixture(t); f.go('page-claw'); f.click('claw-drop'); f.go('page-guest');
    assert.equal(f.page(), 'page-claw');
    await f.advance(6000); assert.equal(f.$('claw-result-dialog').open, true);
    assert.equal(f.$('claw-result-prize').hidden, false);
    assert.equal(JSON.parse(f.w.localStorage.getItem('all-jao-games.claw.v1')).logs.length, 1);
    f.$('claw-result-dialog').close(); f.go('page-guest'); assert.equal(f.page(), 'page-guest');
    f.w.localStorage.setItem('all-jao-games.claw.v1', '{broken'); f.go('page-claw');
    assert.equal(f.$('claw-drop').disabled, true);
    assert.equal(f.w.localStorage.getItem('all-jao-games.claw.v1'), '{broken');
});

test('stock games explain when secure browser locks are unavailable', t => {
    const f = fixture(t, { noLocks: true });
    f.go('page-wheel');
    assert.equal(f.$('spin-button').disabled, true);
    assert.match(f.$('spin-status').textContent, /localhost หรือ HTTPS/);
    f.go('page-claw');
    assert.equal(f.$('claw-drop').disabled, true);
    assert.match(f.$('claw-status').textContent, /localhost หรือ HTTPS/);
});

test('separate browsers see the same central wheel and claw stock and quiz leaderboard', async t => {
    const wheel = require('../games/wheel/wheel-state.js').create(require('../games/wheel/wheel-engine.js').DEFAULT_SETTINGS);
    const central = {
        wheel: { value: wheel, version: 0 },
        claw: { value: require('../games/wheel/wheel-state.js').create(require('../games/claw/claw-game.js').DEFAULT_SETTINGS), version: 0 },
        memory: { value: require('../games/memory/memory-game.js').createDefault(), version: 0 },
        quiz: { value: { questions: require('../games/quiz/quiz-game.js').DEFAULT_QUESTIONS, players: [] }, version: 0 }
    };
    const a = fixture(t, { shared: central, noLocks: true, reduced: true });
    const b = fixture(t, { shared: central, noLocks: true, reduced: true });
    a.go('page-wheel'); a.click('spin-button'); await a.advance(5000);
    assert.equal(central.wheel.value.logs.length, 1);
    b.login();
    assert.match(b.$('log-count').textContent, /1 รายการ/);
    a.go('page-quiz'); a.$('quiz-name').value = 'ผู้เล่น A';
    a.$('quiz-name-form').dispatchEvent(new a.w.Event('submit', { cancelable: true }));
    for (let i = 0; i < 5; i++) { a.$('quiz-choices').querySelector('input').click(); a.click('quiz-confirm'); }
    b.go('page-quiz');
    assert.match(b.$('quiz-leaderboard').textContent, /ผู้เล่น A/);
    a.go('page-claw'); a.click('claw-drop'); await a.advance(6000);
    assert.equal(central.claw.value.logs.length, 1);
    b.go('page-claw-admin');
    assert.match(b.$('claw-log-count').textContent, /1 รายการ/);
});

test('tabs support arrow key focus without accidentally triggering claw controls', t => {
    const f = fixture(t); f.go('page-claw');
    const selected = f.$('page-claw').querySelector('.game-tab.selected'); selected.focus();
    const position = f.$('claw-carriage').getAttribute('style');
    selected.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    assert.equal(f.w.document.activeElement.dataset.page, 'page-quiz');
    assert.equal(f.$('claw-carriage').getAttribute('style'), position);
});

test('animation control is absent and capsule prize stays visible', t => {
    const f = fixture(t);
    assert.equal(f.$('motion-toggle'), null);
    const css = fs.readFileSync(path.join(ROOT, 'styles/motion.css'), 'utf8');
    assert.match(css, /\.claw-result-dialog\.is-revealed \.result-label\s*\{\s*opacity: 1/);
});

test('document has unique IDs, valid navigation targets and all local assets exist', t => {
    const f = fixture(t); const ids = [...f.w.document.querySelectorAll('[id]')].map(el => el.id);
    assert.equal(new Set(ids).size, ids.length);
    f.w.document.querySelectorAll('[data-page]').forEach(el => assert.ok(f.$(el.dataset.page), el.dataset.page));
    for (const el of f.w.document.querySelectorAll('link[href], script[src]')) {
        const source = el.getAttribute('href') || el.getAttribute('src');
        if (!source.startsWith('https:')) assert.ok(fs.existsSync(path.join(ROOT, source)), source);
    }
});
