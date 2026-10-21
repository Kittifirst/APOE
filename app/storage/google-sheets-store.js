(() => {
    'use strict';
    const config = window.JAO_CONFIG;
    if (!config) return; // Keep the original LAN server available for older installations.
    const games = { 'all-jao-games.wheel.v2': 'wheel', 'all-jao-games.claw.v1': 'claw',
        'all-jao-games.memory.v1': 'memory', 'all-jao-games.quiz.v1': 'quiz' };
    const endpoint = (config.googleSheetsUrl || '').trim();
    if (!endpoint) {
        window.SharedStore = Object.freeze({ mode: 'demo', ready: Promise.resolve(),
            getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
        return;
    }
    const cache = new Map();
    const pending = new Set();
    let token = '';
    let polling = false;
    try { token = sessionStorage.getItem('jao.sheets.session') || ''; } catch (_) {}
    function connection(state, message) {
        document.dispatchEvent(new CustomEvent('jao:connection', { detail: { state, message } }));
    }
    function changed(game) { document.dispatchEvent(new CustomEvent('jao:storechange', { detail: { game } })); }
    async function request(action, payload = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);
        try {
            if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint)) {
                throw new Error('กรุณาใส่ URL ของ Google Apps Script ที่ลงท้ายด้วย /exec');
            }
            // A simple POST follows Google's ContentService redirect without an OPTIONS preflight.
            const response = await fetch(endpoint, { method: 'POST', redirect: 'follow', credentials: 'omit',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action, ...payload, token }), signal: controller.signal });
            const result = await response.json();
            if (!response.ok || !result.ok) {
                const error = new Error(result.error || 'เชื่อมต่อข้อมูลร้านไม่ได้');
                error.code = result.code;
                throw error;
            }
            connection('online', 'เชื่อมต่อข้อมูลร้านแล้ว');
            return result;
        } catch (error) {
            if (!error.code) {
                connection('offline', 'เชื่อมต่อข้อมูลร้านไม่ได้ · กดเพื่อลองใหม่');
                throw new Error('เชื่อมต่อ Google Sheets ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตและลองใหม่');
            }
            throw error;
        } finally { clearTimeout(timeout); }
    }
    async function refreshAll() {
        const result = await request('snapshot');
        Object.entries(result.states).forEach(([game, item]) => { if (!pending.has(game)) { cache.set(game, item); changed(game); } });
    }
    async function mutate(game, action, payload) {
        if (pending.has(game)) throw new Error('กำลังบันทึกข้อมูล กรุณารอสักครู่');
        pending.add(game);
        try {
            let result;
            try { result = await request(action, { game, ...payload }); }
            catch (error) {
                // Reuse the same ID if a draw response is lost. The server returns the original award.
                if (action !== 'draw' || error.code) throw error;
                result = await request(action, { game, ...payload });
            }
            cache.set(game, { value: result.value, version: result.version });
            return result;
        } catch (error) {
            // Refresh after conflicts and uncertain network outcomes; never silently save to this browser.
            try { const latest = await request('get', { game }); cache.set(game, latest); } catch (_) { cache.delete(game); }
            throw error;
        } finally { pending.delete(game); changed(game); }
    }
    const api = {
        mode: 'sheets',
        getItem(key) {
            const game = games[key];
            if (!game) return localStorage.getItem(key);
            if (!cache.has(game)) throw new Error('ยังอ่านข้อมูลร้านไม่ได้ กรุณากดสถานะการเชื่อมต่อเพื่อลองใหม่');
            return JSON.stringify(cache.get(game).value);
        },
        setItem(key, value) {
            const game = games[key];
            if (!game) return localStorage.setItem(key, value);
            if (!cache.has(game)) throw new Error('ยังอ่านข้อมูลร้านไม่ได้ กรุณาเชื่อมต่อใหม่');
            return mutate(game, 'put', { value: JSON.parse(value), version: cache.get(game).version });
        },
        async login(username, password) {
            const result = await request('login', { username, password });
            token = result.token;
            try { sessionStorage.setItem('jao.sheets.session', token); } catch (_) {}
        },
        logout() { token = ''; try { sessionStorage.removeItem('jao.sheets.session'); } catch (_) {} },
        hasSession: () => Boolean(token),
        draw: game => mutate(game, 'draw', { requestId: window.crypto.randomUUID() }),
        refreshAll
    };
    api.ready = refreshAll();
    // The first request can fail before the deferred bootstrap script attaches its handler.
    api.ready.catch(() => {});
    window.SharedStore = Object.freeze(api);
    async function poll() {
        if (polling || document.hidden) return;
        polling = true;
        try {
            const latest = await request('versions');
            for (const game of Object.values(games)) {
                if (pending.has(game) || cache.get(game)?.version === latest.versions[game]) continue;
                const result = await request('get', { game });
                if (!pending.has(game)) { cache.set(game, result); changed(game); }
            }
        } catch (_) { /* The connection indicator offers an explicit retry. */ }
        finally { polling = false; }
    }
    setInterval(poll, Math.max(15000, Number(config.pollIntervalMs) || 30000));
    window.addEventListener('focus', poll);
})();
