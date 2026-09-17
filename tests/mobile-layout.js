'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('public/shared-dashboard.css');

assert.match(css, /@media \(max-width: 1024px\)[\s\S]*main \.lower,[\s\S]*grid-template-columns:\s*1fr\s*!important/);
assert.match(css, /@media \(max-width: 1024px\)[\s\S]*main \.calendar-section,[\s\S]*grid-template-columns:\s*1fr\s*!important/);
assert.match(css, /@media \(max-width: 1024px\)[\s\S]*main \.transcripts-layout[\s\S]*grid-template-columns:\s*1fr\s*!important/);
assert.match(css, /@media \(max-width: 1024px\)[\s\S]*teachers-config-list[\s\S]*grid-template-columns:\s*1fr\s*!important/);
assert.match(css, /@media \(max-width: 1024px\)[\s\S]*main table[\s\S]*min-width:\s*max-content/);
assert.match(css, /@media \(max-width: 1024px\)[\s\S]*main \.controls[\s\S]*flex-wrap:\s*wrap/);
assert.match(css, /@media \(max-width: 1024px\)[\s\S]*main \.form-grid[\s\S]*grid-template-columns:\s*1fr\s*!important/);
assert.match(css, /@media \(max-width: 1024px\)[\s\S]*#chat-container[\s\S]*min-width:\s*0/);

assert.match(read('public/transcripts.html'), /class="transcripts-layout"/);
assert.match(read('public/ai_tutor.html'), /@media \(max-width: 640px\)[\s\S]*\.header-title/);

console.log('Mobile layout contract: PASS');
