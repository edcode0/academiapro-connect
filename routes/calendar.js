'use strict';

const express   = require('express');
const router    = express.Router();
const crypto    = require('crypto');
const db        = require('../db');
const { google } = require('googleapis');
const { makeOAuth2Client, createCalendarEvent, deleteCalendarEvent } = require('../services/calendar');
const { authenticateJWT, JWT_SECRET } = require('../middleware/auth');
const { requireStudent, requireTeacherOrAdmin } = require('../middleware/roles');

const isPostgres = db.isPostgres;
const OAUTH_STATE_MAX_AGE_MS = 15 * 60 * 1000;

async function resolveMeetTeacherContext({ req, studentId, sessionId, slotId }) {
    if (slotId) {
        const slotRes = await db.query(
            `SELECT a.teacher_id, COALESCE(s.name, 'Alumno') AS student_name
             FROM available_slots a
             LEFT JOIN students s ON s.id = a.student_id
             WHERE a.id = $1 AND a.academy_id = $2`,
            [slotId, req.user.academy_id]
        );
        const slot = slotRes.rows[0];
        if (slot?.teacher_id) return { teacher: slot, studentName: slot.student_name || 'Alumno' };
    }

    if (sessionId) {
        const sessionRes = await db.query(
            `SELECT COALESCE(a.teacher_id, st.assigned_teacher_id) AS teacher_id, st.name AS student_name
             FROM sessions s
             JOIN students st ON st.id = s.student_id
             LEFT JOIN available_slots a ON a.id = s.slot_id
             WHERE s.id = $1 AND st.academy_id = $2`,
            [sessionId, req.user.academy_id]
        );
        const session = sessionRes.rows[0];
        if (session?.teacher_id) return { teacher: session, studentName: session.student_name || 'Alumno' };
    }

    if (studentId) {
        const studentRes = await db.query(
            `SELECT assigned_teacher_id AS teacher_id, name AS student_name
             FROM students
             WHERE id = $1 AND academy_id = $2`,
            [studentId, req.user.academy_id]
        );
        const student = studentRes.rows[0];
        if (student?.teacher_id) return { teacher: student, studentName: student.student_name || 'Alumno' };
    }

    if (req.user.role === 'teacher') {
        return { teacher: { teacher_id: req.user.id }, studentName: 'Alumno' };
    }

    return { teacher: null, studentName: 'Alumno' };
}

// GET available slots depending on role
router.get('/api/calendar/slots', authenticateJWT, (req, res, next) => {
    let sql = `
        SELECT a.*, u.name as teacher_name, s.name as student_name, s.user_id as student_user_id
        FROM available_slots a
        JOIN users u ON a.teacher_id = u.id
        LEFT JOIN students s ON a.student_id = s.id
        WHERE a.academy_id = $1
    `;
    let params = [req.user.academy_id];

    if (req.user.role === 'teacher') {
        sql += ` AND a.teacher_id = $2`;
        params.push(req.user.id);
    } else if (req.user.role === 'student') {
        // Show slots from assigned teacher OR directly assigned to this student (e.g. admin-created)
        db.query('SELECT id, assigned_teacher_id FROM students WHERE user_id = $1', [req.user.id], (err, r) => {
            if (err || !r.rows[0]) return res.json([]);
            const { id: studentRecordId, assigned_teacher_id } = r.rows[0];
            if (assigned_teacher_id) {
                sql += ` AND (a.teacher_id = $2 OR a.student_id = $3)`;
                params.push(assigned_teacher_id, studentRecordId);
            } else {
                sql += ` AND a.student_id = $2`;
                params.push(studentRecordId);
            }
            db.query(sql + ' ORDER BY a.start_datetime ASC', params, (err, result) => {
                if (err) return next(err);
                res.json(result.rows);
            });
        });
        return;
    }

    db.query(sql + ' ORDER BY a.start_datetime ASC', params, (err, result) => {
        if (err) return next(err);
        res.json(result.rows);
    });
});

