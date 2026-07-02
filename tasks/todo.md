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
- [ ] **A1** Helper `db.insertReturning(table, cols, vals)` que abstrae `isPostgres ? RETURNING : lastID`. Migrar los ~40 sitios con el patrón. (Mayor limpiador de ruido.)
- [ ] **A2** Unificar `authenticateJWT`: borrar copia inline `index.js:219`, usar la de `middleware/auth.js` en todo (páginas incluidas).
- [ ] **A3** Extraer `resolveStudentUserId()` del triple-fallback de transcripts send-to-chat.
Verif: smoke completo tras cada migración; sin cambio de comportamiento.

## FASE 6 — Frontend (el gordo)  [varios commits, validar por página]
- [ ] **F1** `design-system.css` muerto (0 páginas lo cargan) → borrar.
- [ ] **F2** Sidebar a fuente única: `sidebar.js` inyecta `<aside>` en `<div id="sidebar-mount">`, marca activo por `location.pathname`. Borrar las 24 copias de markup.
- [ ] **F3** CSS del sidebar a UN bloque en `shared-dashboard.css`. Borrar reglas `aside`/`.nav-*` inline de las 24 páginas.
- [ ] **F4** Decidir UN sistema CSS: glassmorphism XOR shared. Eliminar solapes `aside`/`body`/`.card`.
- [ ] **F5** XSS: auditar `innerHTML` con datos de usuario (nombres, mensajes, notas) → escapar. Reusar `escapeHtml` existente.
Verif: Playwright (`webapp-testing`) en index.html piloto ANTES de propagar. Sidebar cambia en 1 sitio → todas.
Estrategia: F2/F3 a index.html primero, validar diseño con usuario, LUEGO propagar a las 23.

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
