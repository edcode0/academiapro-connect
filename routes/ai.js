'use strict';

const express   = require('express');
const router    = express.Router();
const db        = require('../db');
const path      = require('path');
const fs        = require('fs');
const multer    = require('multer');
const PDFDocument              = require('pdfkit');
const groqClient               = require('../services/groq');
const { authenticateJWT }      = require('../middleware/auth');
const { requireStudent, requireTeacherOrAdmin } = require('../middleware/roles');

const isPostgres = db.isPostgres;

router.post('/api/ai-tutor/extract-pdf', authenticateJWT, async (req, res, next) => {
    const uploadMem = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 }
    }).single('pdf');

    uploadMem(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No PDF recibido' });

        try {
            const pdf = require('pdf-parse');
            const data = await pdf(req.file.buffer);
            const text = data.text.trim().substring(0, 8000);
            res.json({ text, pages: data.numpages, filename: req.file.originalname });
        } catch (e) {
            console.error('pdf-parse error:', e);
            res.status(500).json({ error: 'Error leyendo PDF: ' + e.message });
        }
    });
});

router.post('/api/ai-tutor/chat', authenticateJWT, async (req, res, next) => {
    const { messages: rawMessages, conversationId: clientConversationId } = req.body;
    let systemPrompt = "Eres un asistente educativo inteligente de AcademiaPro. Ayudas a estudiantes con cualquier materia y duda académica. Explicas conceptos de forma clara y adaptada al nivel del alumno. Eres paciente, motivador y pedagógico. Responde SIEMPRE en español.";

    try {
        if (req.user.role === 'teacher') {
            systemPrompt = "Eres un asistente pedagógico inteligente de AcademiaPro. Ayudas a profesores a preparar clases, crear ejercicios, explicar conceptos difíciles, gestionar alumnos y mejorar su metodología docente. Responde SIEMPRE en español.";
        }

        // Strip any messages with non-standard roles (prompt injection guard)
        const messages = (rawMessages || []).filter(m => m.role === 'user' || m.role === 'assistant');

        // Extract user message before anything else
        const userMessage = messages[messages.length - 1]?.content || '';
        const userMessageStr = typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage);

        // Use conversation from client if provided and it belongs to this user
        let conversationId = clientConversationId ? parseInt(clientConversationId) : null;

        if (conversationId) {
            const convCheck = await db.query(
                'SELECT id FROM ai_conversations WHERE id = $1 AND user_id = $2',
                [conversationId, req.user.id]
            );
            if (!convCheck.rows.length) conversationId = null; // reject cross-user access
        }

        if (!conversationId) {
          const newConv = await db.query(
            'INSERT INTO ai_conversations (user_id, academy_id, title, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id',
            [req.user.id, req.user.academy_id, userMessageStr.substring(0, 50)]
          );
          conversationId = newConv.rows[0].id;
        } else {
          // Update updated_at on existing conversation
          await db.query('UPDATE ai_conversations SET updated_at = NOW() WHERE id = $1', [conversationId]).catch(err => console.error('[AI Tutor] Conversation timestamp update failed:', err.message));
        }

        // Save user message BEFORE calling AI
        await db.query(
          'INSERT INTO ai_messages (conversation_id, role, content, created_at) VALUES ($1, $2, $3, NOW())',
          [conversationId, 'user', userMessageStr]
        );

        // Check if any message contains a doc/image object (like PDF base64).
        const hasComplexContent = messages.some(m => Array.isArray(m.content));
        const modelToUse = hasComplexContent ? "llama-3.2-11b-vision-preview" : "llama-3.3-70b-versatile";

        let apiResponse;
        try {
            apiResponse = await groqClient.chat.completions.create({
                model: modelToUse,
                messages: [{ role: 'system', content: systemPrompt }, ...messages],
                temperature: 0.7,
                max_tokens: 1024,
            });
        } catch (groqErr) {
            console.error('[ai-tutor/chat] Groq error:', groqErr.message);
            return res.status(503).json({
                error: 'El asistente IA no está disponible en este momento. Por favor, inténtalo de nuevo en unos minutos.',
                conversationId
            });
        }

        const aiResponse = apiResponse.choices[0].message.content;

        // Save AI response
        await db.query(
          'INSERT INTO ai_messages (conversation_id, role, content, created_at) VALUES ($1, $2, $3, NOW())',
          [conversationId, 'assistant', aiResponse]
        );

        res.json({ response: aiResponse, conversationId });
    } catch (e) {
        console.error('[ai-tutor/chat] ERROR:', e.message, e.stack);
        res.status(500).json({ error: 'Error interno del servidor. Por favor, inténtalo de nuevo.' });
    }
});

