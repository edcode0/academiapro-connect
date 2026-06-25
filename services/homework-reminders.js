'use strict';

function normalizeHomeworkList(items) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
        .map(x => String(x || '').trim())
        .filter(Boolean)
        .filter(item => {
            const key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function computeNextScheduledFor(dayOfWeek, time, now = new Date()) {
    const weekdays = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6
    };
    const [hours, minutes] = String(time || '').split(':').map(Number);
    const targetDay = weekdays[String(dayOfWeek || '').toLowerCase()];
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || targetDay == null) {
        throw new Error('Invalid schedule');
    }

    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setHours(hours, minutes, 0, 0);

    let delta = targetDay - next.getDay();
    if (delta < 0 || (delta === 0 && next <= now)) delta += 7;
    next.setDate(next.getDate() + delta);
    return next;
}

function canScheduleReminder(reminder) {
    return reminder.status === 'pending_schedule' || reminder.status === 'scheduled';
}

module.exports = { normalizeHomeworkList, computeNextScheduledFor, canScheduleReminder };
