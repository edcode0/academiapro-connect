'use strict';

const { google }             = require('googleapis');
const db                     = require('../db');
const groqClient             = require('./groq');
const {
    createHomeworkReminderFromTranscript,
    buildHomeworkReminderPrompt
} = require('./homework-reminders');
const { createNotification } = require('../notifications');
const { makeOAuth2Client }   = require('./calendar');

const isPostgres = !!process.env.DATABASE_URL;

/**
 * Factory: returns { checkAndProcessTranscripts } bound to the given io instance.
 * Call once after io is created: const gmailService = require('./services/gmail')(io);
 */
module.exports = function makeGmailService(io) {

    async function checkAndProcessTranscripts(teacher) {
        const oauth2Client = makeOAuth2Client();
        oauth2Client.setCredentials({
            access_token:  teacher.gmail_access_token,
            refresh_token: teacher.gmail_refresh_token,
            expiry_date:   teacher.gmail_token_expiry
        });

        // Persist refreshed tokens automatically
        oauth2Client.on('tokens', async (tokens) => {
            await db.query(
                'UPDATE users SET gmail_access_token=$1, gmail_refresh_token=$2, gmail_token_expiry=$3 WHERE id=$4',
                [tokens.access_token, tokens.refresh_token || teacher.gmail_refresh_token, tokens.expiry_date, teacher.id]
            ).catch(err => console.error('[OAuth] Gmail token persist failed:', err.message));
        });

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        const lastCheck = teacher.gmail_last_check
            ? Math.floor(new Date(teacher.gmail_last_check).getTime() / 1000)
            : Math.floor(Date.now() / 1000) - 86400;

        // Include transcript_email alias if configured (so emails sent to that address are found)
        const emailFilter = teacher.transcript_email ? ` OR to:${teacher.transcript_email}` : '';
        const searchQuery = `(from:meet-recordings-noreply@google.com OR from:gemini-notes@google.com OR subject:"Transcripción de" OR subject:"Transcript of" OR subject:"Notas de"${emailFilter}) after:${lastCheck}`;

        // Paginate through all results so no emails are missed when first page is all duplicates
        const messages = [];
        let pageToken;
        do {
            const pageRes = await gmail.users.messages.list({
                userId: 'me', q: searchQuery, maxResults: 50,
                ...(pageToken && { pageToken })
            });
            (pageRes.data.messages || []).forEach(m => messages.push(m));
            pageToken = pageRes.data.nextPageToken;
        } while (pageToken); // exhaust all pages — query is already bounded by after:${lastCheck}

        if (!messages.length) {
            console.log('[Gmail] No new transcript emails found');
        } else {
            console.log(`[Gmail] Found ${messages.length} transcript emails for teacher ${teacher.id}`);
        }

        let processed = 0;
        let batchEarliestMs = null; // track oldest email in batch for reliable retry

        for (const msg of messages) {
            try {
                // Deduplication: skip already-processed messages
                const existing = await db.query('SELECT id FROM transcripts WHERE gmail_msg_id = $1', [msg.id]);
                if ((existing.rows || []).length > 0) {
                    console.log('[Gmail] Skipping duplicate transcript for message:', msg.id);
                    continue;
                }

                const email = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
                const emailMs = parseInt(email.data.internalDate || '0');
                if (!batchEarliestMs || emailMs < batchEarliestMs) batchEarliestMs = emailMs;

                function extractText(payload) {
                    if (payload.mimeType === 'text/plain' && payload.body?.data)
                        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
                    if (payload.mimeType === 'text/html' && payload.body?.data) {
                        const html = Buffer.from(payload.body.data, 'base64').toString('utf-8');
                        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    }
                    if (payload.parts) {
                        for (const part of payload.parts) {
                            const text = extractText(part);
                            if (text && text.length > 50) return text;
                        }
                    }
                    return '';
                }

                // Extract recording link from HTML before stripping tags
                function extractRecordingLink(payload) {
                    const getHtml = (p) => {
                        if (p.mimeType === 'text/html' && p.body?.data)
                            return Buffer.from(p.body.data, 'base64').toString('utf-8');
                        if (p.parts) { for (const c of p.parts) { const h = getHtml(c); if (h) return h; } }
                        return '';
                    };
                    const html = getHtml(payload);
                    if (!html) return null;
                    // Match Drive/Meet recording links inside href attributes
                    const patterns = [
                        /href="(https:\/\/drive\.google\.com\/[^"]+)"/i,
                        /href="(https:\/\/meet\.google\.com\/recording\/[^"]+)"/i,
                    ];
                    for (const re of patterns) {
                        const m = html.match(re);
                        if (m?.[1]) return m[1];
                    }
                    return null;
                }

                const recordingLink = extractRecordingLink(email.data.payload);
                const body = extractText(email.data.payload);
                if (!body || body.length < 100) {
                    console.warn(`[Gmail] Skipping email ${msg.id}: body too short (${body?.length || 0} chars)`);
                    continue;
                }

                // Get teacher's students
                const studentsResult = teacher.role === 'admin'
                    ? await db.query(
                        'SELECT s.id, s.name, s.user_id FROM students s WHERE s.academy_id = $1',
                        [teacher.academy_id]
                      )
                    : await db.query(
                        'SELECT s.id, s.name, s.user_id FROM students s WHERE s.academy_id = $1 AND s.assigned_teacher_id = $2',
                        [teacher.academy_id, teacher.id]
                      );
                const students = studentsResult.rows || [];
                if (!students.length) continue;

                // Analyze with Groq
                const studentNames = students.map(s => s.name).join(', ');
                const analysis = await groqClient.chat.completions.create({
                    model:    'llama-3.3-70b-versatile',
                    messages: [{
                        role:    'user',
                        content: `Analiza esta transcripción de clase y genera un resumen estructurado.\n\nAlumnos posibles: ${studentNames}\n\nTranscripción:\n${body.substring(0, 8000)}\n\nResponde SOLO en JSON con este formato exacto:\n{\n  "student_name": "nombre del alumno identificado o más probable",\n  "resumen": "Resumen de lo tratado en clase en 2-3 frases",\n  "conceptos_clave": ["concepto 1", "concepto 2"],\n  "deberes": ["tarea 1", "tarea 2"],\n  "pistas_profesor": ["consejo o observación del profesor 1"],\n  "proximos_pasos": ["próximo tema 1"],\n  "mensaje_motivador": "Mensaje corto de ánimo para el alumno"\n}`
                    }],
                    max_tokens:      1000,
                    temperature:     0.3,
                    response_format: { type: 'json_object' }
                });

                let analysisData;
                try {
                    analysisData = JSON.parse(analysis.choices[0].message.content);
                } catch (e) {
                    console.error('[Gmail] JSON parse error:', e.message);
                    continue;
                }

                if (recordingLink) {
                    analysisData.google_transcript_url = recordingLink;
                }

                // Match student by name — guard against empty string (includes('') is always true)
                const nameToMatch = (analysisData.student_name || '').trim();
                const exactMatch = nameToMatch.length >= 2
                    ? students.find(s => {
                        const n = s.name.toLowerCase();
                        const m = nameToMatch.toLowerCase();
                        return n.includes(m) || m.includes(n);
                      })
                    : null;

                if (!exactMatch) {
                    console.warn(`[Gmail] No student match for student_name="${analysisData.student_name}" — saving as pending`);
                    await db.query(
                        'INSERT INTO transcripts (academy_id, teacher_id, student_id, raw_text, processed_json, gmail_msg_id, pending_match) VALUES ($1, $2, NULL, $3, $4, $5, TRUE)',
                        [teacher.academy_id, teacher.id, body.substring(0, 5000), JSON.stringify(analysisData), msg.id]
                    );
                    processed++;
                    continue;
                }
                const student = exactMatch;

                // Resolve student user_id
                let studentUserId = student.user_id;
                if (!studentUserId) {
                    const nameMatch = await db.query(
                        "SELECT id FROM users WHERE academy_id=$1 AND role='student' AND LOWER(name)=LOWER($2) LIMIT 1",
                        [teacher.academy_id, student.name]
                    );
                    studentUserId = (nameMatch.rows || [])[0]?.id;
                    if (studentUserId) {
                        await db.query('UPDATE students SET user_id=$1 WHERE id=$2', [studentUserId, student.id])
                            .catch(err => console.error('[Transcript] Student user_id link failed:', err.message));
                        student.user_id = studentUserId;
                    }
                }
                if (!studentUserId) {
                    console.warn(`[Gmail] No user_id for student ${student.name} — saving as pending`);
                    await db.query(
                        'INSERT INTO transcripts (academy_id, teacher_id, student_id, raw_text, processed_json, gmail_msg_id, pending_match) VALUES ($1, $2, NULL, $3, $4, $5, TRUE)',
                        [teacher.academy_id, teacher.id, body.substring(0, 5000), JSON.stringify(analysisData), msg.id]
                    );
                    processed++;
                    continue;
                }

                // Find or create direct room
                const roomResult = await db.query(
                    `SELECT r.id FROM rooms r
                     JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = $1
                     JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id = $2
                     WHERE r.type = 'direct' AND r.academy_id = $3
                     LIMIT 1`,
                    [teacher.id, studentUserId, teacher.academy_id]
                );
                let roomId = (roomResult.rows || [])[0]?.id;

                if (!roomId) {
                    const newRoom = await db.query(
                        isPostgres
                            ? `INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', $2, NOW()) RETURNING id`
                            : `INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', $2, datetime('now'))`,
                        [teacher.academy_id, `${teacher.name} - ${student.name}`]
                    );
                    roomId = newRoom.rows[0].id;
                    const memberSql = isPostgres
                        ? 'INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING'
                        : 'INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES ($1, $2)';
                    await db.query(memberSql, [roomId, teacher.id]);
                    await db.query(memberSql, [roomId, studentUserId]);
                }

                // Build and save chat message
                const d = analysisData;
                const chatMessage =
                    `📚 *Resumen de tu clase*\n\n${d.resumen || d.summary || ''}\n\n` +
                    `📝 *Deberes:*\n${(d.deberes || d.homework || []).map(x => '• ' + x).join('\n') || '• Sin deberes'}\n\n` +
                    `💡 *Conceptos:*\n${(d.conceptos_clave || d.topics_covered || []).map(x => '• ' + x).join('\n')}\n\n` +
                    `🎯 *Consejos:*\n${(d.pistas_profesor || d.key_points || []).map(x => '• ' + x).join('\n')}\n\n` +
                    `💪 ${d.mensaje_motivador || d.teacher_notes || ''}` +
                    (recordingLink ? `\n\n🎥 *Grabación de la clase:*\n${recordingLink}` : '');

                await db.query(
                    isPostgres
                        ? `INSERT INTO messages (room_id, sender_id, academy_id, content, created_at) VALUES ($1, $2, $3, $4, NOW())`
                        : `INSERT INTO messages (room_id, sender_id, academy_id, content, created_at) VALUES ($1, $2, $3, $4, datetime('now'))`,
                    [roomId, teacher.id, teacher.academy_id, chatMessage]
                );

                // Save transcript record (with gmail_msg_id for deduplication)
                const transcriptInsert = await db.query(
                    isPostgres
                        ? 'INSERT INTO transcripts (academy_id, teacher_id, student_id, raw_text, processed_json, gmail_msg_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id'
                        : 'INSERT INTO transcripts (academy_id, teacher_id, student_id, raw_text, processed_json, gmail_msg_id) VALUES ($1, $2, $3, $4, $5, $6)',
                    [teacher.academy_id, teacher.id, student.id, body.substring(0, 5000), JSON.stringify(analysisData), msg.id]
                );
                const transcriptId = transcriptInsert.rows?.[0]?.id || transcriptInsert.lastID || transcriptInsert.insertId || null;
                console.log('[Gmail] Transcript saved for student:', student.name);

                const reminder = await createHomeworkReminderFromTranscript({
                    academyId: teacher.academy_id,
                    teacherId: teacher.id,
                    studentId: student.id,
                    transcriptId,
                    processed: analysisData
                });

                let promptHtml = null;
                if (reminder) {
                    promptHtml = buildHomeworkReminderPrompt(reminder.id, reminder.homeworkList);
                    await db.query(
                        isPostgres
                            ? `INSERT INTO messages (room_id, sender_id, academy_id, content, created_at) VALUES ($1, $2, $3, $4, NOW())`
                            : `INSERT INTO messages (room_id, sender_id, academy_id, content, created_at) VALUES ($1, $2, $3, $4, datetime('now'))`,
                        [roomId, teacher.id, teacher.academy_id, promptHtml]
                    );
                }

                // Notify student
                if (student.user_id) {
                    createNotification(student.user_id, teacher.academy_id, 'transcript',
                        '📝 Resumen de sesión disponible',
                        `Tu profesor ha procesado la transcripción de la última sesión.`,
                        '/student-portal'
                    );
                }

                // Emit via Socket.IO
                io.to(`room_${roomId}`).emit('new_message', {
                    room_id:     roomId,
                    sender_id:   teacher.id,
                    sender_name: teacher.name,
                    sender_role: 'teacher',
                    content:     chatMessage,
                    created_at:  new Date().toISOString()
                });

                if (promptHtml) {
                    io.to(`room_${roomId}`).emit('new_message', {
                        room_id:     roomId,
                        sender_id:   teacher.id,
                        sender_name: teacher.name,
                        sender_role: 'teacher',
                        content:     promptHtml,
                        created_at:  new Date().toISOString()
                    });
                }

                // Mark email as read
                await gmail.users.messages.modify({
                    userId:      'me',
                    id:          msg.id,
                    requestBody: { removeLabelIds: ['UNREAD'] }
                });

                processed++;
                console.log(`[Gmail] Processed transcript for student ${student.name}`);
            } catch (err) {
                console.error('[Gmail] Error processing email:', err.message);
            }
        }

        // Update last_check:
        // - If we fetched real emails: set to just before the oldest in the batch.
        //   Dedup (gmail_msg_id unique index) skips already-processed ones;
        //   failed emails remain in range for the next cron run.
        // - If all messages were duplicates (batchEarliestMs still null): advance to
        //   NOW() to avoid infinite rescanning of the same already-processed range.
        if (batchEarliestMs) {
            const nextCheck = new Date(batchEarliestMs - 1000).toISOString();
            await db.query('UPDATE users SET gmail_last_check=$1 WHERE id=$2', [nextCheck, teacher.id])
                .catch(err => console.error('[Gmail] Last check update failed:', err.message));
        } else if (messages.length > 0) {
            await db.query(
                isPostgres
                    ? 'UPDATE users SET gmail_last_check=NOW() WHERE id=$1'
                    : "UPDATE users SET gmail_last_check=datetime('now') WHERE id=$1",
                [teacher.id]
            ).catch(err => console.error('[Gmail] Last check update (all-dups) failed:', err.message));
        }

        return processed;
    }

    return { checkAndProcessTranscripts };
};
