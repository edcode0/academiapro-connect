'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticateJWT }          = require('../middleware/auth');
const { requireAdmin, requireStudent } = require('../middleware/roles');
const { ensureAcademyRooms }       = require('../services/rooms')(null);

// DELETE student from academy
router.delete('/api/admin/students/:id', authenticateJWT, requireAdmin, (req, res, next) => {
    db.query('SELECT user_id FROM students WHERE id = $1 AND academy_id = $2', [req.params.id, req.user.academy_id], (err, row) => {
        const student = row?.rows[0];
        if (!student) return res.status(404).json({ error: 'Student not found' });

        db.query('DELETE FROM sessions WHERE student_id = $1', [req.params.id]);
        db.query('DELETE FROM exams WHERE student_id = $1', [req.params.id]);
        db.query('DELETE FROM payments WHERE student_id = $1', [req.params.id]);

        db.query('DELETE FROM students WHERE id = $1', [req.params.id], () => {
            if (student.user_id) {
                db.query('UPDATE users SET academy_id = NULL WHERE id = $1', [student.user_id]);
            }
            res.json({ success: true });
        });
    });
});

// CHANGE student's teacher
router.put('/api/admin/students/:id/teacher', authenticateJWT, requireAdmin, async (req, res, next) => {
    const assigned_teacher_id = req.body.assigned_teacher_id || null;
    try {
        let row = await db.query('SELECT user_id, name FROM students WHERE id = $1 AND academy_id = $2', [req.params.id, req.user.academy_id]);
        const student = row?.rows && row.rows.length ? row.rows[0] : null;
        if (!student) return res.status(404).json({ error: 'Student not found' });

        await db.query('UPDATE students SET assigned_teacher_id = $1 WHERE id = $2', [assigned_teacher_id, req.params.id]);
        await ensureAcademyRooms(req.user.academy_id);
        res.json({ success: true });
    } catch (e) {
        next(e);
    }
});

router.get('/api/students', authenticateJWT, (req, res, next) => {
    let q = `
        SELECT s.*, u.name as teacher_name
        FROM students s
        LEFT JOIN users u ON s.assigned_teacher_id = u.id
        WHERE s.academy_id = $1
    `;
    let params = [req.user.academy_id];

    if (req.user.role === 'teacher') {
        q += ' AND s.assigned_teacher_id = $2';
        params.push(req.user.id);
    }

    db.query(q, params, (err, result) => {
        if (err) return next(err);
        res.json(result.rows);
    });
});

router.get('/api/students-list', authenticateJWT, (req, res, next) => {
    const academyId = req.user.academy_id;
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);

    let sql = `
        SELECT s.*, u.name as teacher_name,
        (SELECT COUNT(*) FROM sessions WHERE student_id = s.id AND date LIKE $1) as sessions_this_month,
        (SELECT MAX(date) FROM sessions WHERE student_id = s.id) as last_session_date
        FROM students s
        LEFT JOIN users u ON s.assigned_teacher_id = u.id
        WHERE s.academy_id = $2
    `;
    let params = [`${currentMonth}%`, academyId];

    if (req.user.role === 'teacher') {
        sql += ' AND s.assigned_teacher_id = $3';
        params.push(req.user.id);
    }

    db.query(sql, params, (err, result) => {
        if (err) return next(err);
        res.json(result.rows);
    });
});

router.get('/api/admin/unassigned-count', authenticateJWT, requireAdmin, (req, res, next) => {
    db.query('SELECT COUNT(*) as count FROM students WHERE academy_id = $1 AND assigned_teacher_id IS NULL', [req.user.academy_id], (err, result) => {
        if (err) return next(err);
        res.json({ count: result.rows[0]?.count || 0 });
    });
});

router.post('/api/admin/add-user-by-code', authenticateJWT, requireAdmin, async (req, res, next) => {
    const { code, role } = req.body;
    try {
        let result = await db.query('SELECT * FROM users WHERE user_code = $1', [code]);
        const user = result?.rows && result.rows.length ? result.rows[0] : null;
        if (!user) return res.status(404).json({ error: 'Código no encontrado' });

        const acadId = req.user.academy_id;

        await db.query('UPDATE users SET role = $1, academy_id = $2 WHERE id = $3', [role, acadId, user.id]);

        if (role === 'student') {
            let resMatch = await db.query('SELECT id FROM students WHERE user_id = $1 AND academy_id = $2', [user.id, acadId]);
            const existing = resMatch?.rows && resMatch.rows.length ? resMatch.rows[0] : null;
            if (!existing) {
                await db.query('INSERT INTO students (name, parent_email, academy_id, user_id, join_date) VALUES ($1, $2, $3, $4, $5)',
                    [user.name, user.email, acadId, user.id, new Date().toISOString().split('T')[0]]);
            }
        }

        await ensureAcademyRooms(acadId);
        res.json({ success: true, name: user.name, role });
    } catch (err) {
        next(err);
    }
});

