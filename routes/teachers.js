'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticateJWT }                      = require('../middleware/auth');
const { requireAdmin, requireTeacherOrAdmin }  = require('../middleware/roles');

router.get('/api/teacher/profile', authenticateJWT, async (req, res, next) => {
    try {
        const result = await db.query(
            'SELECT u.id, u.name, u.email, u.role, u.academy_id, a.teacher_code as code FROM users u LEFT JOIN academies a ON u.academy_id = a.id WHERE u.id = $1',
            [req.user.id]
        );
        const user = result.rows?.[0] || result[0];
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(user);
    } catch (err) {
        next(err);
    }
});

// GET all teachers in academy with stats
router.get('/api/admin/teachers', authenticateJWT, requireAdmin, (req, res, next) => {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const sql = `
        SELECT u.id, u.name, u.email, u.user_code, u.hourly_rate, u.group_hourly_rate,
               COUNT(DISTINCT s.id) as student_count,
               COALESCE(SUM(CASE WHEN se.date >= $2 AND se.date <= $3 AND (se.session_type = 'individual' OR se.session_type IS NULL) THEN se.duration_minutes ELSE 0 END), 0) / 60.0 as individual_hours_this_month,
               COALESCE(SUM(CASE WHEN se.date >= $2 AND se.date <= $3 AND se.session_type = 'group' THEN se.duration_minutes ELSE 0 END), 0) / 60.0 as group_hours_this_month
        FROM users u
        LEFT JOIN students s ON s.assigned_teacher_id = u.id AND s.academy_id = $1
        LEFT JOIN sessions se ON se.student_id = s.id
        WHERE u.role = 'teacher' AND u.academy_id = $1
        GROUP BY u.id, u.name, u.email, u.user_code, u.hourly_rate, u.group_hourly_rate
        ORDER BY u.name ASC
    `;
    db.query(sql, [req.user.academy_id, monthStart, monthEnd], (err, result) => {
        if (err) {
            console.error('[/api/admin/teachers] SQL error:', err.message);
            return next(err);
        }
        const teachers = result.rows.map(t => {
            const indivHours = parseFloat(t.individual_hours_this_month || 0);
            const groupHours = parseFloat(t.group_hours_this_month || 0);
            const indivAmount = indivHours * parseFloat(t.hourly_rate || 0);
            const groupAmount = groupHours * parseFloat(t.group_hourly_rate || 0);
            return {
                ...t,
                hours_this_month: (indivHours + groupHours).toFixed(1),
                individual_hours_this_month: indivHours.toFixed(1),
                group_hours_this_month: groupHours.toFixed(1),
                amount_this_month: (indivAmount + groupAmount).toFixed(2)
            };
        });
        res.json(teachers);
    });
});

// GET single teacher profile with full stats
router.get('/api/admin/teachers/:id', authenticateJWT, requireAdmin, (req, res, next) => {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    db.query('SELECT id, name, email, user_code, hourly_rate, group_hourly_rate FROM users WHERE id = $1 AND academy_id = $2 AND role = \'teacher\'',
        [req.params.id, req.user.academy_id], (err, tRes) => {
            if (err || !tRes.rows[0]) return res.status(404).json({ error: 'Teacher not found' });
            const teacher = tRes.rows[0];

            const studentsSQL = `
            SELECT s.*,
                   MAX(se.date) as last_session_date,
                   COUNT(se.id) as total_sessions
            FROM students s
            LEFT JOIN sessions se ON se.student_id = s.id
            WHERE s.assigned_teacher_id = $1 AND s.academy_id = $2
            GROUP BY s.id
            ORDER BY s.name ASC
        `;
            db.query(studentsSQL, [req.params.id, req.user.academy_id], (err, sRes) => {
                const students = sRes?.rows || [];

                const sessionsSQL = `
                SELECT se.*, s.name as student_name
                FROM sessions se
                JOIN students s ON se.student_id = s.id
                WHERE s.assigned_teacher_id = $1 AND s.academy_id = $2 AND se.date >= $3 AND se.date <= $4
                ORDER BY se.date DESC
            `;
                db.query(sessionsSQL, [req.params.id, req.user.academy_id, monthStart, monthEnd], (err, seRes) => {
                    const sessions = seRes?.rows || [];
                    const indivMinutes = sessions.filter(s => !s.session_type || s.session_type === 'individual').reduce((acc, s) => acc + (s.duration_minutes || 0), 0);
                    const groupMinutes = sessions.filter(s => s.session_type === 'group').reduce((acc, s) => acc + (s.duration_minutes || 0), 0);
                    const indivHours = parseFloat((indivMinutes / 60).toFixed(1));
                    const groupHours = parseFloat((groupMinutes / 60).toFixed(1));
                    const hoursThisMonth = (indivHours + groupHours).toFixed(1);
                    const indivAmount = indivHours * parseFloat(teacher.hourly_rate || 0);
                    const groupAmount = groupHours * parseFloat(teacher.group_hourly_rate || 0);
                    const amountThisMonth = (indivAmount + groupAmount).toFixed(2);

                    const avgScoreSQL = `
                    SELECT AVG(e.score) as avg_score
                    FROM exams e
                    JOIN students s ON e.student_id = s.id
                    WHERE s.assigned_teacher_id = $1 AND s.academy_id = $2
                `;
                    db.query(avgScoreSQL, [req.params.id, req.user.academy_id], (err, avgRes) => {
                        const avgScore = avgRes?.rows[0]?.avg_score ? parseFloat(avgRes.rows[0].avg_score).toFixed(1) : '-';

                        db.query('SELECT * FROM teacher_payments WHERE teacher_id = $1 AND academy_id = $2 ORDER BY year DESC, month DESC', [req.params.id, req.user.academy_id], (err, payRes) => {
                            res.json({
                                teacher,
                                students,
                                sessions,
                                stats: {
                                    studentCount: students.length,
                                    hoursThisMonth,
                                    indivHours: indivHours.toFixed(1),
                                    groupHours: groupHours.toFixed(1),
                                    indivAmount: indivAmount.toFixed(2),
                                    groupAmount: groupAmount.toFixed(2),
                                    amountThisMonth,
                                    avgScore
                                },
                                payments: payRes?.rows || []
                            });
                        });
                    });
                });
            });
        });
});

