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

## FASE 4 — Rendimiento  ✅ COMPLETO 2026-08-22
- [x] **P1** Índices confirmados/creados en `db.js` initDb: la lista original (`academy_id`, `student_id`, `assigned_teacher_id`, `room_id`, `user_id`, `messages.room_id`, `available_slots.start_datetime`) ya estaba cubierta de una sesión anterior sin marcar. Añadidos los que faltaban de verdad: `simulator_results.student_id`, `teacher_payments(teacher_id, academy_id)`, `homework_reminders.student_id` y `(status, scheduled_for)` para el cron de recordatorios.
- [x] **P2** N+1 colapsado con `Promise.all`: `/api/teacher/dashboard-stats` (5 queries) y `/api/student-detail/:id` (4 queries), antes anidadas en callback.
- [ ] **P3** `payments-data`/`exams-data`: agregados en JS OK por ahora (ponytail: dejar salvo academia con >1000 filas). Marcar con comentario, no tocar.
Verif: boot local + Railway OK, 70/70 smoke, socket-authz OK, 7/7 gmail-resilience.

## FASE 5 — Arquitectura / mantenibilidad  ✅ COMPLETO 2026-08-22
- [x] **A1** ✅ Helper `db.insertReturning(text, params)` en db.js. Migrados 15 sitios: auth(8), calendar(2), ai(1), transcripts(1), recurring(1), rooms(2). Dejados: inserts en `withTransaction`/`dbRunner`/`RETURNING *`. Verif: register real + login 200 en SQLite.
- [x] **A2** ✅ Unificada `authenticateJWT`: borrada la copia inline de `index.js`, ahora usa `middleware/auth.js` en todo (páginas incluidas). De propina, las páginas ganan renovación deslizante de cookie.
- [x] **A3** ✅ Extraída `resolveStudentUserId()` del triple-fallback de transcripts send-to-chat. De paso se eliminó el `normalizedStudentId` muerto que fijaban los pasos 2 y 3 (siempre se sobreescribía después del scopeCheck).
Verif: 70/70 smoke, socket-authz OK, 7/7 gmail-resilience, deploy Railway OK.

## FASE 6 — Frontend  ✅ COMPLETO (F1-F5)
- [x] **F1** `design-system.css` borrado (0 páginas lo cargaban).
- [x] **F2** `sidebar.js` = fuente única del sidebar. 21 páginas (index + 20) usan `<div id="sidebar-mount" data-role>` + script. Nav por rol (admin/teacher/student), activo por pathname, ids preservados. student_profile.html unificado (tenía nav admin stale). ai_tutor/chat/transcripts intactos (sidebar propio). Verif: screenshots Playwright de los 3 roles = idénticos. Deploy `1819894`.
- [x] **F3** ✅ CSS del sidebar consolidado en shared-dashboard.css (movido `.user-info`/`.user-info strong`; strip de reglas inline duplicadas en 21 páginas, -1026 líneas). Verif: screenshots Playwright 3 roles = idénticos (diffs 27-119 bytes). Deploy `ef537cd`.
- [x] **F4** ✅ Elegido tema PLANO. glassmorphism.css aplanado en su sitio (quitado blur/blobs, fondos sólidos) en vez de borrarlo (habría roto logout/auth/tablas/toasts que shared no cubre). Verif: screenshots Playwright de 4 tipos de página (dashboard, login, tabla, chat) = flat coherente. Deploy `77cff79`.
- [x] **F5** ✅ XSS: `escapeHtml` global en global.js + ~53 sinks escapados (chat content/sender/filename/room, nombres en tablas/dropdowns/perfiles, subject/notes/topic). textContent intactos. Verif Playwright: alumno con nombre `<img onerror>` ya NO ejecuta (antes sí). Deploy `510b529`.

## VOLUMEN RAILWAY ✅ COMPLETO 2026-07-02
- [x] `web-volume` (5GB) montado en `/app/public/uploads` del servicio web. Confirmado por SSH: dispositivo montado + escribible. Adjuntos chat + PDFs informes ya persisten entre deploys. README actualizado.

