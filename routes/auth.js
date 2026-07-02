'use strict';

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const passport = require('passport');
const crypto   = require('crypto');
const db       = require('../db');
const {
    authenticateJWT,
    buildAuthCookieOptions,
    signAuthToken
} = require('../middleware/auth');
const { requireTeacherOrAdmin } = require('../middleware/roles');
const { sendWelcomeEmail, sendJoinWelcomeEmail } = require('../services/email');

const { generateCode, generateUserCode } = require('../utils/codes');
const rateLimit = require('express-rate-limit');
const checkCodeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

router.get('/api/auth/check-code/:code', checkCodeLimiter, (req, res, next) => {
    db.query('SELECT name FROM academies WHERE teacher_code = $1 OR student_code = $2', [req.params.code, req.params.code], (err, result) => {
        const acad = result?.rows[0];
        if (acad) res.json({ valid: true, academy_name: acad.name });
        else res.json({ valid: false });
    });
});

router.post('/auth/register', async (req, res, next) => {
    try {
        const { name, email, password, academy_name, academy_code } = req.body;
        const hash = bcrypt.hashSync(password, 10);
        const userCode = generateUserCode();

        if (academy_code) {
            const result = await db.query('SELECT * FROM academies WHERE teacher_code = $1 OR student_code = $2', [academy_code, academy_code]);
            const acad = result?.rows ? result.rows[0] : (result || [])[0];
            if (!acad) return res.status(404).json({ error: 'Código de academia no válido' });

            const role = academy_code === acad.teacher_code ? 'teacher' : 'student';

            // Check if user already exists
            const userRes = await db.query('SELECT * FROM users WHERE email = $1', [email]);
            const existingUser = userRes?.rows ? userRes.rows[0] : (userRes || [])[0];

            let userId;

            if (existingUser) {
                if (existingUser.academy_id === acad.id) {
                    return res.status(400).json({ error: 'Este email ya está registrado en esta academia' });
                }
                // Update to new academy
                await db.query('UPDATE users SET academy_id = $1, role = $2 WHERE id = $3', [acad.id, role, existingUser.id]);
                userId = existingUser.id;
            } else {
                try {
                    userId = await db.insertReturning('INSERT INTO users (name, email, password_hash, role, academy_id, user_code) VALUES ($1, $2, $3, $4, $5, $6)', [name, email, hash, role, acad.id, userCode]);
                } catch (err) {
                    if (err.message.includes('UNIQUE constraint failed') || err.message.includes('duplicate key value')) {
                        return res.status(400).json({ error: 'Este email ya está registrado. Por favor inicia sesión.' });
                    }
                    throw err;
                }
            }

            if (role === 'student') {
                const resMatch = await db.query('SELECT id FROM students WHERE name = $1 AND academy_id = $2 AND user_id IS NULL', [name, acad.id]);
                const existing = resMatch?.rows ? resMatch.rows[0] : (resMatch || [])[0];
                if (existing) {
                    await db.query('UPDATE students SET user_id = $1 WHERE id = $2', [userId, existing.id]);
                } else {
                    await db.query('INSERT INTO students (name, parent_email, academy_id, user_id, join_date) VALUES ($1, $2, $3, $4, $5)', [name, email, acad.id, userId, new Date().toISOString().split('T')[0]]);
                }
                try {
                    const roomId = await db.insertReturning("INSERT INTO rooms (academy_id, type) VALUES ($1, 'direct')", [acad.id]);
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, acad.owner_id]);
                } catch (e) { }
            } else if (role === 'teacher') {
                try {
                    const roomId = await db.insertReturning("INSERT INTO rooms (academy_id, type) VALUES ($1, 'direct')", [acad.id]);
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, acad.owner_id]);
                } catch (e) { }

                const resGroup = await db.query("SELECT id FROM rooms WHERE academy_id = $1 AND type = 'group' AND name = '👥 Profesores & Admin'", [acad.id]);
                const room = resGroup?.rows ? resGroup.rows[0] : (resGroup || [])[0];
                if (room) {
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [room.id, userId]);
                }
            }
            res.json({ success: true, redirect: '/login' });
        } else {
            const tCode = generateCode();
            const sCode = generateCode();

            try {
                const acadId = await db.insertReturning('INSERT INTO academies (name, teacher_code, student_code) VALUES ($1, $2, $3)', [academy_name, tCode, sCode]);

                const userId = await db.insertReturning('INSERT INTO users (name, email, password_hash, role, academy_id, user_code) VALUES ($1, $2, $3, $4, $5, $6)', [name, email, hash, 'admin', acadId, userCode]);

                await db.query('UPDATE academies SET owner_id = $1 WHERE id = $2', [userId, acadId]);

                try {
                    const roomId = await db.insertReturning("INSERT INTO rooms (academy_id, type, name) VALUES ($1, 'group', '👥 Profesores & Admin')", [acadId]);
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
                } catch (e) { }

                // Send welcome email (non-blocking)
                sendWelcomeEmail({ name, email }, academy_name);

                res.json({ success: true, teacher_code: tCode, student_code: sCode, redirect: '/login' });
            } catch (err) {
                if (err.message.includes('UNIQUE constraint failed') || err.message.includes('duplicate key value')) {
                    return res.status(400).json({ error: 'Este email ya está registrado. Por favor inicia sesión.' });
                }
                console.error('[Register] Error:', err.message);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        }
    } catch (e) {
        console.error('[Register] Error:', e.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.post('/auth/login', async (req, res, next) => {
    try {
        const { email, password, role, academy_code } = req.body;

        // Find user
        const result = await db.query(
            'SELECT id, name, email, role, academy_id, user_code, password_hash FROM users WHERE email = $1', [email]
        );
        const user = result.rows?.[0] || result[0];

        if (!user) {
            return res.status(401).json({ error: 'Email o contraseña incorrectos' });
        }

        // Check role matches (if role is explicitly provided in the request)
        if (role && user.role !== role) {
            return res.status(401).json({
                error: `Esta cuenta no es de tipo ${role === 'teacher' ? 'profesor' : role === 'student' ? 'alumno' : 'administrador'}`
            });
        }

        // Validate password
        const hash = user.password_hash;
        if (!hash || typeof hash !== 'string') {
            return res.status(500).json({ error: 'Error de configuración de cuenta (no password hash)' });
        }

        const valid = bcrypt.compareSync(password, hash);
        if (!valid) {
            return res.status(401).json({ error: 'Email o contraseña incorrectos' });
        }

        // Generate token
        const token = signAuthToken({
            id: user.id,
            email: user.email,
            role: user.role,
            academy_id: user.academy_id,
            name: user.name,
            user_code: user.user_code
        });
        res.cookie('token', token, buildAuthCookieOptions());

        console.log('Login successful: id=%d role=%s', user.id, user.role);
        res.json({
            user: { id: user.id, name: user.name, email: user.email, role: user.role, user_code: user.user_code }
        });

    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.post('/api/auth/join', async (req, res, next) => {
    try {
        const { academy_code, invite_token, name, email, password } = req.body;

        if ((!academy_code && !invite_token) || !name || !email || !password) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });
        }

        let academy, role;

        if (invite_token) {
            // Invite link flow: re-validate token from DB — never trust client role/academy_id
            const inviteResult = await db.query(
                `SELECT il.role, il.academy_id, a.name, a.teacher_code, a.student_code, a.id
                 FROM invitation_links il
                 JOIN academies a ON a.id = il.academy_id
                 WHERE il.token = $1 AND il.expires_at > NOW()`,
                [invite_token]
            );
            const invite = inviteResult.rows?.[0] || inviteResult[0];
            if (!invite) {
                return res.status(400).json({ error: 'Enlace de invitación inválido o expirado' });
            }
            role = invite.role;
            academy = invite;
        } else {
            // Classic code flow: derive role from which code column matches
            const trimmedCode = academy_code.trim();
            const academyResult = await db.query(
                `SELECT *,
                    CASE
                        WHEN UPPER(teacher_code) = UPPER($1) THEN 'teacher'
                        WHEN UPPER(student_code) = UPPER($1) THEN 'student'
                    END AS derived_role
                 FROM academies
                 WHERE UPPER(teacher_code) = UPPER($1) OR UPPER(student_code) = UPPER($1)`,
                [trimmedCode]
            );
            academy = academyResult.rows?.[0] || academyResult[0];
            if (!academy?.derived_role) {
                return res.status(404).json({ error: 'Código de invitación no válido' });
            }
            role = academy.derived_role;
        }

        // Check if email already exists
        const existingResult = await db.query(
            'SELECT id FROM users WHERE email = $1', [email]
        );
        const existing = existingResult.rows?.[0] || existingResult[0];
        if (existing) {
            return res.status(400).json({
                error: 'Este email ya está registrado. Por favor inicia sesión.'
            });
        }

        // Create user — role and academy_id come from DB, not client
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO users (name, email, password_hash, role, academy_id) VALUES ($1, $2, $3, $4, $5)',
            [name, email, hashedPassword, role, academy.id]
        );

        const newUserResult = await db.query(
            'SELECT id, name, email, role, academy_id, user_code FROM users WHERE email = $1', [email]
        );
        const user = newUserResult.rows?.[0] || newUserResult[0];

        const token = signAuthToken({
            id: user.id,
            email: user.email,
            role: user.role,
            academy_id: user.academy_id
        });

        console.log('User joined: id=%d role=%s academy=%d', user.id, user.role, academy.id);

        // If joining as student, ensure a students record exists
        if (role === 'student') {
            const existingStudent = await db.query(
                'SELECT id FROM students WHERE user_id = $1 AND academy_id = $2',
                [user.id, academy.id]
            );
            if (!(existingStudent.rows || []).length) {
                await db.query(
                    'INSERT INTO students (user_id, academy_id, name, status, join_date) VALUES ($1, $2, $3, $4, $5)',
                    [user.id, academy.id, name, 'active', new Date().toISOString().split('T')[0]]
                );
            }
        }

        // Send welcome email (non-blocking)
        sendJoinWelcomeEmail(user, academy.name, role);

        res.cookie('token', token, buildAuthCookieOptions());
        res.json({
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });

    } catch (err) {
        console.error('Join error:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.get('/auth/google', (req, res, next) => {
    if (req.query.academy_code) res.cookie('pending_code', req.query.academy_code, { maxAge: 1000 * 60 * 15, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
    const role = req.query.role;
    if (role && ['admin', 'teacher', 'student'].includes(role)) {
        res.cookie('pending_role', role, { maxAge: 1000 * 60 * 15, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
    }
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), async (req, res, next) => {
    const profile = req.user;
    const email = profile.emails[0].value;
    const name = profile.displayName;

    try {
        const existingResult = await db.query('SELECT id, name, email, role, academy_id, user_code, google_id FROM users WHERE email = $1', [email]);
        const existingUser = existingResult.rows?.[0];

        if (existingUser) {
            // Existing user — always use their role and academy from the DB, never override
            if (!existingUser.google_id) {
                await db.query('UPDATE users SET google_id = $1 WHERE id = $2', [profile.id, existingUser.id]);
            }
            const token = signAuthToken({
                id: existingUser.id,
                email: existingUser.email,
                role: existingUser.role,
                academy_id: existingUser.academy_id,
                name: existingUser.name,
                user_code: existingUser.user_code
            });
            res.cookie('token', token, buildAuthCookieOptions());
            console.log('Google Auth existing user: id=%d role=%s', existingUser.id, existingUser.role);
            return res.redirect('/auth-success');
        }

        // New user — decide what to do based on selected role
        const pendingCode = req.cookies.pending_code;
        const pendingRole = req.cookies.pending_role;
        res.clearCookie('pending_code');
        res.clearCookie('pending_role');

        // If role is teacher or student, redirect to /join to complete registration
        if (pendingRole === 'teacher' || pendingRole === 'student') {
            const joinUrl = `/join?role=${pendingRole}&email=${encodeURIComponent(email)}&google=true`;
            console.log('Google Auth new %s → redirecting to join: %s', pendingRole, joinUrl);
            return res.redirect(joinUrl);
        }

        // Role is admin (or no role specified) — create account as usual
        let role = 'admin';
        let academyId = null;

        if (pendingCode) {
            const actResult = await db.query('SELECT * FROM academies WHERE teacher_code = $1 OR student_code = $2', [pendingCode, pendingCode]);
            const acad = actResult?.rows ? actResult.rows[0] : (actResult || [])[0];
            if (acad) {
                role = pendingCode === acad.teacher_code ? 'teacher' : 'student';
                academyId = acad.id;
            }
        }

        if (!academyId) {
            const academyName = `${name}'s Academy`;
            const tCode = generateCode();
            const sCode = generateCode();
            academyId = await db.insertReturning('INSERT INTO academies (name, teacher_code, student_code) VALUES ($1, $2, $3)', [academyName, tCode, sCode]);
        }

        const userCode = generateUserCode();
        const userId = await db.insertReturning('INSERT INTO users (name, email, google_id, role, academy_id, user_code) VALUES ($1, $2, $3, $4, $5, $6)', [name, email, profile.id, role, academyId, userCode]);

        if (role === 'admin') {
            await db.query('UPDATE academies SET owner_id = $1 WHERE id = $2', [userId, academyId]);
        }

        const newUserRes = await db.query('SELECT id, name, email, role, academy_id, user_code FROM users WHERE id = $1', [userId]);
        const newUser = newUserRes.rows?.[0];

        const token = signAuthToken({
            id: newUser.id,
            email: newUser.email,
            role: newUser.role,
            academy_id: newUser.academy_id,
            name: newUser.name,
            user_code: newUser.user_code
        });
        res.cookie('token', token, buildAuthCookieOptions());
        console.log('Google Auth new user: id=%d role=%s', newUser.id, newUser.role);
        return res.redirect('/auth-success');

    } catch (err) {
        console.error('Google callback error:', err);
        res.redirect('/login?error=auth_failed');
    }
});

router.get('/auth/logout', (req, res, next) => {
    res.clearCookie('token');
    res.redirect('/login');
});

router.get('/auth/me', authenticateJWT, (req, res, next) => {
    const sql = `
        SELECT u.id, u.email, u.role, u.academy_id, u.user_code,
               COALESCE(s.name, u.name) as name
        FROM users u
        LEFT JOIN students s ON u.id = s.user_id
        WHERE u.id = $1
    `;
    db.query(sql, [req.user.id], (err, result) => {
        if (err || !result.rows[0]) return res.json(req.user);
        const user = result.rows[0];

        // Auto-generate code if missing
        if (!user.user_code) {
            const newCode = '#' + crypto.randomInt(10000, 99999);
            db.query('UPDATE users SET user_code = $1 WHERE id = $2', [newCode, user.id]);
            user.user_code = newCode;
        }

        res.json(user);
    });
});

router.get('/api/auth/me', authenticateJWT, async (req, res, next) => {
    try {
        const userId = req.user.id || req.user.userId;
        const result = await db.query('SELECT id, name, role, academy_id FROM users WHERE id = $1', [userId]);
        const rows = result.rows || result;
        res.json(rows[0] || {});
    } catch (err) {
        next(err);
    }
});

router.get('/api/user/my-code', authenticateJWT, (req, res, next) => {
    db.query('SELECT user_code FROM users WHERE id = $1', [req.user.id], (err, result) => {
        if (err || !result.rows[0]) return res.json({ user_code: null });
        res.json({ user_code: result.rows[0].user_code });
    });
});

router.put('/api/user/generate-code', authenticateJWT, (req, res, next) => {
    const newCode = '#' + crypto.randomInt(10000, 99999);
    db.query('UPDATE users SET user_code = $1 WHERE id = $2', [newCode, req.user.id], (err) => {
        if (err) return next(err);
        res.json({ user_code: newCode });
    });
});

router.delete('/api/auth/delete-account', authenticateJWT, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const academyId = req.user.academy_id;

        console.log('Deleting account:', userId, userRole, academyId);

        if (userRole === 'admin' && academyId) {
            // Delete all academy data with proper cascade via subqueries
            try { await db.query('DELETE FROM messages WHERE room_id IN (SELECT id FROM rooms WHERE academy_id = $1)', [academyId]); } catch (e) { console.log('Skip messages:', e.message); }
            try { await db.query('DELETE FROM room_members WHERE room_id IN (SELECT id FROM rooms WHERE academy_id = $1)', [academyId]); } catch (e) { console.log('Skip room_members:', e.message); }
            try { await db.query('DELETE FROM rooms WHERE academy_id = $1', [academyId]); } catch (e) { console.log('Skip rooms:', e.message); }
            try { await db.query('DELETE FROM payments WHERE student_id IN (SELECT id FROM students WHERE academy_id = $1)', [academyId]); } catch (e) { console.log('Skip payments:', e.message); }
            try { await db.query('DELETE FROM exams WHERE student_id IN (SELECT id FROM students WHERE academy_id = $1)', [academyId]); } catch (e) { console.log('Skip exams:', e.message); }
            try { await db.query('DELETE FROM sessions WHERE student_id IN (SELECT id FROM students WHERE academy_id = $1)', [academyId]); } catch (e) { console.log('Skip sessions:', e.message); }
            try { await db.query('DELETE FROM students WHERE academy_id = $1', [academyId]); } catch (e) { console.log('Skip students:', e.message); }
            try { await db.query('DELETE FROM users WHERE academy_id = $1', [academyId]); } catch (e) { console.log('Skip users:', e.message); }
            // Delete academy
            try {
                await db.query('DELETE FROM academies WHERE id = $1', [academyId]);
            } catch (e) {
                console.log('Skip academy:', e.message);
            }
        } else {
            // Just delete this user
            try {
                await db.query('DELETE FROM students WHERE user_id = $1', [userId]);
            } catch (e) {
                console.log('Skip student record:', e.message);
            }
            await db.query('DELETE FROM users WHERE id = $1', [userId]);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Delete error:', err.message);
        res.status(500).json({ error: 'Error al eliminar la cuenta' });
    }
});

// ─── Invitation Links ─────────────────────────────────────────────────────────

// POST /api/academy/invite — generate an invitation link (teacher or admin only)
router.post('/api/academy/invite', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const { role } = req.body;
        if (!role || !['teacher', 'student'].includes(role)) {
            return res.status(400).json({ error: 'role must be teacher or student' });
        }

        const academy_id = req.user.academy_id;
        if (!academy_id) {
            return res.status(400).json({ error: 'User is not associated with an academy' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const appUrl = process.env.APP_URL || '';
        const url = `${appUrl}/join.html?invite=${token}`;

        const result = await db.query(
            `INSERT INTO invitation_links (academy_id, role, token, expires_at, created_by)
             VALUES ($1, $2, $3, NOW() + INTERVAL '7 days', $4)
             RETURNING expires_at`,
            [academy_id, role, token, req.user.id]
        );

        const expires_at = result.rows ? result.rows[0].expires_at : null;

        res.json({ token, url, expires_at, role });
    } catch (err) {
        console.error('[Invite] Error generating invite link:', err.message);
        res.status(500).json({ error: 'Error generating invitation link' });
    }
});

// GET /api/auth/invite/:token — validate an invitation link (public)
router.get('/api/auth/invite/:token', async (req, res, next) => {
    try {
        const { token } = req.params;

        const result = await db.query(
            `SELECT il.academy_id, il.role, a.name AS academy_name
             FROM invitation_links il
             JOIN academies a ON a.id = il.academy_id
             WHERE il.token = $1 AND il.expires_at > NOW()`,
            [token]
        );

        const row = result.rows ? result.rows[0] : null;
        if (!row) {
            return res.status(404).json({ error: 'Invalid or expired invitation link' });
        }

        res.json({ academy_id: row.academy_id, academy_name: row.academy_name, role: row.role });
    } catch (err) {
        console.error('[Invite] Error validating invite link:', err.message);
        res.status(500).json({ error: 'Error validating invitation link' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────

module.exports = router;
