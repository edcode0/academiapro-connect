'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const {
    authenticateJWT,
    JWT_SECRET,
    AUTH_COOKIE_MAX_AGE_MS,
    AUTH_JWT_EXPIRES_IN,
    AUTH_RENEW_WINDOW_MS,
    signAuthToken,
    buildAuthCookieOptions,
    shouldRenewAuthToken
} = require('../middleware/auth');

function createRes() {
    return {
        statusCode: 200,
        payload: null,
        redirectUrl: null,
        cookies: [],
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        },
        redirect(url) {
            this.redirectUrl = url;
            return this;
        },
        cookie(name, value, options) {
            this.cookies.push({ name, value, options });
            return this;
        }
    };
}

async function runAuth(req, res) {
    await new Promise((resolve, reject) => {
        authenticateJWT(req, res, err => err ? reject(err) : resolve());
    });
}

async function testSharedConstants() {
    assert.strictEqual(AUTH_JWT_EXPIRES_IN, '15d');
    assert.strictEqual(AUTH_COOKIE_MAX_AGE_MS, 15 * 24 * 60 * 60 * 1000);
    assert.strictEqual(AUTH_RENEW_WINDOW_MS, 7 * 24 * 60 * 60 * 1000);
    assert.strictEqual(buildAuthCookieOptions().maxAge, AUTH_COOKIE_MAX_AGE_MS);
}

async function testNewTokenLivesAbout15Days() {
    const token = signAuthToken({ id: 1, role: 'admin', academy_id: 2, email: 'a@b.com', name: 'Ada' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const lifetimeSeconds = decoded.exp - decoded.iat;
    assert.ok(lifetimeSeconds >= 15 * 24 * 60 * 60 - 5);
    assert.ok(lifetimeSeconds <= 15 * 24 * 60 * 60 + 5);
}

async function testShouldRenewNearExpiry() {
    const nowSeconds = Math.floor(Date.now() / 1000);
    assert.strictEqual(shouldRenewAuthToken({ exp: nowSeconds + 2 * 24 * 60 * 60 }, nowSeconds), true);
    assert.strictEqual(shouldRenewAuthToken({ exp: nowSeconds + 10 * 24 * 60 * 60 }, nowSeconds), false);
}

async function testAuthenticateJwtRenewsNearExpiryToken() {
    const shortLivedToken = jwt.sign(
        { id: 9, role: 'teacher', academy_id: 3, email: 'teacher@test.com', name: 'Ada' },
        JWT_SECRET,
        { expiresIn: '6d' }
    );
    const req = {
        cookies: { token: shortLivedToken },
        originalUrl: '/auth/me'
    };
    const res = createRes();

    await runAuth(req, res);

    assert.strictEqual(req.user.id, 9);
    assert.strictEqual(res.cookies.length, 1);
    assert.strictEqual(res.cookies[0].name, 'token');
    assert.strictEqual(res.cookies[0].options.maxAge, AUTH_COOKIE_MAX_AGE_MS);
    const renewed = jwt.verify(res.cookies[0].value, JWT_SECRET);
    assert.ok(renewed.exp - renewed.iat >= 15 * 24 * 60 * 60 - 5);
}

async function testAuthenticateJwtDoesNotRenewFreshToken() {
    const freshToken = signAuthToken({ id: 10, role: 'admin', academy_id: 3, email: 'admin@test.com', name: 'Grace' });
    const req = {
        cookies: { token: freshToken },
        originalUrl: '/api/auth/me'
    };
    const res = createRes();

    await runAuth(req, res);

    assert.strictEqual(req.user.id, 10);
    assert.strictEqual(res.cookies.length, 0);
}

async function run() {
    await testSharedConstants();
    await testNewTokenLivesAbout15Days();
    await testShouldRenewNearExpiry();
    await testAuthenticateJwtRenewsNearExpiryToken();
    await testAuthenticateJwtDoesNotRenewFreshToken();
    console.log('persistent-login tests passed');
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
