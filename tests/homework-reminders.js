'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const SERVICE_PATH = path.join(ROOT, 'services/homework-reminders.js');
const HOMEWORK_REMINDER_ROUTES_PATH = path.join(ROOT, 'routes/homework-reminders.js');
const ROUTES_PATH = path.join(ROOT, 'routes/transcripts.js');
const GMAIL_PATH = path.join(ROOT, 'services/gmail.js');
const INDEX_PATH = path.join(ROOT, 'index.js');
const TEACHER_DASHBOARD_PATH = path.join(ROOT, 'public/teacher_dashboard.html');
const HTML_PATH = path.join(ROOT, 'public/transcripts.html');
const QUIET_LOG_PREFIXES = ['[dotenv@', 'Using PostgreSQL', '[Gmail] '];
const QUIET_ERROR_PREFIXES = ['send-to-chat error:', '[Gmail] Error processing email:'];

function purgeModules(pathsToPurge) {
    for (const targetPath of pathsToPurge) {
        try {
            delete require.cache[require.resolve(targetPath)];
        } catch (_) {
            // Ignore modules that have not been loaded yet.
        }
    }
}

function loadWithMocks(targetPath, mocks) {
    purgeModules([targetPath]);
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (Object.prototype.hasOwnProperty.call(mocks, request)) {
            return mocks[request];
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(targetPath);
    } finally {
        Module._load = originalLoad;
    }
}

function createMockDb(overrides = {}) {
    const state = {
        messageInserts: [],
        reminderInserts: [],
        transcriptInserts: [],
        roomMemberInserts: [],
        roomInserts: [],
        updates: [],
        transactionCalls: 0
    };

    function createQueryImplementation(targetState) {
        return async function query(sql, params = []) {
            if (overrides.query) return overrides.query(sql, params, targetState);

            if (sql.includes("SELECT id FROM users WHERE id = $1 AND role = 'student'")) return { rows: [] };
            if (sql.includes('SELECT id, user_id FROM students WHERE id = $1')) return { rows: [{ id: 12, user_id: 55 }] };
            if (sql.includes("SELECT id FROM students WHERE user_id = $1")) return { rows: [{ id: 12 }] };
            if (sql.includes('SELECT r.id FROM rooms r')) return { rows: [{ id: 91 }] };
            if (sql.includes('INSERT INTO room_members')) {
                targetState.roomMemberInserts.push(params);
                return { rows: [], rowCount: 1 };
            }
            if (sql.includes("INSERT INTO rooms (academy_id, type, name, created_at)")) {
                targetState.roomInserts.push(params);
                return { rows: [{ id: 91 }], lastID: 91 };
            }
            if (sql.includes('INSERT INTO messages')) {
                targetState.messageInserts.push(params);
                return { rows: [], rowCount: 1 };
            }
            if (sql.includes('INSERT INTO homework_reminders')) {
                targetState.reminderInserts.push(params);
                return { rows: [{ id: 500 }], lastID: 500 };
            }
            if (sql.includes('SELECT name FROM users WHERE id = $1')) return { rows: [{ name: 'Profesora Ada' }] };
            if (sql.includes('INSERT INTO transcripts')) {
                targetState.transcriptInserts.push(params);
                return { rows: [{ id: 700 }], lastID: 700 };
            }
            if (sql.includes('UPDATE users SET gmail_last_check')) {
                targetState.updates.push({ sql, params });
                return { rows: [], rowCount: 1 };
            }

            throw new Error(`Unexpected SQL in test: ${sql}`);
        };
    }

    const db = {
        isPostgres: true,
        state,
        query: createQueryImplementation(state),
        async withTransaction(work) {
            state.transactionCalls += 1;
            const txState = {
                messageInserts: [...state.messageInserts],
                reminderInserts: [...state.reminderInserts],
                transcriptInserts: [...state.transcriptInserts],
                roomMemberInserts: [...state.roomMemberInserts],
                roomInserts: [...state.roomInserts],
                updates: [...state.updates]
            };
            const tx = {
                query: createQueryImplementation(txState)
            };
            const result = await work(tx);
            state.messageInserts = txState.messageInserts;
            state.reminderInserts = txState.reminderInserts;
            state.transcriptInserts = txState.transcriptInserts;
            state.roomMemberInserts = txState.roomMemberInserts;
            state.roomInserts = txState.roomInserts;
            state.updates = txState.updates;
            return result;
        }
    };

    return db;
}

function createRouterHarness() {
    const routes = { get: new Map(), post: new Map(), put: new Map() };
    return {
        express: {
            Router() {
                return {
                    get(routePath, ...handlers) {
                        routes.get.set(routePath, handlers[handlers.length - 1]);
                    },
                    post(routePath, ...handlers) {
                        routes.post.set(routePath, handlers[handlers.length - 1]);
                    },
                    put(routePath, ...handlers) {
                        routes.put.set(routePath, handlers[handlers.length - 1]);
                    }
                };
            }
        },
        routes
    };
}

function createIoMock() {
    const emits = [];
    return {
        emits,
        to(room) {
            return {
                emit(event, payload) {
                    emits.push({ room, event, payload });
                }
            };
        }
    };
}

function createRes() {
    return {
        statusCode: 200,
        payload: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        }
    };
}

