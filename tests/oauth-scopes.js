'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JWT_SECRET = 'oauth-scope-test-secret';
const STATE_MAX_AGE_MS = 15 * 60 * 1000;
process.env.JWT_SECRET = JWT_SECRET;

function loadWithMocks(targetPath, mocks, initialize = loaded => loaded) {
    delete require.cache[require.resolve(targetPath)];
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try { return initialize(require(targetPath)); } finally { Module._load = originalLoad; }
}

function createRouterHarness() {
    const routes = { get: new Map() };
    const register = method => (routePath, ...handlers) => {
        if (method === 'get') routes.get.set(routePath, handlers[handlers.length - 1]);
    };
    return {
        express: {
            Router: () => ({
                get: register('get'),
                post: register('post'),
                put: register('put'),
                delete: register('delete')
            })
        },
        routes
    };
}

function createResponse() {
    return {
        payload: null,
        redirectUrl: null,
        cookie() {},
        json(payload) { this.payload = payload; return this; },
        redirect(url) { this.redirectUrl = url; return this; },
        sendFile() {}
    };
}

function noopMiddleware(req, res, next) {
    if (next) next();
}

function loadLoginFlow() {
    const router = createRouterHarness();
    const captured = {};
    const passport = {
        authenticate(provider, options) {
            captured.provider = provider;
            captured.options = options;
            return noopMiddleware;
        }
    };

    loadWithMocks(path.join(ROOT, 'routes/auth.js'), {
        express: router.express,
        bcryptjs: { hashSync: () => '', compareSync: () => true },
        passport,
        '../db': {},
        '../middleware/auth': {
            authenticateJWT: noopMiddleware,
            buildAuthCookieOptions: () => ({}),
            signAuthToken: () => 'token'
        },
        '../middleware/roles': { requireTeacherOrAdmin: noopMiddleware },
        '../services/email': { sendWelcomeEmail() {}, sendJoinWelcomeEmail() {} },
        '../utils/codes': { generateCode: () => 'code', generateUserCode: () => 'user-code' },
        'express-rate-limit': () => noopMiddleware
    });

    return { routes: router.routes, handler: router.routes.get.get('/auth/google'), captured };
}

function createOAuthHarness() {
    const captured = { authOptions: [], getTokenCalls: 0, redirectUris: [] };
    class OAuth2 {
        constructor(clientId, clientSecret, redirectUri) {
            captured.redirectUris.push(redirectUri);
        }
        generateAuthUrl(options) {
            captured.authOptions.push(options);
            return 'https://accounts.google.test/auth';
        }
        async getToken() {
            captured.getTokenCalls++;
            return { tokens: {} };
        }
    }
    return { captured, OAuth2 };
}

function loadCalendarFlow() {
    const router = createRouterHarness();
    const oauth = createOAuthHarness();
    loadWithMocks(path.join(ROOT, 'routes/calendar.js'), {
        express: router.express,
        '../db': { isPostgres: true, query: async () => ({ rows: [] }) },
        googleapis: { google: { auth: { OAuth2: oauth.OAuth2 }, calendar: () => ({}) } },
        '../services/calendar': {
            makeOAuth2Client: () => ({}),
            createCalendarEvent: async () => null,
            deleteCalendarEvent: async () => {}
        },
        '../middleware/auth': { authenticateJWT: noopMiddleware, JWT_SECRET },
        '../middleware/roles': {
            requireStudent: noopMiddleware,
            requireTeacherOrAdmin: noopMiddleware
        },
        '../services/recurring': { generateRecurringSlots: async () => {} }
    });
    return { routes: router.routes, captured: oauth.captured };
}

function loadGmailFlow() {
    const router = createRouterHarness();
    const oauth = createOAuthHarness();
    const makeOAuth2Client = () => new oauth.OAuth2('', '', '/api/gmail/callback');
    loadWithMocks(path.join(ROOT, 'routes/transcripts.js'), {
        express: router.express,
        '../db': { isPostgres: true, query: async () => ({ rows: [] }) },
        googleapis: { google: {} },
        '../services/groq': {},
        '../services/calendar': { makeOAuth2Client },
        '../services/homework-reminders': {
            createHomeworkReminderFromTranscript: async () => null,
            buildHomeworkReminderPrompt: () => ''
        },
        '../services/transcript-format': {
            buildTranscriptAnalysisPrompt: () => '',
            buildTranscriptSummaryCard: () => ''
        },
        '../utils/multer': { pdfUpload: { single: () => noopMiddleware } },
        '../middleware/auth': { authenticateJWT: noopMiddleware },
        '../middleware/roles': {
            requireAdmin: noopMiddleware,
            requireTeacherOrAdmin: noopMiddleware
        },
        '../notifications': { createNotification() {} },
        '../services/gmail': () => ({ checkAndProcessTranscripts: async () => 0 })
    }, makeRouter => makeRouter({ to: () => ({ emit() {} }) }));
    return { routes: router.routes, captured: oauth.captured };
}

