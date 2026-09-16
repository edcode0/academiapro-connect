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
const { resolveTranscriptStudent } = require('./student-match');
const { buildTranscriptAnalysisPrompt, buildTranscriptSummaryCard } = require('./transcript-format');

const isPostgres = !!process.env.DATABASE_URL;

// Bound DeepSeek token burn per run: a backlog of N emails must not be re-analyzed
// in full on every 15-min tick (that exhausts the daily token quota in minutes).
// Processed emails become duplicates next run, so the backlog drains monotonically.
const MAX_PER_RUN = 5;

const isRateLimit = (err) =>
    err?.status === 429 || /rate.?limit|429/i.test(err?.message || '');

// A stalled run (emails found, none processed) is invisible otherwise: errors go to
// console.error and die there. That is how a 32-email backlog went unnoticed for days.
// ponytail: in-memory throttle, so a restart re-arms the alert. Good enough for a
// once-a-day digest; move to a users column if restarts ever get frequent.
const alertedOn = new Map(); // teacher.id -> 'YYYY-MM-DD'

async function alertAdmins(teacher, title, message) {
    const today = new Date().toISOString().slice(0, 10);
    if (alertedOn.get(teacher.id) === today) return;
    alertedOn.set(teacher.id, today);

    const admins = await db.query(
        "SELECT id FROM users WHERE academy_id = $1 AND role = 'admin'",
        [teacher.academy_id]
    ).catch(err => {
        console.error('[Gmail] Admin lookup for alert failed:', err.message);
        return { rows: [] };
    });

    for (const admin of admins.rows || []) {
        await createNotification(admin.id, teacher.academy_id, 'system', title, message, '/admin/transcripts');
    }
}

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
        try {
            do {
                const pageRes = await gmail.users.messages.list({
                    userId: 'me', q: searchQuery, maxResults: 50,
                    ...(pageToken && { pageToken })
                });
                (pageRes.data.messages || []).forEach(m => messages.push(m));
                pageToken = pageRes.data.nextPageToken;
            } while (pageToken); // exhaust all pages — query is already bounded by after:${lastCheck}
        } catch (err) {
            // Revoked/expired refresh token: polling can never recover on its own.
            // Clear the tokens so the UI shows "disconnected" and the teacher reconnects,
            // instead of failing silently on every tick forever.
            if (/invalid_grant/i.test(err.message || '')) {
                console.warn(`[Gmail] invalid_grant for teacher ${teacher.id} — clearing tokens, reconnect required`);
                await db.query(
                    'UPDATE users SET gmail_access_token=NULL, gmail_refresh_token=NULL, gmail_token_expiry=NULL WHERE id=$1',
                    [teacher.id]
                ).catch(e => console.error('[Gmail] Token clear failed:', e.message));
                await createNotification(teacher.id, teacher.academy_id, 'system',
                    '⚠️ Gmail desconectado',
                    'Tu conexión con Gmail ha caducado. Reconéctala en Ajustes para seguir recibiendo las transcripciones.',
                    '/teacher/settings'
                );
                await alertAdmins(teacher,
                    '⚠️ Gmail desconectado de un profesor',
                    `La conexión de Gmail de ${teacher.name} ha caducado, así que sus transcripciones no llegan. Debe reconectarla en Ajustes.`
                );
                return 0;
            }
            throw err;
        }

        if (!messages.length) {
            console.log('[Gmail] No new transcript emails found');
        } else {
            console.log(`[Gmail] Found ${messages.length} transcript emails for teacher ${teacher.id}`);
        }

        let processed = 0;
        let skipped = 0;            // already-processed duplicates: not a stall
        let stoppedEarly = false;   // cap or quota hit: unseen (older) emails still pending
        let stallReason = null;     // why nothing got through, for the admin alert
        let batchEarliestMs = null; // track oldest email in batch for reliable retry

        for (const msg of messages) {
            if (processed >= MAX_PER_RUN) {
                console.log(`[Gmail] Batch cap ${MAX_PER_RUN} reached — ${messages.length} found, rest next run`);
                stoppedEarly = true;
                break;
            }
            try {
                // Deduplication: skip already-processed messages
                const existing = await db.query('SELECT id FROM transcripts WHERE gmail_msg_id = $1', [msg.id]);
                if ((existing.rows || []).length > 0) {
                    console.log('[Gmail] Skipping duplicate transcript for message:', msg.id);
                    skipped++;
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

                // Analyze with DeepSeek
                const studentNames = students.map(s => s.name).join(', ');
                let analysis;
                try {
                    analysis = await groqClient.chat.completions.create({
                        model:    'deepseek-v4-flash',
                        messages: [{
                            role:    'user',
                            content: buildTranscriptAnalysisPrompt({ transcriptText: body.substring(0, 8000), studentNames })
                        }],
                        max_tokens:      1000,
                        temperature:     0.3,
                        response_format: { type: 'json_object' }
                    });
                } catch (e) {
                    // Quota exhausted: every remaining email in this batch would fail too.
                    // Abort the run instead of burning one doomed call per email.
                    if (isRateLimit(e)) {
                        stoppedEarly = true;
                        stallReason = 'se ha alcanzado el límite diario de la IA (DeepSeek)';
                        console.warn('[Gmail] DeepSeek rate limit — batch aborted, retry next run:', e.message);
                        break;
                    }
                    throw e;
                }

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

                // Match student by booked slots in the lookup window, falling back to an
                // exact name match. Several students booked in the same window (normal for
                // a teacher with back-to-back classes) is ambiguous — resolveTranscriptStudent
                // disambiguates by exact name, then by which class just finished relative to
                // the email, and only trusts a single candidate if the AI name doesn't
                // contradict it.
                const toMadridNaive = ms => new Date(ms)
                    .toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' })
                    .replace(' ', 'T');
                const emailDate = toMadridNaive(emailMs);
                const windowStart = toMadridNaive(emailMs - 6 * 60 * 60 * 1000);
                const slotMatches = await db.query(
                    `SELECT student_id, start_datetime, end_datetime FROM available_slots
                     WHERE teacher_id = $1 AND is_booked = TRUE AND student_id IS NOT NULL
                       AND start_datetime <= $2 AND start_datetime >= $3`,
                    [teacher.id, emailDate, windowStart]
                );
                const candidateSlots = (slotMatches.rows || []).map(r => ({
                    studentId: r.student_id,
                    startDatetime: r.start_datetime,
                    endDatetime: r.end_datetime
                }));

                const exactMatch = resolveTranscriptStudent({
                    candidateSlots,
                    students,
                    aiGuessedName: analysisData.student_name,
                    emailArrivalNaive: emailDate
                });

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

                // Build and save chat message
                const chatMessage = buildTranscriptSummaryCard(analysisData, recordingLink);

                const transactionResult = await db.withTransaction(async tx => {
                    if (!roomId) {
                        const newRoom = await tx.query(
                            isPostgres
                                ? `INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', $2, NOW()) RETURNING id`
                                : `INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', $2, datetime('now'))`,
                            [teacher.academy_id, `${teacher.name} - ${student.name}`]
                        );
                        roomId = isPostgres && newRoom.rows ? newRoom.rows[0].id : newRoom.lastID;
                        const memberSql = isPostgres
                            ? 'INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING'
                            : 'INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES ($1, $2)';
                        await tx.query(memberSql, [roomId, teacher.id]);
                        await tx.query(memberSql, [roomId, studentUserId]);
                    }

                    await tx.query(
                        isPostgres
                            ? `INSERT INTO messages (room_id, sender_id, academy_id, content, type, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`
                            : `INSERT INTO messages (room_id, sender_id, academy_id, content, type, created_at) VALUES ($1, $2, $3, $4, $5, datetime('now'))`,
                        [roomId, teacher.id, teacher.academy_id, chatMessage, 'html_card']
                    );

                    const transcriptInsert = await tx.query(
                        isPostgres
                            ? 'INSERT INTO transcripts (academy_id, teacher_id, student_id, raw_text, processed_json, gmail_msg_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id'
                            : 'INSERT INTO transcripts (academy_id, teacher_id, student_id, raw_text, processed_json, gmail_msg_id) VALUES ($1, $2, $3, $4, $5, $6)',
                        [teacher.academy_id, teacher.id, student.id, body.substring(0, 5000), JSON.stringify(analysisData), msg.id]
                    );
                    const transcriptId = transcriptInsert.rows?.[0]?.id || transcriptInsert.lastID || transcriptInsert.insertId || null;

                    const reminder = await createHomeworkReminderFromTranscript({
                        academyId: teacher.academy_id,
                        teacherId: teacher.id,
                        studentId: student.id,
                        transcriptId,
                        processed: analysisData,
                        dbRunner: tx
                    });

                    let promptHtml = null;
                    if (reminder) {
                        promptHtml = buildHomeworkReminderPrompt(reminder.id, reminder.homeworkList);
                        await tx.query(
                            isPostgres
                                ? `INSERT INTO messages (room_id, sender_id, academy_id, content, type, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`
                                : `INSERT INTO messages (room_id, sender_id, academy_id, content, type, created_at) VALUES ($1, $2, $3, $4, $5, datetime('now'))`,
                            [roomId, teacher.id, teacher.academy_id, promptHtml, 'html_card']
                        );
                    }

                    return { transcriptId, promptHtml };
                });
                const { transcriptId, promptHtml } = transactionResult;
                console.log('[Gmail] Transcript saved for student:', student.name);

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
                    type:        'html_card',
                    created_at:  new Date().toISOString()
                });

                if (promptHtml) {
                    io.to(`room_${roomId}`).emit('new_message', {
                        room_id:     roomId,
                        sender_id:   teacher.id,
                        sender_name: teacher.name,
                        sender_role: 'teacher',
                        content:     promptHtml,
                        type:        'html_card',
                        created_at:  new Date().toISOString()
                    });
                }

                processed++;
                console.log(`[Gmail] Processed transcript for student ${student.name}`);
            } catch (err) {
                console.error('[Gmail] Error processing email:', err.message);
                stallReason = stallReason || `error al procesar el correo (${err.message})`;
            }
        }

        // Emails waiting but none got through: nobody would notice otherwise.
        if (messages.length > 0 && processed === 0 && skipped < messages.length) {
            const pending = messages.length - skipped;
            console.warn(`[Gmail] Stalled: ${pending} pending, 0 processed — ${stallReason || 'motivo desconocido'}`);
            await alertAdmins(teacher,
                '⚠️ Transcripciones sin procesar',
                `${pending} transcripción(es) de ${teacher.name} no se han podido procesar: ${stallReason || 'motivo desconocido'}. Revisa los registros del servicio.`
            );
        }

        // Update last_check:
        // - If we fetched real emails: set to just before the oldest in the batch.
        //   Dedup (gmail_msg_id unique index) skips already-processed ones;
        //   failed emails remain in range for the next cron run.
        // - If all messages were duplicates (batchEarliestMs still null): advance to
        //   NOW() to avoid infinite rescanning of the same already-processed range.
        // Gmail returns newest-first, so emails we never reached are OLDER than anything
        // fetched. Moving the window at all would drop them permanently — leave it alone
        // and let the next run re-query the same range (already-saved ones are deduped).
        if (stoppedEarly) {
            console.log(`[Gmail] Window kept at ${new Date(lastCheck * 1000).toISOString()} — pending emails remain`);
        } else if (batchEarliestMs) {
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