function createNoopMiddleware() {
    return (req, res, next) => next && next();
}

function extractFunctionSource(source, functionName) {
    const marker = `function ${functionName}`;
    const start = source.indexOf(marker);
    if (start === -1) throw new Error(`Function ${functionName} not found`);

    let braceDepth = 0;
    let seenBrace = false;
    for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (char === '{') {
            braceDepth++;
            seenBrace = true;
        } else if (char === '}') {
            braceDepth--;
            if (seenBrace && braceDepth === 0) {
                return source.slice(start, i + 1);
            }
        }
    }

    throw new Error(`Function ${functionName} did not terminate`);
}

function loadHtmlHelpers() {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const script = [
        extractFunctionSource(html, 'safeParseProcessedJson'),
        extractFunctionSource(html, 'buildHistorySummaryPayload')
    ].join('\n');
    const context = {};
    vm.createContext(context);
    vm.runInContext(script, context);
    return context;
}

function loadHomeworkReminderService(dbMock) {
    purgeModules([SERVICE_PATH]);
    return loadWithMocks(SERVICE_PATH, {
        '../db': dbMock
    });
}

function loadHomeworkReminderRoutes(dbMock, serviceOverrides = {}, notificationOverrides = {}) {
    const routerHarness = createRouterHarness();
    purgeModules([HOMEWORK_REMINDER_ROUTES_PATH]);
    loadWithMocks(HOMEWORK_REMINDER_ROUTES_PATH, {
        express: routerHarness.express,
        '../db': dbMock,
        '../middleware/auth': { authenticateJWT: createNoopMiddleware() },
        '../middleware/roles': {
            requireTeacherOrAdmin: createNoopMiddleware(),
            requireStudent: createNoopMiddleware()
        },
        '../services/homework-reminders': {
            ...loadHomeworkReminderService(dbMock),
            ...serviceOverrides
        },
        '../notifications': notificationOverrides
    });
    return routerHarness.routes;
}

async function testServiceHelpers() {
    const dbMock = createMockDb();
    const service = loadHomeworkReminderService(dbMock);

    assert.deepStrictEqual(
        service.normalizeHomeworkList(['  Ruffini  ', '', 'Ruffini', 'polinomios']),
        ['Ruffini', 'polinomios']
    );

    const next = service.computeNextScheduledFor('wednesday', '18:30', new Date('2026-06-23T10:00:00Z'));
    assert.ok(next instanceof Date);
    assert.strictEqual(service.canScheduleReminder({ status: 'pending_schedule' }), true);
    assert.strictEqual(service.canScheduleReminder({ status: 'done' }), false);
    assert.strictEqual(service.shouldCreateReminderFromProcessed({ deberes: [] }), false);
    assert.strictEqual(service.shouldCreateReminderFromProcessed({ deberes: ['   ', '\n'] }), false);
    assert.strictEqual(service.shouldCreateReminderFromProcessed({ deberes: ['repasar matrices'] }), true);
    assert.strictEqual(service.getTranscriptIdForReminder({ transcript_id: 42 }), 42);
    assert.strictEqual(service.getTranscriptIdForReminder({}, 17), 17);
    assert.strictEqual(service.validateHomeworkResponseStatus('done'), true);
    assert.strictEqual(service.validateHomeworkResponseStatus('not_done'), true);
    assert.strictEqual(service.validateHomeworkResponseStatus('no_homework'), true);
    assert.strictEqual(service.validateHomeworkResponseStatus('later'), false);
}

async function testStudentReminderListUsesStudentOwnershipScope() {
    const dbMock = createMockDb({
        async query(sql, params) {
            if (sql.includes('FROM homework_reminders hr') && sql.includes('JOIN students s ON s.id = hr.student_id')) {
                assert.deepStrictEqual(params, [55, 3]);
                return {
                    rows: [{ id: 10, status: 'pending_schedule' }]
                };
            }
            throw new Error(`Unexpected SQL in student list test: ${sql}`);
        }
    });
    const routes = loadHomeworkReminderRoutes(dbMock);
    const handler = routes.get.get('/api/student/homework-reminders');
    const req = {
        user: { id: 55, academy_id: 3, role: 'student' }
    };
    const res = createRes();

    await handler(req, res, err => { throw err; });

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.payload, [{ id: 10, status: 'pending_schedule' }]);
}

