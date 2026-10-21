(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MemoryGame = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var STORAGE_KEY = 'all-jao-games.memory.v1';
    var MAX_PAIRS = 30;
    var DEFAULT_TIME = 90;
    var colors = ['#edbc8e', '#dfd0e7', '#f2dba5', '#c7d8c4', '#dac1d9', '#efd1b8', '#d8c9e3', '#f3dfb5'];

    function svgData(label, color, index) {
        var safeLabel = String(label).replace(/[<&>"']/g, '');
        var art = [
            '<path d="m157 72 8-23" stroke="#728457" stroke-width="12"/><ellipse cx="160" cy="133" rx="68" ry="55" fill="#cb6834"/><ellipse cx="160" cy="133" rx="39" ry="55" fill="#e6803e"/><path d="m126 112 15 23h-27zm53 0 15 23h-27zM132 151q28 31 56 0" fill="#412b3d"/>',
            '<path d="M105 184V110a55 55 0 0 1 110 0v74l-18-12-18 12-19-12-18 12-18-12z" fill="#fff6e5"/><ellipse cx="142" cy="112" rx="7" ry="11" fill="#49304f"/><ellipse cx="179" cy="112" rx="7" ry="11" fill="#49304f"/><path d="M151 139q9 13 19 0" fill="none" stroke="#b16f7a" stroke-width="5"/>',
            '<path d="M195 62a66 66 0 1 0 10 118A69 69 0 0 1 195 62" fill="#bb8347"/><path d="m212 78 5 12 13 2-10 9 2 13-11-7-11 6 3-13-9-9 13-1z" fill="#806087"/>',
            '<path d="m160 104-12-25-6 28q-47-48-78-14 15 4 19 26 21-4 24 22 25-10 41 22h24q16-32 41-22 3-26 24-22 4-22 19-26-31-34-78 14l-6-28z" fill="#634475"/><circle cx="153" cy="120" r="3" fill="#ffe8bd"/><circle cx="168" cy="120" r="3" fill="#ffe8bd"/>',
            '<path d="m113 104-4-45 37 26q16-5 29 0l38-26-5 45q37 71-48 78-85-7-47-78" fill="#4e365b"/><path d="m130 121 18 3m25 0 18-3" stroke="#f2d49e" stroke-width="7"/><path d="m155 142 10 0-5 6z" fill="#d6a0ac"/>',
            '<path d="m112 107-30-17 4 37-4 36 30-18m96-38 30-17-4 37 4 36-30-18" fill="#9e7eab"/><rect x="106" y="97" width="108" height="61" rx="27" fill="#f6f0da"/><path d="m132 100 22 55m12-55 22 55" stroke="#c66b48" stroke-width="17"/>',
            '<path d="M111 102h90v51q0 37-45 37t-45-37z" fill="#785489"/><path d="M201 112h10q35 20-10 44" fill="none" stroke="#785489" stroke-width="11"/><path d="M136 82q-12-13 0-27m25 27q-12-13 0-27" fill="none" stroke="#aa8b9c" stroke-width="5" stroke-linecap="round"/><path d="m156 120 6 13 14 2-10 10 2 14-12-7-13 7 3-14-11-10 15-2z" fill="#ffe3b6"/>',
            '<path d="m160 57 20 43 48 7-35 34 8 49-41-23-43 23 9-49-36-34 49-7z" fill="#b68a4c"/><path d="m230 62 5 12 13 4-13 4-5 12-4-12-13-4 13-4z" fill="#88608e"/>'
        ];
        var shape = art[index % art.length];
        return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><rect width="320" height="240" rx="28" fill="' + color + '"/>' + shape + '<text x="160" y="222" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="700" fill="#35231a">' + safeLabel + '</text></svg>');
    }

    function defaultPairs() {
        return ['ฟักทอง', 'ผีน้อย', 'พระจันทร์', 'ค้างคาว', 'แมวดำ', 'ลูกกวาด', 'กาแฟอุ่น', 'ดาววิเศษ'].map(function (label, index) {
            var color = colors[index % colors.length];
            return { id: 'pair-' + (index + 1), label: label, first: svgData(label, color, index), second: svgData(label, color, index) };
        });
    }

    function validPair(pair) {
        return pair && typeof pair.id === 'string' && pair.id && typeof pair.label === 'string' && pair.label.trim() &&
            typeof pair.first === 'string' && pair.first && typeof pair.second === 'string' && pair.second;
    }

    function validate(config) {
        return !!config && Number.isInteger(config.timeLimit) && config.timeLimit >= 10 && config.timeLimit <= 600 &&
            Array.isArray(config.pairs) && config.pairs.length >= 2 && config.pairs.length <= MAX_PAIRS &&
            config.pairs.every(validPair) && new Set(config.pairs.map(function (pair) { return pair.id; })).size === config.pairs.length;
    }

    function createDefault() { return { version: 1, timeLimit: DEFAULT_TIME, pairs: defaultPairs() }; }

    function load() {
        try {
            var parsed = JSON.parse((window.SharedStore || localStorage).getItem(STORAGE_KEY) || 'null');
            return validate(parsed) ? parsed : createDefault();
        } catch (_) { return createDefault(); }
    }

    async function save(config) {
        if (!validate(config)) throw new Error('ข้อมูลเกมจับคู่ไม่ถูกต้อง');
        await (window.SharedStore || localStorage).setItem(STORAGE_KEY, JSON.stringify(config));
    }

    function shuffle(items, random) {
        var result = items.slice();
        var rng = random || Math.random;
        for (var index = result.length - 1; index > 0; index -= 1) {
            var swapIndex = Math.floor(rng() * (index + 1));
            var item = result[index]; result[index] = result[swapIndex]; result[swapIndex] = item;
        }
        return result;
    }

    function makeCards(config, random) {
        var cards = [];
        config.pairs.forEach(function (pair) {
            cards.push({ key: pair.id + '-a', pairId: pair.id, label: pair.label, image: pair.first });
            cards.push({ key: pair.id + '-b', pairId: pair.id, label: pair.label, image: pair.second });
        });
        return shuffle(cards, random);
    }

    function init() {
        var config = load();
        var cards = [];
        var opened = [];
        var matched = new Set();
        var secondsLeft = config.timeLimit;
        var timer = null;
        var mismatchTimer = null;
        var deadline = 0;
        var locked = true;
        var adminDraft = null;
        var adminDirty = false;
        var crop = null;
        var playRound = null;
        var reportAttempt = 0;

        function element(id) { return document.getElementById(id); }
        function formatTime(seconds) { return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'); }
        function setStatus(text) { element('memory-status-text').textContent = text; }
        function updateStatus() {
            element('memory-timer').textContent = formatTime(secondsLeft);
            element('memory-timer').classList.toggle('memory-time-warning', secondsLeft <= 15);
            element('memory-matches').textContent = matched.size;
            element('memory-total').textContent = config.pairs.length;
        }
        function stopTimer() { if (timer) window.clearInterval(timer); timer = null; }
        function sendReport(promise, showSuccess) {
            var attempt = ++reportAttempt;
            var status = element('memory-history-status'), retry = element('memory-retry-history');
            if (showSuccess) { status.hidden = false; status.textContent = 'กำลังบันทึกผลการเล่น…'; }
            promise.then(function () {
                if (attempt !== reportAttempt) return;
                retry.hidden = true;
                status.hidden = !showSuccess;
                status.textContent = 'บันทึกผลการเล่นแล้ว';
            }).catch(function () {
                if (attempt !== reportAttempt) return;
                status.hidden = false; status.textContent = 'ยังบันทึกประวัติไม่ได้ ระบบจะลองส่งใหม่เมื่อเชื่อมต่อได้'; retry.hidden = false;
            });
        }
        function reportPlay(stage, outcome) {
            var store = window.SharedStore;
            if (!playRound) return;
            var play = { id: playRound.id, stage: stage, outcome: outcome, total: playRound.total, matched: matched.size,
                durationMs: Math.max(0, Date.now() - playRound.started), startedAt: new Date(playRound.started).toISOString(),
                endedAt: stage === 'finish' ? new Date(Date.now()).toISOString() : '' };
            if (stage === 'finish') playRound = null;
            if (store && store.recordPlay) sendReport(store.recordPlay('memory', play), stage === 'finish');
        }
        function cancel() {
            reportPlay('finish', 'cancelled');
            stopTimer(); window.clearTimeout(mismatchTimer); mismatchTimer = null;
            locked = true; opened = []; renderBoard();
            setStatus('กดเริ่มเกมเพื่อเล่นรอบใหม่');
        }
        function endGame(won) {
            reportPlay('finish', won ? 'won' : 'timeout');
            stopTimer(); window.clearTimeout(mismatchTimer); mismatchTimer = null; locked = true;
            if (won) document.dispatchEvent(new CustomEvent('jao:celebrate'));
            setStatus(won ? 'เก่งมาก! จับคู่ครบทุกคู่แล้ว' : 'หมดเวลาแล้ว ลองเริ่มเกมใหม่อีกครั้ง');
            element('memory-start').textContent = won ? 'เล่นอีกครั้ง' : 'เริ่มใหม่';
        }
        function renderBoard() {
            var board = element('memory-board');
            // Preserve nodes so card flips animate and keyboard focus is retained.
            if (board.children.length === cards.length && cards.every(function (card, index) { return board.children[index].dataset.key === card.key; })) {
                cards.forEach(function (card, index) {
                    var button = board.children[index];
                    var isMatched = matched.has(card.pairId);
                    var isOpen = isMatched || opened.some(function (item) { return item.key === card.key; });
                    button.classList.toggle('is-open', isOpen); button.classList.toggle('is-matched', isMatched);
                    button.setAttribute('aria-label', isOpen ? card.label + (isMatched ? ' จับคู่แล้ว' : ' เปิดอยู่') : 'การ์ดปิดอยู่');
                    button.querySelector('.memory-card-front').setAttribute('aria-hidden', String(!isOpen));
                    var image = button.querySelector('img');
                    if (image.getAttribute('src') !== card.image) image.src = card.image;
                    image.alt = card.label;
                    button.setAttribute('aria-disabled', String(isMatched));
                });
                return;
            }
            board.replaceChildren();
            cards.forEach(function (card) {
                var button = document.createElement('button');
                button.type = 'button'; button.className = 'memory-card'; button.dataset.key = card.key;
                button.setAttribute('aria-label', 'การ์ดปิดอยู่');
                var inner = document.createElement('span'); inner.className = 'memory-card-inner';
                var back = document.createElement('span'); back.className = 'memory-card-back'; back.textContent = '?';
                var front = document.createElement('span'); front.className = 'memory-card-front'; front.setAttribute('aria-hidden', 'true');
                var image = document.createElement('img'); image.src = card.image; image.alt = card.label;
                front.append(image); inner.append(back, front); button.append(inner);
                if (matched.has(card.pairId) || opened.some(function (item) { return item.key === card.key; })) button.classList.add('is-open');
                if (matched.has(card.pairId)) button.classList.add('is-matched');
                board.append(button);
            });
        }
        function startGame() {
            reportPlay('finish', 'cancelled');
            stopTimer(); window.clearTimeout(mismatchTimer); mismatchTimer = null;
            config = load(); cards = makeCards(config); opened = []; matched = new Set(); secondsLeft = config.timeLimit; locked = false;
            deadline = Date.now() + config.timeLimit * 1000;
            playRound = { id: window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'memory-' + Date.now() + '-' + Math.random().toString(36).slice(2), started: Date.now(), total: config.pairs.length };
            reportPlay('start', 'started');
            renderBoard(); updateStatus(); setStatus('เปิดการ์ดสองใบเพื่อจับคู่'); element('memory-start').textContent = 'เริ่มใหม่';
            timer = window.setInterval(function () { secondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); updateStatus(); if (secondsLeft <= 0) endGame(false); }, 200);
        }
        function handleCard(event) {
            var button = event.target.closest('.memory-card');
            if (!button || locked || opened.length >= 2) return;
            if (Date.now() >= deadline) { secondsLeft = 0; updateStatus(); endGame(false); return; }
            var card = cards.find(function (item) { return item.key === button.dataset.key; });
            if (!card || matched.has(card.pairId) || opened.some(function (item) { return item.key === card.key; })) return;
            opened.push(card); renderBoard();
            if (opened.length !== 2) return;
            locked = true;
            if (opened[0].pairId === opened[1].pairId) {
                matched.add(card.pairId); opened = []; locked = false; renderBoard(); updateStatus();
                if (matched.size === config.pairs.length) endGame(true);
            } else {
                mismatchTimer = window.setTimeout(function () { mismatchTimer = null; opened = []; locked = false; renderBoard(); }, 700);
            }
        }
        function createPair(index) {
            var color = colors[index % colors.length];
            return { id: 'pair-' + Date.now() + '-' + index, label: 'คู่ใหม่', first: svgData('ใหม่', color, index), second: svgData('ใหม่', color, index + 1) };
        }
        function resizePairs(slotCount) {
            var pairCount = slotCount / 2;
            while (adminDraft.pairs.length < pairCount) adminDraft.pairs.push(createPair(adminDraft.pairs.length));
            if (adminDraft.pairs.length > pairCount) adminDraft.pairs.splice(pairCount);
            renderAdmin(); markAdminDirty();
        }
        function renderAdmin() {
            adminDraft = adminDraft || JSON.parse(JSON.stringify(config));
            element('memory-time-limit').value = adminDraft.timeLimit;
            element('memory-slot-count').value = adminDraft.pairs.length * 2;
            element('memory-admin-summary').textContent = adminDraft.pairs.length + ' คู่ · ' + (adminDraft.pairs.length * 2) + ' ช่อง';
            var editor = element('memory-pair-editor'); editor.replaceChildren();
            adminDraft.pairs.forEach(function (pair, index) {
                var item = document.createElement('div'); item.className = 'memory-pair-row';
                var heading = document.createElement('strong'); heading.textContent = 'คู่ที่ ' + (index + 1);
                var label = document.createElement('input'); label.className = 'editor-input'; label.type = 'text'; label.maxLength = 40; label.value = pair.label; label.placeholder = 'ชื่อคู่'; label.dataset.memoryLabel = index;
                var previews = document.createElement('div'); previews.className = 'memory-upload-grid';
                [pair.first, pair.second].forEach(function (source, side) {
                    var wrapper = document.createElement('label'); wrapper.className = 'memory-upload';
                    var img = document.createElement('img'); img.src = source; img.alt = 'ตัวอย่างรูปคู่ที่ ' + (index + 1) + ' ด้านที่ ' + (side + 1);
                    var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.dataset.memoryImage = index + ':' + side;
                    input.setAttribute('aria-label', 'อัปโหลดรูปคู่ที่ ' + (index + 1) + ' ด้านที่ ' + (side + 1) + ' เพื่อครอบตัด');
                    var caption = document.createElement('span'); caption.className = 'memory-upload-caption'; caption.textContent = 'อัปโหลด / เปลี่ยนรูป';
                    wrapper.append(img, caption, input); previews.append(wrapper);
                });
                var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button-danger button-small'; remove.textContent = 'ลบคู่นี้'; remove.dataset.memoryRemove = index; remove.disabled = adminDraft.pairs.length <= 2;
                item.append(heading, label, previews, remove); editor.append(item);
            });
        }
        function markAdminDirty() { adminDirty = true; element('memory-save-status').textContent = 'มีการแก้ไขที่ยังไม่ได้บันทึก'; element('memory-save-status').classList.add('unsaved'); }
        function cropBounds() {
            var size = Math.min(crop.image.naturalWidth, crop.image.naturalHeight) / crop.zoom;
            crop.x = Math.max(size / 2, Math.min(crop.image.naturalWidth - size / 2, crop.x));
            crop.y = Math.max(size / 2, Math.min(crop.image.naturalHeight - size / 2, crop.y));
            return { x: crop.x - size / 2, y: crop.y - size / 2, size: size };
        }
        function drawCrop(canvas) {
            var bounds = cropBounds();
            var context = canvas.getContext('2d');
            context.fillStyle = '#fffdf8'; context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(crop.image, bounds.x, bounds.y, bounds.size, bounds.size, 0, 0, canvas.width, canvas.height);
        }
        function updateCrop() {
            if (!crop || !crop.ready) return;
            drawCrop(element('memory-crop-preview'));
            element('memory-crop-zoom').value = crop.zoom;
            element('memory-crop-zoom-value').textContent = Math.round(crop.zoom * 100) + '%';
        }
        function releaseCrop() {
            if (!crop) return;
            if (crop.url) URL.revokeObjectURL(crop.url);
            crop.image.onload = crop.image.onerror = null;
            crop = null;
            element('memory-crop-preview').classList.remove('is-dragging');
        }
        function openCrop(file, pair, side, inputKey) {
            releaseCrop();
            var session = { pair: pair, side: side, inputKey: inputKey, image: new Image(), ready: false, zoom: 1, pointer: null };
            crop = session;
            element('memory-crop-frame').hidden = true;
            element('memory-crop-zoom').value = 1;
            element('memory-crop-zoom-value').textContent = '100%';
            element('memory-crop-both').checked = true;
            ['memory-crop-apply', 'memory-crop-zoom', 'memory-crop-reset'].forEach(function (id) { element(id).disabled = true; });
            element('memory-crop-status').textContent = 'กำลังโหลดภาพ…';
            element('memory-crop-dialog').showModal();
            function failed() {
                if (crop !== session) return;
                element('memory-crop-status').textContent = 'เปิดภาพนี้ไม่ได้ กรุณายกเลิกแล้วเลือกไฟล์ภาพอื่น เช่น JPG, PNG หรือ WebP';
            }
            session.image.onload = function () {
                if (crop !== session) return;
                if (!session.image.naturalWidth || !session.image.naturalHeight) { failed(); return; }
                session.x = session.image.naturalWidth / 2; session.y = session.image.naturalHeight / 2; session.ready = true;
                updateCrop();
                element('memory-crop-frame').hidden = false;
                ['memory-crop-apply', 'memory-crop-zoom', 'memory-crop-reset'].forEach(function (id) { element(id).disabled = false; });
                element('memory-crop-status').textContent = 'เลือก “ใช้ภาพนี้” แล้วกดบันทึกเกมจับคู่เพื่อบันทึกการตั้งค่า';
            };
            session.image.onerror = failed;
            try { session.url = URL.createObjectURL(file); session.image.src = session.url; } catch (_) { failed(); }
        }
        function bindCrop() {
            var dialog = element('memory-crop-dialog');
            var preview = element('memory-crop-preview');
            element('memory-crop-cancel').addEventListener('click', function () { dialog.close(); });
            dialog.addEventListener('close', function () {
                if (dialog.open || !crop) return;
                var inputKey = crop.inputKey;
                releaseCrop();
                if (!adminDirty) { adminDraft = null; renderAdmin(); }
                var input = element('memory-pair-editor').querySelector('[data-memory-image="' + inputKey + '"]');
                if (input) input.focus({ preventScroll: true });
            });
            element('memory-crop-zoom').addEventListener('input', function (event) {
                if (!crop || !crop.ready) return;
                crop.zoom = Number(event.target.value); updateCrop();
            });
            element('memory-crop-reset').addEventListener('click', function () {
                if (!crop || !crop.ready) return;
                crop.zoom = 1; crop.x = crop.image.naturalWidth / 2; crop.y = crop.image.naturalHeight / 2; updateCrop();
            });
            preview.addEventListener('pointerdown', function (event) {
                if (!crop || !crop.ready || crop.pointer || event.button !== 0) return;
                preview.focus({ preventScroll: true });
                crop.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
                preview.setPointerCapture(event.pointerId); preview.classList.add('is-dragging'); event.preventDefault();
            });
            preview.addEventListener('pointermove', function (event) {
                if (!crop || !crop.pointer || crop.pointer.id !== event.pointerId) return;
                var bounds = preview.getBoundingClientRect();
                if (!bounds.width || !bounds.height) return;
                var size = cropBounds().size;
                crop.x -= (event.clientX - crop.pointer.x) * size / bounds.width;
                crop.y -= (event.clientY - crop.pointer.y) * size / bounds.height;
                crop.pointer.x = event.clientX; crop.pointer.y = event.clientY; updateCrop();
            });
            function endDrag(event) {
                if (!crop || !crop.pointer || crop.pointer.id !== event.pointerId) return;
                crop.pointer = null; preview.classList.remove('is-dragging');
                if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId);
            }
            ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) { preview.addEventListener(name, endDrag); });
            preview.addEventListener('keydown', function (event) {
                if (!crop || !crop.ready || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(event.key) < 0) return;
                event.preventDefault();
                var step = cropBounds().size * (event.shiftKey ? 0.1 : 0.02);
                if (event.key === 'ArrowLeft') crop.x += step;
                if (event.key === 'ArrowRight') crop.x -= step;
                if (event.key === 'ArrowUp') crop.y += step;
                if (event.key === 'ArrowDown') crop.y -= step;
                updateCrop();
            });
            element('memory-crop-apply').addEventListener('click', function () {
                if (!crop || !crop.ready || adminDraft.pairs.indexOf(crop.pair) < 0) return;
                try {
                    var canvas = document.createElement('canvas');
                    canvas.width = canvas.height = Math.max(1, Math.min(512, Math.round(cropBounds().size)));
                    drawCrop(canvas);
                    var source = canvas.toDataURL('image/jpeg', 0.9);
                    if (!source.startsWith('data:image/')) throw new Error('Invalid image');
                    if (element('memory-crop-both').checked) { crop.pair.first = source; crop.pair.second = source; }
                    else crop.pair[crop.side] = source;
                    markAdminDirty(); renderAdmin(); dialog.close();
                } catch (_) { element('memory-crop-status').textContent = 'ครอบตัดภาพไม่ได้ กรุณาลองอีกครั้งหรือเลือกภาพอื่น'; }
            });
            window.addEventListener('pagehide', function () { releaseCrop(); if (dialog.open) dialog.close(); });
        }
        function bindAdmin() {
            element('memory-pair-editor').addEventListener('input', function (event) {
                if (event.target.dataset.memoryLabel !== undefined) { adminDraft.pairs[Number(event.target.dataset.memoryLabel)].label = event.target.value; markAdminDirty(); }
            });
            element('memory-pair-editor').addEventListener('change', function (event) {
                var input = event.target;
                if (!input.dataset.memoryImage) return;
                var parts = input.dataset.memoryImage.split(':'); var pair = adminDraft.pairs[Number(parts[0])];
                var file = input.files && input.files[0]; input.value = '';
                if (!file) return;
                if (file.type && !file.type.startsWith('image/')) { window.alert('กรุณาเลือกไฟล์รูปภาพ'); return; }
                openCrop(file, pair, Number(parts[1]) ? 'second' : 'first', input.dataset.memoryImage);
            });
            element('memory-pair-editor').addEventListener('click', function (event) {
                var remove = event.target.closest('[data-memory-remove]'); if (!remove) return;
                adminDraft.pairs.splice(Number(remove.dataset.memoryRemove), 1); renderAdmin(); markAdminDirty();
            });
            element('memory-add-pair').addEventListener('click', function () {
                if (adminDraft.pairs.length >= MAX_PAIRS) return;
                adminDraft.pairs.push(createPair(adminDraft.pairs.length)); renderAdmin(); markAdminDirty();
            });
            element('memory-time-limit').addEventListener('input', function (event) { adminDraft.timeLimit = Number(event.target.value); markAdminDirty(); });
            element('memory-slot-count').addEventListener('change', function (event) {
                var slots = Math.min(MAX_PAIRS * 2, Math.max(4, Number(event.target.value) || 4));
                slots -= slots % 2; event.target.value = slots; resizePairs(slots);
            });
            element('memory-save').addEventListener('click', async function () {
                adminDraft.timeLimit = Number(element('memory-time-limit').value);
                if (!validate(adminDraft) || adminDraft.pairs.some(function (pair) { return pair.label.trim().length === 0; })) { window.alert('กรุณาตรวจสอบเวลา ชื่อคู่ และรูปภาพให้ครบถ้วน'); return; }
                try {
                    await save(adminDraft); config = load(); adminDraft = JSON.parse(JSON.stringify(config)); adminDirty = false; element('memory-save-status').textContent = 'บันทึกเกมจับคู่แล้ว'; element('memory-save-status').classList.remove('unsaved'); updateStatus(); renderAdmin();
                } catch (error) { element('memory-save-status').textContent = window.SharedStore ? 'บันทึกไม่ได้: ' + error.message : 'บันทึกไม่ได้ พื้นที่จัดเก็บอาจเต็ม กรุณาลดขนาดรูปแล้วลองใหม่'; element('memory-save-status').classList.add('unsaved'); }
            });
        }
        element('memory-retry-history').addEventListener('click', function () {
            var store = window.SharedStore;
            if (store && store.retryPlays) sendReport(store.retryPlays(), true);
        });
        document.addEventListener('jao:playhistory', function (event) {
            if (event.detail.pending || element('memory-retry-history').hidden) return;
            element('memory-retry-history').hidden = true;
            element('memory-history-status').textContent = 'บันทึกประวัติที่ค้างไว้แล้ว';
        });
        element('memory-board').addEventListener('click', handleCard); element('memory-start').addEventListener('click', startGame); bindAdmin(); bindCrop(); renderAdmin(); updateStatus();
        document.addEventListener('jao:storechange', function (event) {
            if (event.detail.game !== 'memory') return;
            config = load();
            if (element('page-memory').classList.contains('active')) element('memory-total').textContent = config.pairs.length;
            if (element('page-memory-admin').classList.contains('active') && !adminDirty && !crop) { adminDraft = null; renderAdmin(); }
        });
        window.addEventListener('pagehide', cancel);
        return { render: function () { config = load(); element('memory-total').textContent = config.pairs.length; }, renderAdmin: renderAdmin, showAdmin: function () { config = load(); if (!adminDirty) adminDraft = null; element('memory-admin-panel').hidden = false; renderAdmin(); }, start: startGame, cancel: cancel };
    }

    return Object.freeze({ STORAGE_KEY: STORAGE_KEY, MAX_PAIRS: MAX_PAIRS, DEFAULT_TIME: DEFAULT_TIME, createDefault: createDefault, validate: validate, load: load, save: save, shuffle: shuffle, makeCards: makeCards, init: init });
});
