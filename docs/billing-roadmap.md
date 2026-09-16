# Hoja de ruta de pagos de AcademiaPro

**Estado:** Pendiente. No hay integración de Stripe implementada ni se han fijado todavía los planes definitivos.

**Fecha:** 2026-09-16

## Decisión provisional

La primera versión Android se planteará como una aplicación de acceso para academias que ya tienen una suscripción contratada. La contratación, el cambio de plan y el pago se realizarán en la web.

No se añadirá inicialmente un botón dentro de la aplicación Android que lleve directamente a Stripe. Antes de hacerlo habrá que revisar la política de pagos de Google Play y decidir entre Google Play Billing y la facturación alternativa disponible en el EEE.

## Modelo de negocio previsto

AcademiaPro ofrecerá una prueba gratuita de 30 días y varios planes mensuales según la capacidad de cada academia:

- número máximo de profesores;
- número máximo de alumnos;
- funciones incluidas en cada plan;
- precio mensual;
- impuestos aplicables.

Los planes, sus límites, precios, funciones, descuentos, facturación anual, política de cancelación y reembolsos están todavía por definir. No deben publicarse ni configurarse en Stripe hasta aprobar esta matriz.

## Flujo previsto cuando se implemente

1. El administrador crea la academia.
2. El administrador elige un plan.
3. El administrador introduce el método de pago en Stripe Checkout.
4. Stripe inicia una prueba gratuita de 30 días.
5. Se informa claramente de que el primer cobro se realizará al terminar la prueba y se recoge el método de pago al comenzar la prueba.
6. Al finalizar la prueba, Stripe intenta realizar el primer cobro mensual.
7. Stripe envía eventos al servidor mediante webhooks.
8. El servidor guarda el estado de la suscripción y activa, limita o suspende la academia según ese estado.
9. El administrador puede cambiar de plan, cancelar y consultar o descargar sus facturas desde el portal de cliente de Stripe.

La cancelación debe poder hacerse fácilmente antes de la primera factura y durante cualquier periodo posterior. El servidor será la fuente de verdad para los permisos: la interfaz no podrá ampliar por sí sola el número permitido de profesores o alumnos.

## Diseño técnico previsto

Cuando se aprueben los planes:

- Stripe tendrá un producto de AcademiaPro y un precio recurrente mensual por cada plan cerrado.
- Cada precio tendrá metadatos con el identificador del plan y sus límites de profesores y alumnos.
- Stripe Checkout gestionará la tarjeta; AcademiaPro no almacenará datos de tarjeta.
- El servidor asociará cada cliente de Stripe con una academia.
- Se procesarán, como mínimo, los eventos de finalización del checkout, renovación, cambio de suscripción, cancelación, pago correcto y pago fallido.
- El portal de cliente de Stripe gestionará cambios, cancelaciones y facturas.
- El servidor aplicará los límites del plan al crear o invitar profesores y alumnos.
- Los estados mínimos serán: `trialing`, `active`, `past_due`, `canceled` y `incomplete`.

## Decisiones pendientes

Antes de programar:

1. Definir qué incluye exactamente cada plan.
2. Definir los límites exactos de profesores y alumnos.
3. Definir precios mensuales, posibles precios anuales e IVA.
4. Decidir si se exige tarjeta al empezar la prueba.
5. Definir qué ocurre cuando se supera un límite o falla un cobro.
6. Confirmar cancelaciones, reembolsos y exportación de datos.
7. Confirmar la identidad legal y el email de soporte.
8. Decidir si la app Android será solo de consumo o si en el futuro se contratará dentro de Android.

## Estado actual del repositorio

El repositorio actual contiene registros internos de pagos y envío de informes por email, pero no contiene una integración real con Stripe. La implementación futura debe hacerse de forma separada y no debe confundirse con esos registros académicos existentes.