async function testStudentScheduleUpdatesOwnedReminder() {
    let updateParams = null;
    const computedDate = new Date('2026-06-29T18:30:00.000Z');
    const dbMock = createMockDb({
        async query(sql, params) {
            if (sql.includes('SELECT hr.id') && sql.includes('JOIN students s ON s.id = hr.student_id')) {
                assert.deepStrictEqual(params, ['10', 55, 3]);
                return { rows: [{ id: 10, status: 'pending_schedule' }] };
            }
            if (sql.includes('UPDATE homework_reminders') && sql.includes("status = 'scheduled'")) {
                updateParams = params;
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL in student schedule test: ${sql}`);
        }
    });
    const routes = loadHomeworkReminderRoutes(dbMock, {
        computeNextScheduledFor(dayOfWeek, time) {
            assert.strictEqual(dayOfWeek, 'monday');
            assert.strictEqual(time, '18:30');
            return computedDate;
        }
    });
    const handler = routes.post.get('/api/student/homework-reminders/:id/schedule');
    const req = {
        params: { id: '10' },
        body: { day_of_week: 'monday', time: '18:30' },
        user: { id: 55, academy_id: 3, role: 'student' }
    };
    const res = createRes();

    await handler(req, res, err => { throw err; });

    assert.deepStrictEqual(updateParams, ['monday', '18:30', computedDate.toISOString(), '10']);
    assert.deepStrictEqual(res.payload, {
        success: true,
        scheduled_for: computedDate.toISOString()
    });
}

async function testStudentScheduleRejectsInvalidScheduleInput() {
    let updateAttempted = false;
    const dbMock = createMockDb({
        async query(sql, params) {
            if (sql.includes('SELECT hr.id') && sql.includes('JOIN students s ON s.id = hr.student_id')) {
                assert.deepStrictEqual(params, ['10', 55, 3]);
                return { rows: [{ id: 10, status: 'pending_schedule' }] };
            }
            if (sql.includes('UPDATE homework_reminders')) {
                updateAttempted = true;
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL in invalid schedule test: ${sql}`);
        }
    });
    const routes = loadHomeworkReminderRoutes(dbMock);
    const handler = routes.post.get('/api/student/homework-reminders/:id/schedule');
    const req = {
        params: { id: '10' },
        body: { day_of_week: 'laterday', time: 'not-a-time' },
        user: { id: 55, academy_id: 3, role: 'student' }
    };
    const res = createRes();

    await handler(req, res, err => { throw err; });

    assert.strictEqual(updateAttempted, false);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.payload, { error: 'Horario inválido' });
}

async function testStudentScheduleRejectsUnschedulableReminderStatus() {
    let updateAttempted = false;
    const dbMock = createMockDb({
        async query(sql, params) {
            if (sql.includes('SELECT hr.id') && sql.includes('JOIN students s ON s.id = hr.student_id')) {
                assert.deepStrictEqual(params, ['10', 55, 3]);
                return { rows: [{ id: 10, status: 'done' }] };
            }
            if (sql.includes('UPDATE homework_reminders')) {
                updateAttempted = true;
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL in unschedulable schedule test: ${sql}`);
        }
    });
    const routes = loadHomeworkReminderRoutes(dbMock);
    const handler = routes.post.get('/api/student/homework-reminders/:id/schedule');
    const req = {
        params: { id: '10' },
        body: { day_of_week: 'monday', time: '18:30' },
        user: { id: 55, academy_id: 3, role: 'student' }
    };
    const res = createRes();

    await handler(req, res, err => { throw err; });

    assert.strictEqual(updateAttempted, false);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.payload, { error: 'Recordatorio no programable' });
}

async function testStudentRespondRejectsInvalidStatus() {
    const dbMock = createMockDb({
        async query(sql) {
            throw new Error(`Query should not run for invalid status: ${sql}`);
        }
    });
    const routes = loadHomeworkReminderRoutes(dbMock);
    const handler = routes.post.get('/api/student/homework-reminders/:id/respond');
    const req = {
        params: { id: '10' },
        body: { status: 'later' },
        user: { id: 55, academy_id: 3, role: 'student' }
    };
    const res = createRes();

    await handler(req, res, err => { throw err; });

    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.payload, { error: 'Estado inválido' });
}

async function testStudentRespondUpdatesOwnedReminder() {
    let updateParams = null;
    const dbMock = createMockDb({
        async query(sql, params) {
            if (sql.includes('SELECT hr.id') && sql.includes('JOIN students s ON s.id = hr.student_id')) {
                assert.deepStrictEqual(params, ['10', 55, 3]);
                return { rows: [{ id: 10 }] };
            }
            if (sql.includes('UPDATE homework_reminders') && sql.includes('student_response_at = NOW()')) {
                updateParams = params;
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL in student respond test: ${sql}`);
        }
    });
    const routes = loadHomeworkReminderRoutes(dbMock);
    const handler = routes.post.get('/api/student/homework-reminders/:id/respond');
    const req = {
        params: { id: '10' },
        body: { status: 'done' },
        user: { id: 55, academy_id: 3, role: 'student' }
    };
    const res = createRes();

    await handler(req, res, err => { throw err; });

    assert.deepStrictEqual(updateParams, ['done', '10']);
    assert.deepStrictEqual(res.payload, { success: true });
}

