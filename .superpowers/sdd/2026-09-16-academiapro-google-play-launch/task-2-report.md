# Task 2 — Google OAuth scopes

## Cambios

- `routes/calendar.js`: Calendar solicita solo `https://www.googleapis.com/auth/calendar.events`; el estado OAuth incluye una hora de emisión firmada y expira tras 15 minutos.
- `routes/transcripts.js`: Gmail solicita solo `https://www.googleapis.com/auth/gmail.readonly`; aplica la misma expiración antes de canjear el código.
- `services/gmail.js`: ya no llama a `users.messages.modify` ni marca mensajes como leídos.
- `tests/oauth-scopes.js`: prueba los scopes reales de login, Calendar y Gmail, conserva los tres callbacks separados y verifica que un estado expirado no llega a `getToken`.
- `services/calendar.js`: sin cambios. Todos sus callers fueron revisados; Calendar lo usa con credenciales existentes y Gmail conserva `/api/gmail/callback` para su conexión.

## Decisiones

| Flujo | Scope final | Callback |
|---|---|---|
| Login | `profile`, `email` | `/auth/google/callback` |
| Calendar | `https://www.googleapis.com/auth/calendar.events` | `/api/calendar/callback` |
| Gmail | `https://www.googleapis.com/auth/gmail.readonly` | `/api/gmail/callback` |

`calendar.events` cubre las operaciones liberadas `events.insert`, `events.get`, `events.patch` y `events.delete`; no hay una operación actual que requiera el scope amplio `calendar`.

Marcar el correo como leído no es necesario para procesar transcripciones. La deduplicación usa `transcripts.gmail_msg_id`, el reintento/avance usa `gmail_last_check`, y `users.messages.modify` se ejecutaba solo después de guardar, notificar y emitir el resultado. Por ello se eliminaron tanto la llamada como `gmail.modify`.

La hora de emisión forma parte del dato cubierto por HMAC. Calendar y Gmail rechazan estados inválidos o con más de 15 minutos y redirigen a error antes de llamar a `getToken`.

## Pruebas

TDD observado:

1. Calendar falló por solicitar `calendar` y `calendar.events`.
2. Gmail falló por solicitar `gmail.readonly`, `gmail.modify` y dos scopes Calendar.
3. La expiración falló porque el callback llamó una vez a `getToken` con estado vencido.
4. Tras los cambios, `node tests/oauth-scopes.js`: 6/6.

Regresiones locales que pasan:

- `npm test`: smoke 70/70, socket authz y Gmail 7/7
- `node tests/persistent-login.js`
- `node tests/gmail-resilience.js`: 7/7
- `node tests/meet-owner-resolution.js`

Fallo de línea base reproducido antes y después del cambio:

- `node tests/homework-reminders.js`: su mock rechaza la consulta existente `SELECT user_id FROM students ...`; termina con `500 !== 200`.

No se corrigió porque está fuera del alcance del Task 2 y no fue causado por este diff. El primer intento de `npm test` dio 6/34 por estado remoto reutilizado; la ejecución final limpia pasó 70/70.

## Bloqueos restantes

- El wrapper Android, el proyecto OAuth de Google Cloud y la aplicación Play Console siguen sin estar disponibles para verificación; este task no asume que exista un wrapper.
- Deben alinearse los scopes finales con Google Cloud antes de publicar.
