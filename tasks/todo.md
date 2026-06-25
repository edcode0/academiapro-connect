# tasks/todo.md - Estado actual (verificado 2026-06-09)

---

## SPRINT 2026-06-25 — Recordatorios de deberes desde transcripciones ✅ COMPLETO

| Feature | Estado | Notas |
|---------|--------|-------|
| F4 - Recordatorios de deberes V1 | ✅ Completo | Tabla `homework_reminders`, scheduling alumno, notificación interna, bandeja profesor |
| F5 - Push móvil accionable V2 | 📌 Backlog | Notificación push real con acciones `No tengo deberes`, `No los he hecho`, `Ya los he hecho` |

---

## SPRINT 2026-06-09 — 3 Features ✅ COMPLETO

| Feature | Estado | Archivos |
|---------|--------|---------|
| F1 - Enlaces por alumno | ✅ | db.js, routes/students.js, student_profile.html, teacher_student_profile.html, student_portal.html |
| F2 - Enlace grabación en transcripción | ✅ | services/gmail.js |
| F3 - Sesiones recurrentes semanales | ✅ | db.js, services/recurring.js, routes/calendar.js, cron.js, teacher_calendar.html |

**F1 — Links:** Tabla `student_links`. CRUD `/api/students/:id/links`. Tab "🔗 Enlaces" en perfil admin + teacher. Solo lectura en portal alumno. Validación URL http/https, escape XSS.

**F2 — Grabación:** `extractRecordingLink()` en gmail.js extrae URL de Drive de HTML del email antes de limpiarlo. Concatena `🎥 Grabación de la clase:` al final del mensaje. Fallback silencioso si no hay URL.

**F3 — Recurrencia:** Tabla `recurring_sessions` (regla). `services/recurring.js` (helper idempotente). `/api/calendar/recurring` POST/GET/DELETE. Cron diario mantiene horizonte rodante 8 semanas. Checkbox "🔁 Repetir" en modal de calendario. Meet nuevo por sesión (si OAuth conectado).

---

---

## SPRINT 2026-03-25 - 4 Features ✅ COMPLETO

| Feature | Estado |
|---------|--------|
| SA1 - Group Sessions | ✅ |
| SA2 - Group Hourly Rate per Teacher | ✅ |
| SA3 - Fixed Academy Codes | ✅ |
| SA4 - Help Assistant Floating Button | ✅ |

---

## FRONTEND IMPROVEMENTS - Estado real (2026-04-23)

| # | Mejora | Estado |
|---|--------|--------|
| #1 | Mobile hamburger menu | ✅ - `hamburger-btn` + `toggleMobileNav` en 24 paginas |
| #3 | Replace `alert()` with toasts | ✅ - `showToast` en `global.js`, 0 `alert()` en HTML |
| #4 | Shared CSS deduplication | ✅ - `public/shared-dashboard.css` existe y esta enlazado |
| #5 | Empty states for tables | ✅ - ya implementado en `index.html` y `teacher_dashboard.html` |
| #6 | Password show/hide toggle | ✅ - `togglePwd()` en `login.html` y `join.html` |
| #7 | Sidebar user avatar | ✅ - CSS anadido a `shared-dashboard.css`; JS ya estaba en `global.js` |
| #8 | Student grade progress bar | ✅ - ya implementado en `student_portal.html` |
| #9 | Landing pricing + footer | ⚠️ - pricing ✅, footer existe pero es de 2 columnas (no 3) |
| #10 | Keyboard focus rings | ✅ - `:focus-visible` anadido a `shared-dashboard.css` |

### Pendiente opcional: #9 footer 3 columnas

---

## REFACTOR index.js ✅ COMPLETO (2026-04-22)

- `index.js`: 473 lineas (de 4129 originales)
- 13 routers extraidos + `sockets/chat.js` + `middleware/` + `services/` + `utils/`
- Smoke tests: 56/64 pasan (8 fallan por Groq restringido en test env - es normal)

---

## AUDITORIA DE SEGURIDAD ✅ COMPLETA (2026-04-23)

