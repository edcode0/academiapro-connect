# Guía de Despliegue en Railway - AcademiaPro

Esta aplicación está preparada para ser desplegada en **Railway** utilizando una base de datos **PostgreSQL**.

## 1. Configuración de PostgreSQL en Railway
1. Entra en tu panel de Railway y haz clic en **"New"** -> **"Database"** -> **"Add PostgreSQL"**.
2. Railway creará automáticamente una base de datos y te proporcionará una variable `DATABASE_URL`.

## 2. Variables de Entorno Requeridas
Debes configurar las siguientes variables en la sección **Settings -> Variables** de tu servicio en Railway:

*   `DATABASE_URL`: (Se añade automáticamente al conectar el plugin de PostgreSQL)
*   `JWT_SECRET`: Una cadena aleatoria larga (ej: `7f9e8d6c5b4a3f2...`)
*   `DEEPSEEK_API_KEY`: Tu clave de API de DeepSeek para el Tutor IA, informes y análisis de transcripciones.
*   `RESEND_API_KEY`: Tu clave de API de Resend para el envío de correos.
*   `GOOGLE_CLIENT_ID`: ID de cliente para Google OAuth.
*   `GOOGLE_CLIENT_SECRET`: Secreto de cliente para Google OAuth.
*   `GOOGLE_CALLBACK_URL`: URL completa de callback (ej: `https://tu-app.up.railway.app/auth/google/callback`).
*   `GOOGLE_TOKEN_ENCRYPTION_KEY`: Clave larga y aleatoria para cifrar los tokens de Google guardados en la base de datos.
*   `NODE_ENV`: cámbialo a `production`.

## 3. Pasos para el Despliegue
1. Conecta tu repositorio de GitHub a Railway.
2. Railway detectará automáticamente el archivo `package.json` y el `Procfile`.
3. El comando de inicio será `npm start` (definido en `package.json`).
4. La base de datos se inicializará automáticamente en el primer arranque gracias a la lógica integrada en `db.js`.

## 4. Notas Técnicas
*   La aplicación sigue funcionando con **SQLite localmente** si no se define `DATABASE_URL` en el archivo `.env`.
*   Se han unificado todas las consultas para ser compatibles con ambos motores (placeholders `$1, $2`, etc.).
*   Los archivos subidos (chat y reportes) se guardan en `public/uploads`, que en Railway está montado sobre un **volumen persistente** (`web-volume`, mount path `/app/public/uploads`) — sobreviven a los deploys. Para escala mayor podría migrarse a object storage (S3/bucket), pero el volumen cubre el uso actual.
