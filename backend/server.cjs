'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { CentralStore } = require('./central-store.cjs');
const publicFiles = require('../scripts/public-files.cjs');

const root = path.resolve(__dirname, '..');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ...publicFiles.map(name => ['/' + name, [name, contentTypes[path.extname(name)]]])
]);

function sendJson(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(value));
}

function createServer(store = new CentralStore()) {
return http.createServer((request, response) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch { response.writeHead(400).end(); return; }
    const stateMatch = /^\/api\/state\/(wheel|claw|memory|quiz)$/.exec(pathname);
    if (pathname === '/api/versions' && request.method === 'GET') {
        sendJson(response, 200, store.versions());
        return;
    }
    if (stateMatch) {
        const key = stateMatch[1];
        if (request.method === 'GET') { sendJson(response, 200, store.get(key)); return; }
        if (request.method !== 'PUT') { sendJson(response, 405, { error: 'Method not allowed' }); return; }
        const origin = request.headers.origin;
        if (origin && origin !== 'http://' + request.headers.host) { sendJson(response, 403, { error: 'Invalid origin' }); return; }
        if (!String(request.headers['content-type'] || '').startsWith('application/json')) { sendJson(response, 415, { error: 'JSON required' }); return; }
        const chunks = [];
        let size = 0;
        request.on('data', chunk => {
            if (response.writableEnded) return;
            size += chunk.length;
            if (size > 25_000_000) { sendJson(response, 413, { error: 'Game data is too large' }); request.destroy(); return; }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (response.writableEnded) return;
            let parsed;
            try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { sendJson(response, 400, { error: 'Invalid JSON' }); return; }
            try {
                const result = store.put(key, parsed.value, parsed.version);
                sendJson(response, result.status, result);
            } catch (error) {
                console.error('Central data write failed:', error);
                sendJson(response, 500, { error: 'Could not save central data' });
            }
        });
        return;
    }
    const file = files.get(pathname);
    if ((request.method !== 'GET' && request.method !== 'HEAD') || !file) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
    }
    fs.readFile(path.join(root, file[0]), (error, body) => {
        if (error) { response.writeHead(500).end('File unavailable'); return; }
        response.writeHead(200, {
            'Content-Type': file[1],
            'Content-Length': body.length,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer'
        });
        response.end(request.method === 'HEAD' ? undefined : body);
    });
});
}

if (require.main === module) {
    const server = createServer();
    const port = Number(process.env.PORT || 4173);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number from 1 to 65535');
    server.listen(port, '0.0.0.0', () => {
        console.log('A Place on earth: http://localhost:' + port);
        const addresses = Object.entries(os.networkInterfaces()).flatMap(([name, group]) =>
            (group || []).filter(address => address.family === 'IPv4' && !address.internal)
                .map(address => ({ name, address: address.address }))
        ).sort((a, b) => Number(/vpn|virtual|radmin|vEthernet|docker/i.test(a.name)) - Number(/vpn|virtual|radmin|vEthernet|docker/i.test(b.name)));
        for (const address of addresses) {
            const virtual = /vpn|virtual|radmin|vEthernet|docker/i.test(address.name);
            console.log((virtual ? 'VPN/virtual ' : 'Phone/LAN ') + address.name + ': http://' + address.address + ':' + port);
        }
    });
}

module.exports = { createServer };