// Teacher creates slots
router.post('/api/calendar/slots', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const { start_datetime, end_datetime, student_id, notes, meet_link: providedMeetLink } = req.body;
        const isBooked = !!student_id;
        const slotId = await db.insertReturning('INSERT INTO available_slots (teacher_id, academy_id, start_datetime, end_datetime, is_booked, student_id, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)', [req.user.id, req.user.academy_id, start_datetime, end_datetime, isBooked, student_id || null, notes || null]);

        if (providedMeetLink) {
            // Meet link was already created on-demand — just save it
            await db.query('UPDATE available_slots SET meet_link = $1 WHERE id = $2', [providedMeetLink, slotId]);
        } else {
            // Auto-create Google Calendar event if teacher has OAuth connected
            try {
                const teacherRes = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
                const teacher = teacherRes.rows[0];
                if (teacher?.calendar_access_token) {
                    const calResult = await createCalendarEvent(teacher, { start_datetime, end_datetime, student_name: null, student_email: null });
                    if (calResult) {
                        await db.query(
                            'UPDATE available_slots SET google_event_id = $1, meet_link = $2 WHERE id = $3',
                            [calResult.google_event_id, calResult.meet_link, slotId]
                        );
                    }
                }
            } catch (calErr) {
                console.error('[Calendar] Slot create calendar error:', calErr.message);
            }
        }

        res.json({ success: true, is_booked: isBooked });
    } catch (err) {
        next(err);
    }
});

// Create a Google Meet link on demand for a session or slot
router.post('/api/calendar/meet', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const { student_id, date, start_time, end_time, slot_id, session_id } = req.body;
        if (!date || !start_time || !end_time) {
            return res.status(400).json({ error: 'Se requieren fecha, hora inicio y hora fin' });
        }

        const resolved = await resolveMeetTeacherContext({
            req,
            studentId: student_id,
            sessionId: session_id,
            slotId: slot_id
        });

        if (!resolved.teacher?.teacher_id) {
            return res.status(400).json({ error: 'No se puede crear el Meet todavía: asigna un profesor a esta clase primero.' });
        }

        const teacherRes = await db.query('SELECT * FROM users WHERE id = $1', [resolved.teacher.teacher_id]);
        const teacher = teacherRes.rows[0];
        if (!teacher?.calendar_access_token) {
            return res.status(400).json({ error: 'El profesor asignado no tiene Google Calendar conectado.' });
        }

        const startDatetime = `${date}T${start_time}:00`;
        const endDatetime   = `${date}T${end_time}:00`;

        const calResult = await createCalendarEvent(teacher, {
            start_datetime: startDatetime,
            end_datetime:   endDatetime,
            student_name:   resolved.studentName || 'Alumno'
        });

        if (!calResult?.meet_link) {
            return res.status(500).json({ error: 'No se pudo generar el enlace de Meet. Verifica que Google Calendar esté conectado.' });
        }

        // Persist to slot if provided
        if (slot_id) {
            await db.query(
                'UPDATE available_slots SET google_event_id = $1, meet_link = $2 WHERE id = $3 AND academy_id = $4',
                [calResult.google_event_id, calResult.meet_link, slot_id, req.user.academy_id]
            );
        }

        // Persist to session if provided
        if (session_id) {
            await db.query(
                `UPDATE sessions SET meet_link = $1 WHERE id = $2
                 AND student_id IN (SELECT id FROM students WHERE academy_id = $3)`,
                [calResult.meet_link, session_id, req.user.academy_id]
            );
        }

        res.json({ meet_link: calResult.meet_link, event_id: calResult.google_event_id });
    } catch (err) {
        console.error('[Calendar] Meet create error:', err.message);
        res.status(500).json({ error: 'Error al crear el enlace de Meet' });
    }
});

// Teacher or Admin deletes slot
router.delete('/api/calendar/slots/:id', authenticateJWT, async (req, res, next) => {
    if (req.user.role === 'student') return res.status(403).json({ error: 'Access denied' });
    try {
        const isTeacher = req.user.role === 'teacher';
        // Teachers can only delete their own slots; admins scope by academy
        const whereSql = isTeacher
            ? 'id = $1 AND academy_id = $2 AND teacher_id = $3'
            : 'id = $1 AND academy_id = $2';
        const params = isTeacher
            ? [req.params.id, req.user.academy_id, req.user.id]
            : [req.params.id, req.user.academy_id];

        const slotRes = await db.query(`SELECT * FROM available_slots WHERE ${whereSql}`, params);
        const slot = slotRes.rows[0];
        if (!slot) return res.status(404).json({ error: 'Slot not found' });

        // If slot is booked, delete associated sessions first
        let sessionsDeleted = 0;
        if (slot.is_booked) {
            const delSessions = await db.query('DELETE FROM sessions WHERE slot_id = $1', [req.params.id]);
            sessionsDeleted = delSessions.rowCount || 0;
        }

        // Delete from Google Calendar (non-blocking) — use slot owner's tokens, not requester's
        if (slot.google_event_id) {
            const teacherRes = await db.query('SELECT calendar_access_token, calendar_refresh_token FROM users WHERE id = $1', [slot.teacher_id]);
            deleteCalendarEvent(teacherRes.rows[0], slot.google_event_id).catch(e =>
                console.error('[Calendar] Delete event error:', e.message)
            );
        }

        await db.query(`DELETE FROM available_slots WHERE ${whereSql}`, params);
        res.json({ success: true, sessionsDeleted });
    } catch (err) {
        next(err);
    }
});

