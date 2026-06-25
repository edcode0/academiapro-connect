'use strict';

const db = require('../db');
const DEFAULT_TIMEZONE = process.env.HOMEWORK_REMINDER_TIMEZONE || process.env.APP_TIMEZONE || 'Europe/Madrid';
const WEEKDAYS = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
};

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

function parseSchedule(dayOfWeek, time) {
    const normalizedDay = String(dayOfWeek || '').toLowerCase();
    const targetDay = WEEKDAYS[normalizedDay];
    const match = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
    if (!match || targetDay == null) {
        throw new Error('Invalid schedule');
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
        throw new Error('Invalid schedule');
    }

    return { hours, minutes, targetDay };
}

function getZonedDateParts(date, timeZone = DEFAULT_TIMEZONE) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'long',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);
    const values = {};
    for (const part of parts) {
        if (part.type !== 'literal') values[part.type] = part.value;
    }

    return {
        weekday: String(values.weekday || '').toLowerCase(),
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour),
        minute: Number(values.minute),
        second: Number(values.second)
    };
}

function zonedTimeToUtc(year, month, day, hours, minutes, timeZone = DEFAULT_TIMEZONE) {
    const desiredUtcShape = Date.UTC(year, month - 1, day, hours, minutes, 0);
    let guess = desiredUtcShape;

    for (let i = 0; i < 4; i += 1) {
        const actual = getZonedDateParts(new Date(guess), timeZone);
        const actualUtcShape = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
        const diff = desiredUtcShape - actualUtcShape;
        if (diff === 0) return new Date(guess);
        guess += diff;
    }

    return new Date(guess);
}

function computeNextScheduledFor(dayOfWeek, time, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
    const { hours, minutes, targetDay } = parseSchedule(dayOfWeek, time);
    const current = getZonedDateParts(now, timeZone);
    const currentDay = WEEKDAYS[current.weekday];
    if (currentDay == null) {
        throw new Error('Invalid schedule');
    }

    let delta = targetDay - currentDay;
    if (
        delta < 0 ||
        (delta === 0 && (hours < current.hour || (hours === current.hour && minutes <= current.minute)))
    ) {
        delta += 7;
    }

    const localDate = new Date(Date.UTC(current.year, current.month - 1, current.day));
    localDate.setUTCDate(localDate.getUTCDate() + delta);
    return zonedTimeToUtc(
        localDate.getUTCFullYear(),
        localDate.getUTCMonth() + 1,
        localDate.getUTCDate(),
        hours,
        minutes,
        timeZone
    );
}

function canScheduleReminder(reminder) {
    return reminder.status === 'pending_schedule' || reminder.status === 'scheduled';
}

function shouldCreateReminderFromProcessed(processed = {}) {
    return normalizeHomeworkList(processed.deberes || processed.homework || []).length > 0;
}

function getTranscriptIdForReminder(processed = {}, fallbackTranscriptId = null) {
    const transcriptId = processed.transcript_id ?? fallbackTranscriptId;
    return transcriptId == null || transcriptId === '' ? null : transcriptId;
}

function validateHomeworkResponseStatus(status) {
    return ['no_homework', 'not_done', 'done'].includes(status);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildHomeworkReminderPrompt(reminderId, homeworkList) {
    const items = normalizeHomeworkList(homeworkList);
    return `<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:16px;padding:16px;">
        <div style="font-weight:800;color:#9a3412;margin-bottom:8px;">📚 Organiza tus deberes</div>
        <div style="color:#7c2d12;margin-bottom:8px;">Tienes que hacer estos deberes:</div>
        <ul style="margin:0 0 12px 18px;color:#7c2d12;">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        <a href="/student-portal?homeworkReminder=${reminderId}" style="color:#ea580c;font-weight:700;">Elegir día y hora</a>
    </div>`;
}

async function createHomeworkReminderFromTranscript({
    academyId,
    teacherId,
    studentId,
    transcriptId = null,
    processed = {},
    dbRunner = db
}) {
    const homeworkList = normalizeHomeworkList(processed.deberes || processed.homework || []);
    if (!homeworkList.length) return null;
    const reminderTranscriptId = getTranscriptIdForReminder(processed, transcriptId);

    const insertSql = db.isPostgres
        ? `INSERT INTO homework_reminders
           (academy_id, student_id, teacher_id, transcript_id, source, homework_json)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`
        : `INSERT INTO homework_reminders
           (academy_id, student_id, teacher_id, transcript_id, source, homework_json)
           VALUES ($1, $2, $3, $4, $5, $6)`;
    const result = await dbRunner.query(insertSql, [
        academyId,
        studentId,
        teacherId,
        reminderTranscriptId,
        'transcript',
        JSON.stringify(homeworkList)
    ]);

    return {
        id: result.rows?.[0]?.id || result.lastID || result.insertId || null,
        homeworkList
    };
}

async function dispatchDueHomeworkReminders({
    dbRunner = db,
    createNotificationFn,
    now = new Date()
} = {}) {
    const reminderNowSql = db.isPostgres ? 'NOW()' : "datetime('now')";
    const due = await dbRunner.query(
        `SELECT hr.id, hr.academy_id, s.user_id AS student_user_id
         FROM homework_reminders hr
         JOIN students s ON s.id = hr.student_id
         WHERE hr.status = 'scheduled'
           AND hr.reminder_sent = FALSE
           AND hr.scheduled_for IS NOT NULL
           AND hr.scheduled_for <= $1`,
        [now.toISOString()]
    );

    for (const reminder of (due.rows || [])) {
        if (!reminder.student_user_id) continue;

        await createNotificationFn(
            reminder.student_user_id,
            reminder.academy_id,
            'homework_reminder',
            '📚 Es la hora de hacer tus deberes',
            'Abre la app para marcar si los has hecho',
            `/student-portal?homeworkReminder=${reminder.id}`
        );

        await dbRunner.query(
            `UPDATE homework_reminders SET reminder_sent = TRUE, updated_at = ${reminderNowSql} WHERE id = $1`,
            [reminder.id]
        );
    }
}

module.exports = {
    normalizeHomeworkList,
    computeNextScheduledFor,
    canScheduleReminder,
    shouldCreateReminderFromProcessed,
    getTranscriptIdForReminder,
    validateHomeworkResponseStatus,
    buildHomeworkReminderPrompt,
    createHomeworkReminderFromTranscript,
    dispatchDueHomeworkReminders
};
