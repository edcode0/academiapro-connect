# Task 3 — Ciclo de vida de tokens OAuth

## Resultado

- Los access/refresh tokens de Calendar y Gmail se guardan con AES-256-GCM mediante `node:crypto`, con IV aleatorio y tag de autenticación.
- `db.js` conserva las columnas existentes, cifra los tokens legacy al arrancar y los descifra transparentemente para todos los callers actuales.
- La aplicación no arranca sin `GOOGLE_TOKEN_ENCRYPTION_KEY`, salvo en `NODE_ENV=test`, donde usa una clave efímera por proceso. Debe ser un secreto estable y aleatorio (recomendado: 32 bytes, por ejemplo `openssl rand -base64 32`), configurado solo en el despliegue.
- Nuevos endpoints autenticados: `DELETE /api/calendar/disconnect` y `DELETE /api/gmail/disconnect`. Intentan revocar el refresh token (o access token si no existe) y limpian siempre las credenciales locales; responden `revocation: revoked|failed|not_needed` sin incluir tokens.
- `DELETE /api/auth/delete-account` intenta revocar ambos grants para el usuario; si borra una academia, lo hace para todos sus usuarios. Después limpia tokens y conserva las ramas de borrado admin/usuario existentes. La respuesta incluye solo contadores de revocación.
- El refresh de Gmail persiste access/refresh tokens cifrados; `invalid_grant` conserva la limpieza y notificación existentes.
- Se eliminó el log que incluía la respuesta completa de IA derivada de una transcripción y se evitaron detalles sensibles en errores OAuth/revocación.

## TDD y pruebas

El primer RED de `node tests/oauth-token-lifecycle.js` produjo 6/7 fallos esperados; `invalid_grant` ya pasaba por comportamiento existente. Una integración SQLite posterior detectó que `ADD COLUMN IF NOT EXISTS` no creaba las columnas OAuth en SQLite y se corrigió en el esquema existente, sin migración nueva.

Verificación final:

- `node tests/oauth-token-lifecycle.js`: 9/9.
- `node tests/oauth-scopes.js`: 7/7.
- `node tests/persistent-login.js`: pasa.
- `node tests/gmail-resilience.js`: 7/7.
- `node tests/meet-owner-resolution.js`: pasa.
- `npm run test:socket-authz`: pasa; con `SMOKE_URL` ausente usó su destino Railway por defecto y su bloque `finally` eliminó las cuentas de prueba creadas.
- `node --check` sobre los cinco archivos JS modificados: pasa.
- `git diff --check`: pasa.

## Límites y riesgos residuales

- SQLite está cubierto con migración y lectura real en base temporal. PostgreSQL no pudo ejecutarse: no hay `DATABASE_URL` ni `psql` de pruebas disponibles.
- `tests/smoke.js` no se ejecutó porque apunta por defecto al despliegue Railway y crea/borra cuentas; hacerlo habría causado efectos externos expresamente prohibidos.
- La prueba socket solicitada sí produjo actividad transitoria en Railway antes de detectar que también comparte el destino remoto por defecto; su limpieza final terminó correctamente. No se repitió ninguna suite remota.
- Calendar puede refrescar en memoria mediante `googleapis`, pero su servicio actual no registra el evento `tokens` ni limpia credenciales tras `invalid_grant`; corregir ambos caminos requeriría modificar `services/calendar.js`, fuera del alcance autorizado. El refresh token estable sí permanece cifrado y permite renovar en cada operación mientras siga válido.
- La clave no tiene rotación automática. Cambiarla sin recifrar los valores existentes hará que falle su autenticación; mantenerla estable o planificar una migración de rotación antes de cambiarla.
