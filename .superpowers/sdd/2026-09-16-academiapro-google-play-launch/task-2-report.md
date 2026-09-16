# Task 2 — Google OAuth scopes

## Cambios

- `routes/calendar.js`: Calendar solicita solo `https://www.googleapis.com/auth/calendar.events`; el estado OAuth incluye una hora de emisión firmada y solo es válido durante los primeros 15 minutos.
- `routes/transcripts.js`: Gmail solicita solo `https://www.googleapis.com/auth/gmail.readonly`; aplica la misma validación antes de canjear el código.
- `services/gmail.js`: ya no llama a `users.messages.modify` ni marca mensajes como leídos.
- `tests/oauth-scopes.js`: prueba scopes, callbacks, la matriz de estados OAuth inválidos y que Gmail no modifica mensajes.
- `services/calendar.js`: sin cambios. Todos sus callers fueron revisados; Calendar lo usa con credenciales existentes y Gmail conserva `/api/gmail/callback` para su conexión.

## Decisiones

| Flujo | Scope final | Callback |
|---|---|---|
| Login | `profile`, `email` | `/auth/google/callback` |
| Calendar | `https://www.googleapis.com/auth/calendar.events` | `/api/calendar/callback` |
| Gmail | `https://www.googleapis.com/auth/gmail.readonly` | `/api/gmail/callback` |

`calendar.events` cubre las operaciones liberadas `events.insert`, `events.get`, `events.patch` y `events.delete`; no hay una operación actual que requiera el scope amplio `calendar`.

Marcar el correo como leído no es necesario para procesar transcripciones. La deduplicación usa `transcripts.gmail_msg_id`, el reintento/avance usa `gmail_last_check`, y `users.messages.modify` se ejecutaba solo después de guardar, notificar y emitir el resultado. Por ello se eliminaron tanto la llamada como `gmail.modify`.

La hora de emisión forma parte del dato cubierto por HMAC. El estado exige exactamente `{d,s}`, tres segmentos, nonce hexadecimal de 16 caracteres, ID entero positivo seguro y timestamp entero seguro. Calendar y Gmail aceptan una edad inclusiva de `0..900000 ms`; rechazan estados ausentes, manipulados, mal formados, futuros o más antiguos antes de llamar a `getToken`.

## Pruebas

TDD observado:

1. Calendar falló por solicitar `calendar` y `calendar.events`.
2. Gmail falló por solicitar `gmail.readonly`, `gmail.modify` y dos scopes Calendar.
3. La primera matriz reforzada falló porque un estado firmado con estructura extra llegó a `getToken`.
4. Tras los cambios, `node tests/oauth-scopes.js`: 7/7. Cada rechazo mantiene `getTokenCalls` en cero para Calendar y Gmail, exactamente 15 minutos se acepta y el procesamiento Gmail confirma cero llamadas a `users.messages.modify`.

Regresiones locales que pasan:

- `node tests/persistent-login.js`
- `node tests/gmail-resilience.js`: 7/7
- `node tests/meet-owner-resolution.js`
- `npm run test:socket-authz`

Fallos ajenos al diff:

- `npm test`: el smoke remoto terminó 66/67; solo falló el transcript corto porque el proveedor IA devolvió JSON inválido (`500`). En una ejecución anterior pasó 70/70.
- `node tests/homework-reminders.js`: su mock rechaza la consulta existente `SELECT user_id FROM students ...`; termina con `500 !== 200`.

No se corrigieron porque están fuera del alcance del Task 2 y no fueron causados por este diff.

## Pendiente externo

- Deben alinearse estos scopes finales con Google Cloud antes de publicar.