// GET sessions for teacher in month
router.get('/api/admin/teachers/:id/sessions', authenticateJWT, requireAdmin, (req, res, next) => {
    const { month } = req.query; // YYYY-MM
    const monthStart = month ? `${month}-01` : new Date().toISOString().slice(0, 7) + '-01';
    const monthEnd = month
        ? new Date(parseInt(month.slice(0, 4)), parseInt(month.slice(5, 7)), 0).toISOString().split('T')[0]
        : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];

    const sql = `
        SELECT se.*, s.name as student_name
        FROM sessions se
        JOIN students s ON se.student_id = s.id
        WHERE s.assigned_teacher_id = $1 AND s.academy_id = $2 AND se.date >= $3 AND se.date <= $4
        ORDER BY se.date DESC
    `;
    db.query(sql, [req.params.id, req.user.academy_id, monthStart, monthEnd], (err, result) => {
        if (err) return next(err);
        res.json(result.rows);
    });
});

// PUT update teacher hourly rate (individual and group)
router.put('/api/admin/teachers/:id/rate', authenticateJWT, requireAdmin, (req, res, next) => {
    const { hourly_rate, group_hourly_rate } = req.body;
    db.query('UPDATE users SET hourly_rate = $1, group_hourly_rate = $2 WHERE id = $3 AND academy_id = $4 AND role = \'teacher\'',
        [hourly_rate, group_hourly_rate ?? 0, req.params.id, req.user.academy_id], (err) => {
            if (err) return next(err);
            res.json({ success: true });
        });
});

// POST assign student to teacher
router.post('/api/admin/teachers/:id/assign-student', authenticateJWT, requireAdmin, (req, res, next) => {
    const { student_id } = req.body;
    db.query('UPDATE students SET assigned_teacher_id = $1 WHERE id = $2 AND academy_id = $3',
        [req.params.id, student_id, req.user.academy_id], (err) => {
            if (err) return next(err);
            res.json({ success: true });
        });
});

// DELETE unassign student from teacher
router.delete('/api/admin/teachers/:id/unassign-student/:studentId', authenticateJWT, requireAdmin, (req, res, next) => {
    db.query('UPDATE students SET assigned_teacher_id = NULL WHERE id = $1 AND assigned_teacher_id = $2 AND academy_id = $3',
        [req.params.studentId, req.params.id, req.user.academy_id], (err) => {
            if (err) return next(err);
            res.json({ success: true });
        });
});

