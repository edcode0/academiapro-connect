'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const isProd  = process.env.NODE_ENV === 'production';
const serverErr = (res, err) => { console.error(err); res.status(500).json({ error: isProd ? 'Error interno del servidor' : err.message }); };
const { authenticateJWT }                        = require('../middleware/auth');
const { requireStudent, requireTeacherOrAdmin }  = require('../middleware/roles');
const groqClient    = require('../services/groq');
const { checkStudentRisk } = require('../services/risk');

router.post('/api/exam-simulator/generate', authenticateJWT, requireStudent, async (req, res, next) => {
    try {
        const { topic, difficulty, numQuestions, course } = req.body;
        const prompt = `Genera un examen de ${topic} para ${course} con ${numQuestions} preguntas de nivel ${difficulty}.
        Formato JSON estricto:
        {
          "title": "título del examen",
          "questions": [
            {
              "question": "enunciado de la pregunta",
              "type": "multiple_choice" or "open",
              "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
              "correct_answer": "A" or "respuesta completa",
              "explanation": "explicación de la respuesta correcta"
            }
          ]
        }`;

        const apiResponse = await groqClient.chat.completions.create({
            model: "deepseek-chat",
            messages: [
                { role: 'system', content: 'Eres un generador de exámenes que responde ÚNICA Y EXCLUSIVAMENTE con un JSON válido en español. No añadas texto explicativo, ni Markdown (tampoco ```json), sólo devuelve las llaves { } del JSON y su contenido. El formato de options para multiple_choice debe ser un array de 4 strings que empiecen con "A) ", "B) ", "C) " y "D) ".' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.5,
            response_format: { type: "json_object" }
        });

        const jsonContent = JSON.parse(apiResponse.choices[0].message.content);
        res.json(jsonContent);
    } catch (err) {
        serverErr(res, err);
    }
});

router.get('/api/exams', authenticateJWT, (req, res, next) => {
    let sql = 'SELECT e.*, st.name as student_name FROM exams e JOIN students st ON e.student_id = st.id WHERE st.academy_id = $1';
    let params = [req.user.academy_id];

    if (req.user.role === 'teacher') {
        sql += ' AND st.assigned_teacher_id = $2';
        params.push(req.user.id);
    }

    db.query(sql + ' ORDER BY e.date DESC', params, (err, result) => {
        if (err) return serverErr(res, err);
        res.json(result.rows);
    });
});

router.get('/api/exams-list', authenticateJWT, (req, res, next) => {
    let sql = 'SELECT e.*, st.name as student_name FROM exams e JOIN students st ON e.student_id = st.id WHERE st.academy_id = $1';
    let params = [req.user.academy_id];

    if (req.user.role === 'teacher') {
        sql += ' AND st.assigned_teacher_id = $2';
        params.push(req.user.id);
    }

    db.query(sql + ' ORDER BY e.date DESC', params, (err, result) => {
        if (err) return serverErr(res, err);
        const rows = result.rows;

        const stats = {
            totalExams: rows.length,
            avgScore: rows.length > 0 ? (rows.reduce((acc, e) => acc + e.score, 0) / rows.length).toFixed(1) : 0,
            passRate: rows.length > 0 ? Math.round((rows.filter(e => e.score >= 5).length / rows.length) * 100) : 0
        };

        res.json({ exams: rows, stats });
    });
});

// Enriched exams data for exams.html (ranking + stats)
router.get('/api/exams-data', authenticateJWT, async (req, res, next) => {
    try {
        let sql = 'SELECT e.*, st.name as student_name, st.id as student_id FROM exams e JOIN students st ON e.student_id = st.id WHERE st.academy_id = $1';
        let params = [req.user.academy_id];
        if (req.user.role === 'teacher') {
            sql += ' AND st.assigned_teacher_id = $2';
            params.push(req.user.id);
        }
        const result = await db.query(sql + ' ORDER BY e.date DESC', params);
        const exams = result.rows || [];

        const thisMonth = new Date().toISOString().slice(0, 7);
        const scored = exams.filter(e => e.score != null);
        const avgScore = scored.length > 0 ? (scored.reduce((s, e) => s + e.score, 0) / scored.length).toFixed(1) : '0.0';
        const failingCount = scored.filter(e => e.score < 5).length;
        const thisMonthCount = exams.filter(e => (e.date || '').startsWith(thisMonth)).length;

        // Group by student for ranking
        const byStudent = {};
        exams.forEach(e => {
            if (!byStudent[e.student_id]) byStudent[e.student_id] = { student_id: e.student_id, student_name: e.student_name, scores: [], subjects: [] };
            if (e.score != null) byStudent[e.student_id].scores.push(e.score);
            if (e.subject) byStudent[e.student_id].subjects.push(e.subject);
        });

        let bestStudent = '-', bestAvg = -1;
        Object.values(byStudent).forEach(s => {
            if (s.scores.length > 0) {
                const avg = s.scores.reduce((a, b) => a + b, 0) / s.scores.length;
                if (avg > bestAvg) { bestAvg = avg; bestStudent = s.student_name; }
            }
        });

        const ranking = Object.values(byStudent).map(s => {
            const avg = s.scores.length > 0 ? (s.scores.reduce((a, b) => a + b, 0) / s.scores.length).toFixed(1) : '0.0';
            let trend = '→';
            if (s.scores.length >= 2) trend = s.scores[0] > s.scores[1] ? '↑' : (s.scores[0] < s.scores[1] ? '↓' : '→');
            const subjectFreq = {};
            s.subjects.forEach(sub => { subjectFreq[sub] = (subjectFreq[sub] || 0) + 1; });
            const main_subject = Object.entries(subjectFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
            return { student_id: s.student_id, student_name: s.student_name, avg_score: parseFloat(avg), total_exams: s.scores.length, main_subject, trend };
        }).sort((a, b) => b.avg_score - a.avg_score);

        res.json({ exams, ranking, stats: { avgScore, failingCount, thisMonthCount, bestStudent } });
    } catch (err) {
        serverErr(res, err);
    }
});

router.post('/api/simulator/results', authenticateJWT, (req, res, next) => {
    const { topic, difficulty, num_questions, score, max_score, percentage, questions_json, answers_json } = req.body;

    db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id], (err, sRes) => {
        const student = sRes?.rows[0];
        if (!student) return res.status(403).json({ error: 'Perfil de estudiante no encontrado' });

        const sql = `INSERT INTO simulator_results
            (student_id, topic, difficulty, num_questions, score, max_score, percentage, questions_json, answers_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
        db.query(sql, [student.id, topic, difficulty, num_questions, score, max_score, percentage, JSON.stringify(questions_json), JSON.stringify(answers_json)], (err, result) => {
            if (err) return serverErr(res, err);
            res.json({ success: true, id: result.lastID });
        });
    });
});

// Get simulator results for a student (Teacher/Admin access) — specific before /:id
router.get('/api/simulator/results/student/:studentId', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT sr.* FROM simulator_results sr
             JOIN students s ON sr.student_id = s.id
             WHERE sr.student_id = $1 AND s.academy_id = $2
             ORDER BY sr.created_at DESC`,
            [req.params.studentId, req.user.academy_id]
        );
        res.json(result.rows || []);
    } catch (err) {
        serverErr(res, err);
    }
});

// Get single result detail
router.get('/api/simulator/results/:id', authenticateJWT, async (req, res, next) => {
    try {
        // Students may only read their own results; teachers/admins any in their academy
        const result = req.user.role === 'student'
            ? await db.query(
                `SELECT sr.* FROM simulator_results sr
                 JOIN students s ON sr.student_id = s.id
                 WHERE sr.id = $1 AND s.academy_id = $2 AND s.user_id = $3`,
                [req.params.id, req.user.academy_id, req.user.id])
            : await db.query(
                `SELECT sr.* FROM simulator_results sr
                 JOIN students s ON sr.student_id = s.id
                 WHERE sr.id = $1 AND s.academy_id = $2`,
                [req.params.id, req.user.academy_id]);
        const row = result.rows[0];
        if (!row) return res.status(404).json({ error: 'Resultado no encontrado' });
        row.questions = JSON.parse(row.questions_json || '[]');
        row.answers = JSON.parse(row.answers_json || '[]');
        res.json(row);
    } catch (err) {
        serverErr(res, err);
    }
});

// Teacher grade simulator result
router.put('/api/simulator/results/:id/grade', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const { teacher_grade, teacher_feedback } = req.body;
        const result = await db.query(
            `UPDATE simulator_results sr SET teacher_grade = $1, teacher_feedback = $2, graded_at = CURRENT_TIMESTAMP
             WHERE sr.id = $3 AND sr.student_id IN (SELECT id FROM students WHERE academy_id = $4)`,
            [teacher_grade, teacher_feedback, req.params.id, req.user.academy_id]
        );
        if ((result.rowCount ?? result.changes ?? 0) === 0) return res.status(404).json({ error: 'Resultado no encontrado' });
        res.json({ success: true });
    } catch (err) {
        serverErr(res, err);
    }
});

