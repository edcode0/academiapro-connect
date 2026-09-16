'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticateJWT }                        = require('../middleware/auth');
const { requireAdmin }                           = require('../middleware/roles');

const isPostgres = db.isPostgres;

// GET /api/academy/info
router.get('/academy/info', authenticateJWT, (req, res, next) => {
    db.query('SELECT name FROM academies WHERE id = $1', [req.user.academy_id], (err, result) => {
        if (err) return next(err);
        res.json(result?.rows[0] || {});
    });
});

// GET /api/academy/codes
router.get('/academy/codes', authenticateJWT, requireAdmin, (req, res, next) => {
    db.query('SELECT teacher_code, student_code FROM academies WHERE id = $1', [req.user.academy_id], (err, result) => {
        if (err) return next(err);
        res.json(result?.rows[0]);
    });
});

// POST /api/academy/regenerate
router.post('/academy/regenerate', authenticateJWT, requireAdmin, (req, res, next) => {
    return res.status(403).json({ error: 'Los códigos de academia son permanentes y no se pueden regenerar.' });
});

// Settings API — all keys stored as "{academy_id}_{key}" for multi-tenancy isolation
// GET /api/settings
router.get('/settings', authenticateJWT, requireAdmin, async (req, res, next) => {
    try {
        const prefix = `${req.user.academy_id}_`;
        const result = await db.query(
            "SELECT key, value FROM settings WHERE key LIKE $1",
            [prefix + '%']
        );
        const settings = {};
        (result.rows || []).forEach(r => {
            settings[r.key.slice(prefix.length)] = r.value;
        });
        res.json(settings);
    } catch (err) {
        next(err);
    }
});

// POST /api/settings
router.post('/settings', authenticateJWT, requireAdmin, async (req, res, next) => {
    const settings = req.body;
    const academyId = req.user.academy_id;
    try {
        for (const [key, val] of Object.entries(settings)) {
            const prefixedKey = `${academyId}_${key}`;
            const sql = isPostgres
                ? "INSERT INTO settings (key, value, academy_id) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
                : "INSERT OR REPLACE INTO settings (key, value, academy_id) VALUES ($1, $2, $3)";
            await db.query(sql, [prefixedKey, String(val), academyId]);
        }
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// GET /api/onboarding/status
router.get('/onboarding/status', authenticateJWT, async (req, res, next) => {
    try {
        if (req.user.role !== 'admin') return res.json({ show: false });

        const userResult = await db.query(
            'SELECT onboarding_completed FROM users WHERE id = $1', [req.user.id]
        );
        const user = userResult.rows[0];
        if (user?.onboarding_completed) return res.json({ show: false });

        const [students, teachers, codes] = await Promise.all([
            db.query('SELECT COUNT(*) AS count FROM students WHERE academy_id = $1', [req.user.academy_id]),
            db.query("SELECT COUNT(*) AS count FROM users WHERE academy_id = $1 AND role = 'teacher'", [req.user.academy_id]),
            db.query('SELECT teacher_code, student_code FROM academies WHERE id = $1', [req.user.academy_id])
        ]);

        res.json({
            show: true,
            stats: {
                students: parseInt(students.rows[0].count),
                teachers: parseInt(teachers.rows[0].count),
                teacher_code: codes.rows[0]?.teacher_code,
                student_code: codes.rows[0]?.student_code
            }
        });
    } catch (err) {
        res.json({ show: false });
    }
});

// POST /api/onboarding/complete
router.post('/onboarding/complete', authenticateJWT, async (req, res, next) => {
    try {
        await db.query('UPDATE users SET onboarding_completed = TRUE WHERE id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
