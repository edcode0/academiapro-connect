const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const notifications = fs.readFileSync(path.join(root, 'public/notifications.js'), 'utf8');

// Regression: the dashboard must show only the current month's sessions.
assert.match(dashboard, /Sesiones este mes/);
assert.match(dashboard, /sessions\.filter\(s => String\(s\.date\)\.slice\(0, 7\) === currentMonth\)/);
assert.doesNotMatch(dashboard, /textContent = sessions\.length/);

// Regression: dead dashboard overflow buttons and manual enrollment entry are gone.
assert.doesNotMatch(dashboard, /class="kpi-more"/);
assert.doesNotMatch(dashboard, /Nueva Inscripción/);
assert.doesNotMatch(dashboard, /onclick="openModal\(\)"/);

// Regression: mark-all must not pretend success when the API fails.
assert.match(notifications, /const res = await fetch\('\/api\/notifications\/mark-all-read'/);
assert.match(notifications, /if \(!res\.ok\) throw new Error/);

console.log('Dashboard actions contract: PASS');
