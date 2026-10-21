'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../backend/server.cjs');
const { CentralStore } = require('../backend/central-store.cjs');

test('web server serves the app and keeps source and preview files private', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'all-jao-test-'));
    t.after(() => { if (path.dirname(directory) === os.tmpdir()) fs.rmSync(directory, { recursive: true, force: true }); });
    const server = createServer(new CentralStore(directory));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = 'http://127.0.0.1:' + server.address().port;
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /motion\.js/);
    for (const name of require('../scripts/public-files.cjs').filter(name => name !== 'index.html').map(name => '/' + name)) {
        const response = await fetch(base + name);
        assert.equal(response.status, 200, name);
        assert.ok((await response.text()).length > 100, name);
    }
    const first = await (await fetch(base + '/api/state/wheel')).json();
    const write = value => fetch(base + '/api/state/wheel', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, version: first.version })
    });
    const attempts = await Promise.all([write(first.value), write(first.value)]);
    assert.deepEqual(attempts.map(result => result.status).sort(), [200, 409]);
    assert.equal((await (await fetch(base + '/api/state/wheel')).json()).version, 1);
    assert.equal(new CentralStore(directory).get('wheel').version, 1);
    for (const name of ['/dummy.html', '/dummy/index.html', '/backend/server.cjs', '/backend/central-store.cjs', '/tests/ui-regression.test.js', '/README.md', '/archive/previews/dummy.html', '/data/all-jao-games.json', '/backend/google-apps-script/Code.gs']) {
        assert.equal((await fetch(base + name)).status, 404, name);
    }
});