async function testStudentRespondNotifiesTeacherInbox() {
    let updateParams = null;
    const notificationCalls = [];
    const dbMock = createMockDb({
        async query(sql, params) {
            if (sql.includes('SELECT hr.id') && sql.includes('JOIN students s ON s.id = hr.student_id')) {
                assert.deepStrictEqual(params, ['10', 55, 3]);
                return { rows: [{ id: 10, teacher_id: 7 }] };
            }
            if (sql.includes('UPDATE homework_reminders') && sql.includes('student_response_at = NOW()')) {
                updateParams = params;
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL in teacher inbox notify test: ${sql}`);
        }
    });
    const routes = loadHomeworkReminderRoutes(
        dbMock,
        {},
        {
            async createNotification(...args) {
                notificationCalls.push(args);
            }
        }
    );
    const handler = routes.post.get('/api/student/homework-reminders/:id/respond');
    const req = {
        params: { id: '10' },
        body: { status: 'not_done' },
        user: { id: 55, academy_id: 3, role: 'student', name: 'Ana' }
    };
    const res = createRes();

    await handler(req, res, err => { throw err; });

    assert.deepStrictEqual(updateParams, ['not_done', '10']);
    assert.deepStrictEqual(notificationCalls, [[
        7,
        3,
        'homework_status',
        '📚 Ana ha actualizado sus deberes',
        'Marcó que no los ha hecho',
        '/teacher/dashboard?tab=homework'
    ]]);
    assert.deepStrictEqual(res.payload, { success: true });
}

async function testStudentRespondSucceedsWhenTeacherNotificationFails() {
    let updateParams = null;
    const loggedErrors = [];
    const dbMock = createMockDb({
        async query(sql, params) {
            if (sql.includes('SELECT hr.id') && sql.includes('JOIN students s ON s.id = hr.student_id')) {
                assert.deepStrictEqual(params, ['10', 55, 3]);
                return { rows: [{ id: 10, teacher_id: 7 }] };
            }
            if (sql.includes('UPDATE homework_reminders') && sql.includes('student_response_at = NOW()')) {
                updateParams = params;
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL in teacher notify failure test: ${sql}`);
        }
    });
    const routes = loadHomeworkReminderRoutes(
        dbMock,
        {},
        {
            async createNotification() {
                throw new Error('socket offline');
            }
        }
    );
    const handler = routes.post.get('/api/student/homework-reminders/:id/respond');
    const req = {
        params: { id: '10' },
        body: { status: 'done' },
        user: { id: 55, academy_id: 3, role: 'student', name: 'Ana' }
    };
    const res = createRes();
    const originalError = console.error;
    console.error = (...args) => {
        loggedErrors.push(args.join(' '));
    };

    try {
        await handler(req, res, err => { throw err; });
    } finally {
        console.error = originalError;
    }

    assert.deepStrictEqual(updateParams, ['done', '10']);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.payload, { success: true });
    assert.ok(loggedErrors.some(message => message.includes('[Homework] Teacher notification error: socket offline')));
}

async function testTeacherReminderListScopesToTeacher() {
    const dbMock = createMockDb({
        async query(sql, params) {
            assert.ok(sql.includes('hr.teacher_id = $2'));
            assert.deepStrictEqual(params, [3, 7]);
            return {
                rows: [{ id: 22, student_name: 'Ana' }]
            };
        }
    });
    const routes = loadHomeworkReminderRoutes(dbMock);
    const handler = routes.get.get('/api/teacher/homework-reminders');
    const req = {
        user: { id: 7, academy_id: 3, role: 'teacher' }
    };
    const res = createRes();

    await handler(req, res, err => { throw err; });

    assert.deepStrictEqual(res.payload, [{ id: 22, student_name: 'Ana' }]);
}

async function testAdminReminderListScopesToAcademyOnly() {
    const dbMock = createMockDb({
        async query(sql, params) {
            assert.ok(!sql.includes('hr.teacher_id = $2'));
            assert.deepStrictEqual(params, [3]);
            return {
                rows: [{ id: 23, student_name: 'Luis' }]
            };
        }
    });
    const routes = loadHomeworkReminderRoutes(dbMock);
    const handler = routes.get.get('/api/teacher/homework-reminders');
    const req = {
        user: { id: 1, academy_id: 3, role: 'admin' }
    };
    const res = createRes();

    await handler(req, res, err => { throw err; });

    assert.deepStrictEqual(res.payload, [{ id: 23, student_name: 'Luis' }]);
}

function testTeacherDashboardIncludesHomeworkTrackerCard() {
    const html = fs.readFileSync(TEACHER_DASHBOARD_PATH, 'utf8');

    assert.ok(html.includes('<section class="dashboard-card" id="homework-tracker-card"'));
    assert.ok(html.includes('<div class="section-header">'));
    assert.ok(html.includes('id="homework-tracker-list"'));
    assert.ok(html.includes("fetch('/api/teacher/homework-reminders', { credentials: 'include' })"));
    assert.ok(html.includes('getHomeworkStatusLabel(r.status)'));
    assert.ok(html.includes('getHomeworkWeekdayLabel(r.scheduled_day_of_week)'));
}

function testTeacherDashboardEscapesHomeworkTrackerValues() {
    const html = fs.readFileSync(TEACHER_DASHBOARD_PATH, 'utf8');

    assert.ok(html.includes('function escapeHtml(value)'));
    assert.ok(html.includes('${escapeHtml(r.student_name || \'\')}'));
    assert.ok(html.includes("homeworkItems.map(item => escapeHtml(item)).join(', ')"));
    assert.ok(html.includes('${escapeHtml(getHomeworkWeekdayLabel(r.scheduled_day_of_week))}'));
    assert.ok(html.includes('${escapeHtml(r.scheduled_time || \'Sin hora\')}'));
    assert.ok(html.includes('${escapeHtml(getHomeworkStatusLabel(r.status))}'));
    assert.ok(!html.includes('<div class="homework-reminder-name">${r.student_name}</div>'));
    assert.ok(!html.includes('${homeworkItems.length ? homeworkItems.join(\', \') : \'Sin deberes guardados\'}'));
}

