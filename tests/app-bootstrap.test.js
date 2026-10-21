'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const http = require('node:http');
const { JSDOM, VirtualConsole } = require('jsdom');

async function boot(t, cloud) {
    const requests = [], errors = [];
    const publicFiles = require('../scripts/public-files.cjs');
    const server = http.createServer((request, response) => {
            const parsed = new URL(request.url, 'http://localhost');
            if (!parsed.pathname.endsWith('.js')) { response.writeHead(404).end(); return; }
            requests.push(parsed.pathname);
            const name = parsed.pathname.replace(/^\/my-cafe\//, '');
            if (!publicFiles.includes(name)) { response.writeHead(404).end(); return; }
            const source = name === 'app/app-config.js' && cloud
                ? "window.JAO_CONFIG = { googleSheetsUrl: 'https://script.google.com/macros/s/test/exec' };"
                : fs.readFileSync(path.join(ROOT, name));
            response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
            response.end(source);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error.message));
    const dom = new JSDOM(fs.readFileSync('index.html', 'utf8').replace(/<link\b[^>]*>/g, ''), {
        url: 'http://127.0.0.1:' + server.address().port + '/my-cafe/', resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
        beforeParse(w) {
            w.scrollTo = () => {};
            w.HTMLElement.prototype.scrollIntoView = () => {};
            w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, key) => key === 'measureText' ? value => ({ width: value.length * 8 }) : () => {}, set: () => true });
            w.matchMedia = () => ({ matches: true, addEventListener() {} });
            w.ResizeObserver = class { observe() {} disconnect() {} };
            w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
            w.HTMLDialogElement.prototype.close = function () { this.open = false; };
            w.fetch = async () => { throw new Error('Offline test'); };
        }
    });
    t.after(() => dom.window.close());
    await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
    return { w: dom.window, requests, errors };
}

test('actual deferred bootstrap loads once under a GitHub project path and demo navigation works', async t => {
    const { w, requests, errors } = await boot(t, false);
    assert.equal(w.SharedStore.mode, 'demo');
    assert.match(w.document.getElementById('connection-status').textContent, /โหมดทดลอง/);
    assert.equal(requests.filter(url => url === '/my-cafe/app/main.js').length, 1);
    w.document.querySelector('.continue-guest-button').click();
    assert.equal(w.document.querySelector('.page.active').id, 'page-guest');
    assert.equal(w.document.querySelectorAll('#page-guest .featured-game').length, 4);
    assert.deepEqual(errors, []);
});

test('failed cloud bootstrap still opens the interface and blocks unsaved stock games', async t => {
    const { w, errors } = await boot(t, true);
    assert.equal(w.SharedStore.mode, 'sheets');
    assert.equal(w.document.getElementById('connection-status').dataset.state, 'offline');
    w.document.querySelector('.continue-guest-button').click();
    w.document.querySelector('#page-guest [data-page="page-wheel"]').click();
    assert.equal(w.document.getElementById('spin-button').disabled, true);
    assert.deepEqual(errors, []);
});
