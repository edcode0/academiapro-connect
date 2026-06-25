'use strict';

const assert = require('assert');
const {
    normalizeHomeworkList,
    computeNextScheduledFor,
    canScheduleReminder
} = require('../services/homework-reminders');

function run() {
    assert.deepStrictEqual(
        normalizeHomeworkList(['  Ruffini  ', '', 'Ruffini', 'polinomios']),
        ['Ruffini', 'polinomios']
    );

    const next = computeNextScheduledFor('wednesday', '18:30', new Date('2026-06-23T10:00:00Z'));
    assert.ok(next instanceof Date);
    assert.strictEqual(canScheduleReminder({ status: 'pending_schedule' }), true);
    assert.strictEqual(canScheduleReminder({ status: 'done' }), false);
}

run();
console.log('homework-reminders tests passed');
