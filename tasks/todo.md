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

## FASE 2 — Seguridad media/baja (P1)  [1 commit]
- [ ] **S6** Socket.io `cors origin:'*'` (index.js:76) → usar `allowedOrigins`.
- [ ] **S7** `unhandledRejection` → `process.exit(1)` (index.js:26) → log + Sentry sin matar proceso.
- [ ] **S8** Logout server-side: token cookie 15d sin revocación. Mínimo: `/auth/logout` ya limpia cookie; documentar. Revocación real = YAGNI salvo requisito legal — decidir.
Verif: server arranca, socket conecta desde dominio propio, rejection no tumba.

## FASE 3 — Consistencia de datos  [1 commit]
- [ ] **D1** Estados de pago mezclados EN/ES (`pending`/`pendiente`, `paid`/`pagado`) → normalizar a UN set. Migración backfill en `db.js` + arreglar POST default y filtros de `payments-data`.
- [ ] **D2** `session_type` NULL vs 'individual' → default `'individual'` + backfill. Quitar `OR session_type IS NULL` repetido.
Verif: recaudación de `payments-data` cuadra; teacher-payments da mismas horas.

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

## FASE 7 — Producto / features  [1 commit]
- [ ] **PR1** `payments/auto-generate` → correr en cron mensual (`cron.js` ya tiene `isFirstOfMonth`).
- [ ] **PR2** Job diario recalcula riesgo por inactividad. Extiende `checkStudentRisk`.
- [ ] **PR3** `email.js` fallback BASE_URL hardcodea dominio Railway viejo → usar `academiapro.academy`.
Verif: cron dispara sin duplicar pagos; alumno inactivo pasa a at_risk.

## FASE 8 — Higiene repo  [1 commit]
- [ ] **H1** Borrar ~40 scripts sueltos raíz (`patch_*.js`, `fix_*.js`, `diag*.js`, `*_out.txt`) + `tasks/*.js`.
- [ ] **H2** `console.log` debug en prod → quitar los ruidosos (login id/role, GROQ set, academy_id).
- [ ] **H3** Runner de tests unificado: `tests/*.js` sueltos → un `npm test` que los corra.
Verif: repo limpio; `npm run test:smoke` verde.

---

## Notas de ejecución
- Verificar env Railway antes de FASE 6/7: **volumen montado** para `public/uploads/` (informes+adjuntos se pierden en deploy si no). Si no → migrar a bucket. BLOQUEANTE para prod, no para el plan de código.
- Deploy: `git push origin main` → Railway auto (~2 min). Sin staging → cada fase pasa smoke antes de push.
- Tras cada fase: actualizar este todo.md + `lessons.md` si hubo sorpresa.
