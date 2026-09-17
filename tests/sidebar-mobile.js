'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public/shared-dashboard.css'), 'utf8');

assert.match(css, /aside\.mobile-open[\s\S]*z-index:\s*9999\s*!important/);
assert.match(css, /body aside\.mobile-open nav[\s\S]*overflow-y:\s*auto/);
assert.match(css, /body aside\.mobile-open nav[\s\S]*touch-action:\s*pan-y/);
assert.match(css, /\.mobile-nav-overlay[\s\S]*background:\s*transparent/);

console.log('Mobile sidebar contract: PASS');
