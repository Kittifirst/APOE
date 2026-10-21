'use strict';
const fs = require('node:fs');
const path = require('node:path');
const files = require('./public-files.cjs');
const root = path.join(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
function checkOutput(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (entry.isSymbolicLink()) throw new Error('Unexpected symbolic link in dist: ' + name);
        if (entry.isDirectory()) {
            if (!files.some(file => file.startsWith(name + '/'))) throw new Error('Unexpected directory in dist: ' + name);
            checkOutput(path.join(directory, entry.name), name + '/');
        } else if (!files.includes(name) && name !== '.nojekyll') {
            throw new Error('Unexpected file in dist: ' + name + '. Use a clean build directory.');
        }
    }
}
checkOutput(output);
files.forEach(name => {
    const target = path.join(output, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, name), target);
});
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log('GitHub Pages files are ready in dist/');
