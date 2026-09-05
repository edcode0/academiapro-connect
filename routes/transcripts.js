'use strict';

const express   = require('express');
const router    = express.Router();
const isProd    = process.env.NODE_ENV === 'production';
const serverErr = (res, err) => { console.error(err); res.status(500).json({ error: isProd ? 'Error interno del servidor' : err.message }); };
const path      = require('path');
const crypto    = require('crypto');
const db        = require('../db');
const { google } = require('googleapis');
const groqClient             = require('../services/groq');
const { makeOAuth2Client }   = require('../services/calendar');
const {
    createHomeworkReminderFromTranscript,
    buildHomeworkReminderPrompt
} = require('../services/homework-reminders');
const { pdfUpload }          = require('../utils/multer');
const { authenticateJWT }    = require('../middleware/auth');
const { requireAdmin, requireTeacherOrAdmin } = require('../middleware/roles');
const { createNotification } = require('../notifications');

const JWT_SECRET = process.env.JWT_SECRET;

// Resolve a student's USER id from whatever identifier the caller passed in:
// it may already be a users.id, a students.id linked to a user, or (legacy data)
// a students.id whose link is missing and has to be recovered by name match.
async function resolveStudentUserId(studentId, academyId) {
    const directUser = await db.query(
        "SELECT id FROM users WHERE id = $1 AND role = 'student' AND academy_id = $2",
        [studentId, academyId]
    );
    const duRows = directUser.rows || directUser;
    if (duRows?.length > 0) return duRows[0].id;

    const linkedUser = await db.query(
        "SELECT user_id FROM students WHERE id = $1 AND academy_id = $2 AND user_id IS NOT NULL",
        [studentId, academyId]
    );
    const luRows = linkedUser.rows || linkedUser;
    if (luRows?.length > 0) return luRows[0].user_id;

    const studentRecord = await db.query("SELECT name FROM students WHERE id = $1", [studentId]);
    const srRows = studentRecord.rows || studentRecord;
    if (!srRows?.length) return null;

    const nameMatch = await db.query(
        "SELECT id FROM users WHERE academy_id = $1 AND role = 'student' AND LOWER(name) = LOWER($2) LIMIT 1",
        [academyId, srRows[0].name]
    );
    const nmRows = nameMatch.rows || nameMatch;
    if (!nmRows?.length) return null;

    // Fix the link for future lookups
    await db.query("UPDATE students SET user_id = $1 WHERE id = $2", [nmRows[0].id, studentId]);
    return nmRows[0].id;
}

