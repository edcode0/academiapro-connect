'use strict';

// Regression guard for the transcript-processing storm (2026-07-30):
// a backlog of unprocessable emails was re-analyzed on every 15-min tick,
// exhausting the Groq daily token quota so no transcript ever reached a chat.

const assert = require('assert');
const path   = require('path');
const Module = require('module');

const GMAIL_PATH = path.join(path.resolve(__dirname, '..'), 'services/gmail.js');

function loadWithMocks(targetPath, mocks) {
    delete require.cache[require.resolve(targetPath)];
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try { return require(targetPath); } finally { Module._load = originalLoad; }
}

const TEACHER = {
    id: 7, name: 'Profesora Ada', role: 'teacher', academy_id: 3,
    gmail_access_token: 'token', gmail_refresh_token: 'refresh',
    gmail_token_expiry: Date.now(), gmail_last_check: '2026-07-01T00:00:00Z',
    transcript_email: null
};

function buildEnv({ messages, groqCreate, listThrows }) {
    const state = { sql: [], groqCalls: 0, gmailGets: 0 };

    const db = {
        isPostgres: true,
        state,
        async query(sql, params = []) {
            state.sql.push({ sql, params });
            if (sql.includes('SELECT id FROM transcripts WHERE gmail_msg_id')) return { rows: [] };
            if (sql.includes('FROM students s WHERE s.academy_id')) return { rows: [{ id: 12, name: 'Ana', user_id: 55 }] };
            if (sql.includes('SELECT r.id FROM rooms r')) return { rows: [{ id: 91 }] };
            return { rows: [], rowCount: 1 };
        },
        async withTransaction(work) {
            return work({ query: (sql, params) => db.query(sql, params) });
        }
    };

    const gmailApi = {
        users: { messages: {
            async list() {
                if (listThrows) throw new Error(listThrows);
                return { data: { messages } };
            },
            async get() {
                state.gmailGets++;
                return { data: {
                    internalDate: String(Date.parse('2026-07-20T10:00:00Z')),
                    payload: { mimeType: 'text/plain', body: { data: Buffer.from('A'.repeat(200)).toString('base64') } }
                } };
            },
            async modify() { return { data: {} }; }
        } }
    };

    const groq = { chat: { completions: { async create() { state.groqCalls++; return groqCreate(state.groqCalls); } } } };

    const makeGmailService = loadWithMocks(GMAIL_PATH, {
        '../db': db,
        './groq': groq,
        './homework-reminders': {
            createHomeworkReminderFromTranscript: async () => null,
            buildHomeworkReminderPrompt: () => ''
        },
        '../notifications': { createNotification: async () => {} },
        './calendar': { makeOAuth2Client: () => ({ setCredentials() {}, on() {} }) },
        googleapis: { google: { gmail: () => gmailApi } }
    });

    return { state, service: makeGmailService({ to: () => ({ emit() {} }) }) };
}

const okAnalysis = () => ({ choices: [{ message: { content: JSON.stringify({
    student_name: 'Ana', resumen: 'ok', deberes: [], conceptos_clave: [],
    pistas_profesor: [], mensaje_motivador: 'animo'
}) } }] });

const movedWindow = (state) => state.sql.some(q => q.sql.includes('UPDATE users SET gmail_last_check'));

async function testRateLimitAbortsBatch() {
    const err = Object.assign(new Error('429 rate_limit_exceeded: tokens per day'), { status: 429 });
    const { state, service } = buildEnv({
        messages: Array.from({ length: 30 }, (_, i) => ({ id: `msg-${i}` })),
        groqCreate: () => { throw err; }
    });

    const processed = await service.checkAndProcessTranscripts(TEACHER);

    assert.strictEqual(processed, 0);
    assert.strictEqual(state.groqCalls, 1, 'must stop after the first quota error, not burn one call per email');
    assert.ok(!movedWindow(state), 'window must not move while emails are still pending');
}

async function testBatchCapLimitsRun() {
    const { state, service } = buildEnv({
        messages: Array.from({ length: 30 }, (_, i) => ({ id: `msg-${i}` })),
        groqCreate: okAnalysis
    });

    const processed = await service.checkAndProcessTranscripts(TEACHER);

    assert.strictEqual(processed, 5, 'per-run cap keeps daily token burn bounded');
    assert.strictEqual(state.groqCalls, 5);
    assert.ok(!movedWindow(state), 'older unreached emails would be lost if the window advanced');
}

async function testWindowAdvancesWhenBatchCompletes() {
    const { state, service } = buildEnv({
        messages: [{ id: 'msg-1' }, { id: 'msg-2' }],
        groqCreate: okAnalysis
    });

    const processed = await service.checkAndProcessTranscripts(TEACHER);

    assert.strictEqual(processed, 2);
    assert.ok(movedWindow(state), 'a fully drained batch must still advance the window');
}

async function testInvalidGrantClearsTokens() {
    const { state, service } = buildEnv({ messages: [], groqCreate: okAnalysis, listThrows: 'invalid_grant' });

    const processed = await service.checkAndProcessTranscripts(TEACHER);

    assert.strictEqual(processed, 0);
    assert.ok(
        state.sql.some(q => q.sql.includes('gmail_access_token=NULL')),
        'revoked token must be cleared so the teacher is prompted to reconnect'
    );
}

(async () => {
    const tests = [
        testRateLimitAbortsBatch,
        testBatchCapLimitsRun,
        testWindowAdvancesWhenBatchCompletes,
        testInvalidGrantClearsTokens
    ];
    for (const t of tests) {
        await t();
        console.log(`✓ ${t.name}`);
    }
    console.log(`\n${tests.length}/${tests.length} gmail-resilience tests passed`);
})().catch(err => {
    console.error('✗', err.message);
    process.exit(1);
});