| Nivel | Fixes | Commits |
|-------|-------|---------|
| P0 - Auth bypass & cross-tenant leaks | ✅ 8 fixes | `ba01e66` |
| P1 - Data leaks & auth logic | ✅ 10 fixes | `0e06a4a` |
| P2/P3 - Rate limits, file handling, API logic | ✅ 10 fixes | `67e5807` |

Archivos modificados: `routes/auth.js`, `routes/exams.js`, `routes/sessions.js`, `routes/teachers.js`, `routes/students.js`, `routes/chat.js`, `routes/transcripts.js`, `routes/calendar.js`, `routes/reports.js`, `routes/ai.js`, `middleware/auth.js`, `middleware/roles.js`, `utils/multer.js`, `public/auth-success.html`, `public/join.html`, `public/login.html`

---

## AUDITORIA CODEX 2026-04-24 - En progreso

Plan 5 fases tras auditoria estatica de Codex. Todos los hallazgos verificados contra codigo real.

| Fase | Scope | Estado |
|------|-------|--------|
| 1 - P0/P1 authz gaps | `sockets/chat.js` (room bypass), `routes/sessions.js` (DELETE teacher filter), `routes/calendar.js` (DELETE+PUT) | ✅ `711aa67` |
| 2 - Config hardening | `SESSION_SECRET` fail-fast, cookie `httpOnly/secure/sameSite`, `trust proxy` | ✅ |
| 3 - Schema bugs | `auth.js` (quitar `subscription_status`), `teachers.js` (mark-paid columnas), `chat.js` (ruta legacy `receiver_id`) | ✅ `69869eb` |
| 4 - Error sanitization | Middleware central, migrar ~125 `err.message -> next(err)` | ✅ `0d0f2f2` |
| 5 - Verificacion dirigida | Tests smoke para cada hallazgo + arreglar runner JWT->cookies | ✅ `5875e13` + `fb6b51c` |

## TRANSCRIPCIONES ✅ COMMIT `2a92b0b` (2026-04-30)

| Fix | Estado |
|-----|--------|
| Schema canónico único Gmail+manual | ✅ |
| Student matching seguro (pending_match) | ✅ |
| gmail_last_check por email (no por loop) | ✅ |
| Parser email: text/html + text/plain | ✅ |
| SQLite compat NOW() en gmail.js | ✅ |
| await en insert historial manual | ✅ |
| requireTeacherOrAdmin en rutas proceso | ✅ |
| Rutas pending + assign | ✅ |
| DB: pending_match col + UNIQUE INDEX gmail_msg_id | ✅ |
| UI: bloque estado Gmail + sección pendientes | ✅ |

**PENDIENTE (no se puede hacer desde código):**
- Railway: verificar `BASE_URL=https://academiapro.academy` en variables de entorno
- Google Cloud Console: verificar redirect URI `https://academiapro.academy/api/gmail/callback`
- transcript_email: actualmente es config muerta (limpieza opcional)

---

## DEUDA - Smoke tests ✅ RESUELTO (verificado 2026-05-02)

`npm run test:smoke` → **62/62 passed**. El fix ya estaba aplicado en commits anteriores. Documentación estaba desactualizada.

---

## FIXES SESIÓN 2026-05-02 ✅ COMPLETO

| Fix | Commit | Descripción |
|-----|--------|-------------|
| Google OAuth `callbackURL` | `ed8fff5` | Hardcodeado a dominio Railway → cambiado a `BASE_URL`. Causa: `TokenError: Bad Request` en cada login con Google (Sentry JAVASCRIPT-NEXTJS-2) |
| Gmail query sender | `3970702` | Query solo buscaba `meet-recordings-noreply@google.com`. Gemini AI Notes envía desde `gemini-notes@google.com` → transcripciones nunca encontradas |

**Pendiente operacional (no es código):**
- Teachers con `invalid_grant` (IDs 1 y 9): deben reconectar Gmail desde Ajustes. Posible causa: app en modo Testing en Google Cloud Console (tokens caducan a los 7 días).

---

## BUG FIXES 2026-03-28 ✅ COMPLETO

- BUG 1 - `db-group-students-container` ya usaba `'block'` (ya estaba corregido)
- BUG 2 - `group_hourly_rate` y `saveTeacherRate()` ya implementados en `settings.html`