router.put('/api/students/:id', authenticateJWT, requireAdmin, (req, res, next) => {
    if (req.body.academy_id !== undefined && String(req.body.academy_id) !== String(req.user.academy_id)) {
        return res.status(403).json({ error: 'No puedes mover alumnos a otra academia' });
    }
    const ALLOWED_COLUMNS = new Set(['name', 'course', 'subject', 'status', 'parent_email', 'parent_phone',
        'notes', 'hourly_rate', 'monthly_fee', 'payment_day', 'payment_method',
        'payment_notes', 'payment_start_date', 'join_date', 'assigned_teacher_id']);
    const keys = Object.keys(req.body).filter(k => ALLOWED_COLUMNS.has(k));
    if (keys.length === 0) return res.status(400).json({ error: 'No hay campos válidos para actualizar' });
    const values = keys.map(k => req.body[k]);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(',');
    values.push(req.params.id, req.user.academy_id);
    const sql = `UPDATE students SET ${setClause} WHERE id = $${keys.length + 1} AND academy_id = $${keys.length + 2}`;
    db.query(sql, values, (err, result) => {
        if (err) return next(err);
        res.json({ success: true });
    });
});

router.get('/api/student-detail/:id', authenticateJWT, (req, res, next) => {
    const id = req.params.id;
    const result = {};

    db.query(`
        SELECT s.*, u.name as teacher_name
        FROM students s
        LEFT JOIN users u ON s.assigned_teacher_id = u.id
        WHERE s.id = $1 AND s.academy_id = $2
    `, [id, req.user.academy_id], (err, resData) => {
        if (err) return next(err);
        const student = resData?.rows[0];
        if (!student) return res.status(404).json({ error: 'Student not found' });
        result.student = student;

        db.query(`SELECT * FROM sessions WHERE student_id = $1 ORDER BY date DESC`, [id], (err, resSessions) => {
            result.sessions = resSessions?.rows || [];
            db.query(`SELECT * FROM exams WHERE student_id = $1 ORDER BY date DESC`, [id], (err, resExams) => {
                result.exams = resExams?.rows || [];
                db.query(`SELECT * FROM payments WHERE student_id = $1 ORDER BY due_date DESC`, [id], (err, resPayments) => {
                    result.payments = resPayments?.rows || [];
                    db.query(`SELECT id, label, url, created_at FROM student_links WHERE student_id = $1 AND academy_id = $2 ORDER BY created_at DESC`, [id, req.user.academy_id], (err, resLinks) => {
                        result.links = resLinks?.rows || [];
                        res.json(result);
                    });
                });
            });
        });
    });
});

// ── Student Links CRUD ────────────────────────────────────────────────────────

// Helper: verify student belongs to caller's academy (+ teacher ownership)
async function verifyStudentAccess(studentId, user) {
    const q = user.role === 'teacher'
        ? 'SELECT id FROM students WHERE id = $1 AND academy_id = $2 AND assigned_teacher_id = $3'
        : 'SELECT id FROM students WHERE id = $1 AND academy_id = $2';
    const params = user.role === 'teacher'
        ? [studentId, user.academy_id, user.id]
        : [studentId, user.academy_id];
    const r = await db.query(q, params);
    return (r?.rows?.length > 0);
}

router.get('/api/students/:id/links', authenticateJWT, async (req, res, next) => {
    try {
        const ok = await verifyStudentAccess(req.params.id, req.user);
        if (!ok) return res.status(403).json({ error: 'Forbidden' });
        const r = await db.query(
            'SELECT id, label, url, created_at FROM student_links WHERE student_id = $1 AND academy_id = $2 ORDER BY created_at DESC',
            [req.params.id, req.user.academy_id]
        );
        res.json(r.rows || []);
    } catch (e) { next(e); }
});