// Teacher assigns a student to a free slot
router.put('/api/calendar/slots/:id', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const { student_id, is_booked } = req.body;
        const isTeacher = req.user.role === 'teacher';

        // Validate student_id belongs to the academy (and to the teacher, if teacher role)
        if (student_id != null) {
            const studentCheck = await db.query(
                `SELECT id FROM students WHERE id = $1 AND academy_id = $2${isTeacher ? ' AND assigned_teacher_id = $3' : ''}`,
                isTeacher ? [student_id, req.user.academy_id, req.user.id] : [student_id, req.user.academy_id]
            );
            if (!studentCheck.rows.length) {
                return res.status(400).json({ error: 'Invalid student' });
            }
        }

        const slotWhere = isTeacher
            ? 'WHERE id = $3 AND teacher_id = $4'
            : 'WHERE id = $3 AND academy_id = $4';
        const slotParam = isTeacher ? req.user.id : req.user.academy_id;

        await db.query(
            `UPDATE available_slots SET student_id = $1, is_booked = $2 ${slotWhere}`,
            [student_id, is_booked, req.params.id, slotParam]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[Calendar] Update slot error:', err.message);
        res.status(500).json({ error: 'Error updating slot' });
    }
});

// Student books a slot
router.post('/api/calendar/slots/:id/book', authenticateJWT, requireStudent, async (req, res, next) => {
    try {
        const studentRes = await db.query(
            'SELECT id, name, assigned_teacher_id FROM students WHERE user_id = $1 AND academy_id = $2',
            [req.user.id, req.user.academy_id]
        );
        if (!studentRes.rows[0]) return res.status(404).json({ error: 'Student not found' });
        const student = studentRes.rows[0];
        const studentId = student.id;

        // Verify slot belongs to this academy and to student's assigned teacher
        const slotCheck = await db.query(
            'SELECT teacher_id, academy_id FROM available_slots WHERE id = $1',
            [req.params.id]
        );
        const slotMeta = slotCheck.rows[0];
        if (!slotMeta || slotMeta.academy_id !== req.user.academy_id)
            return res.status(404).json({ error: 'Slot no encontrado' });
        if (student.assigned_teacher_id && slotMeta.teacher_id !== student.assigned_teacher_id)
            return res.status(403).json({ error: 'No puedes reservar clases de otro profesor' });

        const upRes = await db.query(
            'UPDATE available_slots SET is_booked = true, student_id = $1 WHERE id = $2 AND is_booked = false',
            [studentId, req.params.id]
        );
        if (upRes.rowCount === 0) return res.status(400).json({ error: 'Slot ya reservado' });

        // Generate session record and get slot data
        const slotRes = await db.query('SELECT * FROM available_slots WHERE id = $1', [req.params.id]);
        if (slotRes.rows[0]) {
            const slot = slotRes.rows[0];
            const dt = slot.start_datetime.split('T')[0];
            await db.query(
                "INSERT INTO sessions (student_id, date, duration_minutes, homework_done, slot_id, session_type) VALUES ($1, $2, 60, false, $3, 'individual')",
                [studentId, dt, req.params.id]
            );

            // Update Google Calendar event with student as attendee (non-blocking)
            if (slot.google_event_id) {
                (async () => {
                    try {
                        const teacherRes = await db.query('SELECT * FROM users WHERE id = $1', [slot.teacher_id]);
                        const studentUserRes = await db.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
                        const teacher = teacherRes.rows[0];
                        const studentEmail = studentUserRes.rows[0]?.email;
                        if (teacher?.calendar_access_token && studentEmail) {
                            const auth = makeOAuth2Client();
                            auth.setCredentials({ access_token: teacher.calendar_access_token, refresh_token: teacher.calendar_refresh_token });
                            const gcal = google.calendar({ version: 'v3', auth });
                            const existing = await gcal.events.get({ calendarId: 'primary', eventId: slot.google_event_id });
                            const attendees = [...(existing.data.attendees || []), { email: studentEmail }];
                            await gcal.events.patch({
                                calendarId: 'primary',
                                eventId: slot.google_event_id,
                                resource: { attendees },
                                sendUpdates: 'all'
                            });
                        }
                    } catch (e) {
                        console.error('[Calendar] Book update error:', e.message);
                    }
                })();
            }
        }

        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// Student cancels slot booking
router.post('/api/calendar/slots/:id/cancel', authenticateJWT, requireStudent, (req, res, next) => {
    db.query(
        'SELECT start_datetime FROM available_slots WHERE id = $1 AND student_id = (SELECT id FROM students WHERE user_id = $2 AND academy_id = $3) AND academy_id = $3',
        [req.params.id, req.user.id, req.user.academy_id],
        (err, r) => {
        if (err || !r.rows[0]) return res.status(404).json({ error: 'Slot no encontrado o no pertenece a tu reserva' });
        const start = new Date(r.rows[0].start_datetime);
        const now = new Date();
        const diffHours = (start - now) / (1000 * 60 * 60);

        if (diffHours < 24) return res.status(400).json({ error: 'Se requieren al menos 24 horas de antelación para cancelar' });

        db.query('UPDATE available_slots SET is_booked = false, student_id = NULL WHERE id = $1', [req.params.id], (upErr) => {
            if (upErr) return res.status(500).json({ error: upErr.message });
            db.query('DELETE FROM sessions WHERE slot_id = $1', [req.params.id]);
            res.json({ success: true });
        });
    });
});

router.get('/api/calendar/connect', authenticateJWT, requireTeacherOrAdmin, (req, res, next) => {
    const calendarRedirectUri = (process.env.BASE_URL || '') + '/api/calendar/callback';
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        calendarRedirectUri
    );
    const nonce = crypto.randomBytes(8).toString('hex');
    const stateData = `${req.user.id}:${nonce}:${Date.now()}`;
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(stateData).digest('hex').substring(0, 16);
    const signedState = Buffer.from(JSON.stringify({ d: stateData, s: sig })).toString('base64');
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/calendar.events'
        ],
        state: signedState
    });
    res.json({ authUrl });
});

