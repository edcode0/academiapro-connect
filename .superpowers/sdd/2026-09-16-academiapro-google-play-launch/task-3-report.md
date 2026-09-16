# Task 3 — Ciclo de vida de tokens OAuth

## Resultado

- Los access/refresh tokens de Calendar y Gmail se guardan con AES-256-GCM mediante `node:crypto`, con IV aleatorio y tag de autenticación.
- No existe fallback a texto plano: callbacks y refresh rechazan de forma segura cualquier token no vacío si el cifrador no está disponible, sin escribirlo ni incluirlo en logs.
- `db.js` conserva las columnas existentes, cifra los tokens legacy al arrancar y los descifra transparentemente para todos los callers actuales.
- La aplicación no arranca sin `GOOGLE_TOKEN_ENCRYPTION_KEY`, salvo en `NODE_ENV=test`, donde usa una clave efímera por proceso. Debe ser un secreto estable y aleatorio (recomendado: 32 bytes, por ejemplo `openssl rand -base64 32`), configurado solo en el despliegue.
- Nuevos endpoints autenticados: `DELETE /api/calendar/disconnect` y `DELETE /api/gmail/disconnect`. Intentan revocar el refresh token (o access token si no existe) y limpian siempre las credenciales locales; responden `revocation: revoked|failed|not_needed` sin incluir tokens.
- `DELETE /api/auth/delete-account` intenta revocar ambos grants para el usuario; si borra una academia, enumera primero IDs sin columnas OAuth y procesa las credenciales usuario a usuario. Un ciphertext corrupto cuenta como fallo local, se limpia igualmente y no impide revocar los grants válidos de los demás usuarios. La respuesta incluye solo contadores de revocación.
- Los eventos de refresh de Gmail y Calendar persisten access/refresh tokens cifrados. Calendar limpia credenciales ante `invalid_grant` al usar el grant guardado para crear, actualizar o borrar eventos; un código inválido en el callback falla sin borrar una conexión anterior que podría seguir siendo válida. Gmail conserva su limpieza y notificación existentes.
- Desconexión y borrado de cuenta ejecutan la limpieza local aunque la lectura falle por ciphertext corrupto o clave incorrecta; los selectores siguen limitados al usuario o academia autenticados.
- Se eliminó el log que incluía la respuesta completa de IA derivada de una transcripción y se evitaron detalles sensibles en errores OAuth/revocación.

## TDD y pruebas

El primer RED produjo 6/7 fallos esperados; `invalid_grant` Gmail ya pasaba por comportamiento existente. Una integración SQLite posterior detectó que `ADD COLUMN IF NOT EXISTS` no creaba las columnas OAuth y se corrigió en el esquema existente. Las rondas de revisión añadieron RED reproducibles para refresh/`invalid_grant` Calendar, callback inválido, actualización de una reserva, limpieza con ciphertext corrupto, ausencia del cifrador y borrado multiusuario con una fila corrupta; todos quedan cubiertos.

Verificación final:

- `NODE_ENV=test GOOGLE_TOKEN_ENCRYPTION_KEY=una-clave-de-prueba node tests/oauth-token-lifecycle.js`: 18/18.
- `node tests/oauth-scopes.js`: 7/7.
- `node tests/persistent-login.js`: pasa.
- `node tests/gmail-resilience.js`: 7/7.
- `node tests/meet-owner-resolution.js`: pasa.
- `SMOKE_URL=http://127.0.0.1:31237 SMOKE_TIMEOUT=10000 node tests/socket-authz.js`, sobre una copia SQLite temporal: falla antes del flujo OAuth en `POST /api/chat/ensure-rooms` porque `services/rooms.js` ejecuta el SQL PostgreSQL `ANY($1::int[])` sobre SQLite. El `finally` limpió las cuentas temporales; no se repitió contra Railway.
- `node --check` sobre los siete archivos JS del alcance: pasa.
- `git diff --check`: pasa.

## Límites y riesgos residuales

- SQLite está cubierto con migración y lectura real en base temporal. PostgreSQL no pudo ejecutarse: no hay `DATABASE_URL` ni `psql` de pruebas disponibles.
- `tests/smoke.js` no se ejecutó porque apunta por defecto al despliegue Railway y crea/borra cuentas; hacerlo habría causado efectos externos expresamente prohibidos.
- Una ejecución socket anterior produjo actividad transitoria en Railway antes de detectar que comparte ese destino remoto por defecto; su limpieza final terminó correctamente. En esta ronda solo se usó el servidor local aislado indicado arriba y no se ejecutó ninguna suite remota.
- El caller Calendar del alcance pasa `users.id` directamente. El caller heredado de sesiones quedó fuera del alcance de archivos autorizado; el servicio solo resuelve su propietario por `google_event_id` cuando todos los slots coincidentes pertenecen inequívocamente al mismo profesor. Ante ambigüedad no limpia ninguna cuenta.
- `.env.example` quedó fuera del alcance autorizado. La variable obligatoria `GOOGLE_TOKEN_ENCRYPTION_KEY` y el método recomendado para generarla están documentados arriba y deben añadirse al gestor de secretos del despliegue.
- La clave no tiene rotación automática. Cambiarla sin recifrar los valores existentes hará que falle su autenticación; mantenerla estable o planificar una migración de rotación antes de cambiarla.