router.post('/api/students/:id/links', authenticateJWT, async (req, res, next) => {
    try {
        const ok = await verifyStudentAccess(req.params.id, req.user);
        if (!ok) return res.status(403).json({ error: 'Forbidden' });
        const { label, url } = req.body;
        if (!label?.trim()) return res.status(400).json({ error: 'El texto del enlace es obligatorio' });
        if (!url?.trim() || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'La URL debe empezar por http:// o https://' });
        const r = await db.query(
            'INSERT INTO student_links (student_id, academy_id, label, url) VALUES ($1, $2, $3, $4)',
            [req.params.id, req.user.academy_id, label.trim(), url.trim()]
        );
        res.json({ success: true, id: r.rows?.[0]?.id ?? r.lastID });
    } catch (e) { next(e); }
});

router.delete('/api/students/:id/links/:linkId', authenticateJWT, async (req, res, next) => {
    try {
        const ok = await verifyStudentAccess(req.params.id, req.user);
        if (!ok) return res.status(403).json({ error: 'Forbidden' });
        const r = await db.query(
            'DELETE FROM student_links WHERE id = $1 AND student_id = $2 AND academy_id = $3',
            [req.params.linkId, req.params.id, req.user.academy_id]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Enlace no encontrado' });
        res.json({ success: true });
    } catch (e) { next(e); }
});

router.get('/api/student/portal-data', authenticateJWT, async (req, res, next) => {
    try {
        let studentResult = await db.query(
            'SELECT * FROM students WHERE user_id = $1 AND academy_id = $2',
            [req.user.id, req.user.academy_id]
        );
        let student = studentResult.rows?.[0] || studentResult[0] || null;

        if (!student) {
            try {
                // Auto-create student record if missing
                await db.query(
                    `INSERT INTO students (name, course, subject, status, academy_id, user_id)
                     VALUES ($1, 'Sin asignar', 'Sin asignar', 'active', $2, $3)`,
                    [req.user.name, req.user.academy_id, req.user.id]
                );
                const newResult = await db.query(
                    'SELECT * FROM students WHERE user_id = $1 AND academy_id = $2', [req.user.id, req.user.academy_id]
                );
                student = newResult.rows?.[0] || newResult[0] || null;
            } catch(e) {
                console.error('Failed to auto-create student:', e.message);
            }
        }

        if (!student) {
            const defaultResponse = {
                student: { id: null, name: req.user.name, email: req.user.email, course: 'Sin asignar', subject: 'Sin asignar', status: 'active' },
                sessions: [], exams: [], payments: [],
                averageScore: 0, pendingPayments: 0, homeworkRate: 0
            };
            return res.json(defaultResponse);
        }

        // Independent queries — run in parallel; tolerate a single query failing (allSettled)
        const [sessionsR, examsR, paymentsR, linksR] = await Promise.allSettled([
            db.query('SELECT * FROM sessions WHERE student_id = $1 ORDER BY date DESC LIMIT 5', [student.id]),
            db.query('SELECT * FROM exams WHERE student_id = $1 ORDER BY date DESC LIMIT 5', [student.id]),
            db.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY due_date DESC LIMIT 5', [student.id]),
            db.query('SELECT id, label, url FROM student_links WHERE student_id = $1 AND academy_id = $2 ORDER BY created_at DESC', [student.id, req.user.academy_id])
        ]);
        const rowsOf = (r, label) => {
            if (r.status === 'fulfilled') return r.value.rows || [];
            console.error(`${label} query error:`, r.reason?.message);
            return [];
        };
        const sessions = rowsOf(sessionsR, 'sessions');
        const exams = rowsOf(examsR, 'exams');
        const payments = rowsOf(paymentsR, 'payments');
        const links = rowsOf(linksR, 'links');

        res.json({
            student,
            sessions, exams, payments, links,
            averageScore: exams.length ? Math.round(exams.reduce((s, e) => s + (e.score || 0), 0) / exams.length * 10) / 10 : 0,
            pendingPayments: payments.filter(p => p.status === 'pendiente').reduce((s, p) => s + (p.amount || 0), 0),
            homeworkRate: sessions.length ? Math.round(sessions.filter(s => s.homework_done).length / sessions.length * 100) : 0
        });
    } catch (err) {
        console.error('Student portal full exception:', err.message);
        next(err);
    }
});

router.get('/api/student/reports', authenticateJWT, requireStudent, (req, res, next) => {
    db.query('SELECT * FROM reports WHERE student_id = (SELECT id FROM students WHERE user_id = $1) ORDER BY year DESC, month DESC', [req.user.id], (err, result) => {
        if (err) return next(err);
        const rows = result.rows;
        const monthsNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const formatted = rows.map(r => ({
            ...r,
            monthName: monthsNames[r.month - 1],
            url: r.file_url
        }));
        res.json(formatted);
    });
});

module.exports = router;
