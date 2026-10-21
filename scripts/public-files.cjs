'use strict';

// Files shared by the local web server and the GitHub Pages build.
// Keep private data, backend source, tests, and archives out of this list.
module.exports = Object.freeze([
    'index.html',
    'styles/base.css',
    'styles/motion.css',
    'styles/halloween.css',
    'app/app-config.js',
    'app/bootstrap.js',
    'app/main.js',
    'app/motion.js',
    'app/storage/shared-store.js',
    'app/storage/google-sheets-store.js',
    'games/wheel/wheel-engine.js',
    'games/wheel/wheel-state.js',
    'games/wheel/wheel-effects.js',
    'games/wheel/wheel.css',
    'games/memory/memory-game.js',
    'games/claw/claw-game.js',
    'games/quiz/quiz-game.js'
]);
