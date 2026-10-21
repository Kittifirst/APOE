(() => {
    'use strict';
    const status = document.getElementById('connection-status');
    function update(detail) {
        status.dataset.state = detail.state;
        status.textContent = detail.message;
    }
    document.addEventListener('jao:connection', event => update(event.detail));
    const store = window.SharedStore;
    document.querySelectorAll('[data-storage-copy]').forEach(element => {
        element.textContent = store.mode === 'sheets' ? 'บันทึกข้อมูลร่วมกันของร้าน' : 'โหมดทดลอง · เก็บข้อมูลในเครื่องนี้';
    });
    status.addEventListener('click', async () => {
        if (store.mode !== 'sheets') return;
        status.disabled = true;
        update({ state: 'loading', message: 'กำลังเชื่อมต่อข้อมูลร้าน…' });
        try { await store.refreshAll(); } catch (_) {}
        finally { status.disabled = false; }
    });
    update({ state: store.mode === 'sheets' ? 'loading' : 'demo', message: store.mode === 'sheets'
        ? 'กำลังเชื่อมต่อข้อมูลร้าน…' : store.mode === 'local' ? 'ข้อมูลจากเซิร์ฟเวอร์ในร้าน' : 'โหมดทดลอง · ข้อมูลเก็บในเครื่องนี้' });
    Promise.resolve(store.ready).catch(() => update({ state: 'offline', message: 'เชื่อมต่อข้อมูลร้านไม่ได้ · กดเพื่อลองใหม่' })).then(() => {
        const script = document.createElement('script');
        script.src = 'app/main.js';
        document.body.appendChild(script);
    });
})();
