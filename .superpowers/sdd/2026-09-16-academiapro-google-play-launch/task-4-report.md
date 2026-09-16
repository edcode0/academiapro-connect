# Task 4 — Privacidad, términos y eliminación de cuenta

**Fecha:** 2026-09-16

**Rama:** `codex/google-play-readiness`

**Estado del repositorio:** completado y validado

**Estado público:** pendiente de despliegue; no se hizo push

## Cambios

- `public/privacy.html`
  - publica como responsable a **Eduard Luque Debón**, sin NIF ni dirección no confirmados;
  - usa `hola@academiapro.academy` y no afirma que su recepción esté verificada;
  - corrige la contraseña a **hash bcrypt**;
  - sustituye Groq por **DeepSeek**;
  - explica datos de cuentas, alumnos, profesores, chats, transcripciones, Calendar/Meet y Gmail;
  - documenta los scopes finales `calendar.events` y `gmail.readonly`, la conexión iniciada por el usuario, el acceso Gmail sin escritura, los tokens cifrados en servidor, el refresco, la desconexión, la revocación y el borrado;
  - concreta el envío a DeepSeek: hasta 8.000 caracteres del mensaje localizado más nombres candidatos en el flujo Gmail, hasta 12.000 caracteres en cargas manuales y hasta 5.000 caracteres de texto original almacenado localmente junto al resultado estructurado;
  - elimina plazos automáticos de retención que el código no aplica y limita las afirmaciones de borrado a lo que demuestra la implementación.
- `public/terms.html`
  - sustituye Groq por DeepSeek y actualiza el contacto;
  - elimina precios, planes, facturación anticipada, períodos de gracia y reembolsos presentados como existentes;
  - declara Stripe, planes y precios como futuros, con contratación web, y excluye compras dentro de Android v1;
  - enlaza privacidad y eliminación de cuenta.
- `public/delete-account.html`
  - nueva página estática pública, sin login ni formulario y sin recogida directa de datos;
  - explica el borrado desde la zona de peligro para administradores, profesores y alumnos;
  - ofrece `hola@academiapro.academy` cuando el usuario no puede iniciar sesión;
  - describe los registros y tokens que borra la ruta, la revocación de Google y los límites sobre adjuntos, proveedores externos y copias de otros usuarios.
- `docs/release-readiness.md`
  - actualizado con los resultados finales de Tasks 2–4, las URLs candidatas y los bloqueos restantes.

No fue necesario cambiar `index.js`: `express.static(public, { index: false })` ya expone `/delete-account.html` sin autenticación y sin datos de usuario.

## URLs

| Recurso | URL estable prevista | Evidencia 2026-09-16 |
|---|---|---|
| Homepage | `https://academiapro.academy/` | live `200`, TLS válido |
| Privacidad | `https://academiapro.academy/privacy.html` | live `200`, TLS válido |
| Términos | `https://academiapro.academy/terms.html` | live `200`, TLS válido |
| Eliminación | `https://academiapro.academy/delete-account.html` | local `200`; live `404` hasta desplegar este commit |
| Soporte | `https://academiapro.academy/support` | live `404`; no existe página dentro del alcance |

Las rutas limpias live `/privacy` y `/terms` también devuelven `200`. No se creó alias limpio para eliminación porque el fichero estático ya proporciona la URL HTTPS estable exigida y el alcance pedía tocar rutas solo si era necesario.

## Afirmaciones deliberadamente no confirmadas

- `hola@academiapro.academy` fue suministrado como buzón creado, pero no se envió ningún mensaje; entrega, lectura y respuesta siguen pendientes.
- No se publican NIF ni dirección del responsable porque no fueron confirmados.
- No se atribuyen a DeepSeek ubicaciones de servidores, certificaciones, garantías contractuales ni plazos de conservación/borrado no comprobados.
- No se prometen plazos automáticos para datos académicos, chats, transcripciones, logs o copias de seguridad porque el repositorio no implementa ni demuestra esos ciclos.
- El borrado autenticado elimina registros de base de datos y tokens locales, pero no demuestra la eliminación de adjuntos ya guardados, datos ya tratados por proveedores o copias realizadas por usuarios.
- La revocación de Google es de mejor esfuerzo: los tokens locales se limpian aunque Google no confirme la revocación.
- Existen endpoints autenticados de desconexión de Calendar y Gmail, pero las páginas actuales de configuración no muestran botones de desconexión.

## Validación

- RED previo: faltaba `public/delete-account.html` y se detectaron el email heredado, Groq y los precios/facturación no implementados.
- GREEN: `LEGAL_HTML_ASSERTIONS_OK` sobre doctype, idioma, viewport, títulos, contacto, responsable, scopes, límites de texto, cifrado, DeepSeek, términos comerciales y contenido de eliminación.
- `tidy -utf8 --new-blocklevel-tags nav,main,footer -errors -quiet`: salida sin errores estructurales; solo advertencias de un Tidy antiguo sobre elementos/atributos HTML5.
- `node tests/oauth-scopes.js`: **7/7**.
- `NODE_ENV=test GOOGLE_TOKEN_ENCRYPTION_KEY=task4-local-verification-key node tests/oauth-token-lifecycle.js`: **18/18**.
- Servidor estático local: `/privacy.html`, `/terms.html` y `/delete-account.html` devolvieron `200`.
- HTTPS live mediante `curl -L` con validación TLS: homepage, privacidad y términos `200`; soporte y eliminación `404`, sin publicar nada.
- Búsqueda legal: sin `support@tuacademia.app`, `Groq`, precios `€29/€59`, contraseña “cifrada” ni plazos de retención obsoletos en las tres páginas.
- La búsqueda del repositorio conserva nombres internos/históricos `groq` (`services/groq.js`, mocks, tests y documentación antigua); el cliente real sigue siendo DeepSeek y esos ficheros quedaron fuera del alcance estricto.

Se inició por error `npm test`, cuyo smoke usa Railway por defecto. Se interrumpió al detectarlo y se eliminó inmediatamente la academia temporal mediante su propia ruta autenticada de borrado: `REMOTE_SMOKE_CLEANUP_OK ts=1789584020186`. No se repitió ninguna suite remota.

## Bloqueos restantes para OAuth y Play

1. Desplegar este commit y comprobar `https://academiapro.academy/delete-account.html` antes de registrarlo en Play Console.
2. Confirmar mediante una prueba controlada que `hola@academiapro.academy` recibe y responde correo; publicar además una página HTTPS de soporte.
3. Alinear Google Cloud con `profile`, `email`, `calendar.events` y `gmail.readonly`; resolver la verificación del scope restringido de Gmail y cualquier evaluación de seguridad aplicable.
4. Facilitar y verificar el wrapper Android, `applicationId=academy.academiapro.app`, navegador seguro/Custom Tabs, firma y AAB.
5. Completar Play Console, Data safety, instrucciones de revisión y pruebas cerradas.
6. Quitar o calificar en `public/landing.html` las menciones a Stripe y precios fijos; quedó fuera del alcance de Task 4.
7. Exponer controles de desconexión OAuth en la interfaz o validar el proceso de soporte.
8. Definir y probar el borrado de adjuntos persistentes antes de prometer su supresión.
