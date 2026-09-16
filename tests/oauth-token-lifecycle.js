'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const JWT_SECRET = 'oauth-lifecycle-state-secret';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = JWT_SECRET;
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'oauth-lifecycle-encryption-secret';

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
    const routes = { get: new Map(), post: new Map(), delete: new Map() };
    const register = method => (routePath, ...handlers) => routes[method]?.set(routePath, handlers.at(-1));
    return {
        express: {
            Router: () => ({
                get: register('get'), post: register('post'), put: register('put'), delete: register('delete')
            })
        },
        routes
    };
}

function createResponse() {
    return {
        statusCode: 200,
        payload: null,
        redirectUrl: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; },
        redirect(url) { this.redirectUrl = url; return this; },
        cookie() {},
        sendFile() {}
    };
}

function noopMiddleware(req, res, next) {
    if (next) next();
}

function signedState(userId = 42) {
    const data = `${userId}:0123456789abcdef:${Date.now()}`;
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('hex').substring(0, 16);
    return Buffer.from(JSON.stringify({ d: data, s: signature })).toString('base64');
}

function captureConsole() {
    const output = [];
    const originals = { log: console.log, warn: console.warn, error: console.error };
    for (const method of Object.keys(originals)) {
        console[method] = (...args) => output.push(args.map(String).join(' '));
    }
    return {
        output,
        restore() { Object.assign(console, originals); }
    };
}

const realDb = require('../db');

function encryptedDb(query) {
    return {
        isPostgres: true,
        encryptGoogleToken: realDb.encryptGoogleToken,
        decryptGoogleToken: realDb.decryptGoogleToken,
        query
    };
}

function loadCalendarRouter({ query, revokeToken = async () => {} }) {
    const harness = createRouterHarness();
    class OAuth2 {
        generateAuthUrl() { return 'https://accounts.google.test/auth'; }
        async getToken() {
            return { tokens: { access_token: 'calendar-access-secret', refresh_token: 'calendar-refresh-secret', expiry_date: 123 } };
        }
        async revokeToken(token) { return revokeToken(token); }
    }
    loadWithMocks(path.join(ROOT, 'routes/calendar.js'), {
        express: harness.express,
        '../db': encryptedDb(query),
        googleapis: { google: { auth: { OAuth2 }, calendar: () => ({}) } },
        '../services/calendar': {
            makeOAuth2Client: () => ({}), createCalendarEvent: async () => null, deleteCalendarEvent: async () => {}
        },
        '../middleware/auth': { authenticateJWT: noopMiddleware, JWT_SECRET },
        '../middleware/roles': { requireStudent: noopMiddleware, requireTeacherOrAdmin: noopMiddleware },
        '../services/recurring': { generateRecurringSlots: async () => {} }
    });
    return harness.routes;
}

function loadGmailRouter({ query, revokeToken = async () => {}, checkTranscripts = async () => 0 }) {
    const harness = createRouterHarness();
    class OAuth2 {
        generateAuthUrl() { return 'https://accounts.google.test/auth'; }
        async getToken() {
            return { tokens: { access_token: 'gmail-access-secret', refresh_token: 'gmail-refresh-secret', expiry_date: 456 } };
        }
        async revokeToken(token) { return revokeToken(token); }
    }
    const makeOAuth2Client = () => new OAuth2();
    loadWithMocks(path.join(ROOT, 'routes/transcripts.js'), {
        express: harness.express,
        '../db': encryptedDb(query),
        googleapis: { google: {} },
        '../services/groq': {},
        '../services/calendar': { makeOAuth2Client },
        '../services/homework-reminders': {
            createHomeworkReminderFromTranscript: async () => null, buildHomeworkReminderPrompt: () => ''
        },
        '../services/transcript-format': {
            buildTranscriptAnalysisPrompt: () => '', buildTranscriptSummaryCard: () => ''
        },
        '../utils/multer': { pdfUpload: { single: () => noopMiddleware } },
        '../middleware/auth': { authenticateJWT: noopMiddleware },
        '../middleware/roles': { requireAdmin: noopMiddleware, requireTeacherOrAdmin: noopMiddleware },
        '../notifications': { createNotification() {} },
        '../services/gmail': () => ({ checkAndProcessTranscripts: checkTranscripts })
    }, makeRouter => makeRouter({ to: () => ({ emit() {} }) }));
    return harness.routes;
}

