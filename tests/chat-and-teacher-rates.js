const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const chatRoute = fs.readFileSync(path.join(root, 'routes/chat.js'), 'utf8');
const chatPage = fs.readFileSync(path.join(root, 'public/chat.html'), 'utf8');
const teacherRoute = fs.readFileSync(path.join(root, 'routes/teachers.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'public/settings.html'), 'utf8');

// HTML cards must have a human-readable conversation-list preview.
assert.match(chatRoute, /CASE\s+WHEN type = 'html_card' OR content LIKE '<div%' THEN '📚 Resumen de clase'/);
assert.match(chatPage, /function roomPreview\(message\)/);
assert.match(chatPage, /updateRoomLastMessage\(message\.room_id, roomPreview\(message\)\)/);

// Teacher rates must be blank until configured and only actual teachers appear.
assert.match(teacherRoute, /WHERE academy_id = \$1 AND role = 'teacher'/);
assert.match(settings, /t\.hourly_rate > 0 \? t\.hourly_rate : ''/);
assert.match(settings, /t\.group_hourly_rate > 0 \? t\.group_hourly_rate : ''/);
assert.match(settings, /id="teacher-rates-help"/);
assert.match(settings, /toggleTeacherRatesHelp/);

console.log('Chat previews and teacher rates contract: PASS');
