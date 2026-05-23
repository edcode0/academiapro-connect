# Diseño: Seguimiento IA por Alumno

**Fecha:** 2026-05-23
**Estado:** Aprobado

---

## Resumen

El profesor puede introducir opiniones, objetivos y estilo de trabajo por alumno (vía texto o voz). La IA combina esa información con las transcripciones de las sesiones para generar informes mensuales de progreso con diagnósticos y recomendaciones. Esta información es estrictamente privada: solo accesible para el profesor asignado y el admin. Nunca visible para el alumno.

---

## Modelo de datos

### Tabla `student_ai_profiles`
Perfil estructurado del alumno editado por el profesor. Un registro por alumno (upsert).

| columna | tipo | descripción |
|---|---|---|
| id | serial PK | |
| academy_id | int NOT NULL | aislamiento multi-tenant |
| teacher_id | int NOT NULL | FK users |
| student_id | int NOT NULL UNIQUE | FK students |
| objectives | text | objetivos marcados por el profesor |
| working_style | text | cómo trabaja el alumno |
| observations | text | observaciones generales |
| updated_at | timestamp | última edición |

### Tabla `ai_reports`
Informes mensuales generados por Groq. Un registro por alumno por mes.

| columna | tipo | descripción |
|---|---|---|
| id | serial PK | |
| academy_id | int NOT NULL | |
| teacher_id | int NOT NULL | FK users |
| student_id | int NOT NULL | FK students |
| month | varchar(7) NOT NULL | formato `YYYY-MM` |
| report_json | text NOT NULL | informe estructurado (JSON) |
| created_at | timestamp | |

Índice único en `(student_id, month)` para evitar duplicados.

---

## API

Nuevo router `routes/ai-profiles.js`. Todos los endpoints requieren `authenticateJWT` + `requireTeacherOrAdmin`. Los profesores solo acceden a alumnos asignados (`assigned_teacher_id = req.user.id`). El admin accede a todos.

| método | ruta | descripción |
|---|---|---|
| `GET` | `/api/ai-profiles/:student_id` | obtiene el perfil del alumno |
| `POST` | `/api/ai-profiles/:student_id` | crea o actualiza el perfil (upsert) |
| `POST` | `/api/ai-profiles/:student_id/voice` | estructura texto de voz con Groq, devuelve campos — no guarda |
| `GET` | `/api/ai-reports/:student_id` | lista informes mensuales del alumno |
| `POST` | `/api/ai-reports/:student_id/generate` | genera informe del mes actual manualmente |

---

## Interfaz

Nueva sección **"Seguimiento IA"** añadida al final de `teacher_student_profile.html`. Tres partes:

**1. Editor del perfil**
Tres campos de texto: Objetivos, Estilo de trabajo, Observaciones. Botón de micrófono por campo. Al pulsar, Web Speech API transcribe en tiempo real. Al soltar, el texto va al endpoint `/voice` y Groq rellena los tres campos automáticamente. El profesor puede editar antes de guardar. Botón "Guardar perfil".

**2. Informes mensuales**
Lista de informes, uno por mes, cada uno expandible con:
- Progreso hacia objetivos (semáforo verde/amarillo/rojo)
- Patrones detectados en transcripciones del mes
- Recomendaciones concretas para el profesor
- Alerta destacada si hay algo preocupante

**3. Botón "Generar informe ahora"**
Genera el informe del mes en curso sin esperar al cron. Requiere al menos un perfil guardado.

---

## Lógica de IA

### Estructurar voz
Prompt a Groq con el texto transcrito. Groq identifica qué fragmentos corresponden a cada campo y devuelve:
```json
{
  "objectives": "...",
  "working_style": "...",
  "observations": "..."
}
```
Campos no mencionados quedan vacíos. Groq no inventa.

### Generar informe mensual
Groq recibe:
- Perfil del profesor (objetivos, estilo, observaciones)
- Resúmenes procesados de todas las transcripciones del mes (no texto crudo)
- Informe del mes anterior si existe (para evaluar evolución)

Devuelve:
```json
{
  "progreso_objetivos": { "estado": "verde|amarillo|rojo", "detalle": "..." },
  "patrones_detectados": ["...", "..."],
  "recomendaciones": ["...", "..."],
  "alerta": null
}
```

Si no hay transcripciones del mes: informe generado solo con perfil, marcado como `sin_sesiones: true`.
Si no hay perfil guardado: no se genera informe.

---

## Cron mensual

El cron existente en `cron.js` (se ejecuta diariamente) se extiende para que el día 1 de cada mes recorra todos los alumnos con `student_ai_profiles` activo y genere el informe del mes anterior automáticamente.

---

## Privacidad

- Ningún endpoint accesible con rol `student`
- Profesores: solo sus alumnos asignados (`assigned_teacher_id`)
- Admin: acceso completo dentro de su `academy_id`
- No se expone en el portal del alumno
