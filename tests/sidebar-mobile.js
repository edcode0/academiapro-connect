'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public/shared-dashboard.css'), 'utf8');

for (const file of fs.readdirSync(path.join(root, 'public'))) {
    if (!file.endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(root, 'public', file), 'utf8');
    if (!html.includes('id="sidebar-mount"')) continue;
    assert.match(html, /shared-dashboard\.css/);
    assert.match(html, /class="hamburger-btn"/);
    assert.match(html, /id="mobile-nav-overlay"/);
}

assert.match(css, /aside\.mobile-open[\s\S]*z-index:\s*9999\s*!important/);
assert.match(css, /body aside\.mobile-open nav[\s\S]*overflow-y:\s*auto/);
assert.match(css, /body aside\.mobile-open nav[\s\S]*touch-action:\s*pan-y/);
assert.match(css, /\.mobile-nav-overlay[\s\S]*background:\s*transparent/);
assert.match(css, /@media \(max-width: 1024px\)[\s\S]*main\s*\{[\s\S]*min-width:\s*0/);
assert.match(css, /@media \(max-width: 1024px\)[\s\S]*main \.card\s*\{[\s\S]*overflow-x:\s*auto/);
assert.match(css, /@media \(max-width: 1024px\)[\s\S]*\.tabs\s*\{[\s\S]*overflow-x:\s*auto/);

console.log('Mobile sidebar contract: PASS');
