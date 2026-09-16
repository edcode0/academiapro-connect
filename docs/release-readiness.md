# Google Play release readiness

Baseline frozen on 2026-09-16 from branch `codex/google-play-readiness` at `29d28b2c6d53`; updated through Tasks 2–4 on the same branch.

## Status

**Release blocked.** Play Console has reserved the immutable package name `academy.academiapro.app`, but no Android wrapper/build was available to verify that it actually uses that ID. Do not change OAuth configuration or submit Play/Cloud forms until the Android artifact, Google Cloud OAuth project, and Play Console configuration are verified against each other.

## Released surface

- Account registration, password login, Google login, invitations, JWT sessions, and `admin`/`teacher`/`student` roles.
- Academy, teacher, student, session, payment, exam, and report management.
- Real-time chat, file attachments, and notifications.
- Calendar availability, booking, recurring classes, Google Calendar events, and Meet links.
- AI tutor, exam assistance, reports, and transcript analysis through DeepSeek.
- Manual PDF/DOCX/TXT transcripts and automatic Gmail transcript capture, summaries, homework reminders, and chat delivery.
- Authenticated account deletion for all roles through `DELETE /api/auth/delete-account`.

## OAuth requests

| Flow | Route | Exact scopes | Callback |
|---|---|---|---|
| Google login | `GET /auth/google` | `profile`, `email` | `${BASE_URL}/auth/google/callback` |
| Calendar connection | `GET /api/calendar/connect` | `https://www.googleapis.com/auth/calendar.events` | `${BASE_URL}/api/calendar/callback` |
| Gmail connection | `GET /api/gmail/connect` | `https://www.googleapis.com/auth/gmail.readonly` | `${BASE_URL}/api/gmail/callback` |

The three flows are separate. Calendar is limited to event operations and Gmail is read-only. OAuth state is HMAC-signed and expires after 15 minutes.

## Google API operations

| API | Operations | Purpose |
|---|---|---|
| Calendar v3 | `events.insert`, `events.get`, `events.patch`, `events.delete` | create Meet-backed events, read/update attendees, and delete events |
| Gmail v1 | `users.messages.list`, `users.messages.get` | find and read transcript/Meet-note messages without changing them |
| OAuth 2.0 | authorization URL, code exchange, token refresh, and token revocation | connect/disconnect Gmail and Calendar and maintain server-side credentials |

No Gmail send/modify/delete/settings operations or non-event Calendar operations were found.

## Data and processing inventory

- Account: name, email, password hash, Google ID, role, academy, and user code.
- Academic: students, teachers, sessions, notes, exams, results, homework, reports, and internal payment records.
- Communications: chat messages, attachments, notifications, and AI conversations.
- Google integration: OAuth tokens, Gmail transcript alias, message ID/body, Drive/Meet link, Calendar event ID, attendee email, and event times.
- Transcripts: up to 8,000 Gmail-body characters or 12,000 manually supplied characters are sent to DeepSeek; up to 5,000 raw characters plus processed JSON are stored.
- Technical: rate-limit IP data, operational logs, and error traces sent to Sentry when configured.

Google access and refresh tokens are stored only on the server and encrypted in the database with AES-256-GCM. Refresh events persist encrypted values. Authenticated Calendar and Gmail disconnect endpoints attempt Google revocation and always clear local credentials; account deletion follows the same best-effort revocation and local-cleanup rule.

### Retention and deletion

The corrected policy states the behavior proved by the repository:

- Account, academic, chat, and transcript records remain while the account is active; no automated per-category expiry job was found.
- `DELETE /api/auth/delete-account` removes the account's database records (or the academy and associated database records for an admin), clears local Google tokens, and attempts grant revocation.
- The deletion route does not prove deletion of uploaded attachment files from persistent storage, copies made by users, or data already processed by external providers. The public policy and deletion page do not promise those outcomes.
- The backend exposes authenticated disconnect routes, but the current settings pages do not expose disconnect buttons. The policy therefore points users to the support contact or Google Account revocation when the control is unavailable.

## Providers

