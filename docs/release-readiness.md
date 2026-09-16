# Google Play release readiness

Baseline frozen on 2026-09-16 from branch `codex/google-play-readiness` at `29d28b2c6d53`.

## Status

**Release blocked.** Do not change OAuth configuration or submit Play/Cloud forms until the Android wrapper, Google Cloud OAuth project, and Play Console app are identified.

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

Until an artifact is supplied, its status is **not started or not delivered**, and these facts are unknown:

- WebView, Custom Tabs, TWA, or native implementation;
- package/application ID and version;
- signing certificate fingerprints;
- OAuth client and redirect/deep-link behavior;
- AAB/APK build status.

## External identity limitations

### Google Cloud

No project ID, console export, local `.env`, or configured `gcloud` client was available. The OAuth brand, audience, authorized domains, clients, callbacks, approved scopes, verification status, contacts, and user cap could not be checked.

The Gmail scopes requested by the code are restricted scopes. Because Gmail-derived data is stored and transmitted by the server, restricted-scope verification and a security assessment may apply: <https://developers.google.com/workspace/gmail/api/auth/scopes> and <https://support.google.com/cloud/answer/13464321?hl=en>.

### Play Console

No package name, authenticated console access, or export was supplied. The app listing, Data safety form, deletion URL, policy declarations, signing, tracks, testers, artifacts, and distribution could not be checked.

## Repository security scan

- No high-confidence Google/API/GitHub token or private-key pattern was found in tracked text.
- `.env.example` contains variable names/placeholders only; no working `.env` is present in this worktree.
- No explicit logging of OAuth token, client-secret, JWT-secret, session-secret, or API-key values was found.
- The tracked `database.sqlite` blob is empty.
- OAuth/AI error objects are logged in a few paths; production output should be checked for sensitive response metadata.

No credential values were copied into this document.

## Launch blockers

| Priority | Blocker | Exit condition |
|---|---|---|
| P0 | Android wrapper not identified | supply its repository/path, technology, package, version, and signing identity |
| P0 | Google Cloud OAuth project not identified | supply project access or a secret-free export of brand, audience, clients, redirects, scopes, and verification |
| P0 | Play Console app not identified | supply package name and secret-free app-content/release evidence |
| P0 | Public account-deletion URL missing | publish a working branded HTTPS deletion/request path and register it in Play Console |
| P0 | Legal copy names Groq instead of DeepSeek | disclose the real provider and Gmail-to-AI transfer before review |
| P0 | Restricted Gmail scopes with server storage/transmission | confirm verification/security-assessment path or reduce/redesign access |
| P1 | OAuth scopes overlap and appear broader than operations | justify or minimize scopes and align code with Cloud Console |
| P1 | Public support page missing | publish branded HTTPS support and confirm the support mailbox |
| P1 | OAuth disconnect/revocation missing | provide and verify user-controlled Gmail/Calendar disconnection |
| P1 | OAuth token storage controls undocumented | document or implement appropriate at-rest protection |
| P2 | Deployment documentation still refers to Groq | align it with the actual DeepSeek configuration |

## Required input before continuing

1. Android wrapper path or explicit confirmation that it must be created.
2. Wrapper technology, final package name, version, and signing identity.
3. Google Cloud project ID and secret-free evidence from Branding, Audience, Data Access, and Clients.
4. Exact Play Console app/package and secret-free App content, Data safety, and release evidence.
5. Confirmed AI provider/legal entity and public support contact.
