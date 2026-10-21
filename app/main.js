'use strict';

const engine = window.WheelEngine;
const stateEngine = window.WheelState;
const memoryGame = window.MemoryGame.init();
const clawGame = window.ClawGame.init({ showToast: message => showToast(message) });
const quizGame = window.QuizGame.init({ showToast: message => showToast(message) });
const persistentStore = window.SharedStore || localStorage;
const serverStorage = Boolean(window.SharedStore && window.SharedStore.mode !== 'demo');
const STORAGE_KEY = 'all-jao-games.wheel.v2';
const LEGACY_KEY = 'all-jao-games.wheel.v1';
const SESSION_KEY = 'all-jao-games.wheel.session.v1';
const PAGE_IDS = ['page-login', 'page-guest', 'page-wheel', 'page-memory', 'page-claw', 'page-quiz', 'page-admin', 'page-memory-admin', 'page-claw-admin', 'page-quiz-admin'];
const ADMIN_PAGES = ['page-admin', 'page-memory-admin', 'page-claw-admin', 'page-quiz-admin'];
const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
let storageMessage = '';
let hasSavedSettings = false;
let storageBroken = false;
let state = loadState();
let settings = state.settings;
let draft = clone(settings);
let dirty = false;
let isAdmin = false;
let activePage = 'page-login';
let spinning = false;
let animationId = null;
let rotation = 0;
let gameSegments = [];
let toastTimer;
let releaseSpin = null;
let spinToken = 0;
let logPage = 0;
const LOG_PAGE_SIZE = 20;
let pendingDeleteIds = [];
let resettingStock = false;
let navigationReady = false;
let navigationIndex = 0;
let restoringHistory = false;
let backPending = false;

function readState() {
    const raw = persistentStore.getItem(STORAGE_KEY);
    if (raw) {
        const parsed = JSON.parse(raw);
        if (!stateEngine.validate(parsed)) throw new Error('ข้อมูลสต็อกหรือประวัติที่บันทึกไว้ไม่ถูกต้อง');
        hasSavedSettings = true;
        return parsed;
    }
    const legacy = persistentStore.getItem(LEGACY_KEY);
    const config = legacy ? JSON.parse(legacy) : clone(engine.DEFAULT_SETTINGS);
    if (!engine.validateSettings(config).valid) throw new Error('ข้อมูลตั้งค่าที่บันทึกไว้ไม่ถูกต้อง');
    hasSavedSettings = Boolean(legacy);
    return stateEngine.create(config);
}

function loadState() {
    try {
        return readState();
    } catch (_) {
        storageBroken = true;
        storageMessage = 'อ่านสต็อกและประวัติไม่ได้ กรุณาตรวจสอบการเก็บข้อมูลของเบราว์เซอร์ก่อนเริ่มเล่น';
        return stateEngine.create(engine.DEFAULT_SETTINGS);
    }
}

function adoptState(next) {
    state = next;
    settings = next.settings;
    if (!dirty) draft = clone(settings);
}

async function writeState(next) {
    if (!stateEngine.validate(next)) throw new Error('ข้อมูลที่ต้องการบันทึกไม่ถูกต้อง');
    // Stock and log are committed together: never announce an unsaved award.
    await persistentStore.setItem(STORAGE_KEY, JSON.stringify(next));
    storageBroken = false;
    hasSavedSettings = true;
    adoptState(next);
}

async function withWheelLock(action) {
    if (serverStorage) return action();
    if (!navigator.locks) throw new Error('กรุณาเปิดเกมด้วย Chrome หรือ Edge ผ่าน localhost หรือ HTTPS เพื่อบันทึกสต็อกอย่างถูกต้อง');
    return navigator.locks.request('all-jao-wheel-stock', { ifAvailable: true }, lock => {
        if (!lock) throw new Error('วงล้อกำลังทำงานในอีกแท็บ กรุณารอให้หมุนเสร็จแล้วลองอีกครั้ง');
        return action();
    });
}

function showToast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

function saveSession() {
    try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ isAdmin, page: activePage }));
    } catch (_) {
        // Session persistence is optional; the game remains usable if storage is blocked.
    }
}

function restoreSession() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
        if (!saved || typeof saved !== 'object') return;
        isAdmin = saved.isAdmin === true && (persistentStore.mode !== 'sheets' || persistentStore.hasSession());
        const page = PAGE_IDS.includes(saved.page)
            ? saved.page : 'page-guest';
        switchPage(page);
    } catch (_) {
        try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* Storage can be blocked. */ }
    }
}