function loadGmailService({ query, listError = null }) {
    let tokenHandler;
    const oauth = {
        setCredentials() {},
        on(event, handler) { if (event === 'tokens') tokenHandler = handler; }
    };
    const gmailApi = { users: { messages: { async list() {
        if (listError) throw listError;
        return { data: { messages: [] } };
    } } } };
    const makeService = loadWithMocks(path.join(ROOT, 'services/gmail.js'), {
        '../db': encryptedDb(query),
        './groq': {},
        './homework-reminders': {
            createHomeworkReminderFromTranscript: async () => null, buildHomeworkReminderPrompt: () => ''
        },
        '../notifications': { createNotification: async () => {} },
        './calendar': { makeOAuth2Client: () => oauth },
        './student-match': { resolveTranscriptStudent: () => null },
        './transcript-format': {
            buildTranscriptAnalysisPrompt: () => '', buildTranscriptSummaryCard: () => ''
        },
        googleapis: { google: { gmail: () => gmailApi } }
    });
    return {
        service: makeService({ to: () => ({ emit() {} }) }),
        getTokenHandler: () => tokenHandler
    };
}

function loadAuthRouter({ query, withTransaction, revokeToken }) {
    const harness = createRouterHarness();
    class OAuth2 {
        async revokeToken(token) { return revokeToken(token); }
    }
    loadWithMocks(path.join(ROOT, 'routes/auth.js'), {
        express: harness.express,
        bcryptjs: { hashSync: () => '', compareSync: () => true },
        passport: { authenticate: () => noopMiddleware },
        googleapis: { google: { auth: { OAuth2 } } },
        '../db': { query, withTransaction },
        '../middleware/auth': {
            authenticateJWT: noopMiddleware, buildAuthCookieOptions: () => ({}), signAuthToken: () => 'jwt'
        },
        '../middleware/roles': { requireTeacherOrAdmin: noopMiddleware },
        '../services/email': { sendWelcomeEmail() {}, sendJoinWelcomeEmail() {} },
        '../utils/codes': { generateCode: () => 'code', generateUserCode: () => 'user-code' },
        'express-rate-limit': () => noopMiddleware
    });
    return harness.routes;
}

async function testAuthenticatedEncryptionRoundTrip() {
    assert.strictEqual(typeof realDb.encryptGoogleToken, 'function');
    assert.strictEqual(typeof realDb.decryptGoogleToken, 'function');
    const ciphertext = realDb.encryptGoogleToken('access-token-secret');
    assert.notStrictEqual(ciphertext, 'access-token-secret');
    assert.strictEqual(realDb.decryptGoogleToken(ciphertext), 'access-token-secret');
    assert.strictEqual(realDb.decryptGoogleToken('legacy-plaintext-token'), 'legacy-plaintext-token');
    const parts = ciphertext.split(':');
    const bytes = Buffer.from(parts[4], 'base64');
    bytes[0] ^= 1;
    parts[4] = bytes.toString('base64');
    const tampered = parts.join(':');
    assert.throws(() => realDb.decryptGoogleToken(tampered));
}