// POST mark teacher month as paid
router.post('/api/admin/teachers/:id/mark-paid', authenticateJWT, requireAdmin, async (req, res, next) => {
    try {
        const { month, year, hours, hourly_rate, total } = req.body;
        const today = new Date().toISOString().split('T')[0];

        const existing = await db.query(
            'SELECT id FROM teacher_payments WHERE teacher_id = $1 AND academy_id = $2 AND month = $3 AND year = $4',
            [req.params.id, req.user.academy_id, month, year]
        );

        if (existing.rows?.[0]) {
            await db.query(
                'UPDATE teacher_payments SET paid = 1, paid_at = $1, hours = $2, hourly_rate = $3, total_amount = $4 WHERE id = $5 AND academy_id = $6',
                [today, hours, hourly_rate, total, existing.rows[0].id, req.user.academy_id]
            );
        } else {
            await db.query(
                'INSERT INTO teacher_payments (teacher_id, academy_id, month, year, hours, hourly_rate, total_amount, paid, paid_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)',
                [req.params.id, req.user.academy_id, month, year, hours, hourly_rate, total, today]
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[Teachers] mark-paid error:', err.message);
        res.status(500).json({ error: 'Error al marcar pago' });
    }
});

router.delete('/api/admin/teachers/:id', authenticateJWT, requireAdmin, (req, res, next) => {
    db.query(`SELECT id FROM users WHERE id = $1 AND role IN ('teacher', 'admin') AND academy_id = $2`, [req.params.id, req.user.academy_id], (err, row) => {
        const teacher = row?.rows[0];
        if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

        db.query('UPDATE students SET assigned_teacher_id = NULL WHERE assigned_teacher_id = $1 AND academy_id = $2', [req.params.id, req.user.academy_id]);
        db.query('UPDATE users SET academy_id = NULL WHERE id = $1', [req.params.id], () => {
            res.json({ success: true });
        });
    });
});

router.get('/api/teachers', authenticateJWT, requireAdmin, (req, res, next) => {
    db.query(`SELECT id, name FROM users WHERE academy_id = $1 AND role IN ('teacher', 'admin')`, [req.user.academy_id], (err, result) => {
        if (err) return next(err);
        res.json(result.rows);
    });
});

router.get('/api/teachers/rates', authenticateJWT, requireAdmin, (req, res, next) => {
    db.query(`SELECT id, name, hourly_rate, group_hourly_rate FROM users WHERE academy_id = $1 AND role IN ('teacher', 'admin')`, [req.user.academy_id], (err, result) => {
        if (err) return next(err);
        res.json(result.rows);
    });
});

router.put('/api/teachers/:id/rate', authenticateJWT, requireAdmin, (req, res, next) => {
    db.query(`UPDATE users SET hourly_rate = $1, group_hourly_rate = $2 WHERE id = $3 AND academy_id = $4 AND role = 'teacher'`,
        [req.body.hourly_rate || 0, req.body.group_hourly_rate || 0, req.params.id, req.user.academy_id], (err, result) => {
            if (err) return next(err);
            res.json({ success: true });
        });
});

router.get('/api/teacher/students', authenticateJWT, requireTeacherOrAdmin, (req, res, next) => {
    db.query(`SELECT s.*,
            (SELECT MAX(date) FROM sessions WHERE student_id = s.id) as last_session
            FROM students s
            WHERE s.academy_id = $1 AND s.assigned_teacher_id = $2`,
        [req.user.academy_id, req.user.id], (err, result) => {
            if (err) return next(err);
            res.json(result.rows);
        });
});

router.get('/api/teacher/dashboard-stats', authenticateJWT, requireTeacherOrAdmin, (req, res, next) => {
    const teacherId = req.user.id;
    const academyId = req.user.academy_id;
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);

    const stats = {};
    db.query('SELECT COUNT(*) as count FROM students WHERE assigned_teacher_id = $1 AND academy_id = $2', [teacherId, academyId], (err, result1) => {
        stats.studentCount = result1?.rows[0]?.count || 0;
        db.query('SELECT COUNT(*) as count FROM sessions s JOIN students st ON s.student_id = st.id WHERE st.assigned_teacher_id = $1 AND st.academy_id = $2 AND s.date LIKE $3', [teacherId, academyId, `${currentMonth}%`], (err, result2) => {
            stats.sessionCount = result2?.rows[0]?.count || 0;
            db.query("SELECT COUNT(*) as count FROM students WHERE assigned_teacher_id = $1 AND academy_id = $2 AND status = 'at_risk'", [teacherId, academyId], (err, result3) => {
                stats.atRiskCount = result3?.rows[0]?.count || 0;
                db.query('SELECT AVG(score) as avg FROM exams e JOIN students st ON e.student_id = st.id WHERE st.assigned_teacher_id = $1 AND st.academy_id = $2', [teacherId, academyId], (err, result4) => {
                    stats.avgScore = result4?.rows[0]?.avg ? parseFloat(result4.rows[0].avg).toFixed(1) : 0;

                    db.query(`SELECT s.*, st.name as student_name FROM sessions s
                            JOIN students st ON s.student_id = st.id
                            WHERE st.assigned_teacher_id = $1 AND st.academy_id = $2
                            ORDER BY s.date DESC LIMIT 5`, [teacherId, academyId], (err, result5) => {
                        stats.recentActivity = result5?.rows || [];
                        res.json(stats);
                    });
                });
            });
        });
    });
});

module.exports = router;