async function issueState(flow, connectPath, now) {
    const originalNow = Date.now;
    Date.now = () => now;
    try {
        const res = createResponse();
        await flow.routes.get.get(connectPath)({ user: { id: 42 }, query: {} }, res, () => {});
        return flow.captured.authOptions.at(-1).state;
    } finally {
        Date.now = originalNow;
    }
}

async function callbackWithState(flow, callbackPath, state, now) {
    const originalNow = Date.now;
    const originalError = console.error;
    const originalLog = console.log;
    Date.now = () => now;
    console.error = () => {};
    console.log = () => {};
    try {
        const res = createResponse();
        await flow.routes.get.get(callbackPath)({ query: { code: 'code', state } }, res, () => {});
        return res;
    } finally {
        Date.now = originalNow;
        console.error = originalError;
        console.log = originalLog;
    }
}

function signedState(data, extra = {}) {
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('hex').substring(0, 16);
    return Buffer.from(JSON.stringify({ d: data, s: signature, ...extra })).toString('base64');
}

function tamperState(state) {
    const parsed = JSON.parse(Buffer.from(state, 'base64').toString());
    parsed.d = parsed.d.replace(/^42:/, '43:');
    return Buffer.from(JSON.stringify(parsed)).toString('base64');
}

function loadGmailProcessingFlow() {
    const state = { modifyCalls: 0 };
    const db = {
        async query(sql) {
            if (sql.includes('SELECT id FROM transcripts WHERE gmail_msg_id')) return { rows: [] };
            if (sql.includes('FROM students s WHERE s.academy_id')) {
                return { rows: [{ id: 12, name: 'Ana', user_id: 55 }] };
            }
            if (sql.includes('FROM available_slots')) return { rows: [] };
            if (sql.includes('SELECT r.id FROM rooms r')) return { rows: [{ id: 91 }] };
            return { rows: [], rowCount: 1 };
        },
        async withTransaction(work) {
            return work({ query: (sql, params) => db.query(sql, params) });
        }
    };
    const gmailApi = {
        users: { messages: {
            async list() { return { data: { messages: [{ id: 'message-1' }] } }; },
            async get() {
                return { data: {
                    internalDate: String(Date.parse('2026-09-16T12:00:00Z')),
                    payload: {
                        mimeType: 'text/plain',
                        body: { data: Buffer.from('A'.repeat(200)).toString('base64') }
                    }
                } };
            },
            async modify() { state.modifyCalls++; }
        } }
    };
    const makeGmailService = loadWithMocks(path.join(ROOT, 'services/gmail.js'), {
        '../db': db,
        './groq': { chat: { completions: { async create() {
            return { choices: [{ message: { content: JSON.stringify({
                student_name: 'Ana', resumen: 'ok', deberes: [], conceptos_clave: [],
                pistas_profesor: [], mensaje_motivador: 'ánimo'
            }) } }] };
        } } } },
        './homework-reminders': {
            createHomeworkReminderFromTranscript: async () => null,
            buildHomeworkReminderPrompt: () => ''
        },
        '../notifications': { createNotification() {} },
        './calendar': { makeOAuth2Client: () => ({ setCredentials() {}, on() {} }) },
        './student-match': {
            resolveTranscriptStudent: ({ students }) => students[0]
        },
        './transcript-format': {
            buildTranscriptAnalysisPrompt: () => '',
            buildTranscriptSummaryCard: () => 'summary'
        },
        googleapis: { google: { gmail: () => gmailApi } }
    });
    return {
        state,
        service: makeGmailService({ to: () => ({ emit() {} }) })
    };
}

async function testLoginScopes() {
    const flow = loadLoginFlow();
    flow.handler({ query: {} }, createResponse(), () => {});
    assert.deepStrictEqual(flow.captured.options.scope, ['profile', 'email']);
}

async function testCalendarScopes() {
    const flow = loadCalendarFlow();
    await issueState(flow, '/api/calendar/connect', Date.parse('2026-09-16T12:00:00Z'));
    assert.deepStrictEqual(flow.captured.authOptions[0].scope, [
        'https://www.googleapis.com/auth/calendar.events'
    ]);
}