async function testProductionRequiresEncryptionKey() {
    const script = `delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY; process.env.NODE_ENV='production'; require(${JSON.stringify(path.join(ROOT, 'db.js'))});`;
    const env = { ...process.env };
    delete env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    const child = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env, encoding: 'utf8' });
    assert.notStrictEqual(child.status, 0);
    assert.match(child.stderr, /GOOGLE_TOKEN_ENCRYPTION_KEY/);
    const testChild = spawnSync(process.execPath, ['-e', `process.env.NODE_ENV='test'; require(${JSON.stringify(path.join(ROOT, 'db.js'))}); process.exit(0);`], {
        cwd: ROOT, env, encoding: 'utf8'
    });
    assert.strictEqual(testChild.status, 0, testChild.stderr);
}

async function testSqliteMigratesAndTransparentlyDecryptsTokens() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'academiapro-oauth-'));
    const copiedDb = path.join(tempDir, 'db.js');
    fs.copyFileSync(path.join(ROOT, 'db.js'), copiedDb);
    const script = `
        process.env.NODE_ENV = 'test';
        process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'sqlite-lifecycle-secret';
        const db = require(${JSON.stringify(copiedDb)});
        const sqlite3 = require(${JSON.stringify(path.join(ROOT, 'node_modules/sqlite3'))}).verbose();
        (async () => {
            await db.initDb();
            await db.query(
                'INSERT INTO users (name,email,role,calendar_access_token,calendar_refresh_token,gmail_access_token,gmail_refresh_token) VALUES ($1,$2,$3,$4,$5,$6,$7)',
                ['Ada', 'ada@test.invalid', 'teacher', 'ca-plain', 'cr-plain', 'ga-plain', 'gr-plain']
            );
            await db.initDb();
            const visible = (await db.query('SELECT calendar_access_token, gmail_refresh_token FROM users WHERE email=$1', ['ada@test.invalid'])).rows[0];
            if (visible.calendar_access_token !== 'ca-plain' || visible.gmail_refresh_token !== 'gr-plain') throw new Error('transparent decrypt failed');
            const rawDb = new sqlite3.Database(${JSON.stringify(path.join(tempDir, 'academia.db'))});
            rawDb.get('SELECT calendar_access_token, calendar_refresh_token, gmail_access_token, gmail_refresh_token FROM users WHERE email=?', ['ada@test.invalid'], (err, raw) => {
                if (err) throw err;
                for (const value of Object.values(raw)) {
                    if (!value.startsWith('gcm:v1:') || value.includes('plain')) throw new Error('token stored without encryption');
                }
                rawDb.close(() => process.exit(0));
            });
        })().catch(err => { console.error(err.message); process.exit(1); });
    `;
    try {
        const child = spawnSync(process.execPath, ['-e', script], {
            cwd: ROOT,
            env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') },
            encoding: 'utf8'
        });
        assert.strictEqual(child.status, 0, child.stderr || child.stdout);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function testSuccessfulConnectionsStoreCiphertext() {
    for (const [kind, loadRouter, callbackPath, prefix] of [
        ['Calendar', loadCalendarRouter, '/api/calendar/callback', 'calendar'],
        ['Gmail', loadGmailRouter, '/api/gmail/callback', 'gmail']
    ]) {
        const writes = [];
        const routes = loadRouter({ query: async (sql, params = []) => { writes.push({ sql, params }); return { rows: [] }; } });
        const res = createResponse();
        await routes.get.get(callbackPath)({ query: { code: 'code', state: signedState() } }, res, () => {});
        const write = writes.find(item => item.sql.includes(`UPDATE users SET ${prefix}_access_token`));
        assert.ok(write, `${kind} connection must persist tokens`);
        assert.notStrictEqual(write.params[0], `${prefix}-access-secret`);
        assert.notStrictEqual(write.params[1], `${prefix}-refresh-secret`);
        assert.strictEqual(realDb.decryptGoogleToken(write.params[0]), `${prefix}-access-secret`);
        assert.strictEqual(realDb.decryptGoogleToken(write.params[1]), `${prefix}-refresh-secret`);
        assert.ok(!JSON.stringify(res.payload).includes(`${prefix}-access-secret`));
    }
}

async function testRefreshPersistsCiphertext() {
    const writes = [];
    const { service, getTokenHandler } = loadGmailService({
        query: async (sql, params = []) => { writes.push({ sql, params }); return { rows: [] }; }
    });
    await service.checkAndProcessTranscripts({
        id: 7, name: 'Ada', academy_id: 3,
        gmail_access_token: 'old-access', gmail_refresh_token: 'old-refresh', gmail_token_expiry: 1
    });
    await getTokenHandler()({ access_token: 'refreshed-access', expiry_date: 789 });
    const write = writes.find(item => item.sql.includes('gmail_access_token=$1'));
    assert.strictEqual(realDb.decryptGoogleToken(write.params[0]), 'refreshed-access');
    assert.strictEqual(realDb.decryptGoogleToken(write.params[1]), 'old-refresh');
    assert.ok(!write.params.includes('refreshed-access'));
}

async function testInvalidGrantAlwaysClearsWithoutLeakingToken() {
    const writes = [];
    const logs = captureConsole();
    try {
        const { service } = loadGmailService({
            query: async (sql, params = []) => { writes.push({ sql, params }); return { rows: [] }; },
            listError: new Error('invalid_grant token=access-token-secret')
        });
        const result = await service.checkAndProcessTranscripts({
            id: 7, name: 'Ada', academy_id: 3,
            gmail_access_token: 'access-token-secret', gmail_refresh_token: 'refresh-token-secret'
        });
        assert.strictEqual(result, 0);
        assert.ok(writes.some(item => item.sql.includes('gmail_access_token=NULL')));
        assert.ok(!logs.output.join('\n').includes('access-token-secret'));
        assert.ok(!logs.output.join('\n').includes('refresh-token-secret'));
    } finally {
        logs.restore();
    }
}

async function testGmailCheckErrorDoesNotLeakToken() {
    const routes = loadGmailRouter({
        query: async sql => sql.includes('SELECT * FROM users')
            ? { rows: [{ gmail_access_token: 'access-token-secret' }] }
            : { rows: [] },
        checkTranscripts: async () => { throw new Error('upstream token=access-token-secret'); }
    });
    const logs = captureConsole();
    let res;
    try {
        res = createResponse();
        await routes.post.get('/api/gmail/check-transcripts')({ user: { id: 42 } }, res, () => {});
    } finally {
        logs.restore();
    }
    assert.strictEqual(res.statusCode, 500);
    assert.ok(!JSON.stringify(res.payload).includes('access-token-secret'));
    assert.ok(!logs.output.join('\n').includes('access-token-secret'));
}

async function testExplicitDisconnectAlwaysClears() {
    for (const [kind, loadRouter, pathName, prefix] of [
        ['Calendar', loadCalendarRouter, '/api/calendar/disconnect', 'calendar'],
        ['Gmail', loadGmailRouter, '/api/gmail/disconnect', 'gmail']
    ]) {
        const events = [];
        const access = `${prefix}-access-secret`;
        const refresh = `${prefix}-refresh-secret`;
        const routes = loadRouter({
            query: async (sql, params = []) => {
                events.push({ type: 'query', sql, params });
                if (sql.startsWith('SELECT')) return { rows: [{ [`${prefix}_access_token`]: access, [`${prefix}_refresh_token`]: refresh }] };
                return { rows: [], rowCount: 1 };
            },
            revokeToken: async token => { events.push({ type: 'revoke', token }); throw new Error(`upstream echoed ${token}`); }
        });
        const logs = captureConsole();
        let res;
        try {
            res = createResponse();
            await routes.delete.get(pathName)({ user: { id: 42 } }, res, () => {});
        } finally {
            logs.restore();
        }
        assert.strictEqual(res.statusCode, 200, `${kind} disconnect must succeed when revocation fails`);
        assert.strictEqual(res.payload.revocation, 'failed');
        assert.ok(events.some(event => event.type === 'revoke' && event.token === refresh));
        assert.ok(events.some(event => event.type === 'query' && event.sql.includes(`${prefix}_access_token=NULL`)));
        assert.ok(!JSON.stringify(res.payload).includes(access));
        assert.ok(!logs.output.join('\n').includes(refresh));
    }
}

async function testAccountDeletionRevokesAndClearsForAdminAndUser() {
    for (const user of [
        { id: 9, role: 'teacher', academy_id: 3 },
        { id: 1, role: 'admin', academy_id: 3 }
    ]) {
        const events = [];
        const query = async (sql, params = []) => {
            events.push({ type: 'query', sql, params });
            if (sql.startsWith('SELECT')) return { rows: [{
                id: user.id,
                calendar_access_token: 'calendar-access-secret', calendar_refresh_token: 'calendar-refresh-secret',
                gmail_access_token: 'gmail-access-secret', gmail_refresh_token: 'gmail-refresh-secret'
            }, ...(user.role === 'admin' ? [{
                id: 2,
                calendar_access_token: 'calendar-access-secret-2', calendar_refresh_token: 'calendar-refresh-secret-2',
                gmail_access_token: 'gmail-access-secret-2', gmail_refresh_token: 'gmail-refresh-secret-2'
            }] : [])] };
            return { rows: [], rowCount: 1 };
        };
        const withTransaction = async work => work({ query: async (sql, params) => {
            events.push({ type: 'transaction', sql, params });
            return { rows: [], rowCount: 1 };
        } });
        const routes = loadAuthRouter({
            query,
            withTransaction,
            revokeToken: async token => {
                events.push({ type: 'revoke', token });
                if (token.startsWith('gmail')) throw new Error(`upstream echoed ${token}`);
            }
        });
        const logs = captureConsole();
        let res;
        try {
            res = createResponse();
            await routes.delete.get('/api/auth/delete-account')({ user }, res, () => {});
        } finally {
            logs.restore();
        }
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.payload.success, true);
        assert.deepStrictEqual(
            res.payload.googleRevocation,
            user.role === 'admin'
                ? { attempted: 4, succeeded: 2, failed: 2 }
                : { attempted: 2, succeeded: 1, failed: 1 }
        );
        const clearIndex = events.findIndex(event => event.type === 'query' && event.sql.includes('calendar_access_token=NULL'));
        const deleteIndex = events.findIndex(event => event.type === 'transaction' && event.sql.includes('DELETE FROM users'));
        assert.ok(clearIndex >= 0 && deleteIndex > clearIndex, `${user.role} tokens must be cleared before local deletion`);
        assert.ok(!JSON.stringify(res.payload).includes('secret'));
        assert.ok(!logs.output.join('\n').includes('gmail-refresh-secret'));
    }
}

(async () => {
    const tests = [
        testAuthenticatedEncryptionRoundTrip,
        testProductionRequiresEncryptionKey,
        testSqliteMigratesAndTransparentlyDecryptsTokens,
        testSuccessfulConnectionsStoreCiphertext,
        testRefreshPersistsCiphertext,
        testInvalidGrantAlwaysClearsWithoutLeakingToken,
        testGmailCheckErrorDoesNotLeakToken,
        testExplicitDisconnectAlwaysClears,
        testAccountDeletionRevokesAndClearsForAdminAndUser
    ];
    let failures = 0;
    for (const test of tests) {
        try {
            await test();
            console.log(`✓ ${test.name}`);
        } catch (err) {
            failures++;
            console.error(`✗ ${test.name}: ${err.message}`);
        }
    }
    if (failures) throw new Error(`${failures}/${tests.length} lifecycle tests failed`);
    console.log(`\n${tests.length}/${tests.length} oauth-token-lifecycle tests passed`);
})().catch(err => {
    console.error('✗', err.message);
    process.exit(1);
});
