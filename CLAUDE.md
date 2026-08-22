## SESSION START
1. Read tasks/lessons.md — apply all lessons before touching anything
2. Read tasks/todo.md — understand current state
3. If neither exists, create them before starting

## WORKFLOW

### 1. Plan First
- Enter plan mode for any non-trivial task (3+ steps)
- Write plan to tasks/todo.md before implementing
- If something goes wrong, STOP and re-plan — never push through

### 2. Subagent Strategy
- Use subagents to keep main context clean
- One task per subagent
- Throw more compute at hard problems

### 3. Self-Improvement Loop
- After any correction: update tasks/lessons.md
- Format: [date] | what went wrong | rule to prevent it
- Review lessons at every session start

### 4. Verification Standard
- Never mark complete without proving it works
- Run tests, check logs, diff behavior
- Ask: "Would a staff engineer approve this?"

### 5. Demand Elegance
- For non-trivial changes: is there a more elegant solution?
- If a fix feels hacky: rebuild it properly
- Don't over-engineer simple things

### 6. Autonomous Bug Fixing
- When given a bug: just fix it
- Go to logs, find root cause, resolve it
- No hand-holding needed

### 7. Mantener documentación siempre actualizada
Al finalizar cualquier tarea relevante, actualizar los tres documentos:
- `CLAUDE.md` → sección `## PROJECT CONTEXT` si cambia estructura, stack, líneas de index.js, o estado del refactor
- `tasks/todo.md` → marcar ítems completados, añadir nuevas tareas, actualizar métricas
- `tasks/lessons.md` → añadir lección si hubo corrección, bug inesperado, o decisión no obvia
El objetivo: que la próxima sesión arranque con contexto preciso sin explorar el código desde cero.

## CORE PRINCIPLES
- Simplicity First — touch minimal code
- No Laziness — root causes only, no temp fixes
- Never Assume — verify paths, APIs, variables before using
- Ask Once — one question upfront if unclear, never interrupt mid-task

## TASK MANAGEMENT
1. Plan → tasks/todo.md
2. Verify → confirm before implementing
3. Track → mark complete as you go
4. Explain — high-level summary each step
5. Learn → tasks/lessons.md after corrections

## LEARNED
(Claude fills this in over time)

---

## PROJECT CONTEXT

**AcademiaPro** — SaaS para academias de repaso. Multi-tenant (academy_id en todas las queries).

**Stack:** Node.js + Express 5 · PostgreSQL (Railway) / SQLite (local) · Socket.io · DeepSeek (deepseek-chat, vía SDK `openai` con baseURL propio) · Google OAuth + Calendar + Gmail · Resend email · Sentry · JWT + bcrypt

**Deploy:** `git push origin main` → Railway auto-deploy (~2 min). No hay staging.
**Dominio:** academiapro.academy · **Repo:** github.com/edcode0/academiapro

**Test:** `npm run test:smoke` → 56/64 pasan (8 fallan por Groq restringido en test env — es normal).

**Estructura de módulos:**
```
routes/          → 13 routers (auth, students, teachers, sessions, payments, exams,
                               calendar, chat, ai, notifications, reports, settings, transcripts)
services/        → groq, email, calendar, gmail, risk, rooms
middleware/      → auth.js (authenticateJWT), roles.js (requireAdmin, requireTeacher, etc.)
utils/           → multer.js, codes.js
sockets/         → chat.js (socket handler extraído de index.js)
cron.js          → jobs diarios
notifications.js → createNotification + setIo
db.js            → Pool PG / SQLite wrapper + initDb() + migrations
index.js         → 473 líneas: setup, middleware global, montar routers, intervals
```

**Roles:** admin · teacher · student. Siempre verificar `req.user.role` y `req.user.academy_id`.

**DeepSeek en producción:** si falla, devolver 503 con mensaje amigable al usuario (no exponer e.message).

**DB:** columnas nuevas siempre via migración en db.js con `IF NOT EXISTS` dentro de `try/catch`.

**Skills activas:** invocar `using-superpowers` al inicio de cada respuesta para verificar si aplica otra skill.

**Refactor:** ✅ Completo — index.js de 4129 → 473 líneas, modularización total en 4 fases.

---

## TOKEN EFFICIENCY

**Leer archivos:**
- No releer archivos ya en contexto esta sesión
- Grep en vez de cat para buscar algo específico: `grep -n "función" archivo.js`
- Leer solo el rango necesario: `sed -n '45,60p' archivo.js`
- Si lo escribí yo esta sesión, no releerlo — ya sé lo que hay

**Escribir código:**
- Código denso: optional chaining, destructuring, nullish coalescing, arrow functions
- Eliminar comentarios obvios — solo comentar el WHY nunca el WHAT
- Inline variables de un solo uso: `return transform(getData())` no `const x = getData(); return transform(x)`
- Dead code: eliminarlo, no comentarlo. Git tiene la historia.
- Si 3+ líneas se repiten, extraer función

**Outputs:**
- Tablas y diffs sobre prosa
- No preambles ni narración del proceso — ir directo a la acción
- Status updates estructurados: `BROKEN: email (down), db pool (95%)` no párrafos
- Nunca explicar lo obvio — si el código lo dice, no repetirlo en texto

**Arquitectura:**
- Si 3+ archivos comparten 50%+ de código → extraer módulo compartido
- Archivos bajo 20 líneas → fusionar con padre o hermano
- tasks/lessons.md: eliminar lecciones no aplicadas en 30 días