function canLeavePage() {
    if (spinning && persistentStore.mode === 'sheets') { showToast('รอรับผลวงล้อก่อนเปลี่ยนหน้านะ'); return false; }
    if (activePage === 'page-claw' && clawGame.isBusy()) { showToast('รอรับผลแคปซูลก่อนเปลี่ยนเกมนะ'); return false; }
    return true;
}

function rememberPage(mode) {
    if (!navigationReady) return;
    if (mode === 'push') navigationIndex += 1;
    window.history[mode + 'State']({
        ...window.history.state,
        jaoNavigation: { pageId: activePage, index: navigationIndex }
    }, '');
}

function goBack() {
    if (backPending || restoringHistory || !canLeavePage()) return;
    if (navigationIndex > 0) {
        backPending = true;
        window.history.back();
    } else {
        // A restored session may have no earlier page in this tab.
        switchPage(activePage === 'page-guest' ? 'page-login' : 'page-guest', { historyMode: 'replace' });
    }
}

function switchPage(pageId, { historyMode = 'push' } = {}) {
    if (!PAGE_IDS.includes(pageId) || restoringHistory) return false;
    if (ADMIN_PAGES.includes(pageId) && !isAdmin) {
        showToast('กรุณาเข้าสู่ระบบแอดมินเพื่อตั้งค่าเกม');
        pageId = 'page-login';
    }
    if (activePage === pageId) return true;
    if (!canLeavePage()) return false;
    if (activePage === 'page-wheel' && pageId !== 'page-wheel') cancelSpin();
    if (activePage === 'page-memory' && pageId !== 'page-memory') memoryGame.cancel();
    if (activePage === 'page-claw' && pageId !== 'page-claw') clawGame.cancel();
    if (activePage === 'page-quiz' && pageId !== 'page-quiz') quizGame.cancel();
    applyPendingSettings();
    document.querySelectorAll('.page').forEach(page => page.classList.toggle('active', page.id === pageId));
    document.querySelectorAll('.admin-only').forEach(button => { button.hidden = !isAdmin; });
    activePage = pageId;
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    saveSession();
    if (historyMode !== 'none') rememberPage(historyMode);
    if (pageId === 'page-admin') { renderEditor(); renderLogs(); }
    if (pageId === 'page-wheel') {
        renderGame();
        if (dirty && isAdmin) showToast('หน้าเล่นใช้ค่าที่บันทึกแล้ว การแก้ไขของคุณยังอยู่ในหน้าตั้งค่า');
    }
    if (pageId === 'page-memory') memoryGame.render();
    if (pageId === 'page-memory-admin') memoryGame.showAdmin();
    if (pageId === 'page-claw') clawGame.render();
    if (pageId === 'page-claw-admin') clawGame.renderAdmin();
    if (pageId === 'page-quiz') quizGame.render();
    if (pageId === 'page-quiz-admin') quizGame.renderAdmin();
    window.scrollTo(0, 0);
    const heading = $(pageId).querySelector('h1');
    if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
    }
    document.dispatchEvent(new CustomEvent('jao:pagechange', { detail: { pageId } }));
    return true;
}

function initializeNavigation() {
    const savedNavigation = window.history.state?.jaoNavigation;
    if (PAGE_IDS.includes(savedNavigation?.pageId) && Number.isInteger(savedNavigation.index) && savedNavigation.index >= 0) {
        navigationIndex = savedNavigation.index;
        switchPage(savedNavigation.pageId);
    }
    navigationReady = true;
    rememberPage('replace');

    document.querySelectorAll('.app-header nav').forEach(nav => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nav-button nav-back';
        button.dataset.action = 'back';
        button.innerHTML = '<svg class="icon arrow-back" aria-hidden="true"><use href="#i-arrow"/></svg><span>ย้อนกลับ</span>';
        nav.prepend(button);
    });

    window.addEventListener('popstate', event => {
        backPending = false;
        if (restoringHistory) { restoringHistory = false; return; }
        const target = event.state?.jaoNavigation;
        if (!PAGE_IDS.includes(target?.pageId) || !Number.isInteger(target.index) || target.index < 0) return;
        if (!switchPage(target.pageId, { historyMode: 'none' })) {
            // Back/Forward must also wait for an in-flight stock award.
            const distance = navigationIndex - target.index;
            if (distance) {
                restoringHistory = true;
                window.history.go(distance);
            }
            return;
        }
        navigationIndex = target.index;
        // History must not reopen admin settings after logout.
        if (activePage !== target.pageId) rememberPage('replace');
    });
}