| Provider | Current use | Public disclosure |
|---|---|---|
| Railway | hosting, PostgreSQL, persistent files | declared |
| Google | OAuth login, Gmail, Calendar, Meet | declared with final scopes, operations, token handling, disconnection, and deletion behavior |
| DeepSeek | AI tutor and transcript analysis | declared with the exact transcript slices and purpose; no unverified provider-retention promise |
| Resend | transactional email and reports | declared |
| Sentry | error monitoring | declared |
| Google Fonts, jsDelivr, cdnjs | remote frontend assets | not inventoried |

`public/privacy.html` and `public/terms.html` now name DeepSeek. The privacy policy discloses that the Gmail flow sends up to 8,000 characters of the selected message text plus candidate student names, while manual uploads send up to 12,000 characters; up to 5,000 raw characters plus structured JSON are stored locally.

## Commercial surface

The first Android release is an access app for academies that already have a subscription. It must not sell digital content, initiate Stripe checkout, link users directly to Stripe, or present an in-app purchase path. Any future Stripe subscription flow remains web-only until Google Play billing policy and the EEA alternatives are reviewed.

Evidence and current contradiction:

- `docs/billing-roadmap.md:3,9-11,23,65-67` says Stripe is not implemented, plans/prices are not final, Android purchase is excluded from v1, and future contracting/payment belongs on the web.
- `public/landing.html:779-788` advertises Stripe as an existing integration.
- `public/landing.html:864-947` advertises fixed Free/Pro/Academia tiers, €29/€59 monthly pricing, annual savings, limits, and purchase-oriented calls to action.
- `public/terms.html` now states that Stripe, definitive plans/prices, and in-app Android purchases are not implemented.

The terms contradiction is resolved. The landing-page claims remain outside Task 4's strict file scope and must still be removed or qualified before Play review.

## Public URLs

Live baseline verified on 2026-09-16 with HTTPS certificate validation enabled; Task 4 candidate paths were also verified locally:

| Resource | URL | Result |
|---|---|---|
| Homepage | `https://academiapro.academy/` | `200` |
| Privacy | `https://academiapro.academy/privacy` and `/privacy.html` | `200` |
| Terms | `https://academiapro.academy/terms` and `/terms.html` | `200` |
| Support page | `https://academiapro.academy/support` | `404` |
| Account deletion page | target: `https://academiapro.academy/delete-account.html` | local candidate `200`; live deployment still required |

Privacy, terms, and deletion instructions use `hola@academiapro.academy`. The address was supplied as created, but delivery/monitoring has not been tested and is deliberately not claimed as verified.

The repository now contains a public static deletion resource that requires no login and collects no data. It must be deployed and its HTTPS response checked before entering the URL in Play Console.

## Android release artifact

No `AndroidManifest.xml`, Gradle settings, Capacitor config, TWA manifest, Digital Asset Links file, or other Android wrapper was found in the repository, available refs, `/Users/edu/Desktop/app academy`, or `/Users/edu/Documents`.

### Frozen package identity

- **Immutable Play Console package/application ID:** `academy.academiapro.app`.
- This value is a confirmed release decision supplied from Play Console; it is not derived from this repository.
- The Android build remains unverified. When the wrapper is supplied, its manifest/Gradle `applicationId`, signing identity, OAuth Android client, App Links/Digital Asset Links, and uploaded AAB must all match this package exactly.

### Android OAuth requirement

Google login and OAuth consent must use a secure external user agent: Chrome Custom Tabs or the system browser, with the appropriate Android/native integration. A normal embedded `WebView` must not display Google sign-in or consent. If the product shell uses WebView for ordinary AcademiaPro pages, every Google authorization navigation must be intercepted and opened externally, then returned through a verified supported redirect/app-link flow.

Evidence: Google's OAuth policy forbids authorization requests in an embedded user agent, and Google's Android guidance does not support embedded WebViews for sign-in: <https://developers.google.com/identity/protocols/oauth2/policies>, <https://developers.google.com/identity/siwg/best-practices>, and <https://developers.google.com/identity/gsi/web/guides/supported-browsers>.

Until an artifact is supplied, its status is **not started or not delivered**, and these facts remain unknown:

- WebView, Custom Tabs, TWA, or native implementation;
- whether the build actually declares `academy.academiapro.app`, and its version;
- signing certificate fingerprints;
- OAuth client, external-user-agent handling, and redirect/app-link behavior;
- AAB/APK build status.

## External identity limitations

### Google Cloud

No project ID, console export, local `.env`, or configured `gcloud` client was available. The OAuth brand, audience, authorized domains, clients, callbacks, approved scopes, verification status, contacts, and user cap could not be checked.

The Gmail scope requested by the code is restricted. Because Gmail-derived data is stored and transmitted by the server, restricted-scope verification and a security assessment may apply: <https://developers.google.com/workspace/gmail/api/auth/scopes> and <https://support.google.com/cloud/answer/13464321?hl=en>.

### Play Console

The immutable package name is recorded as `academy.academiapro.app`. No authenticated console access or export was supplied, so the corresponding app record and Android build could not be independently verified. The listing, Data safety form, deletion URL, policy declarations, signing, tracks, testers, artifacts, and distribution remain unchecked.

## Repository security scan

- No high-confidence Google/API/GitHub token or private-key pattern was found in tracked text.
- `.env.example` contains variable names/placeholders only; no working `.env` is present in this worktree.
- No explicit logging of OAuth token, client-secret, JWT-secret, session-secret, or API-key values was found.
- The tracked `database.sqlite` blob is empty.
- The transcript parse-error path no longer logs the AI response body, and OAuth/revocation failures use generic messages.
- Production logs must still be reviewed before launch to confirm third-party libraries do not add sensitive response metadata.

No credential values were copied into this document.

## Launch blockers

| Priority | Blocker | Exit condition |
|---|---|---|
| P0 | Android wrapper/build not available for verification | supply its repository/path and prove `applicationId=academy.academiapro.app`, version, signing identity, App Links, and AAB |
| P0 | Android OAuth user agent undecided/unverified | prove Google login/consent uses Custom Tabs/system browser or supported native integration, never a normal embedded WebView |
| P0 | Google Cloud OAuth project not identified | supply project access or a secret-free export of brand, audience, clients, redirects, scopes, and verification |
| P0 | Play Console configuration/build not verified | supply secret-free evidence for package `academy.academiapro.app`, app content, signing, and release artifact |
| P0 | Account-deletion page not deployed | deploy `public/delete-account.html`, verify `https://academiapro.academy/delete-account.html`, and register it in Play Console |
| P0 | Restricted Gmail scopes with server storage/transmission | confirm verification/security-assessment path or reduce/redesign access |
| P0 | Landing page claims Stripe and fixed plans/prices that are not implemented or approved | remove/qualify the out-of-scope landing copy and keep Android v1 free of digital purchases/Stripe links |
| P1 | Final minimized scopes not aligned with Google Cloud | configure exactly `profile`, `email`, `calendar.events`, and `gmail.readonly` in the relevant clients/consent screen |
| P1 | Public support page missing and mailbox delivery unverified | publish branded HTTPS support and complete a controlled receive/reply test for `hola@academiapro.academy` |
| P1 | OAuth disconnect controls absent from settings UI | expose the existing authenticated disconnect routes or retain a tested support process |
| P1 | Uploaded-file deletion not implemented/proven | define and test removal of account-owned attachments from persistent storage before making a broader deletion claim |
| P2 | Deployment documentation still refers to Groq | align it with the actual DeepSeek configuration |

## Required input before continuing

1. Android wrapper path or explicit confirmation that it must be created.
2. Wrapper technology, proof it declares `academy.academiapro.app`, version, signing identity, and external-user-agent OAuth design.
3. Google Cloud project ID and secret-free evidence from Branding, Audience, Data Access, and Clients.
4. Secret-free evidence from the `academy.academiapro.app` Play Console record: App content, Data safety, signing, and release.
5. Verified delivery/monitoring for `hola@academiapro.academy` and a stable HTTPS support page.
6. Approved landing-page commercial wording and confirmed no-purchase behavior for Android v1.
7. A decision and tested behavior for persistent uploaded-file deletion.