router.get('/api/calendar/callback', async (req, res, next) => {
    try {
        const { code, state: rawState } = req.query;
        // Verify HMAC-signed state to prevent account takeover
        let userId;
        try {
            const parsed = JSON.parse(Buffer.from(rawState, 'base64').toString());
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
                Object.keys(parsed).length !== 2 || typeof parsed.d !== 'string' || typeof parsed.s !== 'string') {
                throw new Error('Invalid state structure');
            }
            const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(parsed.d).digest('hex').substring(0, 16);
            if (parsed.s !== expectedSig) throw new Error('Invalid state signature');
            const parts = parsed.d.split(':');
            if (parts.length !== 3 || !/^[1-9]\d*$/.test(parts[0]) || !/^[0-9a-f]{16}$/.test(parts[1]) || !/^\d+$/.test(parts[2])) {
                throw new Error('Invalid state data');
            }
            userId = Number(parts[0]);
            const issuedAt = Number(parts[2]);
            const stateAge = Date.now() - issuedAt;
            if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(issuedAt) ||
                stateAge < 0 || stateAge > OAUTH_STATE_MAX_AGE_MS) throw new Error('Invalid state age');
        } catch (e) {
            console.error('[Calendar] Invalid state:', e.message);
            return res.redirect('/teacher/settings?calendar=error');
        }
        const calendarRedirectUri = (process.env.BASE_URL || '') + '/api/calendar/callback';
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            calendarRedirectUri
        );
        const { tokens } = await oauth2Client.getToken(code);
        await db.query(
            'UPDATE users SET calendar_access_token=$1, calendar_refresh_token=$2, calendar_token_expiry=$3 WHERE id=$4',
            [tokens.access_token, tokens.refresh_token, tokens.expiry_date, userId]
        );
        console.log('[Calendar] Connected for user:', userId);
        res.redirect('/teacher/settings?calendar=connected');
    } catch (err) {
        console.error('[Calendar] Callback error:', err.message);
        res.redirect('/teacher/settings?calendar=error');
    }
});