async function handleLogin(event) {
    if (event) event.preventDefault();
    let authenticated = false;
    const button = $('login-form').querySelector('[type="submit"]');
    button.disabled = true;
    try {
        if (persistentStore.mode === 'sheets') {
            await persistentStore.login($('username').value.trim(), $('password').value);
            authenticated = true;
        } else authenticated = $('username').value.trim() === 'admin' && $('password').value === '1234';
    } catch (error) { showToast(error.message); }
    finally { button.disabled = false; }
    if (authenticated) {
        isAdmin = true;
        $('password').value = '';
        switchPage('page-admin');
    } else {
        $('custom-alert').showModal();
    }
}

function logout() {
    if (spinning && persistentStore.mode === 'sheets') { showToast('รอรับผลวงล้อก่อนออกจากเกมนะ'); return; }
    if (clawGame.isBusy()) { showToast('รอรับผลแคปซูลก่อนออกจากเกมนะ'); return; }
    cancelSpin();
    memoryGame.cancel();
    clawGame.cancel();
    quizGame.cancel();
    isAdmin = false;
    if (persistentStore.logout) persistentStore.logout();
    draft = clone(settings);
    dirty = false;
    $('username').value = '';
    $('password').value = '';
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* optional storage */ }
    switchPage('page-login');
}

function closeAlert() {
    $('custom-alert').close();
}

function formatPercent(value) {
    if (value > 0 && value < 0.01) return '<0.01%';
    return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value) + '%';
}

