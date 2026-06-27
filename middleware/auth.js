'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('[FATAL] JWT_SECRET environment variable is not set');
    process.exit(1);
}

const AUTH_COOKIE_MAX_AGE_MS = 15 * 24 * 60 * 60 * 1000;
const AUTH_RENEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_JWT_EXPIRES_IN = '15d';

function buildAuthCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: AUTH_COOKIE_MAX_AGE_MS
    };
}

function signAuthToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: AUTH_JWT_EXPIRES_IN });
}

function shouldRenewAuthToken(decodedToken, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!decodedToken?.exp) return false;
    return (decodedToken.exp - nowSeconds) * 1000 < AUTH_RENEW_WINDOW_MS;
}

const authenticateJWT = (req, res, next) => {
    const token = req.cookies.token;

    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
                return res.redirect('/login');
            }
            req.user = user;
            if (shouldRenewAuthToken(user)) {
                const renewedToken = signAuthToken({
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    academy_id: user.academy_id,
                    name: user.name,
                    user_code: user.user_code
                });
                res.cookie('token', renewedToken, buildAuthCookieOptions());
            }
            next();
        });
    } else {
        if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
        res.redirect('/login');
    }
};

module.exports = {
    authenticateJWT,
    JWT_SECRET,
    AUTH_COOKIE_MAX_AGE_MS,
    AUTH_RENEW_WINDOW_MS,
    AUTH_JWT_EXPIRES_IN,
    buildAuthCookieOptions,
    signAuthToken,
    shouldRenewAuthToken
};