function testIndexIncludesHomeworkReminderDispatchInterval() {
    const source = fs.readFileSync(INDEX_PATH, 'utf8');

    assert.ok(source.includes("FROM homework_reminders"));
    assert.ok(source.includes("type,\n                'homework_reminder'") || source.includes("'homework_reminder'"));
    assert.ok(source.includes('📚 Es la hora de hacer tus deberes'));
    assert.ok(source.includes('/student-portal?homeworkReminder=${reminder.id}'));
    assert.ok(source.includes('UPDATE homework_reminders SET reminder_sent = TRUE'));
}

async function testManualFlowSkipsSecondMessageWithoutCleanHomework() {
    const dbMock = createMockDb();
    const homeworkService = loadHomeworkReminderService(dbMock);
    const io = createIoMock();
    const routerHarness = createRouterHarness();

    purgeModules([ROUTES_PATH]);
    const makeRouter = loadWithMocks(ROUTES_PATH, {
        express: routerHarness.express,
        '../db': dbMock,
        '../services/gmail': () => () => ({ checkAndProcessTranscripts: async () => 0 }),
        '../services/homework-reminders': homeworkService,
        '../middleware/auth': { authenticateJWT: createNoopMiddleware() },
        '../middleware/roles': {
            requireAdmin: createNoopMiddleware(),
            requireTeacherOrAdmin: createNoopMiddleware()
        },
        '../notifications': { createNotification() {} },
        '../utils/multer': { pdfUpload: { single: () => createNoopMiddleware() } },
        '../services/groq': {},
        '../services/calendar': { makeOAuth2Client() { return {}; } },
        googleapis: { google: {} }
    });

    makeRouter(io);
    const handler = routerHarness.routes.post.get('/api/transcripts/send-to-chat');
    const req = {
        user: { id: 7, academy_id: 3, role: 'teacher' },
        body: {
            student_id: 12,
            summary: {
                resumen: 'Buen trabajo hoy',
                deberes: ['   ', '\n'],
                conceptos_clave: ['Matrices'],
                pistas_profesor: ['Repasa el signo'],
                mensaje_motivador: 'Sigue asi'
            }
        }
    };
    const res = createRes();

    await handler(req, res, err => { throw err; });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(dbMock.state.messageInserts.length, 1);
    assert.strictEqual(dbMock.state.reminderInserts.length, 0);
    assert.strictEqual(dbMock.state.transactionCalls, 1);
    assert.strictEqual(io.emits.length, 1);
    assert.ok(dbMock.state.messageInserts[0][2].startsWith('📚 *Resumen de tu clase de hoy*'));
}

async function testManualFlowAddsSecondMessageAndPreservesTranscriptId() {
    const dbMock = createMockDb();
    const homeworkService = loadHomeworkReminderService(dbMock);
    const io = createIoMock();
    const routerHarness = createRouterHarness();

    purgeModules([ROUTES_PATH]);
    const makeRouter = loadWithMocks(ROUTES_PATH, {
        express: routerHarness.express,
        '../db': dbMock,
        '../services/gmail': () => () => ({ checkAndProcessTranscripts: async () => 0 }),
        '../services/homework-reminders': homeworkService,
        '../middleware/auth': { authenticateJWT: createNoopMiddleware() },
        '../middleware/roles': {
            requireAdmin: createNoopMiddleware(),
            requireTeacherOrAdmin: createNoopMiddleware()
        },
        '../notifications': { createNotification() {} },
        '../utils/multer': { pdfUpload: { single: () => createNoopMiddleware() } },
        '../services/groq': {},
        '../services/calendar': { makeOAuth2Client() { return {}; } },
        googleapis: { google: {} }
    });

    makeRouter(io);
    const handler = routerHarness.routes.post.get('/api/transcripts/send-to-chat');
    const req = {
        user: { id: 7, academy_id: 3, role: 'teacher' },
        body: {
            student_id: 12,
            summary: {
                transcript_id: 77,
                resumen: 'Clase de algebra lineal',
                deberes: ['  repasar matrices  ', ''],
                conceptos_clave: ['Matrices'],
                pistas_profesor: ['Ordena los pasos'],
                mensaje_motivador: 'Vas muy bien'
            }
        }
    };
    const res = createRes();

    await handler(req, res, err => { throw err; });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(dbMock.state.messageInserts.length, 2);
    assert.strictEqual(dbMock.state.reminderInserts.length, 1);
    assert.strictEqual(dbMock.state.reminderInserts[0][3], 77);
    assert.strictEqual(dbMock.state.transactionCalls, 1);
    assert.ok(dbMock.state.messageInserts[1][2].includes('/student-portal?homeworkReminder=500'));
    assert.strictEqual(io.emits.length, 2);
}

