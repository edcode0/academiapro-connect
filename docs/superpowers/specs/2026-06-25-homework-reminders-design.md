# Diseño: recordatorios de deberes desde transcripciones

Fecha: 2026-06-25

## Objetivo

Cuando una transcripción detecte que el profesor ha mandado deberes, la app debe generar un segundo paso para el alumno: organizar cuándo los hará y registrar después si los hizo o no.

La primera versión ya está implementada localmente y usa solo recordatorios dentro de la app.

## Decisión de producto

### Fase 1 aprobada y aterrizada localmente

Después del mensaje de transcripción:

- si `deberes` está vacío, no pasa nada más
- si `deberes` tiene contenido, aparece un segundo mensaje para el alumno

Ese segundo mensaje debe:

- mostrar el texto `Tienes que hacer estos deberes:`
- listar los deberes detectados
- permitir seleccionar día de la semana
- permitir seleccionar hora
- guardar un recordatorio

Cuando llegue el momento programado:

- el alumno recibe una notificación dentro de la app
- al abrirla puede responder:
  - `No tengo deberes`
  - `No los he hecho`
  - `Ya los he hecho`

La respuesta del alumno no irá al chat del profesor. Irá a una bandeja específica de seguimiento de deberes para el profesor.

### Fase 2 aplazada

En una fase posterior, se quiere soporte de push real al móvil con acciones rápidas dentro de la notificación del sistema.

Eso queda explícitamente fuera de esta iteración, pero debe quedar anotado como siguiente mejora de producto.

## Estado actual relevante

- Ya existe el procesamiento de transcripciones manual y automático.
- Ya existe envío de mensajes al chat alumno-profesor.
- Ya existe sistema de notificaciones internas en base de datos + Socket.IO.
- No veo infraestructura clara de push móvil real con acciones del sistema operativo.

Por eso la V1 se apoya en capacidades que ya existen:

- mensajes en chat
- registros en base de datos
- notificaciones internas de la app

## Flujo funcional

### 1. Procesamiento de transcripción

Cuando el resumen procesado tenga `deberes`:

1. se envía el mensaje de transcripción normal
2. se crea un segundo mensaje de “organiza tus deberes”
3. se crea un registro pendiente de planificación o directamente un recordatorio si el alumno ya elige hora/día desde ese mensaje

### 2. Programación por parte del alumno

El alumno debe poder:

- ver la lista de deberes
- elegir un día de la semana
- elegir una hora
- guardar

Tras guardar:

- queda programado el recordatorio
- el estado inicial del seguimiento queda como `scheduled`

### 3. Recordatorio

Cuando llegue la fecha/hora correspondiente:

- la app crea una notificación interna para el alumno
- la notificación debe abrir la vista o módulo donde responder el estado del deber

### 4. Respuesta del alumno

El alumno responde con uno de estos estados:

- `no_homework`
- `not_done`
- `done`

Al guardar respuesta:

- se actualiza el seguimiento de deberes
- se marca cuándo respondió
- se notifica al profesor
- la bandeja del profesor refleja el nuevo estado

## UX propuesta

### Para el alumno

#### Mensaje posterior a la transcripción

Se mostrará como un bloque específico, separado del resumen de clase.

Contenido:

- título orientado a acción
- lista de deberes
- selector de día
- selector de hora
- botón para guardar recordatorio

No hace falta intentar usar botones nativos dentro del propio chat si eso complica demasiado la base actual. Lo importante es que el mensaje conduzca a una acción clara y sencilla.

#### Notificación interna

Texto recomendado:

- título: `Es la hora de hacer tus deberes`
- cuerpo: resumen corto de los deberes pendientes

La notificación debe llevar al alumno a una pantalla o modal donde pueda marcar su estado.

### Para el profesor

Se crea una bandeja simple de seguimiento de deberes, no un chat paralelo.

Cada entrada debe mostrar al menos:

- alumno
- deberes resumidos
- día/hora programados
- estado actual
- fecha de última respuesta

Estados visibles:

