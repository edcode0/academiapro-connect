# PLAN DE ARREGLO INTEGRAL — auditoría 2026-07-02 (main @ d2a38d0)

Modo: ponytail (mínimo que funciona) + caveman. Cada fase = 1 commit deployable.
Orden por riesgo: seguridad → datos → rendimiento → arquitectura → frontend → features → higiene.
Regla: verificar cada fase (smoke tests + curl/Playwright) antes de commit. No avanzar si algo rompe.

---

## FASE 1 — Seguridad crítica (P0)  ✅ COMPLETO 2026-07-02 (rama fix/audit-phase1-security)
- [x] **S1** `DELETE /api/students/:id` genérico sin rol → borrado (bloque CRUD genérico entero, era dead-code + vuln). Admin usa `/api/admin/students/:id`. Verif: DELETE genérico → 404.
- [x] **S2** Rate limiters → movidos a `/auth/login`, `/auth/register`, `/api/auth/join`. Verif: 22× login = 20×401 luego 429.
- [x] **S3** `POST /api/chat/messages` sin check pertenencia → borrado (legacy, 0 usos en front; front usa socket + `/rooms/:roomId/messages`).
- [x] **S4** `POST /api/ai/conversations/:id/messages` → añadido guard ownership `user_id`.
- [x] **S5** `GET /api/simulator/results/:id` → student exige `s.user_id = req.user.id`.
Verif OK: syntax + boot local + curl S1/S2/S4.

## FASE 2 — Seguridad media/baja (P1)  ✅ COMPLETO 2026-07-02
- [x] **S6** Socket.io `cors origin:'*'` → `allowedOrigins` (movida la const arriba, dedup).
- [x] **S7** `unhandledRejection` ya no hace `process.exit(1)` — solo log+Sentry. (uncaughtException sí sigue saliendo, correcto.)
- [x] **S8** Logout: `/auth/logout` limpia cookie. Revocación server-side = YAGNI (no requisito legal declarado). No-op de código.
Verif: boot OK, health 200, socket handshake 200 desde origen permitido.

## FASE 3 — Consistencia de datos  ✅ COMPLETO 2026-07-02
- [x] **D1** Tabla `payments` ya es español-consistente salvo default POST → `'pending'`→`'pendiente'`. BONUS bug: `students.js` portal calculaba `pendingPayments` filtrando `'pending'` (inglés) → **siempre 0**; corregido a `'pendiente'`. (teacher_payments usa `paid` 0/1, tabla distinta — fuera de scope.)
- [x] **D2** Fuente de NULL en `session_type`: insert de sesión al reservar slot ahora pasa `'individual'`. `OR IS NULL` defensivo se mantiene (maneja filas viejas; reescribir queries = churn sin bug → YAGNI).
Verif: boot OK. Sin migración destructiva (tolera datos existentes).

## FASE 4 — Rendimiento  [1 commit]
- [ ] **P1** Índices: confirmar/crear en `db.js` initDb para `academy_id`, `student_id`, `assigned_teacher_id`, `room_id`, `user_id`, `messages.room_id`, `available_slots.start_datetime`.
- [ ] **P2** N+1: `teacher/dashboard-stats` y `student-detail` → colapsar queries anidadas con `Promise.all`.
- [ ] **P3** `payments-data`/`exams-data`: agregados en JS OK por ahora (ponytail: dejar salvo academia con >1000 filas). Marcar con comentario, no tocar.
Verif: EXPLAIN usa índices; dashboards devuelven mismos datos.

## FASE 5 — Arquitectura / mantenibilidad  [1-2 commits]
- [x] **A1** ✅ Helper `db.insertReturning(text, params)` en db.js. Migrados 15 sitios: auth(8), calendar(2), ai(1), transcripts(1), recurring(1), rooms(2). Dejados: inserts en `withTransaction`/`dbRunner`/`RETURNING *`. Verif: register real + login 200 en SQLite.
- [ ] **A2** Unificar `authenticateJWT`: borrar copia inline `index.js:219`, usar la de `middleware/auth.js` en todo (páginas incluidas).
- [ ] **A3** Extraer `resolveStudentUserId()` del triple-fallback de transcripts send-to-chat.
Verif: smoke completo tras cada migración; sin cambio de comportamiento.

## FASE 6 — Frontend  🟡 F1/F2 COMPLETO, F3/F4/F5 PENDIENTE
- [x] **F1** `design-system.css` borrado (0 páginas lo cargaban).
- [x] **F2** `sidebar.js` = fuente única del sidebar. 21 páginas (index + 20) usan `<div id="sidebar-mount" data-role>` + script. Nav por rol (admin/teacher/student), activo por pathname, ids preservados. student_profile.html unificado (tenía nav admin stale). ai_tutor/chat/transcripts intactos (sidebar propio). Verif: screenshots Playwright de los 3 roles = idénticos. Deploy `1819894`.
- [x] **F3** ✅ CSS del sidebar consolidado en shared-dashboard.css (movido `.user-info`/`.user-info strong`; strip de reglas inline duplicadas en 21 páginas, -1026 líneas). Verif: screenshots Playwright 3 roles = idénticos (diffs 27-119 bytes). Deploy `ef537cd`.
- [ ] **F4** PENDIENTE — decisión estética del usuario: glassmorphism XOR shared. Cambia el aspecto de la app. NO hacer sin su elección.
- [x] **F5** ✅ XSS: `escapeHtml` global en global.js + ~53 sinks escapados (chat content/sender/filename/room, nombres en tablas/dropdowns/perfiles, subject/notes/topic). textContent intactos. Verif Playwright: alumno con nombre `<img onerror>` ya NO ejecuta (antes sí). Deploy `510b529`.

## VOLUMEN RAILWAY ✅ COMPLETO 2026-07-02
- [x] `web-volume` (5GB) montado en `/app/public/uploads` del servicio web. Confirmado por SSH: dispositivo montado + escribible. Adjuntos chat + PDFs informes ya persisten entre deploys. README actualizado.

## FASE 7 — Producto / features  [PENDIENTE — checkpoint con usuario]
- [ ] **PR1** `payments/auto-generate` → correr en cron mensual (`cron.js` ya tiene `isFirstOfMonth`). Cambia comportamiento de producto → confirmar.
- [ ] **PR2** Job diario recalcula riesgo por inactividad. Extiende `checkStudentRisk`. Confirmar umbral de inactividad.
- [x] **PR3** `email.js` fallback BASE_URL → `academiapro.academy` (ambos sitios).

## FASE 8 — Higiene repo  ✅ COMPLETO 2026-07-02
- [x] **H1** Borrados 26 scripts/dumps basura (patch_*/fix_*/diag*/apply_*/script_*/*_out.*/output.txt) + tasks/*.js. Conservados: seed.js, generate-favicon.js, patch-favicons.js.
- [x] **H2** Quitados logs debug ruidosos: teachers.js (dump academy_id/user por hit), ai.js (7 logs `[ai-tutor/chat]` incl. fuga `GROQ_API_KEY set`).
- [x] **H3** `npm test` ahora corre smoke + socket-authz (era placeholder).
Verif: syntax OK todos.

---

## Notas de ejecución
- Verificar env Railway antes de FASE 6/7: **volumen montado** para `public/uploads/` (informes+adjuntos se pierden en deploy si no). Si no → migrar a bucket. BLOQUEANTE para prod, no para el plan de código.
- Deploy: `git push origin main` → Railway auto (~2 min). Sin staging → cada fase pasa smoke antes de push.
- Tras cada fase: actualizar este todo.md + `lessons.md` si hubo sorpresa.
