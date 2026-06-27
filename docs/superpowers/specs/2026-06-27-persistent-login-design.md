# Persistent Login Design

Date: 2026-06-27
Repo: `AcademiaPro`
Status: approved in chat, pending final user review of this file

## Goal

Make login persistence feel like a mainstream consumer app: if a user keeps using AcademiaPro in the same browser, they should stay logged in without repeatedly entering email and password.

## Current State

AcademiaPro already stores authentication in an HTTP-only `token` cookie backed by a JWT. The current duration is effectively 7 days because:

- cookie `maxAge` is 7 days in `routes/auth.js`;
- JWT `expiresIn` is 7 days in the login, join, and Google auth flows.

This already survives browser restarts, but it expires too soon and does not renew while the user remains active.

## Decision

Implement a sliding 15-day session for the current browser/device only.

Behavior:

- new login creates a JWT valid for 15 days;
- the auth cookie also lasts 15 days;
- when an authenticated request arrives with a still-valid token that is close enough to expiry, the server issues a fresh 15-day JWT and rewrites the cookie;
- logout clears only the current browser/device session.

Recommended renewal threshold:

- renew when the token has less than 7 days remaining.

This gives the user the expected "I keep using the app, so I stay signed in" behavior without adding session tables, refresh tokens, or multi-device revocation logic.

## Non-Goals

- No "log out from all devices" feature.
- No session management UI.
- No refresh-token architecture.
- No database schema changes.
- No changes to role/academy auth rules.

## Backend Changes

Touch the minimum surface:

- `routes/auth.js`
  - centralize auth cookie/JWT duration constants;
  - change auth cookie lifetime from 7 days to 15 days;
  - change JWT expiry from 7 days to 15 days in:
    - email/password login
    - join flow
    - Google auth existing-user flow
    - Google auth new-user flow

- `middleware/auth.js`
  - after successful JWT verification, inspect token expiry;
  - if remaining lifetime is below the renewal threshold, mint a fresh JWT with the same auth payload and rewrite the cookie with the same secure flags;
  - keep current unauthorized handling unchanged.

## Frontend / Docs Impact

No UI redesign is required.

Documentation must be corrected where it is now inaccurate:

- `public/privacy.html` currently says the `token` cookie lasts for the browser session;
- update that wording to reflect a persistent auth cookie lasting up to 15 days, renewed while the user remains active.

## Security / Behavior Boundaries

- Logout remains local to the current browser/device.
- A stolen valid token still remains usable until expiry, as with the current design; this change extends the window from 7 days to 15 days for active sessions.
- Since no server-side session store is introduced, the app still cannot revoke all devices at once.

## Testing

Keep verification small and direct:

1. Login should issue a cookie/JWT with a 15-day lifetime.
2. A token with less than 7 days remaining should be renewed by an authenticated request such as `/auth/me`.
3. A token with more than 7 days remaining should not be unnecessarily renewed.
4. Logout should still clear the cookie for the current browser.
5. Existing smoke tests should still pass.

## Risks

- Renewing on every request would be unnecessary churn; renewal must be threshold-based.
- The auth middleware currently only verifies and forwards `req.user`; renewal logic must preserve the same payload fields already relied upon by downstream routes.
- Privacy/cookie documentation must be updated in the same change so product behavior and legal text stay aligned.

## Follow-Up

If future product requirements need stronger account security controls, the next step would be server-side session invalidation or a per-user token version for global logout. That is explicitly out of scope for this change.
