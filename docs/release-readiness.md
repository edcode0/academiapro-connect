# Google Play release readiness

Baseline frozen on 2026-09-16 from branch `codex/google-play-readiness` at `29d28b2c6d53`.

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
| Calendar connection | `GET /api/calendar/connect` | `https://www.googleapis.com/auth/calendar`, `https://www.googleapis.com/auth/calendar.events` | `${BASE_URL}/api/calendar/callback` |
| Gmail connection | `GET /api/gmail/connect` | `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/calendar`, `https://www.googleapis.com/auth/calendar.events` | `${BASE_URL}/api/gmail/callback` |

The Gmail flow requests Calendar scopes but stores credentials in `gmail_*` columns, while Calendar operations use separate `calendar_*` credentials. Both flows also request overlapping broad/narrow scopes. Scope minimization and justification remain open.

## Google API operations

| API | Operations | Purpose |
|---|---|---|
| Calendar v3 | `events.insert`, `events.get`, `events.patch`, `events.delete` | create Meet-backed events, read/update attendees, and delete events |
| Gmail v1 | `users.messages.list`, `users.messages.get`, `users.messages.modify` | find transcript emails, read full messages, and remove `UNREAD` after processing |
| OAuth 2.0 | authorization URL and code exchange | store access token, refresh token, and expiry for Gmail/Calendar |

No Gmail send/delete/settings operations or non-event Calendar operations were found.

## Data and processing inventory

- Account: name, email, password hash, Google ID, role, academy, and user code.
- Academic: students, teachers, sessions, notes, exams, results, homework, reports, and internal payment records.
- Communications: chat messages, attachments, notifications, and AI conversations.
- Google integration: OAuth tokens, Gmail transcript alias, message ID/body, Drive/Meet link, Calendar event ID, attendee email, and event times.
- Transcripts: up to 8,000 Gmail-body characters or 12,000 manually supplied characters are sent to DeepSeek; up to 5,000 raw characters plus processed JSON are stored.
- Technical: rate-limit IP data, operational logs, and error traces sent to Sentry when configured.

OAuth tokens are stored in the database. No voluntary Gmail/Calendar disconnect or revocation route and no field-level token encryption were found.

### Retention and revocation discrepancy

The published policy promises the following retention limits in `public/privacy.html:209-218`: account data while active, academic data for up to three years after activity, chat for one year, security logs for twelve months, OAuth tokens until access is revoked or the integration is deleted, and irreversible deletion or anonymization after those periods.

The implementation does not currently enforce those promises:

- `cron.js:7-145` contains risk, billing, recurring-session, and notification jobs, but no time-based retention/anonymization cleanup for account, academic, chat, transcript, or security data.
- No authenticated route or UI action voluntarily disconnects Gmail or Calendar, revokes the Google grant, or clears both integrations' local tokens. `services/gmail.js:94-103` only clears Gmail tokens reactively after Google returns `invalid_grant`.
- `DELETE /api/auth/delete-account` in `routes/auth.js:437-512` deletes local database rows. It does not call Google's revocation endpoint before deleting the row, so deleting an AcademiaPro account is not evidence that the upstream Google OAuth grant was revoked.

This mismatch is a compliance and review risk: published retention/revocation claims are stronger than the behavior proven by the repository. Either implement and test the promised lifecycle or change the policy to an accurate, approved lifecycle before submission. Google also recommends revoking tokens as soon as they are no longer needed: <https://developers.google.com/identity/protocols/oauth2/resources/best-practices>.

## Providers

| Provider | Current use | Public disclosure |
|---|---|---|
| Railway | hosting, PostgreSQL, persistent files | declared |
| Google | OAuth login, Gmail, Calendar, Meet | declared generally; detailed Google-data processing is missing |
| DeepSeek | actual AI provider | not declared |
| Resend | transactional email and reports | declared |
| Sentry | error monitoring | declared |
| Google Fonts, jsDelivr, cdnjs | remote frontend assets | not inventoried |

`public/privacy.html` and `public/terms.html` name Groq, but production code uses DeepSeek at `https://api.deepseek.com`. They also do not explicitly disclose that Gmail-derived transcript content is transferred to DeepSeek.

## Commercial surface

The first Android release is an access app for academies that already have a subscription. It must not sell digital content, initiate Stripe checkout, link users directly to Stripe, or present an in-app purchase path. Any future Stripe subscription flow remains web-only until Google Play billing policy and the EEA alternatives are reviewed.

Evidence and current contradiction:

- `docs/billing-roadmap.md:3,9-11,23,65-67` says Stripe is not implemented, plans/prices are not final, Android purchase is excluded from v1, and future contracting/payment belongs on the web.
- `public/landing.html:779-788` advertises Stripe as an existing integration.
- `public/landing.html:864-947` advertises fixed Free/Pro/Academia tiers, €29/€59 monthly pricing, annual savings, limits, and purchase-oriented calls to action.
- `public/terms.html:209-237` likewise publishes fixed monthly/annual prices and describes active advance billing, failed-payment suspension, and refunds.

