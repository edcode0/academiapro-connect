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

const transcripts = read('public/transcripts.html');
const teacherCalendar = read('public/teacher_calendar.html');
const chat = read('public/chat.html');
const aiTutor = read('public/ai_tutor.html');

assert.match(transcripts, /class="transcripts-layout"/);
assert.match(transcripts, /#historyCard[\s\S]*table-layout:\s*fixed/);
assert.match(teacherCalendar, /<main class="calendar-page">/);
assert.match(teacherCalendar, /class="card calendar-card"/);
assert.match(teacherCalendar, /#calendar \.fc-toolbar/);
assert.match(chat, /#conversation-list #mobile-chat-bar[\s\S]*display:\s*flex/);
assert.match(chat, /#chat-header \.hamburger-btn[\s\S]*display:\s*inline-flex/);
assert.match(aiTutor, /grid-template-columns:\s*auto minmax\(0, 1fr\)/);
assert.match(aiTutor, /\.header-subtitle[\s\S]*grid-row:\s*2/);

console.log('Mobile layout contract: PASS');
