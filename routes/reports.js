'use strict';
const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const PDFDocument = require('pdfkit');
const path        = require('path');
const fs          = require('fs');
const { Resend }  = require('resend');
const groqClient  = require('../services/groq');
const { authenticateJWT }                      = require('../middleware/auth');
const { requireStudent, requireTeacherOrAdmin } = require('../middleware/roles');
const { createNotification }                   = require('../notifications');

router.get('/student/reports', authenticateJWT, requireStudent, (req, res, next) => {
    db.query('SELECT * FROM reports WHERE student_id = (SELECT id FROM students WHERE user_id = $1) ORDER BY year DESC, month DESC', [req.user.id], (err, result) => {
        if (err) return next(err);
        const rows = result.rows;
        const monthsNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const formatted = rows.map(r => ({
            ...r,
            monthName: monthsNames[r.month - 1],
            url: r.file_url
        }));
        res.json(formatted);
    });
});

router.get('/reports/student/:id', authenticateJWT, async (req, res, next) => {
    try {
        // Verify student belongs to the caller's academy
        const ownershipQ = req.user.role === 'student'
            ? await db.query('SELECT id FROM students WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])
            : await db.query('SELECT id FROM students WHERE id=$1 AND academy_id=$2', [req.params.id, req.user.academy_id]);
        if (!ownershipQ.rows.length) return res.status(403).json({ error: 'Acceso denegado' });

        const result = await db.query('SELECT * FROM reports WHERE student_id=$1 ORDER BY year DESC, month DESC', [req.params.id]);
        const monthsNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        res.json(result.rows.map(r => ({ ...r, monthName: monthsNames[r.month - 1], url: r.file_url })));
    } catch (err) {
        next(err);
    }
});

// AI Report Generation
router.post('/generate-report', authenticateJWT, requireTeacherOrAdmin, async (req, res, next) => {
    try {
        const { student_id, studentId, month, year, observations, send_email, sendEmail } = req.body;
        const sid = student_id || studentId;
        const sendMail = send_email !== undefined ? send_email : sendEmail;
        const monthNum = parseInt(month) || new Date().getMonth() + 1;
        const yearNum = parseInt(year) || new Date().getFullYear();
        const monthsNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const monthText = monthsNames[monthNum - 1];
        const monthStart = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
        const monthEnd = new Date(yearNum, monthNum, 0).toISOString().split('T')[0];

        // Access control: teachers can only see their own students
        const studentQ = req.user.role === 'teacher'
            ? await db.query('SELECT * FROM students WHERE id=$1 AND academy_id=$2 AND assigned_teacher_id=$3', [sid, req.user.academy_id, req.user.id])
            : await db.query('SELECT * FROM students WHERE id=$1 AND academy_id=$2', [sid, req.user.academy_id]);
        const student = studentQ.rows[0];
        if (!student) return res.status(404).json({ error: 'Alumno no encontrado o sin acceso' });

        // Fetch data in parallel
        const [sessionsR, examsR, simsR] = await Promise.all([
            db.query('SELECT * FROM sessions WHERE student_id=$1 AND date>=$2 AND date<=$3 ORDER BY date', [sid, monthStart, monthEnd]),
            db.query('SELECT * FROM exams WHERE student_id=$1 AND date>=$2 AND date<=$3 ORDER BY date', [sid, monthStart, monthEnd]),
            db.query("SELECT * FROM simulator_results WHERE student_id=$1 AND created_at::text LIKE $2", [sid, `${yearNum}-${String(monthNum).padStart(2, '0')}%`]).catch(() => ({ rows: [] }))
        ]);
        const sessions = sessionsR.rows || [];
        const exams = examsR.rows || [];
        const sims = simsR.rows || [];

        const homeworkRate = sessions.length ? Math.round(sessions.filter(s => s.homework_done).length / sessions.length * 100) : 0;
        const avgScore = exams.length ? (exams.reduce((s, e) => s + (e.score || 0), 0) / exams.length).toFixed(1) : null;
        const examDetails = exams.map(e => `${e.subject}: ${e.score ?? 'Pendiente'}`).join(', ');
        const simDetails = sims.map(s => `${s.topic} (${s.percentage}%)${s.teacher_grade ? ' - Nota: ' + s.teacher_grade : ''}`).join(', ');

        // Generate AI text
        const aiResponse = await groqClient.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Eres el tutor de una academia de repaso española. Genera un informe mensual profesional y cercano para la familia. Tono cálido pero profesional. Estructura: saludo personalizado, resumen positivo del mes, análisis de exámenes, áreas de mejora, próximos objetivos, cierre motivador. Máximo 250 palabras. Siempre en español.' },
                { role: 'user', content: `Estudiante: ${student.name}, Curso: ${student.course || '-'}, Asignatura: ${student.subject || '-'}. Sesiones este mes: ${sessions.length}. Tareas completadas: ${homeworkRate}%. Notas exámenes: ${examDetails || 'Ninguno'}. Simulacros: ${simDetails || 'Ninguno'}. Observaciones: ${observations || 'Sin observaciones adicionales'}.` }
            ],
            max_tokens: 500
        });
        const reportText = aiResponse.choices[0].message.content;

        // Generate PDF
        const reportsDir = path.join(__dirname, '..', 'public/uploads/reports');
        if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
        const safeName = student.name.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚüÜñÑ]/g, '_').substring(0, 50);
        const fileName = `informe_${safeName}_${monthNum}_${yearNum}_${Date.now()}.pdf`;
        const filePath = path.join(reportsDir, fileName);
        const fileUrl = `/uploads/reports/${fileName}`;

        await new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50 });
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // Header
            doc.rect(0, 0, doc.page.width, 100).fill('#6366f1');
            doc.fillColor('white').fontSize(24).font('Helvetica-Bold').text('AcademiaPro', 50, 30);
            doc.fontSize(14).font('Helvetica').text(`Informe mensual — ${monthText} ${yearNum}`, 50, 62);

            // Student info
            doc.fillColor('#1e293b').fontSize(18).font('Helvetica-Bold').text(student.name, 50, 120);
            doc.fillColor('#64748b').fontSize(12).font('Helvetica').text(`${student.course || ''} · ${student.subject || ''}`, 50, 145);

            // Divider
            doc.moveTo(50, 170).lineTo(doc.page.width - 50, 170).strokeColor('#e2e8f0').lineWidth(1).stroke();

            // Stats
            doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').text('Resumen del mes', 50, 185);
            doc.fillColor('#374151').fontSize(12).font('Helvetica')
                .text(`• Sesiones realizadas: ${sessions.length}`, 50, 210)
                .text(`• Deberes entregados: ${homeworkRate}%`, 50, 230)
                .text(`• Nota media: ${avgScore || 'Sin exámenes'}`, 50, 250);

            // Divider
            doc.moveTo(50, 275).lineTo(doc.page.width - 50, 275).strokeColor('#e2e8f0').lineWidth(1).stroke();

            // AI text
            doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').text('Informe del tutor', 50, 290);
            doc.fillColor('#374151').fontSize(11).font('Helvetica').text(reportText, 50, 315, { width: doc.page.width - 100, lineGap: 4 });

            // Exams on next page if present
            if (exams.length > 0) {
                doc.addPage();
                doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').text('Exámenes del mes', 50, 50);
                let y = 80;
                exams.forEach(exam => {
                    doc.fillColor('#374151').fontSize(12).font('Helvetica')
                        .text(`• ${exam.subject}: ${exam.score ?? 'Pendiente'} — ${exam.date}`, 50, y);
                    y += 22;
                });
            }

            // Simulacros
            if (sims.length > 0) {
                if (exams.length === 0) doc.addPage();
                doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').moveDown(2).text('Simulacros del mes');
                sims.forEach(s => {
                    let t = `• ${s.topic}: ${s.percentage}%`;
                    if (s.teacher_grade) t += ` (Nota: ${s.teacher_grade}/10)`;
                    doc.fillColor('#374151').fontSize(12).font('Helvetica').text(t);
                });
            }

            // Footer
            doc.fillColor('#94a3b8').fontSize(10)
                .text(`Generado por AcademiaPro · ${new Date().toLocaleDateString('es-ES')}`, 50, doc.page.height - 40, { align: 'center' });

            doc.end();
            stream.on('finish', resolve);
            stream.on('error', reject);
        });

        // Save record
        await db.query(
            'INSERT INTO reports (student_id, academy_id, month, year, file_url, created_at) VALUES ($1,$2,$3,$4,$5,NOW())',
            [sid, req.user.academy_id, monthNum, yearNum, fileUrl]
        ).catch(err => console.error('[Report] DB record insert failed:', err.message));

        // Send email
        let emailSent = false;
        if (sendMail && student.parent_email) {
            try {
                const resend = new Resend(process.env.RESEND_API_KEY);
                const pdfBuffer = fs.readFileSync(filePath);
                await resend.emails.send({
                    from: 'AcademiaPro <no-reply@academiapro.academy>',
                    to: student.parent_email,
                    subject: `Informe mensual de ${student.name} — ${monthText} ${yearNum}`,
                    html: `<div style="font-family:Inter,sans-serif;max-width:500px;margin:0 auto;"><div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;border-radius:12px 12px 0 0;text-align:center;"><h1 style="color:white;margin:0;font-size:22px;">🎓 AcademiaPro</h1></div><div style="background:white;padding:32px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;"><p style="color:#1e293b">Estimada familia,</p><p style="color:#64748b">Adjunto encontrarás el informe mensual de <strong>${student.name}</strong> correspondiente a <strong>${monthText} ${yearNum}</strong>.</p><p style="color:#94a3b8;font-size:13px;margin-top:24px;">AcademiaPro · La plataforma inteligente para academias</p></div></div>`,
                    attachments: [{ filename: fileName, content: pdfBuffer.toString('base64') }]
                });
                emailSent = true;
                await db.query('INSERT INTO sent_reports (academy_id, student_id, month, year) VALUES ($1,$2,$3,$4)', [req.user.academy_id, sid, monthNum, yearNum]).catch(err => console.error('[Report] sent_reports insert failed:', err.message));
            } catch (emailErr) {
                console.error('[Report] Email error:', emailErr.message);
            }
        }

        // Notify student if they have an account
        if (student.user_id) {
            createNotification(student.user_id, req.user.academy_id, 'report',
                '📊 Nuevo informe disponible',
                `Tu informe de ${monthText} ${yearNum} ya está listo.`,
                fileUrl
            );
        }

        res.json({
            success: true,
            file_url: fileUrl,
            email_sent: emailSent,
            message: emailSent ? `Informe generado y enviado a ${student.parent_email}` : 'Informe generado correctamente'
        });

    } catch (err) {
        console.error('[Report] Error:', err.message);
        next(err);
    }
});

module.exports = router;