// GET exams for current student — specific before /:id
router.get('/api/exams/student', authenticateJWT, async (req, res, next) => {
    try {
        const sRes = await db.query('SELECT id FROM students WHERE user_id = $1 AND academy_id = $2', [req.user.id, req.user.academy_id]);
        const student = sRes.rows?.[0];
        if (!student) return res.status(403).json({ error: 'Perfil de estudiante no encontrado' });
        const result = await db.query('SELECT * FROM exams WHERE student_id = $1 ORDER BY date DESC', [student.id]);
        res.json(result.rows || []);
    } catch (err) {
        serverErr(res, err);
    }
});

// POST new exam (student adding it)
router.post('/api/exams/student', authenticateJWT, (req, res, next) => {
    const { subject, date, score, notes } = req.body;
    console.log(`[ExamSave] Student ${req.user.id} attempting to save exam:`, { subject, date, score });

    db.query('SELECT id, academy_id, assigned_teacher_id, name FROM students WHERE user_id = $1', [req.user.id], (err, sRes) => {
        if (err) {
            console.error('[ExamSave] Student lookup error:', err);
            return res.status(500).json({ error: 'Database error searching for student profile' });
        }

        const student = sRes?.rows[0];
        if (!student) {
            console.error('[ExamSave] Student profile not found for user ID:', req.user.id);
            return res.status(403).json({ error: 'Tu usuario no tiene un perfil de estudiante vinculado.' });
        }

        console.log(`[ExamSave] Found student profile: ${student.id}, Name: ${student.name}`);

        db.query('INSERT INTO exams (student_id, subject, date, score, notes) VALUES ($1, $2, $3, $4, $5)', [student.id, subject, date, score, notes], (err, result) => {
            if (err) {
                console.error('[ExamSave] Insert exam error:', err);
                return res.status(500).json({ error: 'Error al insertar el examen en la base de datos: ' + err.message });
            }

            const examId = result.lastID;
            console.log(`[ExamSave] Exam saved successfully with ID: ${examId}`);

            // Automatically add to teacher's calendar as a red event if teacher is assigned
            if (student.assigned_teacher_id) {
                console.log(`[ExamSave] Student has teacher assigned (${student.assigned_teacher_id}). Attempting calendar sync...`);
                try {
                    const startTime = `${date}T09:00:00`;
                    const endTime = `${date}T10:00:00`;
                    const title = `📝 Examen: ${subject} - ${student.name}`;

                    db.query('INSERT INTO available_slots (teacher_id, academy_id, start_datetime, end_datetime, is_booked, student_id, notes) VALUES ($1, $2, $3, $4, 1, $5, $6)',
                        [student.assigned_teacher_id, student.academy_id, startTime, endTime, student.id, title], (calErr) => {
                            if (calErr) console.error('[ExamSave] Teacher calendar event creation failed:', calErr);
                            else console.log('[ExamSave] Teacher calendar event created successfully.');
                        });
                } catch (calCatch) {
                    console.error('[ExamSave] Exception in calendar sync block:', calCatch);
                }
            } else {
                console.log('[ExamSave] No teacher assigned, skipping calendar sync.');
            }

            // Trigger risk detection if score added
            if (score !== null) {
                console.log('[ExamSave] Score provided, triggering risk detection...');
                try {
                    checkStudentRisk(student.id);
                } catch (riskErr) {
                    console.error('[ExamSave] Risk detection failed:', riskErr);
                }
            }

            res.json({ success: true, id: examId });
        });
    });
});

