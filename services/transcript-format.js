'use strict';

// Shared by services/gmail.js (automatic Gmail/Meet pipeline) and
// routes/transcripts.js (manual upload + send-to-chat) so the DeepSeek
// prompt and the chat summary card can't drift apart between the two paths.

function normalizeList(items) {
    return (Array.isArray(items) ? items : []).map(x => String(x || '').trim()).filter(Boolean);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// studentNames: comma-separated list of candidate names, or null when the
// student is already known (manual upload) and shouldn't be guessed.
function buildTranscriptAnalysisPrompt({ transcriptText, studentNames = null }) {
    const studentNameField = studentNames
        ? '\n  "student_name": "nombre del alumno identificado o más probable",'
        : '';
    const studentsLine = studentNames ? `\n\nAlumnos posibles: ${studentNames}` : '';

    return `Analiza esta transcripción de clase y genera un resumen estructurado.${studentsLine}

Transcripción:
${transcriptText}

Responde SOLO en JSON con este formato exacto:
{${studentNameField}
  "resumen": "Resumen de lo tratado en clase en 2-3 frases",
  "conceptos_clave": ["concepto 1", "concepto 2"],
  "deberes": ["tarea 1", "tarea 2"],
  "pistas_profesor": ["consejo o observación del profesor 1"],
  "proximos_pasos": ["próximo tema 1"],
  "mensaje_motivador": "Mensaje corto de ánimo para el alumno"
}

IMPORTANTE sobre "deberes": incluye solo tareas que el profesor haya asignado explícitamente y de verdad en la clase. Si no se mencionan deberes reales en la transcripción, devuelve una lista vacía [] — no inventes ni sugieras tareas por tu cuenta.`;
}

function htmlList(items) {
    const list = normalizeList(items);
    if (!list.length) return '<p style="margin:4px 0 0;color:#94a3b8;">—</p>';
    return `<ul style="margin:4px 0 0 18px;padding:0;">${list.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

// analysisData accepts both the Gmail-pipeline keys (conceptos_clave, pistas_profesor)
// and the older manual-upload aliases (topics_covered, key_points, teacher_notes).
function buildTranscriptSummaryCard(analysisData = {}, recordingLink = null) {
    const d = analysisData || {};
    const resumen = escapeHtml(d.resumen || d.summary || '');
    const motivador = escapeHtml(d.mensaje_motivador || d.teacher_notes || '');
    const recording = recordingLink
        ? `<p style="margin:12px 0 0;"><a href="${escapeHtml(recordingLink)}" style="color:#4338ca;font-weight:700;">🎥 Grabación de la clase</a></p>`
        : '';

    return `<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:16px;padding:16px;">
        <div style="font-weight:800;color:#3730a3;margin-bottom:8px;">📚 Resumen de tu clase</div>
        <p style="margin:0 0 10px;color:#3730a3;">${resumen}</p>
        <div style="font-weight:700;color:#3730a3;">📝 Deberes</div>
        ${htmlList(d.deberes || d.homework)}
        <div style="font-weight:700;color:#3730a3;margin-top:10px;">💡 Conceptos clave</div>
        ${htmlList(d.conceptos_clave || d.topics_covered)}
        <div style="font-weight:700;color:#3730a3;margin-top:10px;">🎯 Consejos</div>
        ${htmlList(d.pistas_profesor || d.key_points)}
        ${motivador ? `<p style="margin:10px 0 0;color:#3730a3;font-weight:600;">💪 ${motivador}</p>` : ''}
        ${recording}
    </div>`;
}

module.exports = { buildTranscriptAnalysisPrompt, buildTranscriptSummaryCard };

if (require.main === module) {
    const assert = require('assert');

    const promptWithGuess = buildTranscriptAnalysisPrompt({ transcriptText: 'hola', studentNames: 'Dani, Martina' });
    assert.ok(promptWithGuess.includes('"student_name"'));
    assert.ok(promptWithGuess.includes('Alumnos posibles: Dani, Martina'));
    assert.ok(promptWithGuess.includes('no inventes'));

    const promptNoGuess = buildTranscriptAnalysisPrompt({ transcriptText: 'hola' });
    assert.ok(!promptNoGuess.includes('"student_name"'));

    const card = buildTranscriptSummaryCard({ resumen: 'Bien', deberes: ['pág 12'], conceptos_clave: [] }, 'https://drive.example/rec');
    assert.ok(card.includes('Bien'));
    assert.ok(card.includes('<li>pág 12</li>'));
    assert.ok(card.includes('Grabación de la clase'));
    assert.ok(card.includes('—')); // empty conceptos_clave placeholder
    assert.ok(!card.includes('undefined'));

    console.log('transcript-format.js: all assertions passed');
}
