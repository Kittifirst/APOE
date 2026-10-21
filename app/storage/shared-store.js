(() => {
    'use strict';
    if (window.JAO_CONFIG) return;

    const games = {
        'all-jao-games.wheel.v2': 'wheel',
        'all-jao-games.claw.v1': 'claw',
        'all-jao-games.memory.v1': 'memory',
        'all-jao-games.quiz.v1': 'quiz'
    };
    const versions = new Map();
    const observedVersions = new Map();
    const healthy = new Map();

    function request(method, game, payload) {
        const xhr = new XMLHttpRequest();
        xhr.open(method, '/api/state/' + game, false);
        if (payload !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
        try { xhr.send(payload === undefined ? null : JSON.stringify(payload)); }
        catch (_) { throw new Error('เชื่อมต่อเซิร์ฟเวอร์กลางไม่ได้ กรุณาตรวจสอบเครือข่าย'); }
        let response;
        try { response = JSON.parse(xhr.responseText); } catch (_) { response = {}; }
        if (xhr.status < 200 || xhr.status >= 300) {
            throw new Error(response.error || 'เซิร์ฟเวอร์กลางไม่พร้อม กรุณาลองอีกครั้ง');
        }
        return response;
    }

    window.SharedStore = Object.freeze({
        mode: 'local',
        getItem(key) {
            const game = games[key];
            if (!game) return localStorage.getItem(key);
            try {
                const result = request('GET', game);
                versions.set(game, result.version);
                observedVersions.set(game, result.version);
                healthy.set(game, true);
                return JSON.stringify(result.value);
            } catch (error) { healthy.set(game, false); throw error; }
        },
        setItem(key, value) {
            const game = games[key];
            if (!game) { localStorage.setItem(key, value); return; }
            if (!healthy.get(game) || !versions.has(game)) throw new Error('ยังอ่านข้อมูลกลางไม่ได้ กรุณาเปิดหน้าเกมใหม่แล้วลองอีกครั้ง');
            try {
                const result = request('PUT', game, { value: JSON.parse(value), version: versions.get(game) });
                versions.set(game, result.version);
                observedVersions.set(game, result.version);
            } catch (error) { healthy.set(game, false); throw error; }
        }
    });

    async function checkForChanges() {
        try {
            const response = await fetch('/api/versions', { cache: 'no-store' });
            if (!response.ok) return;
            const latest = await response.json();
            for (const game of Object.values(games)) {
                if (observedVersions.has(game) && observedVersions.get(game) !== latest[game]) {
                    observedVersions.set(game, latest[game]);
                    document.dispatchEvent(new CustomEvent('jao:storechange', { detail: { game } }));
                }
            }
        } catch (_) { /* A later poll will retry if the server is temporarily unavailable. */ }
    }
    setInterval(checkForChanges, 4000);
    window.addEventListener('focus', checkForChanges);
})();
