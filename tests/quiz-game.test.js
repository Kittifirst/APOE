'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const quiz = require('../games/quiz/quiz-game.js');

test('sortPlayers ranks score first and lower time second', () => {
    const ranked = quiz.sortPlayers([
        { name: 'B', score: 4, timeMs: 9000, completedAt: '2026-01-01' },
        { name: 'A', score: 5, timeMs: 15000, completedAt: '2026-01-02' },
        { name: 'C', score: 4, timeMs: 7000, completedAt: '2026-01-03' }
    ]);
    assert.deepEqual(ranked.map(player => player.name), ['A', 'C', 'B']);
});

test('calculateScore checks all five answers', () => {
    const questions = quiz.DEFAULT_QUESTIONS;
    const answers = questions.map(q => q.correct);
    answers[2] = (answers[2] + 1) % 4;
    assert.equal(quiz.calculateScore(questions, answers), 4);
});

test('chooseQuestions returns exactly five unique questions', () => {
    const pool = quiz.DEFAULT_QUESTIONS.concat([{ id: 'q6', text: 'Extra?', choices: ['A', 'B', 'C', 'D'], correct: 0 }]);
    const chosen = quiz.chooseQuestions(pool, () => 0.25);
    assert.equal(chosen.length, 5);
    assert.equal(new Set(chosen.map(q => q.id)).size, 5);
});

test('validateState requires at least five complete questions', () => {
    assert.equal(quiz.validateState({ questions: quiz.DEFAULT_QUESTIONS, players: [] }), true);
    assert.equal(quiz.validateState({ questions: quiz.DEFAULT_QUESTIONS.slice(0, 4), players: [] }), false);
});
