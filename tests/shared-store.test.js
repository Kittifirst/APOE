'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(ROOT, 'app/storage/shared-store.js'), 'utf8');

function browser(server) {
    const fallback = new Map();
    class XMLHttpRequest {
        open(method, url) { this.method = method; this.url = url; }
        setRequestHeader() {}
        send(body) {
            const game = this.url.split('/').pop();
            if (this.method === 'GET' && server.failGet) { this.status = 503; this.responseText = '{}'; return; }
            if (this.method === 'GET') {
                this.status = 200;
                this.responseText = JSON.stringify(server[game]);
                return;
            }
            const update = JSON.parse(body);
            if (update.version !== server[game].version) {
                this.status = 409;
                this.responseText = JSON.stringify({ error: 'ข้อมูลเปลี่ยนจากเครื่องอื่น กรุณาลองอีกครั้ง' });
                return;
            }
            server[game] = { value: update.value, version: update.version + 1 };
            this.status = 200;
            this.responseText = JSON.stringify({ version: server[game].version });
        }
    }
    const context = {
        window: { addEventListener() {} },
        localStorage: { getItem: key => fallback.get(key) ?? null, setItem: (key, value) => fallback.set(key, value) },
        XMLHttpRequest,
        setInterval() {},
        document: { dispatchEvent() {} },
        CustomEvent: class {},
        fetch: async () => ({ ok: true, json: async () => ({}) })
    };
    vm.runInNewContext(source, context);
    return context.window.SharedStore;
}

test('two browsers share central data and reject a stale stock write', () => {
    const central = { wheel: { value: { issued: 0 }, version: 0 } };
    const a = browser(central);
    const b = browser(central);
    const key = 'all-jao-games.wheel.v2';
    assert.equal(JSON.parse(a.getItem(key)).issued, 0);
    assert.equal(JSON.parse(b.getItem(key)).issued, 0);
    a.setItem(key, JSON.stringify({ issued: 1 }));
    assert.throws(() => b.setItem(key, JSON.stringify({ issued: 1 })), /ข้อมูลเปลี่ยนจากเครื่องอื่น/);
    assert.equal(JSON.parse(b.getItem(key)).issued, 1);
    b.setItem(key, JSON.stringify({ issued: 2 }));
    assert.equal(JSON.parse(a.getItem(key)).issued, 2);
});

test('a failed central read prevents writing an old fallback state', () => {
    const central = { wheel: { value: { issued: 3 }, version: 4 } };
    const client = browser(central);
    const key = 'all-jao-games.wheel.v2';
    client.getItem(key);
    central.failGet = true;
    assert.throws(() => client.getItem(key));
    central.failGet = false;
    assert.throws(() => client.setItem(key, JSON.stringify({ issued: 0 })), /ยังอ่านข้อมูลกลางไม่ได้/);
    assert.equal(central.wheel.value.issued, 3);
});
