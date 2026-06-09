# Lessons Learned

## Format: [fecha] | qué salió mal | regla para prevenirlo

---

[2026-04-21] | El todo.md marcaba como "pendientes" 7 routers (auth, students, teachers, sessions, payments, exams, chat) que ya estaban integrados, y como "completados" 5 routers (ai, notifications, reports, settings, transcripts) que existían como archivos pero NO estaban cableados en index.js ni tenían el inline eliminado. | Antes de reportar estado del refactor: verificar con `grep "require('./routes/"` en index.js y comprobar que el inline fue eliminado — no asumir por la existencia del archivo.

[2026-04-21] | routes/transcripts.js usaba `state: req.user.id.toString()` en el OAuth de Gmail (estado simple), mientras que el código inline de index.js usaba HMAC-signed state con nonce para prevenir CSRF. Al extraer el router se perdió la seguridad. | Al extraer código inline a un router, comparar línea a línea con el original antes de dar por buena la extracción. Prestar especial atención a flujos OAuth y crypto.

[2026-04-21] | routes/ai.js tenía `GET /api/ai/conversations` sin filtro `AND academy_id = $2` — cualquier usuario podía ver conversaciones de otra academia. | En toda query de listado, siempre incluir `academy_id = $X` para aislamiento multi-tenant. Revisar sistemáticamente este filtro al extraer rutas.

[2026-04-21] | routes/ai.js tenía `GET /api/ai/conversations/:id/messages` sin ownership check — cualquier usuario autenticado podía leer mensajes de otra conversación. | En rutas que acceden a un recurso por ID, siempre añadir `AND user_id = $X` o equivalente antes de devolver datos.

[2026-04-21] | El catch genérico en routes/ai.js exponía `e.message` de Groq directamente al usuario ("Organization has been restricted..."). | Los errores de APIs externas (Groq, Resend, Google) nunca deben llegar al cliente. Usar un catch específico para la llamada externa y devolver 503 con mensaje amigable.

[2026-04-21] | El todo.md acumuló planes de sesiones de marzo mezclados con el plan de refactor activo, con números de línea obsoletos. | Separar el todo.md en secciones: "Activo" (con estado real) y "Archivo" (planes históricos). Actualizar líneas y métricas tras cada sesión de trabajo.

[2026-04-26] | Helmet 6+ aplica `script-src-attr 'none'` por defecto aunque `script-src` permita `'unsafe-inline'`. Esto bloqueó todos los `onclick=""` de login.html (y de los otros 27 HTML), impidiendo el acceso a la academia. Introducido por `7cb24a3` que pasó de `contentSecurityPolicy: false` a directivas explícitas sin declarar `scriptSrcAttr`. No se detectó porque la verificación post-commit fue solo backend (server arranca, curl OK) — el bug solo aparece en consola del navegador. | Al configurar Helmet CSP, declarar `scriptSrcAttr` explícitamente. Para cambios en CSP/headers de seguridad o cualquier bug que solo aparece en el navegador (console errors, rendering, event handlers): usar `webapp-testing` (Playwright). Para cambios puramente backend (rutas, DB, lógica de negocio), curl + smoke tests son suficientes.

[2026-05-02] | El `callbackURL` de Google OAuth (Passport.js) estaba hardcodeado al dominio Railway interno (`web-production-d02f4.up.railway.app`) en vez de usar `BASE_URL`. Con el dominio custom `academiapro.academy` configurado en Google Cloud Console, el mismatch causaba `TokenError: Bad Request` en cada login con Google. No se detectó antes porque el flujo OAuth nunca fue probado con el dominio custom. | En cualquier callback URL de OAuth, usar siempre `process.env.BASE_URL` — nunca hardcodear dominios de infraestructura. Verificar el flujo OAuth completo tras cualquier cambio de dominio.

[2026-05-02] | El query de Gmail para buscar transcripciones solo incluía `from:meet-recordings-noreply@google.com`. Google Meet AI Notes (Gemini) envía los emails desde `gemini-notes@google.com`. Resultado: 0 transcripciones encontradas aunque el email estuviera en el buzón. Detectado analizando los logs de Railway (`No new transcript emails found`) y confirmando el sender real del email. | Al integrar con APIs de terceros que envían emails (Google, etc.), verificar el sender real de cada tipo de notificación — pueden usar dominios distintos según el producto (Meet clásico vs Gemini AI Notes). Confirmar siempre con un email real antes de asumir el sender.

[2026-06-09] | El email HTML de Google Meet contiene el enlace a la grabación de Drive en un `href`, pero `extractText` borra todos los tags con `.replace(/<[^>]+>/g,' ')`, perdiendo la URL antes de llegar a Groq. | Para extraer datos estructurados (URLs, metadatos) de emails HTML, hacerlo ANTES de la limpieza de texto con una función dedicada que trabaje sobre el HTML crudo.

[2026-06-09] | Las sesiones recurrentes "para siempre" no pueden ser infinitas en DB. El patrón correcto es un horizonte rodante: guardar la regla (day_of_week + start_time) y materializar las próximas N semanas. El cron diario añade las nuevas sin duplicar (idempotencia por check de slot existente). | Para cualquier feature de "repetir indefinidamente", usar regla + horizonte rodante + idempotencia, nunca insertar infinitas filas.

[2026-05-26] | En el matching de alumnos por nombre (`students.find`), se usaba `s.name.toLowerCase().includes(nameToMatch)` sin guardar contra string vacío. `String.prototype.includes('')` devuelve `true` para cualquier string — si Groq no identifica al alumno y devuelve `student_name: ""`, el find siempre retorna el primer alumno de la lista, enviando la transcripción al chat equivocado. | Antes de cualquier `.includes(userInput)` en búsquedas de texto, verificar `userInput.length >= N` (mínimo 2). Un string vacío como needle en `includes` es un falso positivo garantizado.
