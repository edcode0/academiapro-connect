#!/usr/bin/env node
/**
 * AcademiaPro Smoke Tests
 * Validates critical endpoints against the live deployment.
 */

'use strict';

require('dotenv').config();

const https = require('https');
const http = require('http');

const BASE_URL = (process.env.SMOKE_URL || 'https://web-production-d02f4.up.railway.app').replace(/\/$/, '');
const TIMEOUT_MS = parseInt(process.env.SMOKE_TIMEOUT || '30000', 10);

const TS = Date.now();
const OWNER_EMAIL = `smoke_owner_${TS}@test.invalid`;
const STUDENT_EMAIL = `smoke_student_${TS}@test.invalid`;
const TEACHER_EMAIL = `smoke_teacher_${TS}@test.invalid`;
const JOIN_STU_EMAIL = `smoke_joinstu_${TS}@test.invalid`;
const PASSWORD = 'SmokeTest_123!';

let ownerCookie = null;
let studentCookie = null;
let teacherCookie = null;
let joinStuCookie = null;
let studentRecordId = null;
let conversationId = null;
let teacherCode = null;
let studentCode = null;

let passed = 0;
let failed = 0;
const failures = [];

function request(method, urlPath, { body, cookie, token } = {}) {
    return new Promise((resolve, reject) => {
        const fullUrl = new URL(BASE_URL + urlPath);
        const lib = fullUrl.protocol === 'https:' ? https : http;
        const headers = {};
        let postData = null;

        if (body !== undefined) {
            postData = JSON.stringify(body);
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(postData);
        }

        if (cookie) headers['Cookie'] = cookie;
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const req = lib.request({
            hostname: fullUrl.hostname,
            port: fullUrl.port || (fullUrl.protocol === 'https:' ? 443 : 80),
            path: fullUrl.pathname + fullUrl.search,
            method,
            headers,
            timeout: TIMEOUT_MS,
        }, res => {
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(raw); } catch (_) {}
                resolve({
                    status: res.statusCode,
                    body: json,
                    raw,
                    setCookie: res.headers['set-cookie'] || [],
                });
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`));
        });
        req.on('error', reject);

        if (postData) req.write(postData);
        req.end();
    });
}

function extractTokenCookie(response) {
    const tokenCookie = (response.setCookie || []).find(cookie => cookie.startsWith('token='));
    return tokenCookie ? tokenCookie.split(';')[0] : null;
}

function check(label, ok, hint = '') {
    if (ok) {
        process.stdout.write(`  OK  ${label}\n`);
        passed++;
        return;
    }
    process.stdout.write(`  XX  ${label}${hint ? `  [${hint}]` : ''}\n`);
    failed++;
    failures.push(`${label}${hint ? ': ' + hint : ''}`);
}

function warn(msg) {
    process.stdout.write(`  !!  ${msg}\n`);
}

async function section(title, fn) {
    const pad = Math.max(0, 50 - title.length);
    process.stdout.write(`\n-- ${title} ${'-'.repeat(pad)}\n`);
    try {
        await fn();
    } catch (err) {
        process.stdout.write(`  XX  UNEXPECTED ERROR: ${err.message}\n`);
        failed++;
        failures.push(`${title}: ${err.message}`);
    }
}

function hint(body, maxLen = 180) {
    const text = JSON.stringify(body) || '';
    return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

function isExpectedAiRestriction(response) {
    const errorText = String(response?.body?.error || response?.raw || '');
    return (
        response?.status === 500 ||
        response?.status === 503
    ) && (
        errorText.includes('Organization has been restricted') ||
        errorText.includes('Error al contactar la IA') ||
        errorText.includes('no esta disponible') ||
        errorText.includes('no estÃ¡ disponible')
    );
}

async function runTests() {
    process.stdout.write('\nSmoke Tests\n');
    process.stdout.write(`Target  : ${BASE_URL}\n`);
    process.stdout.write(`Time    : ${new Date().toISOString()}\n`);
    process.stdout.write(`Timeout : ${TIMEOUT_MS}ms per request\n`);

    await section('Health', async () => {
        const r = await request('GET', '/health');
        check('GET /health -> 200', r.status === 200, `status=${r.status}`);
        check('Uptime present', typeof r.body?.uptime === 'number', hint(r.body));
    });

    await section('Auth - Register owner', async () => {
        const r = await request('POST', '/auth/register', {
            body: {
                name: `Smoke Owner ${TS}`,
                email: OWNER_EMAIL,
                password: PASSWORD,
                academy_name: `Smoke Academy ${TS}`,
            },
        });
        check('POST /auth/register (owner) -> 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
        check('Response has student_code', !!r.body?.student_code, hint(r.body));
        check('Response has teacher_code', !!r.body?.teacher_code, hint(r.body));
        studentCode = r.body?.student_code ?? null;
        teacherCode = r.body?.teacher_code ?? null;
    });

    await section('Auth - Login owner', async () => {
        const r = await request('POST', '/auth/login', {
            body: { email: OWNER_EMAIL, password: PASSWORD },
        });
        check('POST /auth/login (owner) -> 200', r.status === 200, `status=${r.status}`);
        ownerCookie = extractTokenCookie(r);
        check('Owner session cookie received', !!ownerCookie, hint({ body: r.body, setCookie: r.setCookie }));
    });

    await section('Auth - /api/auth/me', async () => {
        const r = await request('GET', '/api/auth/me', { cookie: ownerCookie });
        check('GET /api/auth/me -> 200', r.status === 200, `status=${r.status}`);
        const user = r.body?.user || r.body;
        check('Returns id and role', !!user?.id && !!user?.role, hint(user));
        check('Role is admin', user?.role === 'admin', `role=${user?.role}`);
    });

    if (studentCode) {
        await section('Auth - Register student', async () => {
            const r = await request('POST', '/auth/register', {
                body: {
                    name: `Smoke Student ${TS}`,
                    email: STUDENT_EMAIL,
                    password: PASSWORD,
                    academy_code: studentCode,
                },
            });
            check('POST /auth/register (student) -> 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
        });

        await section('Auth - Login student', async () => {
            const r = await request('POST', '/auth/login', {
                body: { email: STUDENT_EMAIL, password: PASSWORD },
            });
            check('POST /auth/login (student) -> 200', r.status === 200, `status=${r.status}`);
            studentCookie = extractTokenCookie(r);
            check('Student session cookie received', !!studentCookie, hint({ body: r.body, setCookie: r.setCookie }));
        });
    } else {
        warn('No studentCode - skipping student registration');
    }

    await section('Students', async () => {
        const r = await request('GET', '/api/students', { cookie: ownerCookie });
        check('GET /api/students -> 200', r.status === 200, `status=${r.status}`);
        const rows = Array.isArray(r.body) ? r.body : (r.body?.rows ?? []);
        check('Response is array', Array.isArray(rows), `type=${typeof r.body}`);
        if (rows.length > 0) {
            studentRecordId = rows[0].id;
            check('Student record ID resolved', !!studentRecordId, `id=${studentRecordId}`);
        } else {
            warn('No students in academy - transcript/send-to-chat checks will be limited');
        }
    });

    await section('Chat - rooms & contacts', async () => {
        const ensure = await request('POST', '/api/chat/ensure-rooms', { cookie: ownerCookie });
        check('POST /api/chat/ensure-rooms -> 200', ensure.status === 200, `status=${ensure.status}`);

        const rooms = await request('GET', '/api/chat/rooms', { cookie: ownerCookie });
        check('GET /api/chat/rooms -> 200', rooms.status === 200, `status=${rooms.status}`);
        check('Rooms is array', Array.isArray(rooms.body), `type=${typeof rooms.body}`);

        const contacts = await request('GET', '/api/chat/contacts', { cookie: ownerCookie });
        check('GET /api/chat/contacts -> 200', contacts.status === 200, `status=${contacts.status}`);
    });

    await section('Chat - unread count', async () => {
        const r = await request('GET', '/api/chat/unread-count', { cookie: ownerCookie });
        check('GET /api/chat/unread-count -> 200', r.status === 200, `status=${r.status}`);
        check('Response is object', r.body !== null && typeof r.body === 'object', hint(r.body));
    });

    await section('Transcripts - students list', async () => {
        const r = await request('GET', '/api/transcripts/students', { cookie: ownerCookie });
        check('GET /api/transcripts/students -> 200', r.status === 200, `status=${r.status}`);
        check('Response is array', Array.isArray(r.body), `type=${typeof r.body}`);
        if (!studentRecordId && Array.isArray(r.body) && r.body.length > 0) studentRecordId = r.body[0].id;
    });

    if (studentRecordId) {
        await section('Transcripts - process short text', async () => {
            const r = await request('POST', '/api/transcripts/process', {
                cookie: ownerCookie,
                body: {
                    student_id: studentRecordId,
                    transcript_text: 'Hoy hemos repasado las ecuaciones de segundo grado. El alumno ha practicado ejercicios de factorizacion y aprendido a usar la formula cuadratica. Se explico el discriminante y sus tres casos posibles.',
                },
            });
            const aiRestricted = isExpectedAiRestriction(r);
            check('POST /api/transcripts/process (short) -> 200 or expected AI restriction', r.status === 200 || aiRestricted, `status=${r.status} ${hint(r.body)}`);
            if (r.status === 200) {
                check('Response has resumen', !!r.body?.resumen, hint(r.body));
                check('Response has deberes array', Array.isArray(r.body?.deberes), `type=${typeof r.body?.deberes}`);
                check('Response has conceptos_clave', Array.isArray(r.body?.conceptos_clave), `type=${typeof r.body?.conceptos_clave}`);
            } else if (aiRestricted) {
                warn('Transcript short-text AI response skipped due to expected Groq restriction');
            }
        });

        await section('Transcripts - process long text', async () => {
            const longText = [
                'Clase de matematicas: algebra lineal y calculo diferencial.',
                'Sistemas de ecuaciones lineales con multiples incognitas.',
                'El alumno ha trabajado en matrices, determinantes y el metodo de Gauss-Jordan.',
                'Se introdujeron limites y derivadas basicas, enfocandonos en la interpretacion grafica.',
                'El concepto de derivada como tasa de cambio instantaneo fue muy bien comprendido.',
                'Se practicaron las reglas de derivacion: potencia, producto, cociente y regla de la cadena.',
                'Para la siguiente sesion: ejercicios del libro paginas 45 a 52.',
            ].join(' ').repeat(12);

            check('Long text length > 2000', longText.length > 2000, `length=${longText.length}`);
            const r = await request('POST', '/api/transcripts/process', {
                cookie: ownerCookie,
                body: { student_id: studentRecordId, transcript_text: longText },
            });
            const aiRestricted = isExpectedAiRestriction(r);
            check('POST /api/transcripts/process (long) -> 200 or expected AI restriction', r.status === 200 || aiRestricted, `status=${r.status} ${hint(r.body)}`);
            if (r.status === 200) {
                check('Long text response has resumen', !!r.body?.resumen, hint(r.body));
            } else if (aiRestricted) {
                warn('Transcript long-text AI response skipped due to expected Groq restriction');
            }
        });

        await section('Transcripts - send to chat', async () => {
            const summary = {
                resumen: 'Clase de repaso de ecuaciones. El alumno ha progresado notablemente.',
                deberes: ['Ejercicios pag. 10', 'Repasar factorizacion'],
                conceptos_clave: ['Ecuaciones de segundo grado', 'Discriminante'],
                pistas_profesor: ['Repasar formula cuadratica antes del examen'],
                proximos_pasos: ['Ver video de derivadas'],
                mensaje_motivador: 'Sigue asi, lo estas haciendo genial.',
            };
            const r = await request('POST', '/api/transcripts/send-to-chat', {
                cookie: ownerCookie,
                body: { student_id: studentRecordId, summary },
            });
            check('POST /api/transcripts/send-to-chat -> 200 or 404', r.status === 200 || r.status === 404, `status=${r.status} ${hint(r.body)}`);
            if (r.status === 200) check('Response has room_id', r.body?.room_id !== undefined, hint(r.body));
        });
    } else {
        warn('No studentRecordId - skipping transcript process/send-to-chat checks');
    }

    await section('Transcripts - history', async () => {
        const r = await request('GET', '/api/transcripts/history', { cookie: ownerCookie });
        check('GET /api/transcripts/history -> 200', r.status === 200, `status=${r.status}`);
    });

    await section('Transcripts - authz: student cannot access history', async () => {
        if (!studentCookie) { warn('No studentCookie - skipping student authz check'); return; }
        const r = await request('GET', '/api/transcripts/history', { cookie: studentCookie });
        check('GET /api/transcripts/history as student -> 403', r.status === 403, `status=${r.status}`);
    });

    await section('Transcripts - authz: student cannot process transcript', async () => {
        if (!studentCookie || !studentRecordId) { warn('No studentCookie or studentRecordId - skipping'); return; }
        const r = await request('POST', '/api/transcripts/process', {
            cookie: studentCookie,
            body: { student_id: studentRecordId, transcript_text: 'Texto de prueba con suficiente longitud para pasar la validacion minima.' },
        });
        check('POST /api/transcripts/process as student -> 403', r.status === 403, `status=${r.status}`);
    });

    await section('Transcripts - authz: teacher cannot access out-of-scope student', async () => {
        if (!teacherCookie || !studentRecordId) { warn('No teacherCookie or studentRecordId - skipping'); return; }
        // Teacher (not assigned to this student) tries to process a transcript for ownerCookie's student
        const r = await request('POST', '/api/transcripts/process', {
            cookie: teacherCookie,
            body: { student_id: studentRecordId, transcript_text: 'Texto de prueba con suficiente longitud para pasar la validacion minima.' },
        });
        check('POST /api/transcripts/process as unassigned teacher -> 403', r.status === 403, `status=${r.status}`);
    });

    await section('Transcripts - authz: teacher cannot send-to-chat for out-of-scope student', async () => {
        if (!teacherCookie || !studentRecordId) { warn('No teacherCookie or studentRecordId - skipping'); return; }
        const summary = { resumen: 'test', deberes: [], conceptos_clave: [], pistas_profesor: [], proximos_pasos: [], mensaje_motivador: '' };
        const r = await request('POST', '/api/transcripts/send-to-chat', {
            cookie: teacherCookie,
            body: { student_id: studentRecordId, summary },
        });
        check('POST /api/transcripts/send-to-chat as unassigned teacher -> 403 or 404', r.status === 403 || r.status === 404, `status=${r.status}`);
    });

    await section('AI Tutor - conversations CRUD', async () => {
        const list = await request('GET', '/api/ai/conversations', { cookie: ownerCookie });
        check('GET /api/ai/conversations -> 200', list.status === 200, `status=${list.status}`);
        check('Conversations is array', Array.isArray(list.body), `type=${typeof list.body}`);

        const create = await request('POST', '/api/ai/conversations', {
            cookie: ownerCookie,
            body: { title: `Smoke ${TS}` },
        });
        check('POST /api/ai/conversations -> 200', create.status === 200, `status=${create.status}`);
        conversationId = create.body?.id ?? null;

        if (conversationId) {
            const msgs = await request('GET', `/api/ai/conversations/${conversationId}/messages`, { cookie: ownerCookie });
            check('GET /api/ai/conversations/:id/messages -> 200', msgs.status === 200, `status=${msgs.status}`);
        } else {
            warn('conversationId is null (known endpoint limitation) - messages check skipped');
        }
    });

    await section('AI Tutor - chat', async () => {
        const r = await request('POST', '/api/ai-tutor/chat', {
            cookie: ownerCookie,
            body: {
                messages: [{ role: 'user', content: 'Responde SOLO con la palabra: hola' }],
                conversationId: conversationId || undefined,
            },
        });
        check('POST /api/ai-tutor/chat -> 200', r.status === 200 || r.status === 503, `status=${r.status} ${hint(r.body)}`);
        if (r.status === 200) check('Response has AI text', !!r.body?.response, hint(r.body));
        if (r.body?.conversationId && !conversationId) conversationId = r.body.conversationId;
    });

    await section('AI Tutor - history', async () => {
        const r = await request('GET', '/api/ai-tutor/history', { cookie: ownerCookie });
        check('GET /api/ai-tutor/history -> 200', r.status === 200, `status=${r.status}`);
        check('Response has messages array', Array.isArray(r.body?.messages), `type=${typeof r.body?.messages}`);
    });

    await section('Reports', async () => {
        if (studentRecordId) {
            const r = await request('GET', `/api/reports/student/${studentRecordId}`, { cookie: ownerCookie });
            check('GET /api/reports/student/:id -> 200', r.status === 200, `status=${r.status}`);
        } else {
            warn('No studentRecordId - skipping /api/reports/student/:id');
        }

        if (studentCookie) {
            const portal = await request('GET', '/api/student/portal-data', { cookie: studentCookie });
            check('GET /api/student/portal-data (student) -> 200', portal.status === 200, `status=${portal.status}`);

            const reports = await request('GET', '/api/student/reports', { cookie: studentCookie });
            check('GET /api/student/reports (student) -> 200', reports.status === 200, `status=${reports.status}`);

            const hwRes = await request('GET', '/api/student/homework-reminders', { cookie: studentCookie });
            check('GET /api/student/homework-reminders -> 200', hwRes.status === 200, `status=${hwRes.status}`);
            check('Homework reminders response is array', Array.isArray(hwRes.body), `type=${typeof hwRes.body}`);
        } else {
            warn('No studentCookie - skipping student portal checks');
        }
    });

    await section('External join - teacher via /api/auth/join', async () => {
        if (!teacherCode) { warn('No teacherCode - skipping teacher join'); return; }
        const r = await request('POST', '/api/auth/join', {
            body: { name: `Smoke Teacher ${TS}`, email: TEACHER_EMAIL, password: PASSWORD, role: 'teacher', academy_code: teacherCode },
        });
        check('POST /api/auth/join (teacher) -> 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
        teacherCookie = extractTokenCookie(r);
        check('Teacher join returns session cookie', !!teacherCookie, hint({ body: r.body, setCookie: r.setCookie }));
    });

    await section('External join - student via /api/auth/join', async () => {
        if (!studentCode) { warn('No studentCode - skipping student join'); return; }
        const r = await request('POST', '/api/auth/join', {
            body: { name: `Smoke Join Student ${TS}`, email: JOIN_STU_EMAIL, password: PASSWORD, role: 'student', academy_code: studentCode },
        });
        check('POST /api/auth/join (student) -> 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
        joinStuCookie = extractTokenCookie(r);
        check('Student join returns session cookie', !!joinStuCookie, hint({ body: r.body, setCookie: r.setCookie }));
    });

    await section('External join - student portal access', async () => {
        if (!joinStuCookie) { warn('No joinStuCookie - skipping'); return; }

        const portal = await request('GET', '/api/student/portal-data', { cookie: joinStuCookie });
        check('GET /api/student/portal-data (joined student) -> 200', portal.status === 200, `status=${portal.status} ${hint(portal.body)}`);

        if (portal.status === 200 && Object.prototype.hasOwnProperty.call(portal.body || {}, 'averageScore')) {
            const avg = parseFloat(portal.body.averageScore);
            check('averageScore is finite (not NaN)', Number.isFinite(avg) || portal.body.averageScore === null, `averageScore=${portal.body.averageScore}`);
        } else if (portal.status === 200) {
            warn('portal-data returned 200 but averageScore missing - check skipped');
        }

        const reports = await request('GET', '/api/student/reports', { cookie: joinStuCookie });
        check('GET /api/student/reports (joined student) -> 200', reports.status === 200, `status=${reports.status} ${hint(reports.body)}`);
        check('Reports response is array', Array.isArray(reports.body), `type=${typeof reports.body}`);
    });

    await section('External join - student appears in admin list', async () => {
        if (!joinStuCookie) { warn('No joinStuCookie - skipping'); return; }

        const r = await request('GET', '/api/students', { cookie: ownerCookie });
        check('GET /api/students (admin) -> 200', r.status === 200, `status=${r.status}`);
        const rows = Array.isArray(r.body) ? r.body : (r.body?.rows ?? []);
        const found = rows.some(student =>
            student.name === `Smoke Join Student ${TS}` ||
            student.user_email === JOIN_STU_EMAIL
        );
        check('Joined student appears in admin student list', found, `found=${found}, total_students=${rows.length}`);
    });

    await section('Notifications', async () => {
        const list = await request('GET', '/api/notifications', { cookie: ownerCookie });
        check('GET /api/notifications -> 200', list.status === 200, `status=${list.status}`);
        check('Returns array', Array.isArray(list.body), `type=${typeof list.body}`);

        const teacherHw = await request('GET', '/api/teacher/homework-reminders', { cookie: ownerCookie });
        check('GET /api/teacher/homework-reminders -> 200 or 403 by role', [200, 403].includes(teacherHw.status), `status=${teacherHw.status}`);

        const markAll = await request('POST', '/api/notifications/mark-all-read', { cookie: ownerCookie });
        check('POST /api/notifications/mark-all-read -> 200', markAll.status === 200, `status=${markAll.status}`);
        check('mark-all-read returns success', markAll.body?.success === true, hint(markAll.body));
    });

    await section('Auth guards', async () => {
        const noCookie = await request('GET', '/api/auth/me');
        check('GET /api/auth/me without cookie -> 401', noCookie.status === 401, `status=${noCookie.status}`);

        const badCookie = await request('GET', '/api/notifications', { cookie: 'token=invalid.jwt.here' });
        check('GET /api/notifications with bad cookie -> 401', badCookie.status === 401, `status=${badCookie.status}`);
    });

    await section('Cleanup', async () => {
        if (studentCookie) {
            const r = await request('DELETE', '/api/auth/delete-account', { cookie: studentCookie });
            check('DELETE student test account -> 200', r.status === 200, `status=${r.status}`);
        }
        if (teacherCookie) {
            const r = await request('DELETE', '/api/auth/delete-account', { cookie: teacherCookie });
            check('DELETE teacher test account -> 200', r.status === 200, `status=${r.status}`);
        }
        if (joinStuCookie) {
            const r = await request('DELETE', '/api/auth/delete-account', { cookie: joinStuCookie });
            check('DELETE join-student test account -> 200', r.status === 200, `status=${r.status}`);
        }
        if (ownerCookie) {
            const r = await request('DELETE', '/api/auth/delete-account', { cookie: ownerCookie });
            check('DELETE owner test account -> 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
        }
    });

    const total = passed + failed;
    process.stdout.write(`\n${'-'.repeat(54)}\n`);
    process.stdout.write(`Results: ${passed}/${total} passed\n`);

    if (failures.length) {
        process.stdout.write('\nFailed checks:\n');
        failures.forEach(failure => process.stdout.write(`  XX  ${failure}\n`));
    }

    process.stdout.write('\n');

    if (failed > 0) {
        process.stderr.write(`FAILED: ${failed} check(s) failed\n\n`);
        process.exit(1);
    }

    process.stdout.write(`PASS: All ${passed} checks passed\n\n`);
    process.exit(0);
}

runTests().catch(err => {
    process.stderr.write(`\nFatal error: ${err.message}\n${err.stack}\n`);
    process.exit(1);
});
