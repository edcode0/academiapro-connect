'use strict';

const db = require('../db');

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

module.exports = {
    normalizeHomeworkList,
    computeNextScheduledFor,
    canScheduleReminder,
    shouldCreateReminderFromProcessed,
    getTranscriptIdForReminder,
    validateHomeworkResponseStatus,
    buildHomeworkReminderPrompt,
    createHomeworkReminderFromTranscript
};