// Factory: receives io instance so it can emit socket events
module.exports = function makeTranscriptsRouter(io) {
    const gmailService = require('../services/gmail')(io);
    const isPostgres = db.isPostgres;

    router.get('/api/gmail/connect', authenticateJWT, requireTeacherOrAdmin, (req, res, next) => {
        const oauth2Client = makeOAuth2Client();
        const nonce = crypto.randomBytes(8).toString('hex');
        const stateData = `${req.user.id}:${nonce}`;
        const sig = crypto.createHmac('sha256', JWT_SECRET).update(stateData).digest('hex').substring(0, 16);
        const signedState = Buffer.from(JSON.stringify({ d: stateData, s: sig })).toString('base64');
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'https://www.googleapis.com/auth/gmail.readonly',
                'https://www.googleapis.com/auth/gmail.modify',
                'https://www.googleapis.com/auth/calendar',
                'https://www.googleapis.com/auth/calendar.events'
            ],
            state: signedState
        });
        res.json({ authUrl });
    });

    router.get('/api/gmail/callback', async (req, res, next) => {
        try {
            const { code, state: rawState } = req.query;
            let userId;
            try {
                const parsed = JSON.parse(Buffer.from(rawState, 'base64').toString());
                const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(parsed.d).digest('hex').substring(0, 16);
                if (parsed.s !== expectedSig) throw new Error('Invalid state signature');
                userId = parsed.d.split(':')[0];
                if (!userId || isNaN(Number(userId))) throw new Error('Invalid userId in state');
            } catch (e) {
                console.error('[Gmail] Invalid state:', e.message);
                return res.redirect('/teacher/settings?gmail=error');
            }
            const oauth2Client = makeOAuth2Client();
            const { tokens } = await oauth2Client.getToken(code);
            await db.query(
                'UPDATE users SET gmail_access_token=$1, gmail_refresh_token=$2, gmail_token_expiry=$3 WHERE id=$4',
                [tokens.access_token, tokens.refresh_token, tokens.expiry_date, userId]
            );
            console.log('[Gmail] Connected for user:', userId);
            res.redirect('/teacher/settings?gmail=connected');
        } catch (err) {
            console.error('[Gmail] Callback error:', err.message);
            res.redirect('/teacher/settings?gmail=error');
        }
    });

    router.get('/api/gmail/status', authenticateJWT, async (req, res, next) => {
        try {
            const result = await db.query(
                'SELECT gmail_access_token, transcript_email FROM users WHERE id=$1',
                [req.user.id]
            );
            const user = result.rows[0];
            res.json({
                connected: !!user?.gmail_access_token,
                transcript_email: user?.transcript_email || null
            });
        } catch (err) {
            serverErr(res, err);
        }
    });

    router.put('/api/gmail/transcript-email', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
        try {
            const { transcript_email } = req.body;
            await db.query('UPDATE users SET transcript_email=$1 WHERE id=$2', [transcript_email, req.user.id]);
            res.json({ success: true });
        } catch (err) {
            serverErr(res, err);
        }
    });

    router.post('/api/gmail/check-transcripts', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
        try {
            const result = await db.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
            const teacher = result.rows[0];
            if (!teacher.gmail_access_token) {
                return res.status(400).json({ error: 'Gmail no conectado. Conecta tu Gmail primero.' });
            }
            const processed = await gmailService.checkAndProcessTranscripts(teacher);
            res.json({ success: true, processed });
        } catch (err) {
            console.error('[Gmail] check-transcripts error:', err.message);
            serverErr(res, err);
        }
    });

    router.get('/admin/transcripts', authenticateJWT, requireAdmin, (req, res, next) => res.sendFile(path.join(__dirname, '../public/transcripts.html')));

    router.get('/api/transcripts/students', authenticateJWT, requireTeacherOrAdmin, (req, res, next) => {
        let q = 'SELECT s.id, s.name FROM students s WHERE s.academy_id = $1';
        let params = [req.user.academy_id];

        if (req.user.role === 'teacher') {
            q += ' AND s.assigned_teacher_id = $2';
            params.push(req.user.id);
        }
        q += ' ORDER BY s.name ASC';
        db.query(q, params, (err, result) => {
            if (err) return serverErr(res, err);
            res.json(result.rows || []);
        });
    });

    router.post('/api/transcripts/process', authenticateJWT, requireTeacherOrAdmin, pdfUpload.single('file'), async (req, res, next) => {
        try {
            const { student_id } = req.body;
            let transcript_text = req.body.transcript_text || '';

            if (req.file) {
                const ext = path.extname(req.file.originalname).toLowerCase();
                if (ext === '.pdf') {
                    try {
                        const pdfParse = require('pdf-parse');
                        const data = await pdfParse(req.file.buffer);
                        transcript_text = data.text;
                    } catch (e) {
                        console.error('Error pdf-parse:', e);
                        return res.status(400).json({ error: 'Error procesando el PDF. Asegúrate de que el archivo es válido.' });
                    }
                } else if (ext === '.docx') {
                    try {
                        const mammoth = require('mammoth');
                        const data = await mammoth.extractRawText({ buffer: req.file.buffer });
                        transcript_text = data.value;
                    } catch (e) {
                        console.error('Error mammoth:', e);
                        return res.status(400).json({ error: 'Error procesando .docx. Asegúrate de que el documento es válido.' });
                    }
                } else if (ext === '.txt') {
                    transcript_text = req.file.buffer.toString('utf8');
                } else {
                    return res.status(400).json({ error: 'Formato no soportado (.pdf, .docx, .txt)' });
                }
            }

            if (!student_id || !transcript_text || transcript_text.trim().length < 10) {
                return res.status(400).json({ error: 'Se requiere ID de alumno y un texto válido de la clase (mín. 10 caracteres).' });
            }

            const studentCheck = req.user.role === 'teacher'
                ? await db.query('SELECT id FROM students WHERE id = $1 AND academy_id = $2 AND assigned_teacher_id = $3', [student_id, req.user.academy_id, req.user.id])
                : await db.query('SELECT id FROM students WHERE id = $1 AND academy_id = $2', [student_id, req.user.academy_id]);
            if (!studentCheck.rows?.[0]) return res.status(403).json({ error: 'Alumno no encontrado o no asignado a este profesor' });

            // Truncate to ~12 000 chars to stay well within token limits
            const transcriptForAI = transcript_text.substring(0, 12000);

            const prompt = `Analiza esta transcripción de clase y genera un resumen estructurado.
Responde en JSON con este formato exacto (sin Markdown extra):
{
  "resumen": "Resumen breve de la clase en 2-3 frases",
  "conceptos_clave": ["concepto 1", "concepto 2"],
  "deberes": ["tarea 1", "tarea 2"],
  "pistas_profesor": ["pista o consejo 1", "pista 2"],
  "proximos_pasos": ["paso 1", "paso 2"],
  "mensaje_motivador": "Mensaje corto de ánimo personalizado para el alumno"
}

Transcripción:
${transcriptForAI}`;

            let apiResponse;
            try {
                apiResponse = await groqClient.chat.completions.create({
                    model: "deepseek-v4-flash",
                    messages: [
                        { role: 'system', content: 'Eres un asistente educativo que analiza transcripciones de clases particulares. Tu tarea es extraer la información más útil para el alumno. Responde EXCLUSIVAMENTE con el JSON solicitado.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3,
                    max_tokens: 1024,
                    response_format: { type: "json_object" }
                });
            } catch (e) {
                console.error('DeepSeek API error:', e.message, e.status, e.error);
                return res.status(503).json({ error: 'El asistente IA no está disponible en este momento. Por favor, inténtalo de nuevo en unos minutos.' });
            }

            let jsonContent;
            try {
                jsonContent = JSON.parse(apiResponse.choices[0].message.content);
            } catch (e) {
                console.error('JSON Parse error', e, apiResponse.choices[0].message.content);
                return res.status(500).json({ error: 'La IA no devolvió un JSON válido.' });
            }

            // Save History - raw_text subset
            const transcriptId = await db.insertReturning('INSERT INTO transcripts (academy_id, teacher_id, student_id, raw_text, processed_json) VALUES ($1, $2, $3, $4, $5)', [req.user.academy_id, ['teacher', 'admin'].includes(req.user.role) ? req.user.id : null, student_id, transcript_text.substring(0, 5000), JSON.stringify(jsonContent)]);

            res.json({ ...jsonContent, transcript_id: transcriptId });
        } catch (err) {
            next(err);
        }
    });


    router.post('/api/transcripts/send-to-chat', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
        try {
            const sender_id = req.user.id || req.user.userId;
            const { student_id, summary } = req.body;
            const academy_id = req.user.academy_id;

            if (!student_id || !summary) {
                return res.status(400).json({ error: 'Faltan datos requeridos' });
            }

            // Step 1: Resolve student USER id
            const studentUserId = await resolveStudentUserId(student_id, academy_id);
            let normalizedStudentId = null;

            if (!studentUserId) {
                return res.status(404).json({
                    error: 'No se encontró el usuario del alumno. El alumno debe haber iniciado sesión al menos una vez.'
                });
            }

            const scopeCheck = req.user.role === 'teacher'
                ? await db.query(
                    "SELECT id FROM students WHERE user_id = $1 AND academy_id = $2 AND assigned_teacher_id = $3",
                    [studentUserId, academy_id, req.user.id]
                )
                : await db.query(
                    "SELECT id FROM students WHERE user_id = $1 AND academy_id = $2",
                    [studentUserId, academy_id]
                );
            const scopeRows = scopeCheck.rows || scopeCheck;
            if (!scopeRows.length) {
                if (req.user.role === 'teacher') {
                    return res.status(403).json({ error: 'Este alumno no está asignado a ti' });
                }
                return res.status(404).json({ error: 'Alumno no encontrado en esta academia' });
            }
            normalizedStudentId = scopeRows[0].id;

            // Step 2: Find or create direct room between sender and studentUserId
            const sqlFindRoom = `
                SELECT r.id FROM rooms r
                JOIN room_members rm1 ON rm1.room_id = r.id AND rm1.user_id = $1
                JOIN room_members rm2 ON rm2.room_id = r.id AND rm2.user_id = $2
                WHERE r.type = 'direct' AND r.academy_id = $3
                LIMIT 1
            `;

            // Step 3: Build message
            let s;
            try {
                s = typeof summary === 'string' ? JSON.parse(summary) : summary;
            } catch (e) {
                s = { resumen: String(summary), deberes: [], conceptos_clave: [], pistas_profesor: [], mensaje_motivador: '' };
            }

            const messageText = `📚 *Resumen de tu clase de hoy*\n\n${s.resumen || ''}\n\n` +
                `📝 *Deberes para casa:*\n${(s.deberes || []).map(d => '• ' + d).join('\n')}\n\n` +
                `💡 *Conceptos importantes:*\n${(s.conceptos_clave || []).map(c => '• ' + c).join('\n')}\n\n` +
                `🎯 *Consejos de tu profe:*\n${(s.pistas_profesor || []).map(p => '• ' + p).join('\n')}\n\n` +
                `💪 ${s.mensaje_motivador || ''}`;

            // Step 4: Save message
            const insertMsgSql = isPostgres
                ? `INSERT INTO messages (room_id, sender_id, content, academy_id, read, created_at)
                   VALUES ($1, $2, $3, $4, FALSE, NOW())`
                : `INSERT INTO messages (room_id, sender_id, content, academy_id, read, created_at)
                   VALUES ($1, $2, $3, $4, 0, datetime('now'))`;
            const insertHtmlMsgSql = isPostgres
                ? `INSERT INTO messages (room_id, sender_id, content, academy_id, read, type, created_at)
                   VALUES ($1, $2, $3, $4, FALSE, $5, NOW())`
                : `INSERT INTO messages (room_id, sender_id, content, academy_id, read, type, created_at)
                   VALUES ($1, $2, $3, $4, 0, $5, datetime('now'))`;

            const transactionResult = await db.withTransaction(async tx => {
                const existingRooms = await tx.query(sqlFindRoom, [sender_id, studentUserId, academy_id]);
                const erRows = existingRooms.rows || existingRooms;

                let roomId;
                if (erRows && erRows.length > 0) {
                    roomId = erRows[0].id;
                } else {
                    const insertRoomSql = isPostgres
                        ? "INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', 'Direct', NOW()) RETURNING id"
                        : "INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', 'Direct', datetime('now'))";

                    const newRoom = await tx.query(insertRoomSql, [academy_id]);
                    roomId = isPostgres && newRoom.rows ? newRoom.rows[0].id : newRoom.lastID;

                    const insertMemberSql = isPostgres
                        ? "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
                        : "INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES ($1, $2)";

                    await tx.query(insertMemberSql, [roomId, sender_id]);
                    await tx.query(insertMemberSql, [roomId, studentUserId]);
                }

                await tx.query(insertMsgSql, [roomId, sender_id, messageText, academy_id]);

                const reminder = await createHomeworkReminderFromTranscript({
                    academyId: academy_id,
                    teacherId: sender_id,
                    studentId: normalizedStudentId,
                    transcriptId: s.transcript_id || null,
                    processed: s,
                    dbRunner: tx
                });

                let promptHtml = null;
                if (reminder) {
                    promptHtml = buildHomeworkReminderPrompt(reminder.id, reminder.homeworkList);
                    await tx.query(insertHtmlMsgSql, [roomId, sender_id, promptHtml, academy_id, 'html_card']);
                }

                return { roomId, promptHtml };
            });
            const { roomId, promptHtml } = transactionResult;

            // Step 5: Emit
            const senderInfo = await db.query('SELECT name FROM users WHERE id = $1', [sender_id]);
            const senderRows = senderInfo.rows || senderInfo;

            io.to('room_' + roomId).emit('new_message', {
                room_id: roomId,
                sender_id: sender_id,
                sender_name: senderRows[0]?.name || 'Profesor',
                content: messageText,
                created_at: new Date().toISOString()
            });

            if (promptHtml) {
                io.to('room_' + roomId).emit('new_message', {
                    room_id: roomId,
                    sender_id: sender_id,
                    sender_name: senderRows[0]?.name || 'Profesor',
                    content: promptHtml,
                    type: 'html_card',
                    created_at: new Date().toISOString()
                });
            }

            res.json({ success: true, room_id: roomId });

        } catch (err) {
            console.error('send-to-chat error:', err);
            serverErr(res, err);
        }
    });

    router.get('/api/transcripts/pending', authenticateJWT, requireTeacherOrAdmin, (req, res, next) => {
        let q = `
            SELECT t.id, t.created_at, t.processed_json, t.gmail_msg_id
            FROM transcripts t
            WHERE t.academy_id = $1 AND t.pending_match = TRUE
        `;
        let params = [req.user.academy_id];
        if (req.user.role === 'teacher') {
            q += ' AND t.teacher_id = $2';
            params.push(req.user.id);
        }
        q += ' ORDER BY t.created_at DESC LIMIT 20';
        db.query(q, params, (err, result) => {
            if (err) return serverErr(res, err);
            res.json(result.rows || []);
        });
    });

    router.put('/api/transcripts/:id/assign', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
        try {
            const { student_id } = req.body;
            const { id } = req.params;
            const studentCheck = req.user.role === 'teacher'
                ? await db.query('SELECT id FROM students WHERE id = $1 AND academy_id = $2 AND assigned_teacher_id = $3', [student_id, req.user.academy_id, req.user.id])
                : await db.query('SELECT id FROM students WHERE id = $1 AND academy_id = $2', [student_id, req.user.academy_id]);
            if (!studentCheck.rows?.[0]) return res.status(403).json({ error: 'Alumno no encontrado o no asignado a este profesor' });
            // Teachers can only assign their own pending transcripts
            const transcriptFilter = req.user.role === 'teacher'
                ? 'WHERE id = $2 AND academy_id = $3 AND teacher_id = $4'
                : 'WHERE id = $2 AND academy_id = $3';
            const params = req.user.role === 'teacher'
                ? [student_id, id, req.user.academy_id, req.user.id]
                : [student_id, id, req.user.academy_id];
            const result = await db.query(
                `UPDATE transcripts SET student_id = $1, pending_match = FALSE ${transcriptFilter}`,
                params
            );
            if ((result.rowCount || 0) === 0) return res.status(403).json({ error: 'Transcripción no encontrada o sin permiso' });
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    router.get('/api/transcripts/mine', authenticateJWT, (req, res, next) => {
        db.query(
            `SELECT t.id, t.created_at, t.processed_json
             FROM transcripts t
             JOIN students s ON t.student_id = s.id
             WHERE s.user_id = $1 AND t.academy_id = $2 AND (t.pending_match = FALSE OR t.pending_match IS NULL)
             ORDER BY t.created_at DESC LIMIT 10`,
            [req.user.id, req.user.academy_id],
            (err, result) => {
                if (err) return serverErr(res, err);
                res.json(result.rows || []);
            }
        );
    });

    router.get('/api/transcripts/history', authenticateJWT, requireTeacherOrAdmin, (req, res, next) => {
        let q = `
            SELECT t.id, t.id AS transcript_id, t.created_at, t.processed_json, t.student_id, s.name as student_name
            FROM transcripts t
            JOIN students s ON t.student_id = s.id
            WHERE t.academy_id = $1
        `;
        let params = [req.user.academy_id];
        if (req.user.role === 'teacher') {
            q += ' AND t.teacher_id = $2';
            params.push(req.user.id);
        }
        q += ' ORDER BY t.created_at DESC LIMIT 50';

        db.query(q, params, (err, result) => {
            if (err) return serverErr(res, err);
            res.json(result.rows || []);
        });
    });

    return router;
};