async function testManualFlowNormalizesStudentUserIdToStudentRecordId() {
    const dbMock = createMockDb({
        query(sql, params, state) {
            if (sql.includes("SELECT id FROM users WHERE id = $1 AND role = 'student'")) return { rows: [{ id: 55 }] };
            if (sql.includes("SELECT id FROM students WHERE user_id = $1 AND academy_id = $2 AND assigned_teacher_id = $3")) {
                return { rows: [{ id: 12 }] };
            }
            if (sql.includes('SELECT r.id FROM rooms r')) return { rows: [{ id: 91 }] };
            if (sql.includes('INSERT INTO messages')) {
                state.messageInserts.push(params);
                return { rows: [], rowCount: 1 };
            }
            if (sql.includes('INSERT INTO homework_reminders')) {
                state.reminderInserts.push(params);
                return { rows: [{ id: 501 }], lastID: 501 };
            }
            if (sql.includes('SELECT name FROM users WHERE id = $1')) return { rows: [{ name: 'Profesora Ada' }] };
            throw new Error(`Unexpected SQL in user-id test: ${sql}`);
        }
    });
    const homeworkService = loadHomeworkReminderService(dbMock);
    const io = createIoMock();
    const routerHarness = createRouterHarness();

    purgeModules([ROUTES_PATH]);
    const makeRouter = loadWithMocks(ROUTES_PATH, {
        express: routerHarness.express,
        '../db': dbMock,
        '../services/gmail': () => () => ({ checkAndProcessTranscripts: async () => 0 }),
        '../services/homework-reminders': homeworkService,
        '../middleware/auth': { authenticateJWT: createNoopMiddleware() },
        '../middleware/roles': {
            requireAdmin: createNoopMiddleware(),
            requireTeacherOrAdmin: createNoopMiddleware()
        },
        '../notifications': { createNotification() {} },
        '../utils/multer': { pdfUpload: { single: () => createNoopMiddleware() } },
        '../services/groq': {},
        '../services/calendar': { makeOAuth2Client() { return {}; } },
        googleapis: { google: {} }
    });

    makeRouter(io);
    const handler = routerHarness.routes.post.get('/api/transcripts/send-to-chat');
    const req = {
        user: { id: 7, academy_id: 3, role: 'teacher' },
        body: {
            student_id: 55,
            summary: {
                transcript_id: 88,
                resumen: 'Resumen',
                deberes: ['ejercicio 1'],
                conceptos_clave: ['Matrices'],
                pistas_profesor: ['Repasa'],
                mensaje_motivador: 'Bien'
            }
        }
    };
    const res = createRes();

    await handler(req, res, err => { throw err; });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(dbMock.state.reminderInserts.length, 1);
    assert.strictEqual(dbMock.state.reminderInserts[0][1], 12);
}

function testHistoryShapingPreservesTranscriptLinkage() {
    const { safeParseProcessedJson, buildHistorySummaryPayload } = loadHtmlHelpers();

    const safeFallback = safeParseProcessedJson('{bad json');
    assert.strictEqual(JSON.stringify(safeFallback), '{}');

    const malformedRowPayload = buildHistorySummaryPayload({
        id: 33,
        transcript_id: 44,
        processed_json: '{broken'
    });
    assert.strictEqual(malformedRowPayload.transcript_id, 44);

    const historyPayload = buildHistorySummaryPayload({
        id: 10,
        transcript_id: 11,
        processed_json: JSON.stringify({ resumen: 'Resumen guardado' })
    });
    assert.strictEqual(historyPayload.resumen, 'Resumen guardado');
    assert.strictEqual(historyPayload.transcript_id, 11);
}

