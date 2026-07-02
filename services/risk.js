'use strict';

const db                   = require('../db');
const { createNotification } = require('../notifications');

const checkStudentRisk = (studentId) => {
    db.query(`SELECT * FROM students WHERE id = $1`, [studentId], (err, result) => {
        const student = result?.rows[0];
        if (err || !student) return;
        db.query(`SELECT homework_done FROM sessions WHERE student_id = $1 ORDER BY date DESC LIMIT 3`, [studentId], (err, resSessions) => {
            const sessions = resSessions?.rows || [];
            if (!err && sessions.length >= 3) {
                const allNoHomework = sessions.every(s => !s.homework_done);
                if (allNoHomework) {
                    db.query(`UPDATE students SET status = 'at_risk' WHERE id = $1`, [studentId]);
                    notifyAtRisk(studentId, 'No entrega deberes (3 sesiones seguidas)');
                    return;
                }
            }
            db.query(`SELECT score FROM exams WHERE student_id = $1 ORDER BY date DESC LIMIT 4`, [studentId], (err, resExams) => {
                const exams = resExams?.rows || [];
                if (!err && exams.length >= 4) {
                    const scores = exams.slice(0, 4).map(e => e.score);
                    const validScores = scores.filter(s => s !== null && s !== undefined && !isNaN(Number(s)));
                    if (validScores.length < 4) return;
                    const last2Avg = (validScores[0] + validScores[1]) / 2;
                    const prev2Avg = (validScores[2] + validScores[3]) / 2;
                    if (last2Avg < prev2Avg) {
                        db.query(`UPDATE students SET status = 'at_risk' WHERE id = $1`, [studentId]);
                        notifyAtRisk(studentId, 'Bajada de notas en los últimos exámenes');
                    }
                }
            });
        });
    });
};

async function notifyAtRisk(studentId, reason) {
    try {
        const r = await db.query(
            `SELECT s.name, s.academy_id, s.assigned_teacher_id,
                    u_admin.id AS admin_id
             FROM students s
             LEFT JOIN users u_admin ON u_admin.academy_id = s.academy_id AND u_admin.role = 'admin'
             WHERE s.id = $1 LIMIT 1`,
            [studentId]
        );
        const row = r.rows[0];
        if (!row) return;
        const title = `⚠️ Alumno en riesgo: ${row.name}`;
        const msg   = reason;
        if (row.admin_id)            createNotification(row.admin_id,            row.academy_id, 'at_risk', title, msg, null);
        if (row.assigned_teacher_id) createNotification(row.assigned_teacher_id, row.academy_id, 'at_risk', title, msg, null);
    } catch (e) {
        console.error('[notifyAtRisk]', e.message);
    }
}

// ponytail: 14 days = ~2 missed weekly sessions; tune INACTIVITY_DAYS if cadence differs.
const INACTIVITY_DAYS = 14;

// Daily sweep: flag active students whose last session is older than INACTIVITY_DAYS
// (or who have never had one) as at_risk. checkStudentRisk only fires on writes, so a
// student who simply stops showing up would never be caught without this.
async function checkInactivityRisk(now = new Date()) {
    const cutoff = new Date(now.getTime() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];
    let flagged = 0;
    try {
        const r = await db.query(
            `SELECT s.id
             FROM students s
             LEFT JOIN (SELECT student_id, MAX(date) AS last_date FROM sessions GROUP BY student_id) se
                    ON se.student_id = s.id
             WHERE s.status = 'active'
               AND (se.last_date IS NULL OR se.last_date < $1)`,
            [cutoff]
        );
        for (const row of (r.rows || [])) {
            await db.query("UPDATE students SET status = 'at_risk' WHERE id = $1", [row.id]);
            await notifyAtRisk(row.id, `Sin sesiones en los últimos ${INACTIVITY_DAYS} días`);
            flagged++;
        }
    } catch (e) {
        console.error('[checkInactivityRisk]', e.message);
    }
    return flagged;
}

module.exports = { checkStudentRisk, notifyAtRisk, checkInactivityRisk };
