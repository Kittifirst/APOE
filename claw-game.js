(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./wheel-engine.js'), require('./wheel-state.js'));
    else root.ClawGame = factory(root.WheelEngine, root.WheelState);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine, ledger) {
    'use strict';

    var STORAGE_KEY = 'all-jao-games.claw.v1';
    var LOCK_KEY = 'all-jao-claw-stock';
    var PAGE_SIZE = 20;
    var DEFAULT_SETTINGS = {
        equalChance: false,
        items: [
            { id: 'claw-sticker', label: 'สติกเกอร์ All Jao', quantity: 20, weight: 35, color: '#e6ad62' },
            { id: 'claw-keychain', label: 'พวงกุญแจ', quantity: 10, weight: 25, color: '#7898a4' },
            { id: 'claw-coupon', label: 'คูปองส่วนลด 10%', quantity: 8, weight: 20, color: '#b66c51' },
            { id: 'claw-tote', label: 'กระเป๋าผ้า', quantity: 4, weight: 12, color: '#7d8d70' },
            { id: 'claw-special', label: 'ของรางวัลพิเศษ', quantity: 2, weight: 8, color: '#9b6a83' }
        ]
    };

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function newId(prefix) {
        return globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }
    function formatPercent(value) {
        if (value > 0 && value < 0.01) return '<0.01%';
        return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value) + '%';
    }

    function init(options) {
        options = options || {};
        var toast = options.showToast || function () {};
        var $ = function (id) { return document.getElementById(id); };
        var state = load();
        var draft = clone(state.settings);
        var dirty = false;
        var busy = false;
        var playable = true;
        var position = 0;
        var timers = [];
        var logPage = 0;
        var holdDelay = null;
        var holdInterval = null;
        var gravityFrame = null;

        function load() {
            try {
                var raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return ledger.create(DEFAULT_SETTINGS);
                var parsed = JSON.parse(raw);
                if (!ledger.validate(parsed)) throw new Error('invalid state');
                return parsed;
            } catch (_) {
                return ledger.create(DEFAULT_SETTINGS);
            }
        }
        function save(next) {
            if (!ledger.validate(next)) throw new Error('ข้อมูลเกมตู้คีบไม่ถูกต้อง');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            state = next;
        }
        function latest() {
            var next = load();
            state = next;
            return next;
        }
        function wait(ms) {
            return new Promise(function (resolve) {
                var id = setTimeout(resolve, ms);
                timers.push(id);
            });
        }
        function setControls(disabled) {
            ['claw-left', 'claw-right', 'claw-drop'].forEach(function (id) { $(id).disabled = disabled; });
        }
        function updatePosition() {
            $('claw-carriage').style.setProperty('--claw-position', position);
            $('claw-left').disabled = busy || !playable;
            $('claw-right').disabled = busy || !playable;
        }
        function startPosition() {
            var rail = $('claw-cabinet').querySelector('.claw-rail');
            var chute = $('claw-cabinet').querySelector('.prize-chute');
            if (!rail.clientWidth) return 0;
            var chuteCenter = chute.offsetLeft + chute.offsetWidth / 2;
            return Math.max(0, Math.min(4, (chuteCenter - rail.offsetLeft) / rail.clientWidth * 4));
        }
        function move(step) {
            if (busy || !$('page-claw').classList.contains('active')) return;
            position = Math.round(Math.max(0, Math.min(4, position + step)) * 1000) / 1000;
            updatePosition();
            $('claw-status').textContent = 'ตำแหน่งแขนคีบ ' + Math.round(position / 4 * 100) + '% · พร้อมคีบ';
        }
        function stopMoving() {
            clearTimeout(holdDelay);
            clearInterval(holdInterval);
            holdDelay = null;
            holdInterval = null;
        }
        function startMoving(button, direction, event) {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault();
            if (busy || !playable || !$('page-claw').classList.contains('active')) return;
            stopMoving();
            if (button.setPointerCapture && event.pointerId !== undefined) button.setPointerCapture(event.pointerId);
            move(direction * .16);
            holdDelay = setTimeout(function () {
                holdInterval = setInterval(function () { move(direction * .055); }, 35);
            }, 170);
        }
        function renderCapsules() {
            var pile = $('capsule-pile');
            pile.textContent = '';
            var availableItems = state.settings.items.filter(function (item) { return engine.remainingCount(item, state.issued) > 0; });
            var colors = availableItems.map(function (item) { return item.color; });
            var stockTotal = availableItems.reduce(function (sum, item) { return sum + engine.remainingCount(item, state.issued); }, 0);
            if (!colors.length) colors = ['#c9bca9'];
            var layout = [];
            var compactLayouts = {
                1: [[50, 5, -8, 1.06]],
                2: [[38, 5, -10, 1.04], [67, 8, 13, 1]],
                3: [[35, 5, -14, 1.03], [58, 9, 8, 1.06], [81, 4, -5, .98]],
                4: [[34, 5, -13, 1], [51, 10, 12, 1.05], [68, 3, -8, 1.02], [85, 8, 16, .98]],
                5: [[34, 5, -13, 1], [51, 10, 12, 1.05], [68, 3, -8, 1.02], [85, 8, 16, .98], [58, 51, -17, 1.04]],
                6: [[34, 5, -13, 1], [50, 10, 12, 1.05], [66, 3, -8, 1.02], [83, 8, 16, .98], [48, 51, -17, 1.04], [72, 48, 11, .96]],
                7: [[33, 5, -13, 1], [46, 10, 12, 1.05], [59, 3, -8, 1.02], [72, 8, 16, .98], [85, 4, -10, 1], [48, 51, -17, 1.04], [72, 48, 11, .96]],
                8: [[33, 5, -13, 1], [46, 10, 12, 1.05], [59, 3, -8, 1.02], [72, 8, 16, .98], [85, 4, -10, 1], [42, 51, -17, 1.04], [62, 48, 11, .96], [80, 54, -6, 1.02]]
            };
            if (stockTotal <= 8) {
                layout = compactLayouts[stockTotal] || [];
            } else {
                var visualTotal = Math.min(stockTotal, 200);
                for (var layoutIndex = 0; layoutIndex < visualTotal; layoutIndex += 1) {
                    var row = Math.floor(layoutIndex / 12);
                    var column = layoutIndex % 12;
                    var left = 6 + column * 7.9 + ((row * 7 + column * 3) % 5 - 2);
                    var bottom = row * 17 + ((column * 11 + row * 5) % 10);
                    if (left < 30 && bottom < 86) bottom += 88;
                    layout.push([left, bottom, ((layoutIndex * 29 + row * 7) % 46) - 23, .86 + ((layoutIndex * 13) % 20) / 100]);
                }
            }
            for (var index = 0; index < layout.length; index += 1) {
                var capsule = document.createElement('span');
                capsule.className = 'capsule';
                capsule.style.setProperty('--capsule-color', colors[index % colors.length]);
                capsule.style.setProperty('--capsule-left', layout[index][0] + '%');
                capsule.style.setProperty('--capsule-bottom', layout[index][1] + 'px');
                capsule.style.setProperty('--capsule-rotate', layout[index][2] + 'deg');
                capsule.style.setProperty('--capsule-scale', layout[index][3]);
                capsule.style.zIndex = String(Math.round(layout[index][1] / 10) + (index % 3));
                pile.appendChild(capsule);
            }
            updateStockCount(stockTotal, layout.length);
        }
        function remainingStock() {
            return state.settings.items.reduce(function (sum, item) { return sum + engine.remainingCount(item, state.issued); }, 0);
        }
        function updateStockCount(total, visible) {
            total = total === undefined ? remainingStock() : total;
            visible = visible === undefined ? $('capsule-pile').querySelectorAll('.capsule:not(.is-picked)').length : visible;
            $('claw-stock-count').textContent = total > visible
                ? 'ในตู้ ' + total.toLocaleString('th-TH') + ' ลูก · แสดงกองด้านหน้า ' + visible.toLocaleString('th-TH')
                : 'ในตู้ ' + total.toLocaleString('th-TH') + ' ลูก';
        }
        function pickVisibleCapsule() {
            var capsules = Array.from($('capsule-pile').querySelectorAll('.capsule:not(.is-picked)'));
            if (!capsules.length) {
                renderCapsules();
                capsules = Array.from($('capsule-pile').querySelectorAll('.capsule:not(.is-picked)'));
            }
            var clawPercent = position * 25;
            var target = capsules.reduce(function (best, capsule) {
                var left = parseFloat(capsule.style.getPropertyValue('--capsule-left'));
                var bottom = parseFloat(capsule.style.getPropertyValue('--capsule-bottom'));
                var score = Math.abs(left - clawPercent) - bottom * .055;
                return !best || score < best.score ? { capsule: capsule, score: score, left: left, bottom: bottom } : best;
            }, null);
            if (!target) return null;
            var pickedLeft = target.left;
            target.capsule.classList.add('is-picked');
            var gravityTimer = setTimeout(function () { runCapsuleGravity(pickedLeft); }, 130);
            timers.push(gravityTimer);
            var color = target.capsule.style.getPropertyValue('--capsule-color') || '#c47c54';
            var removeTimer = setTimeout(function () { target.capsule.remove(); }, 520);
            timers.push(removeTimer);
            return color;
        }
        function runCapsuleGravity(pickedLeftPercent) {
            cancelAnimationFrame(gravityFrame);
            var pile = $('capsule-pile');
            var width = pile.clientWidth;
            if (!width) return;
            var chute = pile.parentElement.querySelector('.prize-chute');
            var chuteRight = Math.max(0, chute.offsetLeft + chute.offsetWidth - pile.offsetLeft);
            var chuteTop = Math.max(0, chute.offsetHeight - 11);
            var diameter = Math.max(36, Math.min(50, width * .065));
            var radius = diameter / 2;
            var bodies = Array.from(pile.querySelectorAll('.capsule:not(.is-picked)')).map(function (capsule, index) {
                capsule.classList.add('is-physics');
                return {
                    element: capsule,
                    x: parseFloat(capsule.style.getPropertyValue('--capsule-left')) / 100 * width,
                    y: parseFloat(capsule.style.getPropertyValue('--capsule-bottom')),
                    vx: ((index * 17) % 9 - 4) * 2 + (parseFloat(capsule.style.getPropertyValue('--capsule-left')) < pickedLeftPercent ? 12 : -12),
                    vy: 0,
                    rotation: parseFloat(capsule.style.getPropertyValue('--capsule-rotate')) || 0
                };
            });
            var startedAt = performance.now();
            var previous = startedAt;
            function groundFor(body) {
                return body.x - radius < chuteRight ? chuteTop : 0;
            }
            function frame(now) {
                var dt = Math.min(.028, Math.max(.008, (now - previous) / 1000));
                previous = now;
                bodies.forEach(function (body) {
                    body.vy -= 920 * dt;
                    body.x += body.vx * dt;
                    body.y += body.vy * dt;
                    if (body.x < radius) { body.x = radius; body.vx = Math.abs(body.vx) * .42; }
                    if (body.x > width - radius) { body.x = width - radius; body.vx = -Math.abs(body.vx) * .42; }
                    var ground = groundFor(body);
                    if (body.y < ground) {
                        body.y = ground;
                        if (body.vy < -35) body.vy = -body.vy * .18;
                        else body.vy = 0;
                        body.vx *= .84;
                    }
                });
                for (var pass = 0; pass < 3; pass += 1) {
                    for (var first = 0; first < bodies.length; first += 1) {
                        for (var second = first + 1; second < bodies.length; second += 1) {
                            var a = bodies[first];
                            var b = bodies[second];
                            var dx = b.x - a.x;
                            var dy = b.y - a.y;
                            var distance = Math.sqrt(dx * dx + dy * dy) || .01;
                            if (distance >= diameter) continue;
                            var nx = dx / distance;
                            var ny = dy / distance;
                            var overlap = (diameter - distance) * .51;
                            a.x -= nx * overlap; a.y -= ny * overlap;
                            b.x += nx * overlap; b.y += ny * overlap;
                            var relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                            if (relative < 0) {
                                var impulse = -relative * .24;
                                a.vx -= impulse * nx; a.vy -= impulse * ny;
                                b.vx += impulse * nx; b.vy += impulse * ny;
                            }
                            a.y = Math.max(groundFor(a), a.y);
                            b.y = Math.max(groundFor(b), b.y);
                        }
                    }
                }
                var moving = false;
                bodies.forEach(function (body) {
                    body.vx *= .992;
                    body.rotation += body.vx * dt * .18;
                    body.element.style.setProperty('--capsule-left', body.x / width * 100 + '%');
                    body.element.style.setProperty('--capsule-bottom', Math.max(0, body.y) + 'px');
                    body.element.style.setProperty('--capsule-rotate', body.rotation + 'deg');
                    if (Math.abs(body.vx) > 2 || Math.abs(body.vy) > 2) moving = true;
                });
                if (now - startedAt < 1700 && moving) gravityFrame = requestAnimationFrame(frame);
                else {
                    gravityFrame = null;
                    bodies.forEach(function (body) { body.element.classList.remove('is-physics'); });
                }
            }
            gravityFrame = requestAnimationFrame(frame);
        }
        function syncGameControls(setReadyMessage) {
            var available = engine.buildSegments(state.settings, state.issued).some(function (item) { return item.weight > 0; });
            playable = available;
            setControls(busy || !available);
            updatePosition();
            updateStockCount();
            if (!available) $('claw-status').textContent = 'ของรางวัลหมดแล้ว กรุณาติดต่อผู้ดูแล';
            else if (setReadyMessage) $('claw-status').textContent = 'เลือกตำแหน่ง แล้วกดคีบได้เลย';
        }
        function render() {
            state = latest();
            renderCapsules();
            position = startPosition();
            syncGameControls(true);
        }
        async function withLock(action) {
            if (!navigator.locks) throw new Error('กรุณาเปิดเกมด้วย Chrome หรือ Edge ผ่าน localhost หรือ HTTPS');
            return navigator.locks.request(LOCK_KEY, { ifAvailable: true }, function (lock) {
                if (!lock) throw new Error('ตู้คีบกำลังทำงานในอีกแท็บ กรุณาลองอีกครั้ง');
                return action();
            });
        }
        async function drop() {
            if (busy || !playable || !$('page-claw').classList.contains('active')) return;
            busy = true;
            setControls(true);
            $('claw-status').textContent = 'กำลังหย่อนแขนคีบ…';
            $('claw-carriage').classList.add('is-dropping');
            try {
                await wait(850);
                var result = await withLock(function () {
                    var current = load();
                    var segments = engine.buildSegments(current.settings, current.issued);
                    var chosen = segments[engine.chooseWeightedSegment(segments, Math.random)];
                    var next = ledger.award(current, chosen.id, newId('claw'), new Date().toISOString());
                    save(next);
                    return { prize: chosen, next: next };
                });
                var capsuleColor = pickVisibleCapsule();
                $('claw-caught').style.setProperty('--caught-color', capsuleColor || result.prize.color);
                $('claw-carriage').classList.add('has-capsule');
                $('claw-status').textContent = 'คีบได้แล้ว! กำลังนำแคปซูลออกมา…';
                await wait(950);
                $('claw-carriage').classList.remove('is-dropping');
                position = startPosition();
                updatePosition();
                $('claw-carriage').classList.add('is-delivering');
                await wait(1000);
                position = startPosition();
                updatePosition();
                var resultDialog = $('claw-result-dialog');
                var resultButton = resultDialog.querySelector('[data-close="claw-result-dialog"]');
                resultDialog.classList.remove('is-opening', 'is-revealed');
                $('claw-result-title').textContent = 'กำลังเปิดแคปซูล…';
                $('claw-result-prize').textContent = '';
                $('claw-result-prize').hidden = true;
                resultButton.disabled = true;
                resultDialog.showModal();
                void resultDialog.offsetWidth;
                resultDialog.classList.add('is-opening');
                await wait(1750);
                $('claw-result-title').textContent = 'เปิดแคปซูลแล้ว!';
                $('claw-result-prize').textContent = result.prize.label;
                $('claw-result-prize').hidden = false;
                resultDialog.classList.add('is-revealed');
                resultButton.disabled = false;
                $('claw-status').textContent = 'คุณได้รับ: ' + result.prize.label;
                state = result.next;
                updateStockCount();
            } catch (error) {
                $('claw-status').textContent = error.message || 'คีบไม่สำเร็จ กรุณาลองอีกครั้ง';
                toast(error.message || 'คีบไม่สำเร็จ กรุณาลองอีกครั้ง');
            } finally {
                $('claw-carriage').classList.remove('is-dropping', 'is-delivering', 'has-capsule');
                position = startPosition();
                busy = false;
                syncGameControls(false);
            }
        }
        function cancel() {
            stopMoving();
            cancelAnimationFrame(gravityFrame);
            gravityFrame = null;
            timers.forEach(clearTimeout);
            timers = [];
            position = startPosition();
            busy = false;
            if ($('claw-carriage')) $('claw-carriage').classList.remove('is-dropping', 'is-delivering', 'has-capsule');
            if ($('claw-carriage')) updatePosition();
        }

        function showErrors(errors) {
            var box = $('claw-settings-errors');
            box.hidden = !errors.length;
            box.innerHTML = errors.length ? '<ul>' + errors.map(function (error) { return '<li>' + escapeHtml(error) + '</li>'; }).join('') + '</ul>' : '';
        }
        function escapeHtml(value) {
            var span = document.createElement('span');
            span.textContent = value;
            return span.innerHTML;
        }
        function renderAdmin() {
            state = latest();
            if (!dirty) draft = clone(state.settings);
            var body = $('claw-prize-editor');
            body.textContent = '';
            var probabilities;
            try { probabilities = engine.probabilities(draft, state.issued); } catch (_) { probabilities = []; }
            draft.items.forEach(function (item, index) {
                var issued = engine.issuedCount(item, state.issued);
                var remaining = Math.max(0, Number(item.quantity) - issued);
                var row = document.createElement('tr');
                row.dataset.index = index;
                row.innerHTML = '<td><input class="color-input" type="color" data-field="color" aria-label="สีรายการที่ ' + (index + 1) + '"></td>' +
                    '<td><input class="editor-input" type="text" maxlength="60" data-field="label" aria-label="ชื่อรางวัลรายการที่ ' + (index + 1) + '"></td>' +
                    '<td><input class="editor-input" type="number" min="1" max="999999" step="1" data-field="quantity" aria-label="จำนวนทั้งหมดรายการที่ ' + (index + 1) + '"></td>' +
                    '<td class="stock-issued">' + issued.toLocaleString('th-TH') + '</td><td class="stock-remaining' + (remaining ? '' : ' sold-out') + '">' + (remaining ? remaining.toLocaleString('th-TH') : 'หมดแล้ว') + '</td>' +
                    '<td><input class="editor-input" type="number" min="0" max="1000" step="0.1" data-field="weight" aria-label="น้ำหนักสุ่มรายการที่ ' + (index + 1) + '"></td>' +
                    '<td class="editor-chance">' + formatPercent(probabilities[index] ? probabilities[index].percent : 0) + '</td>' +
                    '<td><button class="delete-prize" type="button" data-remove="' + index + '" aria-label="ลบรางวัลรายการที่ ' + (index + 1) + '"><svg class="icon"><use href="#i-trash"/></svg></button></td>';
                body.appendChild(row);
                row.querySelector('[data-field="color"]').value = item.color;
                row.querySelector('[data-field="label"]').value = item.label;
                row.querySelector('[data-field="quantity"]').value = item.quantity;
                row.querySelector('[data-field="weight"]').value = item.weight;
            });
            updateAdminSummary();
            renderLogs();
        }
        function updateAdminSummary() {
            dirty = JSON.stringify(draft) !== JSON.stringify(state.settings);
            $('claw-equal-chance').checked = draft.equalChance;
            document.querySelectorAll('#claw-prize-editor [data-field="weight"]').forEach(function (input) { input.disabled = draft.equalChance; });
            var remaining = draft.items.reduce(function (sum, item) { return sum + Math.max(0, Number(item.quantity) - engine.issuedCount(item, state.issued)); }, 0);
            $('claw-editor-total').textContent = draft.items.length + ' รายการ · เหลือ ' + remaining.toLocaleString('th-TH') + ' ชิ้น';
            $('claw-weight-explanation').textContent = draft.equalChance ? 'โอกาสออก = จำนวนคงเหลือของรายการ ÷ จำนวนคงเหลือรวม' : 'โอกาสออก = (จำนวนคงเหลือ × น้ำหนักสุ่ม) ÷ น้ำหนักรวมของของที่เหลือ';
            $('claw-save-status').textContent = dirty ? 'มีการแก้ไขที่ยังไม่ได้บันทึก' : 'ใช้การตั้งค่าที่บันทึกแล้ว';
            $('claw-save-status').classList.toggle('unsaved', dirty);
            $('claw-discard-settings').disabled = !dirty;
            $('claw-add-prize').disabled = draft.items.length >= engine.MAX_ITEMS;
            try {
                var probabilities = engine.probabilities(draft, state.issued);
                document.querySelectorAll('#claw-prize-editor .editor-chance').forEach(function (cell, index) { cell.textContent = formatPercent(probabilities[index].percent); });
            } catch (_) { /* form errors appear when saving */ }
        }
        function fieldInput(event) {
            var input = event.target.closest('[data-field]');
            if (!input) return;
            var item = draft.items[Number(input.closest('tr').dataset.index)];
            item[input.dataset.field] = input.type === 'number' ? input.valueAsNumber : input.value;
            updateAdminSummary();
        }
        function saveSettings(event) {
            event.preventDefault();
            var validation = engine.validateSettings(draft);
            var belowIssued = draft.items.filter(function (item) { return Number.isInteger(item.quantity) && item.quantity < engine.issuedCount(item, state.issued); });
            var errors = validation.errors.slice();
            if (belowIssued.length) errors.push('จำนวนทั้งหมดต้องไม่น้อยกว่าที่จ่ายแล้ว: ' + belowIssued.map(function (item) { return item.label; }).join(', '));
            if (errors.length) { showErrors(errors); return; }
            try {
                var current = latest();
                save({ version: current.version, settings: clone(draft), issued: current.issued, logs: current.logs });
                dirty = false;
                showErrors([]);
                renderAdmin();
                toast('บันทึกเกมตู้คีบแล้ว สต็อกและประวัติยังอยู่ครบ');
            } catch (_) { showErrors(['บันทึกไม่ได้ กรุณาตรวจสอบการเก็บข้อมูลของเบราว์เซอร์']); }
        }
        function renderLogs() {
            state = latest();
            var logs = state.logs;
            var pages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
            logPage = Math.min(logPage, pages - 1);
            var rows = $('claw-log-rows');
            rows.textContent = '';
            logs.slice(logPage * PAGE_SIZE, (logPage + 1) * PAGE_SIZE).forEach(function (log) {
                var date = new Date(log.time);
                var row = document.createElement('tr');
                row.innerHTML = '<td><time datetime="' + log.time + '">' + date.toLocaleString('th-TH') + '</time></td><td></td><td>' + log.quantity + '</td><td>' + log.remaining.toLocaleString('th-TH') + '</td><td><button class="button button-danger button-small" type="button" data-log-delete="' + escapeHtml(log.id) + '">ลบ</button></td>';
                row.children[1].textContent = log.label;
                rows.appendChild(row);
            });
            if (!logs.length) rows.innerHTML = '<tr><td colspan="5" class="empty-log">ยังไม่มีประวัติการคีบ</td></tr>';
            $('claw-log-count').textContent = logs.length ? 'ทั้งหมด ' + logs.length.toLocaleString('th-TH') + ' รายการ' : 'ยังไม่มีประวัติ';
            $('claw-log-page-info').textContent = logs.length ? 'หน้า ' + (logPage + 1) + ' / ' + pages : 'ยังไม่มีประวัติการคีบ';
            $('claw-logs-prev').disabled = logPage === 0;
            $('claw-logs-next').disabled = logPage >= pages - 1;
            $('claw-export-logs').disabled = !logs.length;
            $('claw-clear-logs').disabled = !logs.length;
        }
        function deleteLogs(ids) {
            if (!ids.length || !window.confirm('ยืนยันลบประวัติ ' + ids.length + ' รายการ? การลบจะไม่คืนสต็อก')) return;
            var current = latest();
            save(ledger.deleteLogs(current, ids));
            renderAdmin();
            toast('ลบประวัติแล้ว สต็อกและยอดจ่ายไม่เปลี่ยน');
        }
        function resetStock() {
            if (!window.confirm('เริ่มสต็อกใหม่? จำนวนที่จ่ายแล้วจะกลับมาเป็นของเหลือ แต่ประวัติยังอยู่ครบ')) return;
            save(ledger.resetStock(latest()));
            dirty = false;
            renderAdmin();
            toast('เริ่มสต็อกเกมตู้คีบใหม่แล้ว');
        }
        function exportLogs() {
            var logs = latest().logs;
            if (!logs.length) return;
            var blob = new Blob([ledger.csv(logs)], { type: 'text/csv;charset=utf-8;' });
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url;
            link.download = 'all-jao-claw-logs-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
            toast('ส่งออกประวัติ ' + logs.length + ' รายการแล้ว');
        }

        [['claw-left', -1], ['claw-right', 1]].forEach(function (control) {
            var button = $(control[0]);
            button.addEventListener('pointerdown', function (event) { startMoving(button, control[1], event); });
            button.addEventListener('pointerup', stopMoving);
            button.addEventListener('pointercancel', stopMoving);
            button.addEventListener('lostpointercapture', stopMoving);
        });
        window.addEventListener('blur', stopMoving);
        $('claw-drop').addEventListener('click', drop);
        document.addEventListener('keydown', function (event) {
            if (!$('page-claw').classList.contains('active') || $('claw-result-dialog').open) return;
            if (event.key === 'ArrowLeft') { event.preventDefault(); move(-.15); }
            if (event.key === 'ArrowRight') { event.preventDefault(); move(.15); }
            if (event.code === 'Space') { event.preventDefault(); drop(); }
        });
        $('claw-settings-form').addEventListener('submit', saveSettings);
        $('claw-prize-editor').addEventListener('input', fieldInput);
        $('claw-prize-editor').addEventListener('click', function (event) {
            var remove = event.target.closest('[data-remove]');
            if (!remove || draft.items.length <= 1) return;
            draft.items.splice(Number(remove.dataset.remove), 1);
            dirty = true;
            renderAdmin();
        });
        $('claw-add-prize').addEventListener('click', function () {
            if (draft.items.length >= engine.MAX_ITEMS) return;
            var colors = ['#c47c54', '#e8c587', '#788568', '#7898a4', '#9b6a83'];
            draft.items.push({ id: newId('claw-prize'), label: 'ของรางวัลใหม่', quantity: 1, weight: 10, color: colors[draft.items.length % colors.length] });
            dirty = true;
            renderAdmin();
        });
        $('claw-equal-chance').addEventListener('change', function (event) { draft.equalChance = event.target.checked; dirty = true; renderAdmin(); });
        $('claw-discard-settings').addEventListener('click', function () { draft = clone(state.settings); dirty = false; showErrors([]); renderAdmin(); });
        $('claw-log-rows').addEventListener('click', function (event) { var button = event.target.closest('[data-log-delete]'); if (button) deleteLogs([button.dataset.logDelete]); });
        $('claw-clear-logs').addEventListener('click', function () { deleteLogs(latest().logs.map(function (log) { return log.id; })); });
        $('claw-reset-stock').addEventListener('click', resetStock);
        $('claw-export-logs').addEventListener('click', exportLogs);
        $('claw-logs-prev').addEventListener('click', function () { if (logPage > 0) { logPage -= 1; renderLogs(); } });
        $('claw-logs-next').addEventListener('click', function () { logPage += 1; renderLogs(); });
        window.addEventListener('storage', function (event) { if (event.key === STORAGE_KEY && !busy) { state = load(); if (!dirty) draft = clone(state.settings); if ($('page-claw').classList.contains('active')) render(); if ($('page-claw-admin').classList.contains('active')) renderAdmin(); } });

        renderCapsules();
        updatePosition();
        return { render: render, renderAdmin: renderAdmin, cancel: cancel };
    }

    return Object.freeze({ init: init, DEFAULT_SETTINGS: clone(DEFAULT_SETTINGS), STORAGE_KEY: STORAGE_KEY });
});