- `Programado`
- `No tengo deberes`
- `No los he hecho`
- `Ya los he hecho`

## Propuesta técnica

## Modelo de datos

Hace falta una tabla nueva, separada de `sessions` y de `transcripts`, porque este seguimiento tiene ciclo de vida propio.

Propuesta mínima:

`homework_reminders`

Campos:

- `id`
- `academy_id`
- `student_id`
- `teacher_id`
- `transcript_id` nullable
- `source` con valor inicial `transcript`
- `homework_json` o texto serializado con la lista de deberes
- `scheduled_day_of_week`
- `scheduled_time`
- `scheduled_for` si decidimos materializar próxima fecha/hora exacta
- `status`
- `student_response_at`
- `teacher_notified_at`
- `created_at`
- `updated_at`

Estados mínimos:

- `pending_schedule`
- `scheduled`
- `no_homework`
- `not_done`
- `done`

## Generación del segundo mensaje

No conviene meter lógica compleja dentro del HTML de chat existente.

Recomendación:

- reutilizar el flujo actual de envío de transcripción
- después de enviar el resumen, si hay deberes, crear un registro en `homework_reminders`
- mandar un segundo mensaje al chat con CTA clara

Ese mensaje puede ser HTML sencillo, igual que la tarjeta de transcripción, y contener enlace o acción hacia una vista del alumno para programar el recordatorio.

## Programación del recordatorio

La opción más simple y robusta para V1:

- guardar día/hora elegidos
- calcular la próxima ocurrencia útil
- desde un cron ya existente o desde un chequeo periódico en servidor, lanzar la notificación cuando toque

No hace falta push móvil real para esta fase.

## Entrega de la notificación

V1:

- usar tabla `notifications`
- emitir por Socket.IO si el alumno está conectado
- mostrarla en la campana/inbox de notificaciones de la app

La notificación debe llevar `link` a la pantalla donde responder el estado del deber.

## Recepción por parte del profesor

No recomiendo que llegue al profesor como mensaje de chat, porque:

- mezcla seguimiento operativo con conversación
- dificulta filtrar estados
- escala peor cuando haya muchos alumnos

Recomiendo una bandeja específica, por ejemplo:

- una vista nueva de “Seguimiento de deberes”
- o un bloque nuevo en el perfil del alumno / dashboard del profesor

Mi recomendación es empezar por una vista simple tipo lista filtrable. Es más útil que enterrarlo dentro del perfil de cada alumno.

## API esperada

Como diseño, no nombres definitivos, pero el sistema necesitará algo parecido a:

- crear recordatorio desde transcripción
- listar recordatorios del alumno
- programar día/hora
- listar seguimiento para profesor
- responder estado del deber
- marcar como notificado cuando se dispare el recordatorio

## Reglas importantes

- si no hay deberes, no se crea recordatorio
- si la transcripción trae deberes duplicados o vacíos, limpiar antes de guardar
- el alumno solo puede responder sus propios recordatorios
- el profesor solo ve recordatorios de sus alumnos asignados
- un recordatorio ya respondido no debe seguir disparando avisos como si siguiera pendiente

## Verificación

La implementación debe cubrir como mínimo:

- creación de recordatorio cuando una transcripción sí trae deberes
- no creación cuando no hay deberes
- guardado correcto de día/hora
- disparo de notificación interna
- respuesta del alumno con los tres estados posibles
- visibilidad correcta en la bandeja del profesor

## No objetivos

- push móvil real del sistema operativo
- acciones rápidas desde la notificación nativa del móvil
- sincronización con calendario externo
- gamificación o métricas avanzadas de deberes

## Backlog explícito

Pendiente para fase futura:

- `Fase 2`: push real al móvil con acciones directas en la notificación:
  - `No tengo deberes`
  - `No los he hecho`
  - `Ya los he hecho`

## Decisión final

Se implementará una V1 apoyada en notificaciones internas de la app y una bandeja específica de seguimiento de deberes para el profesor. La V2 de push móvil real queda aplazada y documentada como mejora futura.
