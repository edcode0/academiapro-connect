# Construcción Android de AcademiaPro

El wrapper es una Trusted Web Activity (TWA), no una app con WebView. Su
paquete es `academy.academiapro.app`, abre `https://academiapro.academy/` y
apunta a API 36.

## Requisitos

- JDK 17.
- Android SDK con `platforms;android-36` y `build-tools;35.0.0`.
- `ANDROID_SDK_ROOT` apuntando al SDK local.
- La clave local `android/academiapro-upload.keystore`, que no se versiona.

Antes de compilar, producción debe servir estos recursos:

```text
https://academiapro.academy/manifest.webmanifest
https://academiapro.academy/icon-512.png
https://academiapro.academy/.well-known/assetlinks.json
```

## Build local

```bash
cd android
JAVA_HOME=/ruta/al/jdk-17 ANDROID_SDK_ROOT=/ruta/al/android-sdk \
ACADEMIAPRO_UPLOAD_KEY_PASSWORD='contraseña-del-keystore' ./gradlew bundleRelease
```

El build de release falla deliberadamente si no recibe la contraseña: así no se
puede generar por accidente un AAB sin firma. La ruta y el alias se pueden
sobrescribir con `ACADEMIAPRO_UPLOAD_KEYSTORE` y `ACADEMIAPRO_UPLOAD_KEY_ALIAS`.

El bundle se genera en:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

El build local actual se ha validado con `targetSdkVersion 36`.

## Firma y Digital Asset Links

La huella de la clave local de subida usada ahora es:

```text
EC:6F:FB:30:3B:51:FF:C0:15:F8:BF:49:C0:97:D9:26:36:A7:95:29:F3:51:F8:8F:1C:D7:38:1D:A4:CA:3B:28
```

La contraseña de la clave no se guarda en Git. Conserva una copia segura del
keystore: perderlo impide firmar actualizaciones compatibles antes de resolver
la configuración de Play App Signing.

Después de subir el primer bundle a Play Console, añade también la huella de
la clave de **Play App Signing** a `public/.well-known/assetlinks.json` y
despliega de nuevo. La huella de Play es la que necesitan las instalaciones
distribuidas por Google Play; la huella local sirve para pruebas firmadas
localmente.

## Comprobaciones

```bash
node tests/android-wrapper.js
git diff --check
```

El test comprueba paquete, dominio, manifest web, `assetlinks.json`, API 36,
fallback Custom Tabs y ausencia de WebView/secretos del servidor.
