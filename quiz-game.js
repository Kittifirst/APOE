(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.QuizGame = api;
}(typeof self !== 'undefined' ? self : this, function (root) {
    'use strict';

    var STORAGE_KEY = 'all-jao-games.quiz.v1';
    var ROUND_SIZE = 5;
    var DEFAULT_QUESTIONS = [
        { id: 'q1', text: 'ถ้ามีวันหยุดแบบไม่ต้องวางแผน ฉันอยากทำอะไรมากที่สุด?', choices: ['นอนดูซีรีส์อยู่บ้าน', 'ออกไปเที่ยวธรรมชาติ', 'หาร้านอร่อย ๆ', 'ชวนเพื่อนมาปาร์ตี้'], correct: 0 },
        { id: 'q2', text: 'เครื่องดื่มที่ฉันเลือกบ่อยที่สุดคืออะไร?', choices: ['กาแฟ', 'ชาไทย', 'น้ำผลไม้', 'น้ำเปล่า'], correct: 1 },
        { id: 'q3', text: 'ถ้าเลือกของขวัญให้ฉันหนึ่งชิ้น ฉันน่าจะชอบอะไร?', choices: ['หนังสือ', 'ต้นไม้', 'บัตรคอนเสิร์ต', 'ของทำมือ'], correct: 3 },
        { id: 'q4', text: 'เวลาเครียด ฉันมักจะทำอะไรเป็นอย่างแรก?', choices: ['ฟังเพลง', 'โทรหาเพื่อน', 'ออกกำลังกาย', 'หาอะไรอร่อย ๆ กิน'], correct: 0 },
        { id: 'q5', text: 'สถานที่ที่ฉันอยากกลับไปเที่ยวซ้ำมากที่สุดคือแบบไหน?', choices: ['ทะเล', 'ภูเขา', 'เมืองเก่า', 'สวนสนุก'], correct: 1 }
    ];

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function freshState() { return { questions: clone(DEFAULT_QUESTIONS), players: [] }; }
    function validQuestion(q) {
        return q && typeof q.id === 'string' && typeof q.text === 'string' && q.text.trim() &&
            Array.isArray(q.choices) && q.choices.length === 4 && q.choices.every(function (c) { return typeof c === 'string' && c.trim(); }) &&
            Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4;
    }
    function validateState(state) {
        return Boolean(state && Array.isArray(state.questions) && state.questions.length >= ROUND_SIZE && state.questions.every(validQuestion) && Array.isArray(state.players));
    }
    function sortPlayers(players) {
        return players.slice().sort(function (a, b) {
            return (Number(b.score) - Number(a.score)) || (Number(a.timeMs) - Number(b.timeMs)) || String(a.completedAt).localeCompare(String(b.completedAt));
        });
    }
    function chooseQuestions(questions, random) {
        var shuffled = questions.slice();
        var rng = random || Math.random;
        for (var i = shuffled.length - 1; i > 0; i -= 1) {
            var j = Math.floor(rng() * (i + 1));
            var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
        }
        return shuffled.slice(0, ROUND_SIZE);
    }
    function calculateScore(questions, answers) {
        return questions.reduce(function (score, q, index) { return score + (answers[index] === q.correct ? 1 : 0); }, 0);
    }
    function newId(prefix) {
        return root && root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }

    function init(options) {
        options = options || {};
        var notify = options.showToast || function () {};
        var $ = function (id) { return document.getElementById(id); };
        var state = load();
        var draft = clone(state.questions);
        var round = null;
        var timer = null;

        function load() {
            try {
                var raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return freshState();
                var parsed = JSON.parse(raw);
                return validateState(parsed) ? parsed : freshState();
            } catch (_) { return freshState(); }
        }
        function save(next) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            state = next;
        }
        function formatTime(ms) {
            var total = Math.max(0, Math.floor(ms / 1000));
            var minutes = Math.floor(total / 60);
            var seconds = total % 60;
            var tenths = Math.floor((ms % 1000) / 100);
            return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0') + '.' + tenths;
        }
        function leaderboardRows(target, limit, withActions) {
            var rows = sortPlayers(state.players).slice(0, limit || state.players.length);
            target.innerHTML = '';
            if (!rows.length) {
                var empty = document.createElement('div'); empty.className = 'quiz-empty'; empty.textContent = 'ยังไม่มีผู้เล่น มาเป็นคนแรกกันเลย'; target.appendChild(empty); return;
            }
            rows.forEach(function (player, index) {
                var row = document.createElement('div'); row.className = 'quiz-rank-row';
                var rank = document.createElement('strong'); rank.className = 'quiz-rank-number'; rank.textContent = index + 1;
                var name = document.createElement('span'); name.className = 'quiz-rank-name'; name.textContent = player.name;
                var score = document.createElement('span'); score.className = 'quiz-rank-score'; score.textContent = player.score + '/5 ข้อ';
                var time = document.createElement('span'); time.className = 'quiz-rank-time'; time.textContent = formatTime(player.timeMs);
                row.append(rank, name, score, time);
                if (withActions) { var del = document.createElement('button'); del.type = 'button'; del.className = 'button button-danger button-small'; del.textContent = 'ลบ'; del.dataset.quizDeletePlayer = player.id; row.appendChild(del); }
                target.appendChild(row);
            });
        }
        function renderIntro() {
            state = load();
            $('quiz-intro').hidden = false; $('quiz-play').hidden = true; $('quiz-result').hidden = true;
            $('quiz-name').value = '';
            leaderboardRows($('quiz-leaderboard'), 5, false);
        }
        function start(event) {
            event.preventDefault();
            var name = $('quiz-name').value.trim().replace(/\s+/g, ' ');
            if (!name) { $('quiz-name-error').hidden = false; $('quiz-name').focus(); return; }
            $('quiz-name-error').hidden = true;
            state = load();
            if (state.questions.length < ROUND_SIZE) { notify('ต้องมีคำถามอย่างน้อย 5 ข้อก่อนเริ่มเล่น'); return; }
            round = { name: name.slice(0, 50), questions: chooseQuestions(state.questions), answers: [], index: 0, startedAt: performance.now() };
            $('quiz-intro').hidden = true; $('quiz-result').hidden = true; $('quiz-play').hidden = false;
            renderQuestion();
            clearInterval(timer); timer = setInterval(updateTimer, 100);
        }
        function updateTimer() { if (round) $('quiz-timer').textContent = formatTime(performance.now() - round.startedAt); }
        function renderQuestion() {
            var question = round.questions[round.index];
            $('quiz-progress-text').textContent = 'ข้อ ' + (round.index + 1) + ' / ' + ROUND_SIZE;
            $('quiz-progress-bar').style.width = ((round.index + 1) / ROUND_SIZE * 100) + '%';
            $('quiz-question').textContent = question.text;
            $('quiz-choices').innerHTML = '';
            question.choices.forEach(function (choice, index) {
                var label = document.createElement('label'); label.className = 'quiz-choice';
                var input = document.createElement('input'); input.type = 'radio'; input.name = 'quiz-answer'; input.value = index;
                var marker = document.createElement('span'); marker.className = 'quiz-choice-marker'; marker.textContent = String.fromCharCode(65 + index);
                var text = document.createElement('span'); text.textContent = choice;
                label.append(input, marker, text); $('quiz-choices').appendChild(label);
            });
            $('quiz-confirm').disabled = true;
        }
        function confirmAnswer() {
            var selected = document.querySelector('input[name="quiz-answer"]:checked');
            if (!round || !selected) return;
            round.answers.push(Number(selected.value));
            if (round.index < ROUND_SIZE - 1) { round.index += 1; renderQuestion(); return; }
            finish();
        }
        function finish() {
            var elapsed = Math.max(1, Math.round(performance.now() - round.startedAt));
            clearInterval(timer); timer = null;
            var player = { id: newId('player'), name: round.name, score: calculateScore(round.questions, round.answers), timeMs: elapsed, completedAt: new Date().toISOString() };
            state = load(); state.players.push(player); save(state);
            $('quiz-play').hidden = true; $('quiz-result').hidden = false;
            $('quiz-result-score').textContent = player.score + ' / 5';
            $('quiz-result-time').textContent = formatTime(elapsed);
            var placement = sortPlayers(state.players).findIndex(function (item) { return item.id === player.id; }) + 1;
            $('quiz-result-message').textContent = player.name + ' ได้อันดับที่ ' + placement + ' จากผู้เล่นทั้งหมด ' + state.players.length + ' คน';
            round = null;
        }
        function cancel() { clearInterval(timer); timer = null; round = null; }
        function renderAdmin() {
            state = load(); draft = clone(state.questions);
            renderQuestionEditor(); leaderboardRows($('quiz-admin-players'), state.players.length, true);
            $('quiz-admin-count').textContent = 'ผู้เล่นทั้งหมด ' + state.players.length + ' คน';
        }
        function renderQuestionEditor() {
            var host = $('quiz-question-editor'); host.innerHTML = '';
            draft.forEach(function (question, index) {
                var card = document.createElement('fieldset'); card.className = 'quiz-editor-card'; card.dataset.quizQuestion = index;
                var legend = document.createElement('legend'); legend.textContent = 'คำถามที่ ' + (index + 1);
                var qInput = document.createElement('input'); qInput.className = 'editor-input quiz-question-input'; qInput.value = question.text; qInput.dataset.quizField = 'text'; qInput.setAttribute('aria-label', 'คำถามที่ ' + (index + 1)); card.append(legend, qInput);
                var choices = document.createElement('div'); choices.className = 'quiz-choice-editor';
                question.choices.forEach(function (choice, choiceIndex) {
                    var label = document.createElement('label');
                    var radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'correct-' + index; radio.checked = question.correct === choiceIndex; radio.dataset.quizCorrect = choiceIndex;
                    var input = document.createElement('input'); input.className = 'editor-input'; input.value = choice; input.dataset.quizChoice = choiceIndex; input.setAttribute('aria-label', 'ตัวเลือก ' + (choiceIndex + 1));
                    label.append(radio, input); choices.appendChild(label);
                });
                var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button-danger button-small'; remove.textContent = 'ลบคำถาม'; remove.dataset.quizRemoveQuestion = index; remove.disabled = draft.length <= ROUND_SIZE;
                card.append(choices, remove); host.appendChild(card);
            });
            $('quiz-question-summary').textContent = draft.length + ' คำถาม · สุ่มเล่นครั้งละ 5 ข้อ';
        }
        function markDirty() { $('quiz-save-status').textContent = 'มีการแก้ไขที่ยังไม่ได้บันทึก'; $('quiz-save-status').classList.add('unsaved'); }
        function saveQuestions() {
            if (draft.length < ROUND_SIZE || !draft.every(validQuestion)) { notify('กรุณากรอกคำถาม ตัวเลือก 4 ข้อ และเลือกคำตอบที่ถูกให้ครบ'); return; }
            state = load(); state.questions = clone(draft); save(state);
            $('quiz-save-status').textContent = 'บันทึกคำถามแล้ว'; $('quiz-save-status').classList.remove('unsaved'); notify('บันทึกคำถามเกม 04 แล้ว'); renderQuestionEditor();
        }
        function addQuestion() {
            draft.push({ id: newId('question'), text: 'คำถามใหม่', choices: ['ตัวเลือก A', 'ตัวเลือก B', 'ตัวเลือก C', 'ตัวเลือก D'], correct: 0 }); renderQuestionEditor(); markDirty();
        }
        function resetPlayers() {
            if (!state.players.length) return;
            if (!window.confirm('ลบอันดับและประวัติผู้เล่นทั้งหมดของเกม 04 ใช่หรือไม่?')) return;
            state = load(); state.players = []; save(state); renderAdmin(); notify('ลบอันดับและประวัติผู้เล่นเกม 04 แล้ว');
        }
        function prepareNavigation() {
            var upcoming = document.querySelector('#page-guest .game-card.upcoming');
            if (upcoming) {
                upcoming.classList.remove('upcoming'); upcoming.classList.add('featured-game', 'quiz-game-card');
                upcoming.dataset.page = 'page-quiz'; upcoming.setAttribute('role', 'button'); upcoming.tabIndex = 0;
                upcoming.innerHTML = '<div class="game-art quiz-art"><div class="mini-quiz"><span>?</span><i>A</i><i>B</i><i>C</i><i>D</i></div><span class="available-tag"><span></span> พร้อมเล่น</span></div><div class="game-card-content"><span class="eyebrow">GAME 04</span><h2>รู้ใจแค่ไหน?</h2><p>ตอบคำถาม 5 ข้อ ทำคะแนนให้สูงและเร็วที่สุด</p><span class="card-link">เริ่มเล่น <svg class="icon"><use href="#i-arrow"/></svg></span></div>';
                upcoming.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); upcoming.click(); } });
            }
            document.querySelectorAll('.game-tabs button[disabled]').forEach(function (tab) {
                tab.disabled = false; tab.dataset.page = 'page-quiz-admin'; tab.textContent = '04 · รู้ใจแค่ไหน';
            });
        }
        function bind() {
            $('quiz-name-form').addEventListener('submit', start);
            $('quiz-choices').addEventListener('change', function () { $('quiz-confirm').disabled = false; });
            $('quiz-confirm').addEventListener('click', confirmAnswer);
            $('quiz-play-again').addEventListener('click', renderIntro);
            $('quiz-add-question').addEventListener('click', addQuestion);
            $('quiz-save-questions').addEventListener('click', saveQuestions);
            $('quiz-reset-players').addEventListener('click', resetPlayers);
            $('quiz-question-editor').addEventListener('input', function (event) {
                var card = event.target.closest('[data-quiz-question]'); if (!card) return; var q = draft[Number(card.dataset.quizQuestion)];
                if (event.target.dataset.quizField === 'text') q.text = event.target.value;
                if (event.target.dataset.quizChoice !== undefined) q.choices[Number(event.target.dataset.quizChoice)] = event.target.value;
                markDirty();
            });
            $('quiz-question-editor').addEventListener('change', function (event) {
                var card = event.target.closest('[data-quiz-question]'); if (!card || event.target.dataset.quizCorrect === undefined) return;
                draft[Number(card.dataset.quizQuestion)].correct = Number(event.target.dataset.quizCorrect); markDirty();
            });
            $('quiz-question-editor').addEventListener('click', function (event) {
                var button = event.target.closest('[data-quiz-remove-question]'); if (!button || draft.length <= ROUND_SIZE) return;
                draft.splice(Number(button.dataset.quizRemoveQuestion), 1); renderQuestionEditor(); markDirty();
            });
            $('quiz-admin-players').addEventListener('click', function (event) {
                var button = event.target.closest('[data-quiz-delete-player]'); if (!button) return;
                state = load(); state.players = state.players.filter(function (p) { return p.id !== button.dataset.quizDeletePlayer; }); save(state); renderAdmin();
            });
            window.addEventListener('storage', function (event) { if (event.key === STORAGE_KEY) state = load(); });
        }
        prepareNavigation();
        bind();
        return { render: renderIntro, renderAdmin: renderAdmin, cancel: cancel };
    }

    return { init: init, sortPlayers: sortPlayers, chooseQuestions: chooseQuestions, calculateScore: calculateScore, validateState: validateState, DEFAULT_QUESTIONS: DEFAULT_QUESTIONS, ROUND_SIZE: ROUND_SIZE };
}));