async function testGmailScopes() {
    const flow = loadGmailFlow();
    await issueState(flow, '/api/gmail/connect', Date.parse('2026-09-16T12:00:00Z'));
    assert.deepStrictEqual(flow.captured.authOptions[0].scope, [
        'https://www.googleapis.com/auth/gmail.readonly'
    ]);
}

async function testCallbacksStaySeparate() {
    const calendar = loadCalendarFlow();
    const gmail = loadGmailFlow();
    const login = loadLoginFlow();
    assert.ok(login.routes.get.has('/auth/google/callback'));
    assert.ok(calendar.routes.get.has('/api/calendar/callback'));
    assert.ok(gmail.routes.get.has('/api/gmail/callback'));
}

async function testInvalidStatesStopTokenExchange() {
    const now = Date.parse('2026-09-16T12:00:00Z');
    const valid = signedState(`42:0123456789abcdef:${now}`);
    const rejected = [
        ['missing', undefined],
        ['tampered', tamperState(valid)],
        ['extra field', signedState(`42:0123456789abcdef:${now}`, { extra: true })],
        ['zero user', signedState(`0:0123456789abcdef:${now}`)],
        ['negative user', signedState(`-1:0123456789abcdef:${now}`)],
        ['decimal user', signedState(`1.5:0123456789abcdef:${now}`)],
        ['infinite user', signedState(`Infinity:0123456789abcdef:${now}`)],
        ['malformed state', signedState(`42:0123456789abcdef:${now}:extra`)],
        ['invalid timestamp', signedState('42:0123456789abcdef:not-a-number')],
        ['future timestamp', signedState(`42:0123456789abcdef:${now + 1}`)],
        ['expired timestamp', signedState(`42:0123456789abcdef:${now - STATE_MAX_AGE_MS - 1}`)]
    ];
    const callbacks = [
        [loadCalendarFlow, '/api/calendar/callback', '/teacher/settings?calendar=error'],
        [loadGmailFlow, '/api/gmail/callback', '/teacher/settings?gmail=error']
    ];

    for (const [loadFlow, callbackPath, errorRedirect] of callbacks) {
        const flow = loadFlow();
        for (const [label, state] of rejected) {
            const res = await callbackWithState(flow, callbackPath, state, now);
            assert.strictEqual(flow.captured.getTokenCalls, 0, `${callbackPath}: ${label}`);
            assert.strictEqual(res.redirectUrl, errorRedirect, `${callbackPath}: ${label}`);
        }
    }
}

async function testStateAtFifteenMinuteBoundaryIsAccepted() {
    const now = Date.parse('2026-09-16T12:00:00Z');
    const state = signedState(`42:0123456789abcdef:${now - STATE_MAX_AGE_MS}`);
    for (const [loadFlow, callbackPath, successRedirect] of [
        [loadCalendarFlow, '/api/calendar/callback', '/teacher/settings?calendar=connected'],
        [loadGmailFlow, '/api/gmail/callback', '/teacher/settings?gmail=connected']
    ]) {
        const flow = loadFlow();
        const res = await callbackWithState(flow, callbackPath, state, now);
        assert.strictEqual(flow.captured.getTokenCalls, 1);
        assert.strictEqual(res.redirectUrl, successRedirect);
    }
}

async function testGmailProcessingNeverModifiesMessages() {
    const { state, service } = loadGmailProcessingFlow();
    const originalLog = console.log;
    console.log = () => {};
    try {
        const processed = await service.checkAndProcessTranscripts({
            id: 7,
            name: 'Ada',
            role: 'teacher',
            academy_id: 3,
            gmail_access_token: 'test-access-token',
            gmail_refresh_token: 'test-refresh-token',
            gmail_token_expiry: Date.now(),
            gmail_last_check: '2026-09-16T10:00:00Z',
            transcript_email: null
        });
        assert.strictEqual(processed, 1);
        assert.strictEqual(state.modifyCalls, 0);
    } finally {
        console.log = originalLog;
    }
}

(async () => {
    const tests = [
        testLoginScopes,
        testCalendarScopes,
        testGmailScopes,
        testCallbacksStaySeparate,
        testInvalidStatesStopTokenExchange,
        testStateAtFifteenMinuteBoundaryIsAccepted,
        testGmailProcessingNeverModifiesMessages
    ];
    for (const test of tests) {
        await test();
        console.log(`✓ ${test.name}`);
    }
    console.log(`\n${tests.length}/${tests.length} oauth-scope tests passed`);
})().catch(err => {
    console.error('✗', err.message);
    process.exit(1);
});