The public marketing and terms currently claim a commercial implementation and settled offers that the repository roadmap says do not exist. Remove or clearly qualify those claims before Play review and before accepting customers on those terms.

## Public URLs

Verified on 2026-09-16 with HTTPS certificate validation enabled:

| Resource | URL | Result |
|---|---|---|
| Homepage | `https://academiapro.academy/` | `200` |
| Privacy | `https://academiapro.academy/privacy` and `/privacy.html` | `200` |
| Terms | `https://academiapro.academy/terms` and `/terms.html` | `200` |
| Support page | `https://academiapro.academy/support` | `404` |
| Account deletion page | `https://academiapro.academy/account-deletion` and `/delete-account` | `404` |

Privacy and terms expose an email contact on a different domain. Its domain has mail routing, but mailbox availability was not tested because no external message was authorized.

The app has authenticated in-product deletion, but no public web deletion resource. Google Play requires a functional web path when an app permits account creation: <https://support.google.com/googleplay/android-developer/answer/13327111?hl=en>.

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

The Gmail scopes requested by the code are restricted scopes. Because Gmail-derived data is stored and transmitted by the server, restricted-scope verification and a security assessment may apply: <https://developers.google.com/workspace/gmail/api/auth/scopes> and <https://support.google.com/cloud/answer/13464321?hl=en>.

### Play Console

The immutable package name is recorded as `academy.academiapro.app`. No authenticated console access or export was supplied, so the corresponding app record and Android build could not be independently verified. The listing, Data safety form, deletion URL, policy declarations, signing, tracks, testers, artifacts, and distribution remain unchecked.

## Repository security scan

- No high-confidence Google/API/GitHub token or private-key pattern was found in tracked text.
- `.env.example` contains variable names/placeholders only; no working `.env` is present in this worktree.
- No explicit logging of OAuth token, client-secret, JWT-secret, session-secret, or API-key values was found.
- The tracked `database.sqlite` blob is empty.
- `routes/transcripts.js:233-238`, specifically line 237 in the audited revision, logs `apiResponse.choices[0].message.content` in full when DeepSeek returns invalid JSON. That response is derived from a class transcript and can contain names, academic details, or other personal data; the parse-error path therefore creates a concrete personal-data logging risk.
- Other OAuth/AI error objects are also logged in a few paths; production output should be checked for sensitive response metadata.

No credential values were copied into this document.

## Launch blockers

| Priority | Blocker | Exit condition |
|---|---|---|
| P0 | Android wrapper/build not available for verification | supply its repository/path and prove `applicationId=academy.academiapro.app`, version, signing identity, App Links, and AAB |
| P0 | Android OAuth user agent undecided/unverified | prove Google login/consent uses Custom Tabs/system browser or supported native integration, never a normal embedded WebView |
| P0 | Google Cloud OAuth project not identified | supply project access or a secret-free export of brand, audience, clients, redirects, scopes, and verification |
| P0 | Play Console configuration/build not verified | supply secret-free evidence for package `academy.academiapro.app`, app content, signing, and release artifact |
| P0 | Public account-deletion URL missing | publish a working branded HTTPS deletion/request path and register it in Play Console |
| P0 | Legal copy names Groq instead of DeepSeek | disclose the real provider and Gmail-to-AI transfer before review |
| P0 | Restricted Gmail scopes with server storage/transmission | confirm verification/security-assessment path or reduce/redesign access |
| P0 | Published retention/revocation promises are not implemented | add tested retention cleanup and Google revocation/disconnect, or approve accurate replacement disclosures |
| P0 | Public site claims Stripe and fixed plans/prices that are not implemented or approved | remove/qualify claims and keep Android v1 free of digital purchases/Stripe links |
| P1 | OAuth scopes overlap and appear broader than operations | justify or minimize scopes and align code with Cloud Console |
| P1 | Public support page missing | publish branded HTTPS support and confirm the support mailbox |
| P1 | OAuth token storage controls undocumented | document or implement appropriate at-rest protection |
| P1 | Transcript parse errors log the complete AI response | replace full-response logging with safe metadata and verify logs contain no transcript-derived personal data |
| P2 | Deployment documentation still refers to Groq | align it with the actual DeepSeek configuration |

## Required input before continuing

1. Android wrapper path or explicit confirmation that it must be created.
2. Wrapper technology, proof it declares `academy.academiapro.app`, version, signing identity, and external-user-agent OAuth design.
3. Google Cloud project ID and secret-free evidence from Branding, Audience, Data Access, and Clients.
4. Secret-free evidence from the `academy.academiapro.app` Play Console record: App content, Data safety, signing, and release.
5. Confirmed AI provider/legal entity and public support contact.
6. Approved commercial wording and confirmed no-purchase behavior for Android v1.
7. Approved retention/revocation behavior or corrected disclosures.
