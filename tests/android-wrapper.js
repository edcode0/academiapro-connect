'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
const landing = fs.readFileSync(path.join(root, 'public/landing.html'), 'utf8');

assert.equal(manifest.name, 'AcademiaPro');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.id, '/');
assert.ok(manifest.icons.some(icon => icon.src === '/favicon-192.png' && icon.sizes === '192x192'));
assert.ok(landing.includes('rel="manifest"'));
assert.ok(landing.includes('/manifest.webmanifest'));

console.log('Android wrapper contract: PASS');
