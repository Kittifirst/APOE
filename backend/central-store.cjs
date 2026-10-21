'use strict';

const fs = require('node:fs');
const path = require('node:path');
const wheelEngine = require('../games/wheel/wheel-engine.js');
const ledger = require('../games/wheel/wheel-state.js');
const memory = require('../games/memory/memory-game.js');
const claw = require('../games/claw/claw-game.js');
const quiz = require('../games/quiz/quiz-game.js');

const validators = {
    wheel: ledger.validate,
    claw: ledger.validate,
    memory: memory.validate,
    quiz: quiz.validateState
};

function initialData() {
    return {
        schema: 1,
        versions: { wheel: 0, claw: 0, memory: 0, quiz: 0 },
        states: {
            wheel: ledger.create(wheelEngine.DEFAULT_SETTINGS),
            claw: ledger.create(claw.DEFAULT_SETTINGS),
            memory: memory.createDefault(),
            quiz: { questions: quiz.DEFAULT_QUESTIONS, players: [] }
        }
    };
}

function validDatabase(data) {
    return data && data.schema === 1 && data.versions && data.states &&
        Object.keys(validators).every(key => Number.isSafeInteger(data.versions[key]) && data.versions[key] >= 0 && validators[key](data.states[key]));
}

class CentralStore {
    constructor(directory = path.join(__dirname, '..', 'data')) {
        this.directory = directory;
        this.file = path.join(directory, 'all-jao-games.json');
        fs.mkdirSync(directory, { recursive: true });
        if (fs.existsSync(this.file)) {
            this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (!validDatabase(this.data)) throw new Error('Central game data is invalid: ' + this.file);
        } else {
            this.data = initialData();
            this.persist(this.data, false);
        }
    }

    get(key) {
        if (!validators[key]) return null;
        return { value: structuredClone(this.data.states[key]), version: this.data.versions[key] };
    }

    versions() { return { ...this.data.versions }; }

    put(key, value, expectedVersion) {
        if (!validators[key]) return { status: 404, error: 'Unknown game' };
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return { status: 400, error: 'Invalid version' };
        if (expectedVersion !== this.data.versions[key]) return { status: 409, error: 'ข้อมูลเปลี่ยนจากเครื่องอื่น กรุณาลองอีกครั้ง' };
        if (!validators[key](value)) return { status: 400, error: 'Invalid game data' };
        const next = {
            schema: 1,
            versions: { ...this.data.versions, [key]: expectedVersion + 1 },
            states: { ...this.data.states, [key]: value }
        };
        this.persist(next, true);
        this.data = next;
        return { status: 200, version: next.versions[key] };
    }

    persist(next, backup) {
        const temporary = this.file + '.' + process.pid + '.' + Date.now() + '.tmp';
        try {
            fs.writeFileSync(temporary, JSON.stringify(next), { flag: 'wx' });
            if (backup && fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
            fs.renameSync(temporary, this.file);
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    }
}

module.exports = { CentralStore, validDatabase };
