'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ROUTES_PATH = path.join(ROOT, 'routes/calendar.js');

function purge(targetPath) {
    try { delete require.cache[require.resolve(targetPath)]; } catch (_) {}
}

function loadWithMocks(targetPath, mocks) {
    purge(targetPath);
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require(targetPath);
    } finally {
        Module._load = originalLoad;
    }
}

function createRouterHarness() {
    const routes = { post: new Map() };
    return {
        express: {
            Router() {
                return {
                    post(routePath, ...handlers) {
                        routes.post.set(routePath, handlers[handlers.length - 1]);
                    },
                    get() {},
                    put() {},
                    delete() {}
                };
            }
        },
        routes
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

function loadMeetRoute({ queryImpl, createCalendarEventImpl }) {
    const routerHarness = createRouterHarness();
    loadWithMocks(ROUTES_PATH, {
        express: routerHarness.express,
        '../db': { isPostgres: true, query: queryImpl },
        'googleapis': { google: {} },
        '../services/calendar': {
            makeOAuth2Client: () => ({}),
            deleteCalendarEvent: async () => {},
            createCalendarEvent: createCalendarEventImpl
        },
        '../middleware/auth': { authenticateJWT: createNoopMiddleware(), JWT_SECRET: 'test-secret' },
        '../middleware/roles': {
            requireStudent: createNoopMiddleware(),
            requireTeacherOrAdmin: createNoopMiddleware()
        },
        '../services/recurring': { generateRecurringSlots: async () => {} }
    });
    return routerHarness.routes.post.get('/api/calendar/meet');
}

async function testAdminUsesAssignedTeacherCalendar() {
    const createdWith = [];
    const handler = loadMeetRoute({
        async queryImpl(sql, params) {
            if (sql.includes('FROM sessions s')) {
                return { rows: [{ teacher_id: 42, student_name: 'Lucia' }] };
            }
            if (sql.includes('SELECT * FROM users WHERE id = $1')) {
                return { rows: [{ id: 42, calendar_access_token: 'teacher-token', calendar_refresh_token: 'refresh' }] };
            }
            if (sql.includes('UPDATE sessions SET meet_link')) {
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        },
        async createCalendarEventImpl(teacher, slot) {
            createdWith.push({ teacherId: teacher.id, studentName: slot.student_name });
            return { google_event_id: 'evt-1', meet_link: 'https://meet.google.com/aaa-bbbb-ccc' };
        }
    });

    const req = {
        user: { id: 9001, role: 'admin', academy_id: 7 },
        body: { session_id: 55, date: '2026-07-01', start_time: '17:00', end_time: '18:00' }
    };
    const res = createRes();
    await handler(req, res, () => {});

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(createdWith[0].teacherId, 42);
    assert.strictEqual(createdWith[0].studentName, 'Lucia');
}

async function testTeacherFallsBackToRequesterWhenNoClassTeacherExists() {
    const createdWith = [];
    const handler = loadMeetRoute({
        async queryImpl(sql, params) {
            if (sql.includes('SELECT * FROM users WHERE id = $1')) {
                return { rows: [{ id: 88, calendar_access_token: 'teacher-token', calendar_refresh_token: 'refresh' }] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        },
        async createCalendarEventImpl(teacher) {
            createdWith.push(teacher.id);
            return { google_event_id: 'evt-2', meet_link: 'https://meet.google.com/ddd-eeee-fff' };
        }
    });

    const req = {
        user: { id: 88, role: 'teacher', academy_id: 7 },
        body: { date: '2026-07-02', start_time: '09:00', end_time: '10:00' }
    };
    const res = createRes();
    await handler(req, res, () => {});

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(createdWith, [88]);
}

async function testAdminWithoutResolvableTeacherGets400() {
    const handler = loadMeetRoute({
        async queryImpl() {
            throw new Error('query should not run for unresolved admin teacher fallback');
        },
        async createCalendarEventImpl() {
            throw new Error('createCalendarEvent should not be called');
        }
    });

    const req = {
        user: { id: 9001, role: 'admin', academy_id: 7 },
        body: { date: '2026-07-03', start_time: '12:00', end_time: '13:00' }
    };
    const res = createRes();
    await handler(req, res, () => {});

    assert.strictEqual(res.statusCode, 400);
    assert.match(res.payload.error, /asigna.*profesor/i);
}

async function testResolvedTeacherWithoutCalendarGets400() {
    const handler = loadMeetRoute({
        async queryImpl(sql, params) {
            if (sql.includes('FROM students') && sql.includes('assigned_teacher_id AS teacher_id')) {
                return { rows: [{ teacher_id: 42, student_name: 'Lucia' }] };
            }
            if (sql.includes('SELECT * FROM users WHERE id = $1')) {
                return { rows: [{ id: 42, calendar_access_token: null, calendar_refresh_token: null }] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        },
        async createCalendarEventImpl() {
            throw new Error('createCalendarEvent should not be called');
        }
    });

    const req = {
        user: { id: 9001, role: 'admin', academy_id: 7 },
        body: { student_id: 14, date: '2026-07-04', start_time: '18:00', end_time: '19:00' }
    };
    const res = createRes();
    await handler(req, res, () => {});

    assert.strictEqual(res.statusCode, 400);
    assert.match(res.payload.error, /profesor asignado.*google calendar/i);
}

async function run() {
    await testAdminUsesAssignedTeacherCalendar();
    await testTeacherFallsBackToRequesterWhenNoClassTeacherExists();
    await testAdminWithoutResolvableTeacherGets400();
    await testResolvedTeacherWithoutCalendarGets400();
    console.log('meet-owner-resolution tests passed');
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
