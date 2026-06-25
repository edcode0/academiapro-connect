'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { createNotification } = require('../notifications');
const { authenticateJWT } = require('../middleware/auth');
const { requireTeacherOrAdmin, requireStudent } = require('../middleware/roles');
const {
    canScheduleReminder,
    computeNextScheduledFor,
    validateHomeworkResponseStatus
} = require('../services/homework-reminders');
const nowSql = db.isPostgres ? 'NOW()' : "datetime('now')";

router.get('/api/student/homework-reminders', authenticateJWT, requireStudent, async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT hr.*
             FROM homework_reminders hr
             JOIN students s ON s.id = hr.student_id
             WHERE s.user_id = $1 AND hr.academy_id = $2
             ORDER BY hr.created_at DESC`,
            [req.user.id, req.user.academy_id]
        );
        res.json(result.rows || []);
    } catch (err) {
        next(err);
    }
});

router.post('/api/student/homework-reminders/:id/schedule', authenticateJWT, requireStudent, async (req, res, next) => {
    try {
        const { day_of_week, time } = req.body;
        const owned = await db.query(
            `SELECT hr.id, hr.status
             FROM homework_reminders hr
             JOIN students s ON s.id = hr.student_id
             WHERE hr.id = $1 AND s.user_id = $2 AND hr.academy_id = $3`,
            [req.params.id, req.user.id, req.user.academy_id]
        );
        if (!owned.rows?.length) return res.status(404).json({ error: 'Recordatorio no encontrado' });
        if (!canScheduleReminder(owned.rows[0])) {
            return res.status(400).json({ error: 'Recordatorio no programable' });
        }

        const scheduledFor = computeNextScheduledFor(day_of_week, time);
        await db.query(
            `UPDATE homework_reminders
             SET scheduled_day_of_week = $1,
                 scheduled_time = $2,
                 scheduled_for = $3,
                 status = 'scheduled',
                 reminder_sent = FALSE,
                 updated_at = ${nowSql}
             WHERE id = $4`,
            [day_of_week, time, scheduledFor.toISOString(), req.params.id]
        );
        res.json({ success: true, scheduled_for: scheduledFor.toISOString() });
    } catch (err) {
        if (err && err.message === 'Invalid schedule') {
            return res.status(400).json({ error: 'Horario inválido' });
        }
        next(err);
    }
});

router.post('/api/student/homework-reminders/:id/respond', authenticateJWT, requireStudent, async (req, res, next) => {
    try {
        const { status } = req.body;
        if (!validateHomeworkResponseStatus(status)) {
            return res.status(400).json({ error: 'Estado inválido' });
        }

        const owned = await db.query(
            `SELECT hr.id, hr.teacher_id
             FROM homework_reminders hr
             JOIN students s ON s.id = hr.student_id
             WHERE hr.id = $1 AND s.user_id = $2 AND hr.academy_id = $3`,
            [req.params.id, req.user.id, req.user.academy_id]
        );
        if (!owned.rows?.length) return res.status(404).json({ error: 'Recordatorio no encontrado' });

        await db.query(
            `UPDATE homework_reminders
             SET status = $1,
                 student_response_at = ${nowSql},
                 updated_at = ${nowSql}
             WHERE id = $2`,
            [status, req.params.id]
        );

        const teacherId = owned.rows[0].teacher_id;
        if (teacherId) {
            await createNotification(
                teacherId,
                req.user.academy_id,
                'homework_status',
                `📚 ${req.user.name} ha actualizado sus deberes`,
                status === 'done' ? 'Marcó que ya los ha hecho' : status === 'not_done' ? 'Marcó que no los ha hecho' : 'Marcó que no tenía deberes',
                '/teacher/dashboard?tab=homework'
            );
        }

        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

router.get('/api/teacher/homework-reminders', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const sql = req.user.role === 'teacher'
            ? `SELECT hr.*, s.name as student_name
               FROM homework_reminders hr
               JOIN students s ON s.id = hr.student_id
               WHERE hr.academy_id = $1 AND hr.teacher_id = $2
               ORDER BY hr.updated_at DESC, hr.created_at DESC`
            : `SELECT hr.*, s.name as student_name
               FROM homework_reminders hr
               JOIN students s ON s.id = hr.student_id
               WHERE hr.academy_id = $1
               ORDER BY hr.updated_at DESC, hr.created_at DESC`;
        const params = req.user.role === 'teacher'
            ? [req.user.academy_id, req.user.id]
            : [req.user.academy_id];
        const result = await db.query(sql, params);
        res.json(result.rows || []);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
