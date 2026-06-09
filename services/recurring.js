'use strict';

const db = require('../db');
const { createCalendarEvent } = require('./calendar');
const { createNotification } = require('../notifications');

const isPostgres = db.isPostgres;

/**
 * Materialise the next `weeksAhead` occurrences of a recurring session rule.
 * Idempotent: skips any slot that already exists for (teacher_id, start_datetime).
 *
 * @param {Object} rule - row from recurring_sessions
 * @param {number} weeksAhead - how many future occurrences to ensure exist
 */
async function generateRecurringSlots(rule, weeksAhead = 8) {
    const { id: ruleId, academy_id, teacher_id, student_id, day_of_week, start_time, duration_minutes } = rule;

    // Fetch teacher for Google Calendar OAuth
    let teacher = null;
    try {
        const tRes = await db.query('SELECT * FROM users WHERE id = $1', [teacher_id]);
        teacher = tRes.rows?.[0] || null;
    } catch (e) {
        console.error('[Recurring] Teacher fetch error:', e.message);
    }

    // Fetch student user_id for notification
    let studentUserId = null;
    try {
        const sRes = await db.query('SELECT user_id FROM students WHERE id = $1', [student_id]);
        studentUserId = sRes.rows?.[0]?.user_id || null;
    } catch (e) {
        console.error('[Recurring] Student fetch error:', e.message);
    }

    const [startHour, startMin] = start_time.split(':').map(Number);
    const now = new Date();

    for (let week = 0; week < weeksAhead; week++) {
        // Find the next date whose day_of_week matches, starting from today + week * 7 days
        const base = new Date(now);
        base.setDate(base.getDate() + week * 7);
        const diff = (day_of_week - base.getDay() + 7) % 7;
        const target = new Date(base);
        target.setDate(target.getDate() + diff);

        // Skip if the target date is in the past
        if (target < now && diff === 0 && week === 0) {
            // Today but already past the start time — skip only today, next week ok
            const todaySlot = new Date(target);
            todaySlot.setHours(startHour, startMin, 0, 0);
            if (todaySlot <= now) continue;
        }

        target.setHours(startHour, startMin, 0, 0);
        const endMs = target.getTime() + duration_minutes * 60 * 1000;
        const endDate = new Date(endMs);

        // ISO strings without timezone offset (local)
        const pad = n => String(n).padStart(2, '0');
        const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
        const startDatetime = fmt(target);
        const endDatetime   = fmt(endDate);

        // Idempotency check: skip if slot already exists for this teacher + start
        const existing = await db.query(
            'SELECT id FROM available_slots WHERE teacher_id = $1 AND start_datetime = $2 AND academy_id = $3',
            [teacher_id, startDatetime, academy_id]
        );
        if (existing.rows?.length) continue;

        // Insert slot
        const insertSql = isPostgres
            ? 'INSERT INTO available_slots (teacher_id, academy_id, start_datetime, end_datetime, is_booked, student_id, recurrence_rule_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id'
            : 'INSERT INTO available_slots (teacher_id, academy_id, start_datetime, end_datetime, is_booked, student_id, recurrence_rule_id) VALUES ($1, $2, $3, $4, $5, $6, $7)';
        const slotRes = await db.query(insertSql, [teacher_id, academy_id, startDatetime, endDatetime, true, student_id, ruleId]);
        const slotId = isPostgres ? slotRes.rows[0].id : slotRes.lastID;

        // Create session row
        const dateStr = startDatetime.slice(0, 10);
        const sessionSql = isPostgres
            ? 'INSERT INTO sessions (student_id, date, duration_minutes, teacher_notes, session_type, slot_id) VALUES ($1, $2, $3, $4, $5, $6)'
            : 'INSERT INTO sessions (student_id, date, duration_minutes, teacher_notes, session_type, slot_id) VALUES ($1, $2, $3, $4, $5, $6)';
        await db.query(sessionSql, [student_id, dateStr, duration_minutes, 'Sesión recurrente', 'individual', slotId]);

        // Create Google Calendar event + Meet (new Meet per session)
        try {
            if (teacher?.calendar_access_token) {
                const calResult = await createCalendarEvent(teacher, { start_datetime: startDatetime, end_datetime: endDatetime, student_name: null, student_email: null });
                if (calResult) {
                    await db.query(
                        'UPDATE available_slots SET google_event_id = $1, meet_link = $2 WHERE id = $3',
                        [calResult.google_event_id, calResult.meet_link, slotId]
                    );
                }
            }
        } catch (calErr) {
            console.error('[Recurring] Calendar event error:', calErr.message);
        }

        // Notify student
        if (studentUserId) {
            createNotification(studentUserId, academy_id, 'new_session',
                '📅 Nueva sesión programada',
                `Tienes una sesión el ${dateStr} a las ${start_time}`,
                '/student-portal'
            );
        }

        console.log(`[Recurring] Slot created: rule ${ruleId}, date ${startDatetime}`);
    }
}

module.exports = { generateRecurringSlots };
