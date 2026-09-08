(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MemoryGame = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var STORAGE_KEY = 'all-jao-games.memory.v1';
    var MAX_PAIRS = 30;
    var DEFAULT_TIME = 90;
    var colors = ['#d96c4b', '#e2ae58', '#708466', '#c36d83', '#6c8e9f', '#aa7b55', '#8b75a8', '#cf8e55'];

    function svgData(label, color, index) {
        var safeLabel = String(label).replace(/[<&>"']/g, '');
        var shape = index % 3 === 0 ? '<circle cx="160" cy="120" r="62" fill="#fff8"/><circle cx="125" cy="175" r="22" fill="#fff8"/>'
            : index % 3 === 1 ? '<path d="M65 205 160 55l95 150z" fill="#fff8"/><circle cx="160" cy="145" r="24" fill="' + color + '"/>'
                : '<rect x="78" y="62" width="164" height="132" rx="30" fill="#fff8"/><circle cx="160" cy="128" r="30" fill="' + color + '"/>';
        return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><rect width="320" height="240" rx="28" fill="' + color + '"/>' + shape + '<text x="160" y="222" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="700" fill="#35231a">' + safeLabel + '</text></svg>');
    }

    function defaultPairs() {
        return ['ดวงดาว', 'ดอกไม้', 'ทะเล', 'พระอาทิตย์', 'ใบไม้', 'สายรุ้ง', 'พระจันทร์', 'ภูเขา'].map(function (label, index) {
            var color = colors[index % colors.length];
            return { id: 'pair-' + (index + 1), label: label, first: svgData(label, color, index), second: svgData(label, color, index + 1) };
        });
    }

    function validPair(pair) {
        return pair && typeof pair.id === 'string' && pair.id && typeof pair.label === 'string' && pair.label.trim() &&
            typeof pair.first === 'string' && pair.first && typeof pair.second === 'string' && pair.second;
    }

    function validate(config) {
        return !!config && Number.isInteger(config.timeLimit) && config.timeLimit >= 10 && config.timeLimit <= 600 &&
            Array.isArray(config.pairs) && config.pairs.length >= 2 && config.pairs.length <= MAX_PAIRS &&
            config.pairs.every(validPair);
    }

    function createDefault() { return { version: 1, timeLimit: DEFAULT_TIME, pairs: defaultPairs() }; }

    function load() {
        try {
            var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            return validate(parsed) ? parsed : createDefault();
        } catch (_) { return createDefault(); }
    }

    function save(config) {
        if (!validate(config)) throw new Error('ข้อมูลเกมจับคู่ไม่ถูกต้อง');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
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
        var locked = true;
        var adminDraft = null;

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
        function endGame(won) {
            stopTimer(); locked = true;
            setStatus(won ? 'เก่งมาก! จับคู่ครบทุกคู่แล้ว' : 'หมดเวลาแล้ว ลองเริ่มเกมใหม่อีกครั้ง');
            element('memory-start').textContent = won ? 'เล่นอีกครั้ง' : 'เริ่มใหม่';
        }
        function renderBoard() {
            var board = element('memory-board');
            board.replaceChildren();
            cards.forEach(function (card) {
                var button = document.createElement('button');
                button.type = 'button'; button.className = 'memory-card'; button.dataset.key = card.key;
                button.setAttribute('aria-label', 'การ์ดปิดอยู่');
                var inner = document.createElement('span'); inner.className = 'memory-card-inner';
                var back = document.createElement('span'); back.className = 'memory-card-back'; back.textContent = '?';
                var front = document.createElement('span'); front.className = 'memory-card-front';
                var image = document.createElement('img'); image.src = card.image; image.alt = card.label;
                front.append(image); inner.append(back, front); button.append(inner);
                if (matched.has(card.pairId) || opened.some(function (item) { return item.key === card.key; })) button.classList.add('is-open');
                if (matched.has(card.pairId)) button.classList.add('is-matched');
                board.append(button);
            });
        }
        function startGame() {
            stopTimer(); cards = makeCards(config); opened = []; matched = new Set(); secondsLeft = config.timeLimit; locked = false;
            renderBoard(); updateStatus(); setStatus('เปิดการ์ดสองใบเพื่อจับคู่'); element('memory-start').textContent = 'เริ่มใหม่';
            timer = window.setInterval(function () { secondsLeft -= 1; updateStatus(); if (secondsLeft <= 0) endGame(false); }, 1000);
        }
        function handleCard(event) {
            var button = event.target.closest('.memory-card');
            if (!button || locked || opened.length >= 2) return;
            var card = cards.find(function (item) { return item.key === button.dataset.key; });
            if (!card || matched.has(card.pairId) || opened.some(function (item) { return item.key === card.key; })) return;
            opened.push(card); renderBoard();
            if (opened.length !== 2) return;
            locked = true;
            if (opened[0].pairId === opened[1].pairId) {
                matched.add(card.pairId); opened = []; locked = false; renderBoard(); updateStatus();
                if (matched.size === config.pairs.length) endGame(true);
            } else {
                window.setTimeout(function () { opened = []; locked = false; renderBoard(); }, 700);
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
                    wrapper.append(img, input); previews.append(wrapper);
                });
                var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button-danger button-small'; remove.textContent = 'ลบคู่นี้'; remove.dataset.memoryRemove = index; remove.disabled = adminDraft.pairs.length <= 2;
                item.append(heading, label, previews, remove); editor.append(item);
            });
        }
        function markAdminDirty() { element('memory-save-status').textContent = 'มีการแก้ไขที่ยังไม่ได้บันทึก'; element('memory-save-status').classList.add('unsaved'); }
        function bindAdmin() {
            element('memory-pair-editor').addEventListener('input', function (event) {
                if (event.target.dataset.memoryLabel !== undefined) { adminDraft.pairs[Number(event.target.dataset.memoryLabel)].label = event.target.value; markAdminDirty(); }
            });
            element('memory-pair-editor').addEventListener('change', function (event) {
                var input = event.target;
                if (!input.dataset.memoryImage) return;
                var parts = input.dataset.memoryImage.split(':'); var pair = adminDraft.pairs[Number(parts[0])];
                var file = input.files && input.files[0]; if (!file || !file.type.startsWith('image/')) return;
                var reader = new FileReader(); reader.onload = function () { pair[Number(parts[1]) ? 'second' : 'first'] = reader.result; renderAdmin(); markAdminDirty(); }; reader.readAsDataURL(file);
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
            element('memory-save').addEventListener('click', function () {
                adminDraft.timeLimit = Number(element('memory-time-limit').value);
                if (!validate(adminDraft) || adminDraft.pairs.some(function (pair) { return pair.label.trim().length === 0; })) { window.alert('กรุณาตรวจสอบเวลา ชื่อคู่ และรูปภาพให้ครบถ้วน'); return; }
                save(adminDraft); config = load(); adminDraft = JSON.parse(JSON.stringify(config)); element('memory-save-status').textContent = 'บันทึกเกมจับคู่แล้ว'; element('memory-save-status').classList.remove('unsaved'); updateStatus(); renderAdmin();
            });
        }
        element('memory-board').addEventListener('click', handleCard); element('memory-start').addEventListener('click', startGame); bindAdmin(); renderAdmin(); updateStatus();
        return { render: function () { config = load(); element('memory-total').textContent = config.pairs.length; }, renderAdmin: renderAdmin, showAdmin: function () { element('memory-admin-panel').hidden = false; renderAdmin(); }, start: startGame };
    }

    return Object.freeze({ STORAGE_KEY: STORAGE_KEY, MAX_PAIRS: MAX_PAIRS, DEFAULT_TIME: DEFAULT_TIME, createDefault: createDefault, validate: validate, load: load, save: save, shuffle: shuffle, makeCards: makeCards, init: init });
});