function drawWheel(canvas, segments, displayRotation = 0) {
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const radius = size / 2;
    ctx.clearRect(0, 0, size, size);
    if (!segments.length) {
        ctx.fillStyle = '#f4ede0';
        ctx.beginPath();
        ctx.arc(radius, radius, radius, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    const slice = Math.PI * 2 / segments.length;
    segments.forEach((segment, index) => {
        const start = -Math.PI / 2 + index * slice;
        ctx.beginPath();
        ctx.moveTo(radius, radius);
        ctx.arc(radius, radius, radius - 1, start, start + slice);
        ctx.closePath();
        ctx.fillStyle = segment.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fffaf180';
        ctx.stroke();
        ctx.save();
        ctx.translate(radius, radius);
        const centerAngle = start + slice / 2;
        const shortWheel = segments.length <= 4;
        const labelRadius = radius * .56;
        if (shortWheel) {
            ctx.translate(Math.cos(centerAngle) * labelRadius, Math.sin(centerAngle) * labelRadius);
            ctx.rotate(-displayRotation * Math.PI / 180);
        } else {
            ctx.rotate(centerAngle);
        }
        // Keep prize names on the wheel, including when many segments are configured.
        const dense = segments.length > 18;
        const fontSize = dense ? size * 0.024 : Math.min(size * 0.036, size * 0.46 / Math.max(segments.length, 6));
        ctx.font = '600 ' + fontSize + 'px "Noto Sans Thai", "Manrope", Tahoma, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const hex = segment.color.slice(1);
        const fullHex = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex;
        const rgb = [0, 2, 4].map(offset => parseInt(fullHex.slice(offset, offset + 2), 16));
        ctx.fillStyle = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 155 ? '#2e1d11' : '#fffdf8';
        let label = segment.label;
        const maxWidth = shortWheel
            ? Math.min(radius * .85, segments.length === 1 ? radius * .85 : 2 * labelRadius * Math.sin(slice / 2) * .9)
            : radius * .58;
        if (ctx.measureText(label).width > maxWidth) {
            const chars = Array.from(label);
            while (chars.length && ctx.measureText(chars.join('') + '…').width > maxWidth) chars.pop();
            label = chars.join('') + '…';
        }
        ctx.fillText(label, shortWheel ? 0 : radius * .65, 0);
        ctx.restore();
    });
}

function renderGame() {
    if (spinning) return;
    gameSegments = engine.buildSegments(settings, state.issued);
    rotation = gameSegments.length ? engine.rotationForSegment(0, 0, gameSegments.length, 0) : 0;
    $('game-wheel').style.transform = 'rotate(' + rotation + 'deg)';
    drawWheel($('game-wheel'), gameSegments, rotation);
    $('game-wheel').setAttribute('aria-label', gameSegments.length
        ? 'วงล้อสุ่มของรางวัล: ' + gameSegments.map(item => item.label).join(', ')
        : 'วงล้อไม่มีรางวัลให้สุ่มแล้ว');
    const available = !storageBroken && Boolean(serverStorage || navigator.locks) && gameSegments.some(item => item.weight > 0);
    $('spin-label').textContent = available ? 'กดเพื่อสุ่ม' : 'ยังไม่พร้อม';
    $('spin-button').disabled = !available;
    $('spin-status').textContent = storageBroken ? 'ไม่สามารถอ่านข้อมูลเกมได้ กรุณาติดต่อผู้ดูแล'
        : !serverStorage && !navigator.locks ? 'การสุ่มต้องเปิดผ่าน localhost หรือ HTTPS บน Chrome/Edge'
        : available ? 'พร้อมลุ้นแล้วหรือยัง?' : 'รอบนี้ไม่มีรางวัลให้สุ่มแล้ว กรุณาติดต่อผู้ดูแล';
}

function randomUnit() {
    if (window.crypto && window.crypto.getRandomValues) {
        const values = new Uint32Array(1);
        window.crypto.getRandomValues(values);
        return values[0] / 4294967296;
    }
    return Math.random();
}

async function spinWheel() {
    if (spinning || activePage !== 'page-wheel' || $('result-dialog').open) return;
    spinning = true;
    const token = ++spinToken;
    $('spin-button').disabled = true;
    try {
        await withWheelLock(async () => {
            if (token !== spinToken || activePage !== 'page-wheel') return;
            adoptState(readState());
            storageBroken = false;
            let segments = engine.buildSegments(settings, state.issued);
            if (!segments.some(item => item.weight > 0)) {
                spinning = false;
                renderGame();
                return;
            }
            // Cloud draws choose and commit on the server before revealing the award.
            const cloudDraw = persistentStore.mode === 'sheets' ? await persistentStore.draw('wheel') : null;
            if (!cloudDraw) await writeState(state);
            else {
                adoptState(cloudDraw.value);
                const beforeAward = { ...state.issued, [cloudDraw.prize.id]: state.issued[cloudDraw.prize.id] - 1 };
                segments = engine.buildSegments(settings, beforeAward);
            }
            gameSegments = segments;
            drawWheel($('game-wheel'), segments, rotation);
            const selectedIndex = cloudDraw ? segments.findIndex(item => item.id === cloudDraw.prize.id) : engine.chooseWeightedSegment(segments, randomUnit);
            const startRotation = rotation;
            const target = engine.rotationForSegment(startRotation, selectedIndex, segments.length, 6);
            const duration = 4600;
            const started = performance.now();
            $('spin-label').textContent = 'กำลังหมุน…';
            $('spin-status').textContent = 'ลุ้นไปด้วยกัน… วงล้อกำลังเลือกของให้คุณ';
            await new Promise(resolve => {
                releaseSpin = resolve;
                async function frame(now) {
                    if (token !== spinToken) { resolve(); return; }
                    const progress = Math.min(1, (now - started) / duration);
                    const eased = 1 - Math.pow(1 - progress, 4);
                    rotation = startRotation + (target - startRotation) * eased;
                    $('game-wheel').style.transform = 'rotate(' + rotation + 'deg)';
                    if (progress < 1) {
                        animationId = requestAnimationFrame(frame);
                    } else {
                        animationId = null;
                        rotation = target % 360;
                        $('game-wheel').style.transform = 'rotate(' + rotation + 'deg)';
                        drawWheel($('game-wheel'), segments, rotation);
                        const prize = segments[engine.pointerIndex(rotation, segments.length)];
                        try {
                            if (!cloudDraw) {
                                const latest = readState();
                                await writeState(stateEngine.award(latest, prize.id, newId(), new Date().toISOString()));
                            }
                            finishSpin(prize);
                        } catch (_) {
                            spinning = false;
                            $('spin-button').disabled = false;
                            $('spin-label').textContent = 'ลองอีกครั้ง';
                            $('spin-status').textContent = 'บันทึกผลไม่ได้ รอบนี้ยังไม่จ่ายรางวัล กรุณาลองใหม่';
                            showToast('บันทึกผลไม่สำเร็จ จึงยังไม่ยืนยันรางวัลและไม่หักสต็อก');
                        } finally {
                            releaseSpin = null;
                            resolve();
                        }
                    }
                }
                animationId = requestAnimationFrame(frame);
            });
        });
    } catch (error) {
        if (token === spinToken) {
            spinning = false;
            renderGame();
            showToast(window.SharedStore || error.message.includes('แท็บ') || error.message.includes('HTTPS')
                ? error.message : 'เริ่มหมุนไม่ได้ กรุณาตรวจสอบการบันทึกข้อมูลของเบราว์เซอร์');
        }
    } finally {
        if (token === spinToken) spinning = false;
    }
}

function newId() {
    return window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID() : 'wheel-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function finishSpin(prize) {
    spinning = false;
    $('spin-label').textContent = 'หมุนอีกครั้ง';
    $('spin-button').disabled = false;
    $('spin-status').textContent = 'คุณสุ่มได้: ' + prize.label;
    $('result-prize').textContent = prize.label;
    $('result-dialog').showModal();
}

function cancelSpin() {
    spinToken += 1;
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
    spinning = false;
    if (releaseSpin) { releaseSpin(); releaseSpin = null; }
    if ($('result-dialog').open) $('result-dialog').close();
}

function createEditorInput(item, index, field, type) {
    const input = document.createElement('input');
    input.type = type;
    input.className = type === 'color' ? 'color-input' : 'editor-input';
    input.dataset.field = field;
    input.value = item[field];
    const labels = { color: 'สี', label: 'ชื่อของรางวัล', quantity: 'จำนวนชิ้น', weight: 'น้ำหนักสุ่ม' };
    input.setAttribute('aria-label', labels[field] + ' รายการที่ ' + (index + 1));
    if (field === 'label') {
        input.maxLength = 60;
        input.required = true;
        input.placeholder = 'ชื่อของรางวัล';
    }
    if (field === 'quantity') { input.min = Math.max(1, engine.issuedCount(item, state.issued)); input.max = engine.MAX_QUANTITY; input.step = 1; input.required = true; }
    if (field === 'weight') { input.min = 0; input.max = 1000; input.step = 'any'; input.required = true; input.disabled = draft.equalChance; }
    return input;
}

function renderEditor() {
    const body = $('prize-editor');
    body.replaceChildren();
    draft.items.forEach((item, index) => {
        const row = document.createElement('tr');
        row.dataset.index = index;
        ['color', 'label', 'quantity', 'weight'].forEach(field => {
            const cell = document.createElement('td');
            cell.append(createEditorInput(item, index, field, field === 'color' ? 'color' : field === 'label' ? 'text' : 'number'));
            row.append(cell);
            if (field === 'quantity') {
                for (const className of ['stock-issued', 'stock-remaining']) {
                    const stock = document.createElement('td');
                    stock.className = className;
                    row.append(stock);
                }
            }
        });
        const chance = document.createElement('td');
        chance.className = 'editor-chance';
        row.append(chance);
        const actions = document.createElement('td');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'delete-prize';
        remove.dataset.remove = index;
        remove.setAttribute('aria-label', 'ลบรายการที่ ' + (index + 1));
        remove.disabled = draft.items.length === 1;
        remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>';
        actions.append(remove);
        row.append(actions);
        body.append(row);
    });
    $('equal-chance').checked = draft.equalChance;
    updateEditorSummary();
}

function setDirty() {
    dirty = JSON.stringify(draft) !== JSON.stringify(settings);
    updateEditorSummary();
}

function updateEditorSummary() {
    const result = engine.validateSettings(draft);
    const total = draft.items.reduce((sum, item) => sum + (Number.isInteger(item.quantity) ? engine.remainingCount(item, state.issued) : 0), 0);
    $('editor-total').textContent = draft.items.length + ' รายการ · เหลือ ' + total + ' ชิ้น';
    $('preview-items').textContent = draft.items.length;
    $('preview-segments').textContent = total;
    $('add-prize').disabled = draft.items.length >= engine.MAX_ITEMS;
    $('discard-settings').disabled = !dirty;
    $('save-status').textContent = dirty ? 'มีการแก้ไขที่ยังไม่ได้บันทึก' : hasSavedSettings ? 'บันทึกการตั้งค่าแล้ว' : 'ใช้การตั้งค่าเริ่มต้น';
    $('save-status').classList.toggle('unsaved', dirty);
    $('mode-explanation').textContent = draft.equalChance
        ? 'ทุกชิ้นที่เหลือมีโอกาสเท่ากัน รวมถึงน้ำหนัก 0 · ของหมดจะไม่ถูกสุ่ม · เรทเดิมยังถูกเก็บไว้'
        : 'เมื่อไม่ติ๊ก ระบบจะสุ่มตามน้ำหนักที่ตั้งไว้และหยุดอัตโนมัติ';
    $('weight-explanation').textContent = draft.equalChance
        ? 'โอกาสออก = จำนวนคงเหลือของรายการ ÷ จำนวนคงเหลือรวม · ทุกชิ้นมีโอกาสเท่ากัน แต่แสดงชนิดละ 1 ช่อง'
        : 'โอกาสออก = (จำนวนคงเหลือ × น้ำหนักสุ่ม) ÷ น้ำหนักรวมของของที่เหลือ · น้ำหนัก 0 หรือของหมดจะไม่ถูกสุ่ม';
    document.querySelectorAll('#prize-editor [data-field="weight"]').forEach(input => { input.disabled = draft.equalChance; });
    document.querySelectorAll('#prize-editor .editor-input').forEach(input => {
        const item = draft.items[Number(input.closest('tr').dataset.index)];
        const field = input.dataset.field;
        const invalid = field === 'label' ? !item.label.trim()
            : field === 'quantity' ? !Number.isInteger(item.quantity) || item.quantity < Math.max(1, engine.issuedCount(item, state.issued)) || item.quantity > engine.MAX_QUANTITY
            : !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1000;
        input.setAttribute('aria-invalid', String(invalid));
    });
    document.querySelectorAll('#prize-editor tr').forEach((row, index) => {
        const item = draft.items[index];
        const remaining = Number.isInteger(item.quantity) ? engine.remainingCount(item, state.issued) : null;
        row.querySelector('.stock-issued').textContent = engine.issuedCount(item, state.issued);
        row.querySelector('.stock-remaining').textContent = remaining === null ? '—' : remaining ? remaining : 'หมดแล้ว';
        row.querySelector('.stock-remaining').classList.toggle('sold-out', remaining === 0);
    });
    if (result.valid) {
        const chances = engine.probabilities(draft, state.issued);
        document.querySelectorAll('#prize-editor .editor-chance').forEach((cell, index) => { cell.textContent = formatPercent(chances[index].percent); });
        drawWheel($('preview-wheel'), engine.buildSegments(draft, state.issued));
        $('preview-wheel').setAttribute('aria-label', 'ตัวอย่างวงล้อ ' + engine.buildSegments(draft, state.issued).length + ' ช่อง ตามรางวัลที่ยังเหลือ');
    } else {
        document.querySelectorAll('#prize-editor .editor-chance').forEach(cell => { cell.textContent = '—'; });
        drawWheel($('preview-wheel'), []);
        $('preview-wheel').setAttribute('aria-label', 'กรุณากรอกข้อมูลวงล้อให้ถูกต้องเพื่อดูตัวอย่าง');
    }
    if (!$('settings-errors').hidden) showSettingsErrors(result.errors);
}

function showSettingsErrors(errors) {
    const box = $('settings-errors');
    box.replaceChildren();
    box.hidden = errors.length === 0;
    if (!errors.length) return;
    const list = document.createElement('ul');
    errors.forEach(error => {
        const li = document.createElement('li');
        li.textContent = error;
        list.append(li);
    });
    box.append(list);
}

async function saveSettings(event) {
    event.preventDefault();
    if (!isAdmin) return;
    const candidate = { equalChance: draft.equalChance, items: draft.items.map(item => ({ ...item, id: item.id.trim(), label: item.label.trim() })) };
    const validation = engine.validateSettings(candidate);
    if (!validation.valid) {
        showSettingsErrors(validation.errors);
        const invalid = $('prize-editor').querySelector('[aria-invalid="true"]');
        if (invalid) invalid.focus();
        $('settings-errors').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
    }
    $('save-settings').disabled = true;
    try {
        await withWheelLock(async () => {
            const latest = readState();
            const belowIssued = candidate.items.filter(item => item.quantity < engine.issuedCount(item, latest.issued));
            if (belowIssued.length) throw new Error('จำนวนทั้งหมดต้องไม่น้อยกว่าที่จ่ายแล้ว: ' + belowIssued.map(item => item.label).join(', '));
            await writeState({ ...latest, settings: candidate });
        });
        draft = clone(settings);
        dirty = false;
        showSettingsErrors([]);
        renderEditor();
        renderLogs();
        showToast('บันทึกแล้ว จำนวนที่จ่ายไปและประวัติยังอยู่ครบ');
    } catch (error) {
        showSettingsErrors(['บันทึกไม่ได้: ' + (window.SharedStore || error.message.includes('จำนวนทั้งหมด') || error.message.includes('แท็บ') || error.message.includes('HTTPS')
            ? error.message : 'เบราว์เซอร์ไม่อนุญาตให้เก็บข้อมูลหรือพื้นที่เต็ม การแก้ไขยังอยู่ในหน้านี้')]);
    } finally {
        $('save-settings').disabled = false;
    }
}

function applyPendingSettings() {
    if (spinning) return;
    try {
        adoptState(readState());
        storageBroken = false;
    } catch (_) {
        storageBroken = true;
        showToast('อ่านสต็อกและประวัติไม่ได้ กรุณาตรวจสอบข้อมูลที่บันทึกไว้');
    }
}

function renderLogs() {
    const logs = state.logs;
    const pages = Math.max(1, Math.ceil(logs.length / LOG_PAGE_SIZE));
    logPage = Math.min(logPage, pages - 1);
    $('log-count').textContent = logs.length + ' รายการที่บันทึกไว้ · จ่ายรางวัลแล้วทั้งหมด ' + Object.values(state.issued).reduce((sum, value) => sum + value, 0) + ' ชิ้น';
    $('export-logs').disabled = logs.length === 0;
    $('clear-logs').disabled = logs.length === 0;
    $('logs-prev').disabled = logPage === 0;
    $('logs-next').disabled = logPage >= pages - 1;
    $('log-page-info').textContent = logs.length ? 'หน้า ' + (logPage + 1) + ' / ' + pages : 'ยังไม่มีประวัติการสุ่ม';
    const body = $('log-rows');
    body.replaceChildren();
    if (!logs.length) {
        const row = body.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 5;
        cell.className = 'empty-log';
        cell.textContent = 'เมื่อวงล้อหมุนจบ ผลรางวัลจะถูกบันทึกที่นี่';
        return;
    }
    logs.slice(logPage * LOG_PAGE_SIZE, (logPage + 1) * LOG_PAGE_SIZE).forEach(log => {
        const row = body.insertRow();
        const time = document.createElement('time');
        time.dateTime = log.time;
        time.textContent = new Date(log.time).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' });
        row.insertCell().append(time);
        row.insertCell().textContent = log.label;
        row.insertCell().textContent = log.quantity;
        row.insertCell().textContent = log.remaining;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'button button-quiet button-small';
        remove.dataset.deleteLog = log.id;
        remove.textContent = 'ลบ';
        remove.setAttribute('aria-label', 'ลบประวัติ ' + log.label + ' ' + time.textContent);
        row.insertCell().append(remove);
    });
}

function askDeleteLogs(ids) {
    if (!isAdmin || !ids.length) return;
    pendingDeleteIds = ids;
    $('delete-logs-message').textContent = 'ต้องการลบประวัติ ' + ids.length + ' รายการหรือไม่? หากต้องการเก็บสำเนา ให้ส่งออก CSV ก่อนลบ';
    $('delete-logs-error').hidden = true;
    $('delete-logs-dialog').showModal();
}

async function deleteSelectedLogs() {
    if (!isAdmin || !pendingDeleteIds.length) return;
    $('confirm-delete-logs').disabled = true;
    try {
        await withWheelLock(async () => {
            await writeState(stateEngine.deleteLogs(readState(), pendingDeleteIds));
        });
        pendingDeleteIds = [];
        $('delete-logs-dialog').close();
        renderLogs();
        updateEditorSummary();
        showToast('ลบประวัติแล้ว สต็อกและยอดจ่ายไม่เปลี่ยน');
    } catch (error) {
        $('delete-logs-error').textContent = error.message.includes('แท็บ') ? error.message : 'ลบไม่ได้ กรุณาตรวจสอบการบันทึกข้อมูลแล้วลองอีกครั้ง';
        $('delete-logs-error').hidden = false;
    } finally {
        $('confirm-delete-logs').disabled = false;
    }
}

function askResetStock() {
    if (!isAdmin || resettingStock) return;
    $('reset-stock-error').hidden = true;
    $('reset-stock-dialog').showModal();
}

async function resetStock() {
    if (!isAdmin || resettingStock) return;
    resettingStock = true;
    $('confirm-reset-stock').disabled = true;
    try {
        await withWheelLock(async () => {
            await writeState(stateEngine.resetStock(readState()));
        });
        draft = clone(settings);
        dirty = false;
        logPage = 0;
        $('reset-stock-dialog').close();
        renderEditor();
        renderLogs();
        showToast('เริ่มสต็อกใหม่แล้ว ของรางวัลกลับมาครบตามจำนวนทั้งหมด ประวัติยังอยู่ครบ');
    } catch (error) {
        $('reset-stock-error').textContent = error.message.includes('แท็บ') || error.message.includes('HTTPS')
            ? error.message : 'รีเซ็ตไม่ได้ กรุณาตรวจสอบการบันทึกข้อมูลแล้วลองอีกครั้ง';
        $('reset-stock-error').hidden = false;
    } finally {
        resettingStock = false;
        $('confirm-reset-stock').disabled = false;
    }
}

function exportLogs() {
    if (!isAdmin) return;
    try {
        const latest = readState();
        if (!latest.logs.length) { showToast('ยังไม่มีประวัติให้ส่งออก'); return; }
        const blob = new Blob([stateEngine.csv(latest.logs)], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'a-place-on-earth-wheel-logs-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        showToast('ส่งออกประวัติ ' + latest.logs.length + ' รายการแล้ว');
    } catch (_) {
        showToast('ส่งออกไม่ได้ กรุณาตรวจสอบข้อมูลที่บันทึกไว้');
    }
}

document.addEventListener('click', event => {
    const close = event.target.closest('[data-close]');
    if (close) $(close.dataset.close).close();
    const navigation = event.target.closest('[data-page]');
    if (navigation) {
        event.preventDefault();
        switchPage(navigation.dataset.page);
    }
    if (event.target.closest('[data-action="logout"]')) logout();
    if (event.target.closest('[data-action="back"]')) goBack();
});
$('login-form').addEventListener('submit', handleLogin);
$('spin-button').addEventListener('click', spinWheel);
$('settings-form').addEventListener('submit', saveSettings);
$('equal-chance').addEventListener('change', event => {
    draft.equalChance = event.target.checked;
    setDirty();
});
$('prize-editor').addEventListener('input', event => {
    const input = event.target.closest('[data-field]');
    if (!input || !isAdmin) return;
    const item = draft.items[Number(input.closest('tr').dataset.index)];
    item[input.dataset.field] = input.type === 'number' ? input.valueAsNumber : input.value;
    setDirty();
});
$('prize-editor').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove]');
    if (!remove || !isAdmin || draft.items.length <= 1) return;
    const removedIndex = Number(remove.dataset.remove);
    draft.items.splice(removedIndex, 1);
    dirty = JSON.stringify(draft) !== JSON.stringify(settings);
    renderEditor();
    const next = $('prize-editor').querySelectorAll('[data-field="label"]')[Math.min(removedIndex, draft.items.length - 1)];
    if (next) next.focus();
});
$('add-prize').addEventListener('click', () => {
    if (!isAdmin || $('add-prize').disabled) return;
    const colors = ['#c47c54', '#e8c587', '#788568', '#b75c3d', '#dac19b', '#95604a'];
    const id = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'prize-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    draft.items.push({ id, label: 'ของรางวัลใหม่', quantity: 1, weight: 10, color: colors[draft.items.length % colors.length] });
    dirty = true;
    renderEditor();
    $('prize-editor').lastElementChild.querySelector('[data-field="label"]').select();
});
$('discard-settings').addEventListener('click', () => {
    draft = clone(settings);
    dirty = false;
    showSettingsErrors([]);
    renderEditor();
    showToast('กลับไปใช้ค่าที่บันทึกไว้แล้ว');
});
function refreshWheelFromStore() {
    if (spinning || $('result-dialog').open) return;
    applyPendingSettings();
    if (activePage === 'page-wheel') renderGame();
    if (activePage === 'page-admin') {
        if (!dirty) renderEditor();
        else updateEditorSummary();
        renderLogs();
    }
}
window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY || event.key === LEGACY_KEY || event.key === null) refreshWheelFromStore();
});
document.addEventListener('jao:storechange', event => {
    if (event.detail.game === 'wheel') refreshWheelFromStore();
});
$('result-dialog').addEventListener('close', () => {
    if (activePage === 'page-wheel' && !spinning) {
        applyPendingSettings();
        renderGame();
    }
});
$('export-logs').addEventListener('click', exportLogs);
$('clear-logs').addEventListener('click', () => askDeleteLogs(state.logs.map(log => log.id)));
$('log-rows').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-log]');
    if (button) askDeleteLogs([button.dataset.deleteLog]);
});
$('confirm-delete-logs').addEventListener('click', deleteSelectedLogs);
$('reset-stock').addEventListener('click', askResetStock);
$('confirm-reset-stock').addEventListener('click', resetStock);
$('logs-prev').addEventListener('click', () => { if (logPage > 0) logPage -= 1; renderLogs(); });
$('logs-next').addEventListener('click', () => { logPage += 1; renderLogs(); });
window.addEventListener('pagehide', cancelSpin);
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
        if (activePage === 'page-wheel' && !spinning) drawWheel($('game-wheel'), gameSegments, rotation);
        if (activePage === 'page-admin') updateEditorSummary();
    });
}
if (storageMessage) showToast(storageMessage);
restoreSession();
initializeNavigation();
