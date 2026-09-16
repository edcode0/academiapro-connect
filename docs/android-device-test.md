# Pruebas de aceptación Android de AcademiaPro

Estas pruebas deben ejecutarse con el `.aab` en una prueba interna de Google
Play o con una build firmada instalada en un dispositivo Android real.

## Navegación y sesión

- [ ] La aplicación abre `https://academiapro.academy/`.
- [ ] El inicio de sesión con correo y contraseña funciona.
- [ ] La sesión HttpOnly se conserva al cerrar y reabrir la aplicación.
- [ ] El botón atrás navega correctamente y no cierra la aplicación de forma
      inesperada.
- [ ] Los enlaces externos se abren fuera de la TWA cuando corresponde.

## Google OAuth

- [ ] El login de Google se abre en Chrome Custom Tabs o en el navegador del
      sistema, nunca en un WebView.
- [ ] Se puede cancelar el consentimiento y volver a AcademiaPro sin dejar una
      sesión incompleta.
- [ ] Se puede completar el consentimiento y volver a la pantalla correcta.
- [ ] El flujo de Calendar/Meet conecta y desconecta correctamente.
- [ ] El flujo de Gmail/transcripciones conecta y desconecta correctamente.
- [ ] No aparecen credenciales, tokens ni secretos dentro del APK/AAB.

## Funciones web

- [ ] Las subidas y descargas de archivos funcionan.
- [ ] Chat, notificaciones y sesiones funcionan en móvil.
- [ ] La interfaz no tiene desbordamientos ni botones inaccesibles.
- [ ] La aplicación se comporta de forma segura si Digital Asset Links aún no
      está verificado: debe degradar a Custom Tab visible, nunca a WebView.

## Evidencia para el lanzamiento

Guardar fecha, versión del bundle, dispositivo, versión de Android y resultado
de cada prueba. La grabación para la revisión de Play debe mostrar el flujo
real de la aplicación y usar credenciales de revisión separadas, nunca la
contraseña personal del propietario.