async function testGmailFlowAddsSecondMessageWhenHomeworkExists() {
    const dbMock = createMockDb({
        query(sql, params, state) {
            if (sql.includes('SELECT id FROM transcripts WHERE gmail_msg_id = $1')) return { rows: [] };
            if (sql.includes('SELECT s.id, s.name, s.user_id FROM students s WHERE s.academy_id = $1 AND s.assigned_teacher_id = $2')) {
                return { rows: [{ id: 12, name: 'Ana', user_id: 55 }] };
            }
            if (sql.includes('SELECT r.id FROM rooms r')) return { rows: [{ id: 91 }] };
            if (sql.includes('INSERT INTO messages')) {
                state.messageInserts.push(params);
                return { rows: [], rowCount: 1 };
            }
            if (sql.includes('INSERT INTO transcripts')) {
                state.transcriptInserts.push(params);
                return { rows: [{ id: 700 }], lastID: 700 };
            }
            if (sql.includes('INSERT INTO homework_reminders')) {
                state.reminderInserts.push(params);
                return { rows: [{ id: 900 }], lastID: 900 };
            }
            if (sql.includes('UPDATE users SET gmail_last_check')) {
                state.updates.push({ sql, params });
                return { rows: [], rowCount: 1 };
            }

            throw new Error(`Unexpected SQL in gmail test: ${sql}`);
        }
    });
    const homeworkService = loadHomeworkReminderService(dbMock);
    const io = createIoMock();

    const oauthClient = {
        setCredentials() {},
        on() {}
    };
    const gmailApi = {
        users: {
            messages: {
                async list() {
                    return { data: { messages: [{ id: 'msg-1' }] } };
                },
                async get() {
                    return {
                        data: {
                            internalDate: String(new Date('2026-06-25T10:00:00Z').getTime()),
                            payload: {
                                mimeType: 'text/plain',
                                body: {
                                    data: Buffer.from('A'.repeat(150)).toString('base64')
                                }
                            }
                        }
                    };
                },
                async modify() {
                    return { data: {} };
                }
            }
        }
    };
    const groqMock = {
        chat: {
            completions: {
                async create() {
                    return {
                        choices: [{
                            message: {
                                content: JSON.stringify({
                                    student_name: 'Ana',
                                    resumen: 'Resumen Gmail',
                                    deberes: ['  hacer ejercicios  ', ''],
                                    conceptos_clave: ['Matrices'],
                                    pistas_profesor: ['Revisar signos'],
                                    mensaje_motivador: 'Buen progreso'
                                })
                            }
                        }]
                    };
                }
            }
        }
    };

    purgeModules([GMAIL_PATH]);
    const makeGmailService = loadWithMocks(GMAIL_PATH, {
        '../db': dbMock,
        './groq': groqMock,
        './homework-reminders': homeworkService,
        '../notifications': { createNotification() {} },
        './calendar': { makeOAuth2Client() { return oauthClient; } },
        googleapis: { google: { gmail() { return gmailApi; } } }
    });

    const gmailService = makeGmailService(io);
    const processed = await gmailService.checkAndProcessTranscripts({
        id: 7,
        name: 'Profesora Ada',
        role: 'teacher',
        academy_id: 3,
        gmail_access_token: 'token',
        gmail_refresh_token: 'refresh',
        gmail_token_expiry: Date.now(),
        gmail_last_check: null,
        transcript_email: null
    });

    assert.strictEqual(processed, 1);
    assert.strictEqual(dbMock.state.transcriptInserts.length, 1);
    assert.strictEqual(dbMock.state.reminderInserts.length, 1);
    assert.strictEqual(dbMock.state.reminderInserts[0][3], 700);
    assert.strictEqual(dbMock.state.messageInserts.length, 2);
    assert.strictEqual(dbMock.state.transactionCalls, 1);
    assert.ok(dbMock.state.messageInserts[1][3].includes('/student-portal?homeworkReminder=900'));
    assert.strictEqual(io.emits.length, 2);
}

async function testManualFlowRollsBackOnReminderCtaFailure() {
    const dbMock = createMockDb({
        query(sql, params, state) {
            if (sql.includes("SELECT id FROM users WHERE id = $1 AND role = 'student'")) return { rows: [] };
            if (sql.includes('SELECT id, user_id FROM students WHERE id = $1')) return { rows: [{ id: 12, user_id: 55 }] };
            if (sql.includes("SELECT id FROM students WHERE user_id = $1 AND academy_id = $2 AND assigned_teacher_id = $3")) return { rows: [{ id: 12 }] };
            if (sql.includes('SELECT r.id FROM rooms r')) return { rows: [{ id: 91 }] };
            if (sql.includes('INSERT INTO messages')) {
                state.messageInserts.push(params);
                if (state.messageInserts.length === 2) throw new Error('CTA insert failed');
                return { rows: [], rowCount: 1 };
            }
            if (sql.includes('INSERT INTO homework_reminders')) {
                state.reminderInserts.push(params);
                return { rows: [{ id: 500 }], lastID: 500 };
            }
            throw new Error(`Unexpected SQL in rollback test: ${sql}`);
        }
    });
    const homeworkService = loadHomeworkReminderService(dbMock);
    const io = createIoMock();
    const routerHarness = createRouterHarness();

    purgeModules([ROUTES_PATH]);
    const makeRouter = loadWithMocks(ROUTES_PATH, {
        express: routerHarness.express,
        '../db': dbMock,
        '../services/gmail': () => () => ({ checkAndProcessTranscripts: async () => 0 }),
        '../services/homework-reminders': homeworkService,
        '../middleware/auth': { authenticateJWT: createNoopMiddleware() },
        '../middleware/roles': {
            requireAdmin: createNoopMiddleware(),
            requireTeacherOrAdmin: createNoopMiddleware()
        },
        '../notifications': { createNotification() {} },
        '../utils/multer': { pdfUpload: { single: () => createNoopMiddleware() } },
        '../services/groq': {},
        '../services/calendar': { makeOAuth2Client() { return {}; } },
        googleapis: { google: {} }
    });

    makeRouter(io);
    const handler = routerHarness.routes.post.get('/api/transcripts/send-to-chat');
    const req = {
        user: { id: 7, academy_id: 3, role: 'teacher' },
        body: {
            student_id: 12,
            summary: {
                transcript_id: 99,
                resumen: 'Resumen',
                deberes: ['ejercicio'],
                conceptos_clave: ['Tema'],
                pistas_profesor: ['Pista'],
                mensaje_motivador: 'Bien'
            }
        }
    };
    const res = createRes();

    await handler(req, res, err => err);

    assert.notStrictEqual(res.statusCode, 200);
    assert.strictEqual(dbMock.state.messageInserts.length, 0);
    assert.strictEqual(dbMock.state.reminderInserts.length, 0);
    assert.strictEqual(io.emits.length, 0);
}

