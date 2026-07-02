'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { Resend } = require('resend');
const { authenticateJWT } = require('../middleware/auth');
const { requireAdmin, requireTeacherOrAdmin } = require('../middleware/roles');
const { generateMonthlyPayments } = require('../services/billing');

router.post('/api/payments', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const { student_id, amount, due_date, status, paid_date, notes } = req.body;
        const studentCheck = await db.query(
            'SELECT id FROM students WHERE id = $1 AND academy_id = $2',
            [student_id, req.user.academy_id]
        );
        if (!studentCheck.rows.length) return res.status(403).json({ error: 'El alumno no pertenece a tu academia' });
        const result = await db.query(
            `INSERT INTO payments (student_id, amount, due_date, status, paid_date)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [student_id, amount, due_date, status || 'pendiente', paid_date || null]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Payment error:', err.message);
        res.status(500).json({ error: 'Error al crear el pago' });
    }
});

router.get('/api/payments', authenticateJWT, (req, res, next) => {
    db.query('SELECT p.* FROM payments p JOIN students st ON p.student_id = st.id WHERE st.academy_id = $1', [req.user.academy_id], (err, result) => {
        if (err) return next(err);
        res.json(result.rows);
    });
});

router.get('/api/payments-data', authenticateJWT, (req, res, next) => {
    const sql = `
        SELECT p.*, s.name as student_name, s.monthly_fee as student_monthly_fee
        FROM payments p
        JOIN students s ON p.student_id = s.id
        WHERE s.academy_id = $1
        ORDER BY p.due_date DESC
    `;
    db.query(sql, [req.user.academy_id], (err, result) => {
        if (err) return next(err);
        const allPayments = result.rows;
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const currentMonth = todayStr.slice(0, 7);
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);

        let collectedThisMonth = 0, collectedLastMonth = 0, pendingTotal = 0, overdueCount = 0, overdueAmount = 0;

        allPayments.forEach(p => {
            if (p.status === 'pagado') {
                if (p.paid_date && p.paid_date.startsWith(currentMonth)) collectedThisMonth += p.amount;
                if (p.paid_date && p.paid_date.startsWith(lastMonth)) collectedLastMonth += p.amount;
            } else {
                pendingTotal += p.amount;
                if (p.due_date < todayStr) { overdueCount++; overdueAmount += p.amount; }
            }
        });
        const percentChange = collectedLastMonth > 0 ? (((collectedThisMonth - collectedLastMonth) / collectedLastMonth) * 100).toFixed(1) : 0;
        res.json({
            payments: allPayments,
            stats: { collectedThisMonth, pendingTotal, overdueCount, overdueAmount, percentChange, trend: percentChange >= 0 ? '↑' : '↓' }
        });
    });
});

router.post('/api/payments/auto-generate', authenticateJWT, requireAdmin, async (req, res, next) => {
    try {
        const created = await generateMonthlyPayments(req.user.academy_id);
        res.json({ success: true, created });
    } catch (err) {
        next(err);
    }
});

router.get('/api/teacher-payments', authenticateJWT, requireAdmin, (req, res, next) => {
    const acadId = req.user.academy_id;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const likePattern = `${year}-${String(month).padStart(2, '0')}%`;

    db.query(`SELECT id, name, hourly_rate, group_hourly_rate FROM users WHERE role = 'teacher' AND academy_id = $1`, [acadId], (err, tRes) => {
        if (err) return next(err);
        const teachers = tRes.rows || [];

        let processed = 0;
        if (teachers.length === 0) return res.json([]);

        teachers.forEach(teacher => {
            db.query(`SELECT
                        sum(CASE WHEN (s.session_type = 'individual' OR s.session_type IS NULL) THEN s.duration_minutes ELSE 0 END) as indiv_ms,
                        sum(CASE WHEN s.session_type = 'group' THEN s.duration_minutes ELSE 0 END) as group_ms
                      FROM sessions s JOIN students st ON s.student_id = st.id
                      WHERE st.assigned_teacher_id = $1 AND s.date LIKE $2`,
                [teacher.id, likePattern], (err, sRes) => {
                    const indivMinutes = sRes?.rows?.[0]?.indiv_ms ? parseFloat(sRes.rows[0].indiv_ms) : 0;
                    const groupMinutes = sRes?.rows?.[0]?.group_ms ? parseFloat(sRes.rows[0].group_ms) : 0;
                    const indivHours = indivMinutes / 60;
                    const groupHours = groupMinutes / 60;
                    const hours = indivHours + groupHours;
                    const totalAmount = parseFloat(((indivHours * (teacher.hourly_rate || 0)) + (groupHours * (teacher.group_hourly_rate || 0))).toFixed(2));

                    db.query('SELECT id, paid FROM teacher_payments WHERE teacher_id = $1 AND academy_id = $2 AND month = $3 AND year = $4',
                        [teacher.id, acadId, month, year], (err, pRes) => {
                            const existing = pRes && pRes.rows && pRes.rows[0];
                            if (existing) {
                                if (!existing.paid) {
                                    db.query('UPDATE teacher_payments SET hours = $1, hourly_rate = $2, total_amount = $3 WHERE id = $4 AND academy_id = $5',
                                        [hours, teacher.hourly_rate || 0, totalAmount, existing.id, acadId]);
                                }
                            } else {
                                db.query('INSERT INTO teacher_payments (teacher_id, academy_id, month, year, hours, hourly_rate, total_amount) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                                    [teacher.id, acadId, month, year, hours, teacher.hourly_rate || 0, totalAmount]);
                            }

                            processed++;
                            if (processed === teachers.length) {
                                db.query(`SELECT p.*, u.name as teacher_name
                                  FROM teacher_payments p
                                  JOIN users u ON p.teacher_id = u.id
                                  WHERE u.academy_id = $1 AND month = $2 AND year = $3`, [acadId, month, year], (err, finalRes) => {
                                    if (err) return next(err);
                                    res.json(finalRes.rows || []);
                                });
                            }
                        });
                });
        });
    });
});

router.post('/api/teacher-payments/:id/pay', authenticateJWT, requireAdmin, (req, res, next) => {
    const today = new Date().toISOString().split('T')[0];
    db.query('UPDATE teacher_payments SET paid = 1, paid_at = $1 WHERE id = $2 AND academy_id = $3', [today, req.params.id, req.user.academy_id], (err) => {
        if (err) return next(err);
        res.json({ success: true });
    });
});

router.post('/api/admin/send-monthly-report', authenticateJWT, requireAdmin, async (req, res, next) => {
    try {
        if (!process.env.RESEND_API_KEY) throw new Error('Resend no configurado');
        const acadId = req.user.academy_id;
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();

        const tListRes = await new Promise((resolve, reject) => {
            db.query(`SELECT p.*, u.name as teacher_name
                      FROM teacher_payments p
                      JOIN users u ON p.teacher_id = u.id
                      WHERE u.academy_id = $1 AND month = $2 AND year = $3`,
                [acadId, month, year], (err, r) => err ? reject(err) : resolve(r.rows || []));
        });

        let tableHtml = '<table border="1" cellpadding="5" cellspacing="0" style="width:100%; border-collapse:collapse; text-align:left;">';
        tableHtml += '<tr style="background:#f1f5f9;"><th>Profesor</th><th>Horas</th><th>Tarifa</th><th>Total</th></tr>';
        let grandTotal = 0;
        for (const t of tListRes) {
            tableHtml += `<tr><td>${t.teacher_name}</td><td>${t.hours.toFixed(1)}h</td><td>${t.hourly_rate}€/h</td><td>${t.total_amount}€</td></tr>`;
            grandTotal += t.total_amount;
        }
        tableHtml += `<tr><td colspan="3" align="right"><strong>Total:</strong></td><td><strong>${grandTotal}€</strong></td></tr></table>`;

        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: 'AcademiaPro <no-reply@academiapro.academy>',
                to: req.user.email,
                subject: `Resumen mensual de profesores - ${month}/${year}`,
                html: `<h2>Resumen mensual</h2>${tableHtml}`
            })
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Error sending monthly report', err);
        next(err);
    }
});

router.put('/api/payments/:id', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const { amount, due_date, status, paid_date } = req.body;
        const result = await db.query(
            `UPDATE payments SET amount=$1, due_date=$2, status=$3, paid_date=$4
             WHERE id=$5 AND student_id IN (SELECT id FROM students WHERE academy_id=$6) RETURNING *`,
            [amount, due_date, status, paid_date, req.params.id, req.user.academy_id]
        );
        res.json(result.rows[0] || { updated: 0 });
    } catch (err) {
        next(err);
    }
});

router.delete('/api/payments/:id', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        await db.query(
            'DELETE FROM payments WHERE id=$1 AND student_id IN (SELECT id FROM students WHERE academy_id=$2)',
            [req.params.id, req.user.academy_id]
        );
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