router.get('/api/ai-tutor/history', authenticateJWT, async (req, res, next) => {
  try {
    const convResult = await db.query(
      'SELECT id FROM ai_conversations WHERE user_id = $1 AND academy_id = $2 ORDER BY created_at DESC LIMIT 1',
      [req.user.id, req.user.academy_id]
    );
    const conv = convResult.rows?.[0];
    if (!conv) return res.json({ messages: [], conversationId: null });

    const messagesResult = await db.query(
      'SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conv.id]
    );
    res.json({ messages: messagesResult.rows || [], conversationId: conv.id });
  } catch(err) {
    console.error('History error:', err.message);
    res.json({ messages: [], conversationId: null });
  }
});

router.post('/api/ai-tutor/generate-pdf', authenticateJWT, (req, res, next) => {
    try {
        const { text } = req.body;
        const doc = new PDFDocument();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Tutor_IA_${Date.now()}.pdf`);
        doc.pipe(res);

        // Header
        doc.rect(0, 0, 612, 100).fill('#1A56A0');
        doc.fillColor('white').fontSize(24).text('AcademiaPro - Tutor IA', 50, 40);
        doc.fontSize(14).text(new Date().toLocaleDateString('es-ES'), 450, 45);

        doc.moveDown(4);
        doc.fillColor('black').fontSize(12).text(text, { align: 'justify', lineGap: 5 });

        res.end();
    } catch (err) {
        console.error('PDF gen error:', err);
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

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

        let apiResponse;
        try {
            apiResponse = await groqClient.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: 'system', content: 'Eres un generador de exámenes que responde ÚNICA Y EXCLUSIVAMENTE con un JSON válido en español. No añadas texto explicativo, ni Markdown (tampoco \`\`\`json), sólo devuelve las llaves { } del JSON y su contenido. El formato de options para multiple_choice debe ser un array de 4 strings que empiecen con "A) ", "B) ", "C) " y "D) ".' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.5,
                response_format: { type: "json_object" }
            });
        } catch (groqErr) {
            console.error('[exam-simulator] Groq error:', groqErr.message);
            return res.status(503).json({ error: 'El generador de exámenes no está disponible ahora mismo. Inténtalo de nuevo en unos minutos.' });
        }

        const jsonContent = JSON.parse(apiResponse.choices[0].message.content);
        res.json(jsonContent);
    } catch (err) {
        console.error('Route error:', err.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

router.get('/api/ai/conversations', authenticateJWT, async (req, res, next) => {
    try {
        const result = await db.query('SELECT * FROM ai_conversations WHERE user_id = $1 AND academy_id = $2 ORDER BY COALESCE(is_pinned, FALSE) DESC, updated_at DESC', [req.user.id, req.user.academy_id]);
        res.json(result.rows || []);
    } catch (err) {
        next(err);
    }
});

// Create new conversation
router.post('/api/ai/conversations', authenticateJWT, async (req, res, next) => {
    const { title } = req.body;
    try {
        const id = await db.insertReturning('INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2)', [req.user.id, title || 'Nueva conversación']);
        res.json({ id });
    } catch (err) {
        next(err);
    }
});

// Pin conversation
router.put('/api/ai/conversations/:id/pin', authenticateJWT, (req, res, next) => {
    const { is_pinned } = req.body;
    db.query('UPDATE ai_conversations SET is_pinned = $1 WHERE id = $2 AND user_id = $3', [is_pinned ? 1 : 0, req.params.id, req.user.id], (err) => {
        if (err) return next(err);
        res.json({ success: true });
    });
});

// Get messages for a conversation
router.get('/api/ai/conversations/:id/messages', authenticateJWT, async (req, res, next) => {
    try {
        const ownerCheck = await db.query('SELECT id FROM ai_conversations WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (!ownerCheck.rows.length) return res.status(403).json({ error: 'Acceso denegado' });
        const result = await db.query('SELECT * FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC', [req.params.id]);
        res.json(result.rows || []);
    } catch (err) {
        next(err);
    }
});

// Save message to conversation
router.post('/api/ai/conversations/:id/messages', authenticateJWT, async (req, res, next) => {
    const { role, content } = req.body;
    const conversationId = req.params.id;

    let owner;
    try {
        owner = await db.query('SELECT id FROM ai_conversations WHERE id = $1 AND user_id = $2', [conversationId, req.user.id]);
    } catch (e) {
        return next(e);
    }
    if (!owner.rows.length) return res.status(403).json({ error: 'Acceso denegado' });

    db.query('INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, $2, $3)', [conversationId, role, content], (err) => {
        if (err) return next(err);

        // Update conversation title if it's the first message and update updated_at
        db.query('SELECT COUNT(*) as count FROM ai_messages WHERE conversation_id = $1', [conversationId], (err, countRes) => {
            const count = isPostgres ? parseInt(countRes.rows[0].count) : countRes.rows[0].count;
            if (count === 1 && role === 'user') {
                const title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
                db.query('UPDATE ai_conversations SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [title, conversationId]);
            } else {
                db.query('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [conversationId]);
            }
        });
        res.json({ success: true });
    });
});

// Delete conversation
router.delete('/api/ai/conversations/:id', authenticateJWT, (req, res, next) => {
    db.query('DELETE FROM ai_messages WHERE conversation_id = $1', [req.params.id], () => {
        db.query('DELETE FROM ai_conversations WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id], (err) => {
            if (err) return next(err);
            res.json({ success: true });
        });
    });
});

router.post('/api/help-assistant/chat', authenticateJWT, async (req, res, next) => {
  try {
    const { message, conversationHistory = [] } = req.body;
    const role = req.user.role;

    const systemPrompts = {
      admin: `Eres el asistente de ayuda de AcademiaPro. Ayudas al administrador a usar la plataforma.
Puedes explicar cómo: gestionar estudiantes, añadir y gestionar profesores, ver y crear sesiones,
registrar pagos, generar informes PDF con IA, usar el chat, ver transcripciones de Google Meet,
configurar la academia, conectar Google Calendar y Gmail, usar el tutor IA, gestionar el calendario,
ver exámenes y rankings. Responde siempre en español, de forma clara y concisa.`,
      teacher: `Eres el asistente de ayuda de AcademiaPro. Ayudas al profesor a usar la plataforma.
Puedes explicar cómo: ver y gestionar sus alumnos asignados, registrar sesiones individuales y grupales,
registrar exámenes, usar el calendario y crear slots con Google Meet, procesar transcripciones de
Google Meet automáticamente, usar el chat con alumnos y el grupo de profesores, generar informes PDF,
usar el asistente IA, ver su configuración y conectar Gmail y Google Calendar.
Responde siempre en español, de forma clara y concisa.`,
      student: `Eres el asistente de ayuda de AcademiaPro. Ayudas al alumno a usar la plataforma.
Puedes explicar cómo: ver su panel principal con próximas sesiones y notas, usar el calendario
para ver sus clases y unirse a videollamadas de Google Meet, ver sus notas y exámenes,
ver sus pagos pendientes, hacer simulacros de examen con IA, usar el Tutor IA para resolver dudas,
chatear con su profesor, ver sus informes mensuales.
Responde siempre en español, de forma clara y concisa.`
    };

    const systemPrompt = systemPrompts[role] || systemPrompts.student;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-10),
      { role: 'user', content: message }
    ];

    let completion;
    try {
      completion = await groqClient.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 500,
        temperature: 0.7
      });
    } catch (groqErr) {
      console.error('Help assistant Groq error:', groqErr.message);
      return res.json({ response: 'El asistente no está disponible en este momento. Consulta la documentación o inténtalo de nuevo en unos minutos.' });
    }

    const response = completion.choices[0]?.message?.content || 'No pude generar una respuesta.';
    res.json({ response });
  } catch (err) {
    console.error('Help assistant error:', err);
    res.status(500).json({ response: 'Lo siento, ocurrió un error. Inténtalo de nuevo.' });
  }
});

module.exports = router;
