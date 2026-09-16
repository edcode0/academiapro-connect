'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JWT_SECRET = 'oauth-scope-test-secret';
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
    Date.now = () => now;
    console.error = () => {};
    try {
        const res = createResponse();
        await flow.routes.get.get(callbackPath)({ query: { code: 'code', state } }, res, () => {});
        return res;
    } finally {
        Date.now = originalNow;
        console.error = originalError;
    }
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

async function testExpiredCalendarStateStopsTokenExchange() {
    const flow = loadCalendarFlow();
    const issuedAt = Date.parse('2026-09-16T12:00:00Z');
    const state = await issueState(flow, '/api/calendar/connect', issuedAt);
    const res = await callbackWithState(flow, '/api/calendar/callback', state, issuedAt + 15 * 60 * 1000 + 1);
    assert.strictEqual(flow.captured.getTokenCalls, 0);
    assert.strictEqual(res.redirectUrl, '/teacher/settings?calendar=error');
}

async function testExpiredGmailStateStopsTokenExchange() {
    const flow = loadGmailFlow();
    const issuedAt = Date.parse('2026-09-16T12:00:00Z');
    const state = await issueState(flow, '/api/gmail/connect', issuedAt);
    const res = await callbackWithState(flow, '/api/gmail/callback', state, issuedAt + 15 * 60 * 1000 + 1);
    assert.strictEqual(flow.captured.getTokenCalls, 0);
    assert.strictEqual(res.redirectUrl, '/teacher/settings?gmail=error');
}

(async () => {
    const tests = [
        testLoginScopes,
        testCalendarScopes,
        testGmailScopes,
        testCallbacksStaySeparate,
        testExpiredCalendarStateStopsTokenExchange,
        testExpiredGmailStateStopsTokenExchange
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