router.get('/api/calendar/status', authenticateJWT, async (req, res, next) => {
    try {
        const result = await db.query(
            'SELECT calendar_access_token FROM users WHERE id=$1',
            [req.user.id]
        );
        const user = result.rows[0];
        res.json({ connected: !!user?.calendar_access_token });
    } catch (err) {
        next(err);
    }
});

// ── Recurring sessions ────────────────────────────────────────────────────────
const { generateRecurringSlots } = require('../services/recurring');

// Create a recurring rule + materialise next 8 weeks immediately
router.post('/api/calendar/recurring', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const { student_id, day_of_week, start_time, duration_minutes } = req.body;
        if (!student_id || day_of_week == null || !start_time) {
            return res.status(400).json({ error: 'Faltan campos: student_id, day_of_week, start_time' });
        }
        // Verify student belongs to caller's academy (teacher must own the student)
        const ownership = req.user.role === 'teacher'
            ? await db.query('SELECT id FROM students WHERE id=$1 AND academy_id=$2 AND assigned_teacher_id=$3', [student_id, req.user.academy_id, req.user.id])
            : await db.query('SELECT id FROM students WHERE id=$1 AND academy_id=$2', [student_id, req.user.academy_id]);
        if (!ownership.rows?.length) return res.status(403).json({ error: 'Alumno no encontrado o sin permiso' });

        const dow = parseInt(day_of_week, 10);
        const dur = parseInt(duration_minutes, 10) || 60;
        const ruleId = await db.insertReturning('INSERT INTO recurring_sessions (academy_id, teacher_id, student_id, day_of_week, start_time, duration_minutes) VALUES ($1,$2,$3,$4,$5,$6)', [req.user.academy_id, req.user.id, student_id, dow, start_time, dur]);

        const rule = { id: ruleId, academy_id: req.user.academy_id, teacher_id: req.user.id, student_id, day_of_week: dow, start_time, duration_minutes: dur };
        await generateRecurringSlots(rule, 8);

        res.json({ success: true, rule_id: ruleId });
    } catch (err) { next(err); }
});

// List active recurring rules for the caller
router.get('/api/calendar/recurring', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const sql = req.user.role === 'teacher'
            ? 'SELECT r.*, s.name as student_name FROM recurring_sessions r JOIN students s ON r.student_id=s.id WHERE r.academy_id=$1 AND r.teacher_id=$2 AND r.active=TRUE ORDER BY r.day_of_week, r.start_time'
            : 'SELECT r.*, s.name as student_name FROM recurring_sessions r JOIN students s ON r.student_id=s.id WHERE r.academy_id=$1 AND r.active=TRUE ORDER BY r.day_of_week, r.start_time';
        const params = req.user.role === 'teacher' ? [req.user.academy_id, req.user.id] : [req.user.academy_id];
        const result = await db.query(sql, params);
        res.json(result.rows || []);
    } catch (err) { next(err); }
});

// Cancel a recurring rule: deactivate + remove future unbooked slots
router.delete('/api/calendar/recurring/:id', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const ownership = req.user.role === 'teacher'
            ? await db.query('SELECT id FROM recurring_sessions WHERE id=$1 AND academy_id=$2 AND teacher_id=$3', [req.params.id, req.user.academy_id, req.user.id])
            : await db.query('SELECT id FROM recurring_sessions WHERE id=$1 AND academy_id=$2', [req.params.id, req.user.academy_id]);
        if (!ownership.rows?.length) return res.status(404).json({ error: 'Regla no encontrada' });

        await db.query('UPDATE recurring_sessions SET active=FALSE WHERE id=$1', [req.params.id]);

        // Delete future unbooked slots linked to this rule (already-booked slots are kept)
        const nowStr = new Date().toISOString().slice(0, 19);
        await db.query(
            'DELETE FROM available_slots WHERE recurrence_rule_id=$1 AND is_booked=FALSE AND start_datetime>$2',
            [req.params.id, nowStr]
        );

        res.json({ success: true });
    } catch (err) { next(err); }
});

module.exports = router;