## FASE 7 — Producto / features  ✅ YA COMPLETO (encontrado 2026-08-22, sin marcar)
- [x] **PR1** `generateMonthlyPayments()` (`services/billing.js`) corre en `cron.js` cada día 1 del mes, idempotente. Wired en `runDailyJobs`. Commit `210f571`.
- [x] **PR2** `checkInactivityRisk()` (`services/risk.js`) corre a diario, umbral 14 días sin sesión (`ponytail:` comentado, ajustable). Wired en `runDailyJobs`. Commit `210f571`.
- [x] **PR3** `email.js` fallback BASE_URL → `academiapro.academy` (ambos sitios).

## FASE 8 — Higiene repo  ✅ COMPLETO 2026-07-02
- [x] **H1** Borrados 26 scripts/dumps basura (patch_*/fix_*/diag*/apply_*/script_*/*_out.*/output.txt) + tasks/*.js. Conservados: seed.js, generate-favicon.js, patch-favicons.js.
- [x] **H2** Quitados logs debug ruidosos: teachers.js (dump academy_id/user por hit), ai.js (7 logs `[ai-tutor/chat]` incl. fuga `GROQ_API_KEY set`).
- [x] **H3** `npm test` ahora corre smoke + socket-authz (era placeholder).
Verif: syntax OK todos.

## INCIDENTE TRANSCRIPCIONES — 2026-07-30  [código arreglado, pendiente deploy + cuota]
Síntoma: no se leen transcripciones ni llegan a los chats de los alumnos.
Causa raíz (logs Railway `web`): bucle de reproceso agota los 100k tokens/día de Groq (tier free) → todo 429.
- [x] **T1** Cap `MAX_PER_RUN = 5` emails por ejecución en `services/gmail.js`.
- [x] **T2** Abortar lote al primer 429 de Groq (antes hacía ~31 llamadas condenadas por tick).
- [x] **T3** No mover `gmail_last_check` si el lote se cortó (Gmail es newest-first: avanzar perdería los antiguos).
- [x] **T4** `invalid_grant` → limpiar tokens + notificar al profesor (profes 1 y 9 llevaban días caídos en silencio).
- [x] **T5** `tests/gmail-resilience.js` (4 casos) + wired en `npm test`.
- [x] **T6** OBSOLETO: Groq quedó bloqueando con 403 "Access denied" desde 2026-08-20 (no era cuota, algo distinto — org/región). Migrado el proveedor de IA entero a DeepSeek (`deepseek-chat` vía SDK `openai`) 2026-08-22. Ya no aplica subir tier de Groq.
- [x] **T7** Cola post-migración DeepSeek drenó correctamente en 2026-08-22. Cerrado.

## INCIDENTE — 2026-09-05  [BLOQUEANTE, requiere acción de Edu]
DeepSeek sin saldo: `402 Insufficient Balance` desde 2026-09-03 ~14:00 (logs Railway, servicio `web`). Bloquea transcripciones (profesor 17, 5 pendientes y creciendo) y probablemente el tutor IA de toda la academia. La alerta de stall (`alertAdmins` en `services/gmail.js`) SÍ está avisando in-app a los admins, 1x/día/profesor.
## HALLAZGO — 2026-09-05  ✅ ARREGLADO Y DESPLEGADO mismo día
`teacher_payments` en producción no tenía `academy_id`/`paid`/`created_at`. Añadidas vía `ALTER TABLE ADD COLUMN IF NOT EXISTS` + backfill idempotente en `db.js` (migración normal, corre sola en cada boot). Verificado en producción tras deploy: columnas presentes, `paid` bien migrado desde `status='paid'`. Una fila queda con `academy_id NULL` — `teacher_id` apunta a un profesor ya borrado (huérfano de antes de mi fix de cascada), dato muerto sin importancia, no limpiado.

## FIX TRANSCRIPCIONES → CHAT EQUIVOCADO — 2026-09-05  ✅ ARREGLADO Y DESPLEGADO
Causa: `services/gmail.js` hacía matching de alumno por substring bidireccional (`.includes()`) sobre el nombre que adivinaba la IA — cualquier nombre corto que solapara con otro (ej. "Ana" dentro de "Ana María") podía robar la transcripción de otro alumno; con rol admin el pool era toda la academia. Arreglado: señal primaria ahora es la sesión reservada en `available_slots` (teacher_id + hora del email, ventana de 6h) que da el `student_id` exacto sin adivinar nada; fallback a coincidencia de nombre EXACTA (no substring) solo si no hay slot. Verificado: smoke 63/65, gmail-resilience 7/7.

- [ ] Edu: recargar saldo en la cuenta de **DeepSeek** (no Groq — `services/groq.js` es solo el nombre heredado del fichero, el cliente real es DeepSeek). Confirmado 2026-09-05 vía API real (`railway run` + `/user/balance`): `total_balance: -0.03 USD`, `is_available: false`.
- [ ] Tras recarga: verificar que el backlog del profesor 17 se drena y que el tutor IA vuelve a responder.
Verif: 65/65 smoke · homework-reminders OK · 4/4 gmail-resilience.

## FASE 9 — Sesión 2026-09-16: sidebar admin/rol + tarjetas de transcripción + matching  ✅ COMPLETO
Origen: 3 bugs reportados por Edu (capturas propias + queja de un cliente real). Investigación con `systematic-debugging` antes de tocar código.

- [x] **B1** Root cause real: `document.getElementById('sidebarName')` en `teacher_sessions.html`/`teacher_calendar.html`/`teacher_exams.html`/`teacher_student_profile.html`/`teacher_settings.html` no existía (id correcto es `teacher-name`) — regresión de la unificación de sidebar (fase 6) que nunca se detectó porque el error quedaba sin capturar y cortaba el resto de `init()` (por eso "Sesiones" mostraba 0 en todo: el crash pasaba ANTES de cargar los datos reales). Además `sidebar.js` elegía el nav/badge leyendo un `data-role` estático por HTML, sin comprobar el rol real de sesión — por eso un admin en `/teacher/*` perdía "Gestión de Academia" y el badge ADMIN. Fix: `sidebar.js` ahora pinta con el `data-role` (paint instantáneo) y se autocorrige con `/auth/me` si el rol real difiere; borrados los 5 bloques de parche manual rotos (y uno más en `teacher_dashboard.html`, mismo patrón pero sin crash). Migrados `chat.html` y `transcripts.html` al `sidebar-mount` compartido (CSS/nav idénticos al resto de la app). `ai_tutor.html` NO se tocó: su "aside" es un panel de historial de conversaciones, no el nav compartido — migrarlo habría borrado esa función.
- [x] **B2** Prompt de DeepSeek y tarjeta de resumen duplicados letra por letra en `services/gmail.js` y `routes/transcripts.js` → extraídos a `services/transcript-format.js` (con self-check). Prompt ahora indica explícitamente devolver `"deberes": []` si el profesor no asignó nada real (antes la IA rellenaba algo siempre). El resumen de clase pasa de texto pseudo-WhatsApp (`*negrita*`, `\n`, colapsado por el navegador en un párrafo) a tarjeta `html_card` real, igual que la de deberes. El render de la tarjeta de deberes como HTML (no texto crudo) ya estaba arreglado desde el `8a89644` de 2026-09-05 — la queja del cliente del 14/09 es de una pestaña vieja sin recargar.
- [x] **B3** `services/gmail.js` emparejaba alumno por el slot reservado más reciente (`ORDER BY ... DESC LIMIT 1`) dentro de una ventana de 6h desde la llegada del email — con dos alumnos seguidos en la ventana (lo normal, no un caso raro), cogía el slot equivocado. Extraído `services/student-match.js` (con self-check, 7 casos) con 3 señales en cascada: (1) nombre exacto que la IA detecta en la transcripción, solo contra los candidatos reales de la ventana; (2) si el nombre no desempata, proximidad horaria entre el fin de cada clase candidata y la llegada del email — solo se confía si el hueco es <90min Y claramente el mejor (≥20min de margen sobre el segundo candidato, para no adivinar en un empate técnico); (3) con un único candidato en la ventana, se acepta salvo que la IA detecte con confianza el nombre de OTRO alumno real de la academia — esa contradicción ahora bloquea el auto-match en vez de asumir que el slot es correcto. Sin ganador claro en ningún paso → `pending_match = TRUE`.

Verif: `npm test` 70/70 smoke + socket-authz OK, 7/7 gmail-resilience, self-checks de `student-match.js`/`transcript-format.js` OK.

## FASE 10 — Sesión 2026-09-16 (cont.): auditoría completa con 5 subagentes en paralelo  ✅ COMPLETO
Auditoría exhaustiva de todo el código (auth/pagos/roster, sesiones/exámenes/IA/cron, chat/notificaciones/email, frontend HTML/JS completo, esquema DB/tests) pedida por Edu tras los 3 bugs de la Fase 9. Encontrados ~30 problemas reales. Arreglados por orden de prioridad que Edu fue aprobando, en 4 tandas/commits:

- [x] **Tanda 1** (`604cd3b`) — 4 bugs de producción visibles: campana de notificaciones muerta (seguía usando `localStorage.token`, la migración a cookies la dejó atrás), `admin_teachers.html`/`admin_teacher_profile.html` crasheaban antes de cargar nada (mismo patrón de id roto que B1), Simulador de examen 100% roto (`showLoading`/`hideLoading` nunca definidos + `configPdfText` inexistente), alta por código de invitación sin `name`/`user_code` en el JWT (alumnos quedaban como "undefined" en chat).
- [x] **Tanda 2 — seguridad** (`36b2023`) — XSS almacenado en adjuntos de chat (fileFilter solo miraba mimetype), hijack de cuenta cross-academia vía `/auth/register` y vía `/api/admin/add-user-by-code` (código de 5 dígitos fuerza-bruteable + sin validar `role`), exámenes sin scope por profesor (cualquier profesor editaba/borraba/calificaba exámenes de alumnos ajenos), `/api/chat/contacts` sin restricción de rol. De propina: la ruta autenticada de `/uploads/*` estaba registrada DESPUÉS del `express.static` que ya la servía sin login, y su guard roto (`setHeaders` + `res.status(403).end()`) podía **tirar el servidor entero** con `ERR_HTTP_HEADERS_SENT` — reordenado para que la ruta autenticada intercepte primero.
- [x] **Tanda 3** (`44685b2`) — alumno "en riesgo" no volvía nunca a activo + notificación duplicada en cada sesión/examen; resumen mensual de pagos a profesores se podía reenviar duplicado en un redeploy del día 1 (sin staging, cae fácil); errores de DB tragados como éxito en varios sitios (`students.js`, `teachers.js`, `chat.js` unread-count, `payments.js`); pagos sin scope por profesor (Edu pidió arreglarlo, no dejarlo así) — create/read/update/delete de pagos ya exigen `assigned_teacher_id` igual que exámenes/sesiones.
- [x] **Tanda 4 — solo SQLite local** (`05a92e6`) — 22 migraciones `ADD COLUMN IF NOT EXISTS` (sintaxis inválida en SQLite, silenciadas por el catch-all) nunca creaban la columna en una BD local fresca; bug de despacho en `db.js` hacía que `RETURNING` perdiera filas en SQLite (pagos/exámenes/sesiones devolvían cuerpo vacío, y `checkStudentRisk` nunca se disparaba tras una sesión nueva); `NOW()` hardcodeado sin rama SQLite en notificaciones/chat/IA/invitaciones (rompía chat e IA tutor al 100% en local); `COUNT(*)` sin alias en settings; cast Postgres-only en reports; índice que faltaba en `ai_messages`; plantilla de email vulnerable a `$&`/`$1` + sin escapar HTML. Nada de esto toca producción (Postgres), todo detrás de `db.isPostgres`.

Verif de cada tanda: `npm test` completo (70/70 smoke + gmail-resilience 7/7) + Playwright contra servidor local con SQLite fresca (login real, JWT decodificado, escenarios de ataque para cada bug de seguridad, columnas confirmadas vía `PRAGMA table_info`).

---

## Notas de ejecución
- Verificar env Railway antes de FASE 6/7: **volumen montado** para `public/uploads/` (informes+adjuntos se pierden en deploy si no). Si no → migrar a bucket. BLOQUEANTE para prod, no para el plan de código.
- Deploy: `git push origin main` → Railway auto (~2 min). Sin staging → cada fase pasa smoke antes de push.
- Tras cada fase: actualizar este todo.md + `lessons.md` si hubo sorpresa.