async function testGmailFlowRollsBackOnReminderCtaFailure() {
    const dbMock = createMockDb({
        query(sql, params, state) {
            if (sql.includes('SELECT id FROM transcripts WHERE gmail_msg_id = $1')) return { rows: [] };
            if (sql.includes('SELECT s.id, s.name, s.user_id FROM students s WHERE s.academy_id = $1 AND s.assigned_teacher_id = $2')) {
                return { rows: [{ id: 12, name: 'Ana', user_id: 55 }] };
            }
            if (sql.includes('SELECT r.id FROM rooms r')) return { rows: [{ id: 91 }] };
            if (sql.includes('INSERT INTO messages')) {
                state.messageInserts.push(params);
                if (state.messageInserts.length === 2) throw new Error('CTA insert failed');
                return { rows: [], rowCount: 1 };
            }
            if (sql.includes('INSERT INTO transcripts')) {
                state.transcriptInserts.push(params);
                return { rows: [{ id: 700 }], lastID: 700 };
            }
            if (sql.includes('INSERT INTO homework_reminders')) {
                state.reminderInserts.push(params);
                return { rows: [{ id: 900 }], lastID: 900 };
            }
            if (sql.includes('UPDATE users SET gmail_last_check')) {
                state.updates.push({ sql, params });
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL in gmail rollback test: ${sql}`);
        }
    });
    const homeworkService = loadHomeworkReminderService(dbMock);
    const io = createIoMock();
    const oauthClient = { setCredentials() {}, on() {} };
    const gmailApi = {
        users: {
            messages: {
                async list() {
                    return { data: { messages: [{ id: 'msg-1' }] } };
                },
                async get() {
                    return {
                        data: {
                            internalDate: String(new Date('2026-06-25T10:00:00Z').getTime()),
                            payload: { mimeType: 'text/plain', body: { data: Buffer.from('A'.repeat(150)).toString('base64') } }
                        }
                    };
                },
                async modify() {
                    return { data: {} };
                }
            }
        }
    };
    const groqMock = {
        chat: {
            completions: {
                async create() {
                    return {
                        choices: [{
                            message: { content: JSON.stringify({ student_name: 'Ana', resumen: 'Resumen', deberes: ['ejercicio'], conceptos_clave: ['Tema'], pistas_profesor: ['Pista'], mensaje_motivador: 'Bien' }) }
                        }]
                    };
                }
            }
        }
    };

    purgeModules([GMAIL_PATH]);
    const makeGmailService = loadWithMocks(GMAIL_PATH, {
        '../db': dbMock,
        './groq': groqMock,
        './homework-reminders': homeworkService,
        '../notifications': { createNotification() {} },
        './calendar': { makeOAuth2Client() { return oauthClient; } },
        googleapis: { google: { gmail() { return gmailApi; } } }
    });

    const gmailService = makeGmailService(io);
    const processed = await gmailService.checkAndProcessTranscripts({
        id: 7,
        name: 'Profesora Ada',
        role: 'teacher',
        academy_id: 3,
        gmail_access_token: 'token',
        gmail_refresh_token: 'refresh',
        gmail_token_expiry: Date.now(),
        gmail_last_check: null,
        transcript_email: null
    });

    assert.strictEqual(processed, 0);
    assert.strictEqual(dbMock.state.messageInserts.length, 0);
    assert.strictEqual(dbMock.state.transcriptInserts.length, 0);
    assert.strictEqual(dbMock.state.reminderInserts.length, 0);
    assert.strictEqual(io.emits.length, 0);
}

async function run() {
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => {
        const message = args.join(' ');
        if (QUIET_LOG_PREFIXES.some(prefix => message.startsWith(prefix))) return;
        originalLog(...args);
    };
    console.error = (...args) => {
        const message = args.join(' ');
        if (args.length === 1 && args[0] instanceof Error && args[0].message === 'CTA insert failed') return;
        if (QUIET_ERROR_PREFIXES.some(prefix => message.startsWith(prefix))) return;
        originalError(...args);
    };

    try {
        await testServiceHelpers();
        await testStudentReminderListUsesStudentOwnershipScope();
        await testStudentScheduleUpdatesOwnedReminder();
        await testStudentScheduleRejectsInvalidScheduleInput();
        await testStudentScheduleRejectsUnschedulableReminderStatus();
        await testStudentRespondRejectsInvalidStatus();
        await testStudentRespondUpdatesOwnedReminder();
        await testStudentRespondNotifiesTeacherInbox();
        await testStudentRespondSucceedsWhenTeacherNotificationFails();
        await testTeacherReminderListScopesToTeacher();
        await testAdminReminderListScopesToAcademyOnly();
        testTeacherDashboardIncludesHomeworkTrackerCard();
        testTeacherDashboardEscapesHomeworkTrackerValues();
        testIndexIncludesHomeworkReminderDispatchInterval();
        await testManualFlowSkipsSecondMessageWithoutCleanHomework();
        await testManualFlowAddsSecondMessageAndPreservesTranscriptId();
        await testManualFlowNormalizesStudentUserIdToStudentRecordId();
        testHistoryShapingPreservesTranscriptLinkage();
        await testGmailFlowAddsSecondMessageWhenHomeworkExists();
        await testManualFlowRollsBackOnReminderCtaFailure();
        await testGmailFlowRollsBackOnReminderCtaFailure();
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
}

run()
    .then(() => {
        console.log('homework-reminders tests passed');
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