// Update score for existing exam
router.put('/api/exams/:id/score', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const { score } = req.body;
        const result = await db.query(
            `UPDATE exams SET score = $1
             WHERE id = $2 AND student_id IN (SELECT id FROM students WHERE academy_id = $3)`,
            [score, req.params.id, req.user.academy_id]
        );
        if ((result.rowCount ?? result.changes ?? 0) === 0) return res.status(404).json({ error: 'Examen no encontrado' });

        const resId = await db.query('SELECT student_id FROM exams WHERE id = $1', [req.params.id]);
        const studentId = resId.rows?.[0]?.student_id;
        if (studentId) checkStudentRisk(studentId);

        res.json({ success: true });
    } catch (err) {
        serverErr(res, err);
    }
});

router.post('/api/exams', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const { student_id, subject, score, date, notes } = req.body;
        // Verify student belongs to the same academy before inserting
        const ownerCheck = await db.query(
            'SELECT id FROM students WHERE id = $1 AND academy_id = $2',
            [student_id, req.user.academy_id]
        );
        if (!(ownerCheck.rows?.[0] ?? ownerCheck[0])) {
            return res.status(403).json({ error: 'Estudiante no pertenece a esta academia' });
        }
        const result = await db.query(
            'INSERT INTO exams (student_id, subject, score, date, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [student_id, subject, score || null, date || new Date().toISOString().split('T')[0], notes || '']
        );
        res.json(result.rows[0]);
    } catch (err) {
        serverErr(res, err);
    }
});

router.put('/api/exams/:id', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const { subject, score, date, notes } = req.body;
        const result = await db.query(
            `UPDATE exams SET subject=$1, score=$2, date=$3, notes=$4
             WHERE id=$5 AND student_id IN (SELECT id FROM students WHERE academy_id=$6) RETURNING *`,
            [subject, score, date, notes, req.params.id, req.user.academy_id]
        );
        res.json(result.rows[0] || { updated: 0 });
    } catch (err) {
        serverErr(res, err);
    }
});

router.delete('/api/exams/:id', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        await db.query(
            'DELETE FROM exams WHERE id=$1 AND student_id IN (SELECT id FROM students WHERE academy_id=$2)',
            [req.params.id, req.user.academy_id]
        );
        res.json({ success: true });
    } catch (err) {
        serverErr(res, err);
    }
});

module.exports = router;
