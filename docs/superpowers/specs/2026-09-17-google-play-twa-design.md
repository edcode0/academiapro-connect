# AcademiaPro Android wrapper (TWA) — diseño

## Objetivo

Publicar `https://academiapro.academy` en Google Play como una aplicación
Android con `applicationId` `academy.academiapro.app`, manteniendo una sola
aplicación web y evitando que Google OAuth se ejecute dentro de un WebView.

## Decisión

Usaremos una Trusted Web Activity (TWA) generada con Bubblewrap y basada en
Custom Tabs. No usaremos Capacitor ni un WebView embebido para renderizar la
aplicación.

La TWA encaja con AcademiaPro porque el producto actual es una web completa,
con autenticación y sesiones gestionadas por el servidor. El navegador del
usuario conserva el contexto de cookies y ejecuta el flujo OAuth en un agente
de usuario permitido por Google. Si la verificación de Digital Asset Links
falla, el navegador debe degradar a Custom Tab visible, nunca a WebView.

## Componentes

1. `android/`: proyecto Android mínimo generado con Bubblewrap.
2. `public/.well-known/assetlinks.json`: asociación entre el dominio y el
   paquete Android, usando la huella SHA-256 de la clave de firma.
3. Manifest web/PWA mínimo si Bubblewrap lo necesita para generar la TWA.
4. Iconos y nombre visibles de AcademiaPro.
5. Documentación de build y firma, sin incluir claves privadas ni secretos.

El wrapper no tendrá `GOOGLE_CLIENT_SECRET`, tokens de Google, claves de
Railway ni credenciales de usuario. Todo el OAuth seguirá pasando por el
servidor HTTPS de AcademiaPro.

## Flujo de navegación y OAuth

```text
AcademiaPro TWA
  -> navegador/Custom Tab del sistema
  -> https://academiapro.academy/auth/google
  -> accounts.google.com (consentimiento OAuth)
  -> /auth/google/callback o callback específico de Calendar/Gmail
  -> servidor AcademiaPro guarda tokens cifrados y sesión HttpOnly
  -> navegador vuelve a AcademiaPro
```

El wrapper no interceptará `accounts.google.com`, no inyectará JavaScript y no
leerá cookies del navegador. Los flujos existentes de login, Calendar y Gmail
se probarán desde la TWA en un dispositivo Android físico.

## Requisitos de dominio y Play

- `https://academiapro.academy` debe servir `/.well-known/assetlinks.json`.
- El certificado de firma usado para probar y publicar debe estar controlado
  y documentado; la huella de Play App Signing se añadirá cuando Play la
  proporcione.
- El bundle será `.aab`, no APK de producción.
- El proyecto se configurará con el nivel de API objetivo exigido por Play en
  la fecha de envío; al preparar el build actual se comprobará API 36.
- La ficha incluirá política de privacidad, eliminación de cuenta, soporte y
  credenciales de revisión si Google las necesita.

## Pruebas de aceptación

### Locales

- El paquete generado contiene exactamente
  `academy.academiapro.app`.
- `assetlinks.json` coincide con el paquete y la huella de firma.
- El build reproducible genera un `.aab` y no contiene secretos.
- La aplicación abre la URL HTTPS de producción y no contiene una clase
  `WebView` ni una navegación OAuth embebida.

### En Android físico

- Login con contraseña.
- Login con Google.
- Conexión y desconexión de Google Calendar/Meet.
- Conexión y desconexión de Gmail/transcripciones.
- Regreso correcto a AcademiaPro después del consentimiento y tras cancelar.
- Cookies/sesión conservadas al cerrar y reabrir la TWA.
- Enlaces externos, subida de archivos, descarga y botón atrás.
- Comportamiento cuando no hay Chrome o cuando Digital Asset Links aún no está
  verificado.

### Play Console

- Prueba interna con el `.aab` firmado.
- Revisión de permisos, ficha, seguridad de datos, contenido y credenciales de
  acceso del revisor antes de solicitar producción.

## Orden de implementación

1. Integrar en esta rama los cambios de preparación de Play que están en la
   rama local anterior, conservando los cinco commits nuevos de `origin/main`.
2. Preparar la web para TWA: manifest, iconos y `assetlinks.json`.
3. Generar el proyecto Android mínimo con Bubblewrap.
4. Configurar paquete, firma y build `.aab`.
5. Instalar las herramientas Android necesarias y ejecutar las pruebas físicas.
6. Corregir solo los fallos encontrados en esas pruebas.
7. Subir la rama al repositorio y abrir revisión antes de tocar `main`.

## Fuera de alcance

- Reescribir la aplicación como app nativa.
- Añadir pagos Stripe dentro de Android ahora.
- Crear un puente de tokens entre WebView y Custom Tabs.
- Añadir notificaciones push nativas sin una necesidad demostrada.
- Ejecutar `npm test`, porque sus pruebas smoke apuntan por defecto a Railway.

