# VPAI CRM — Demo

CRM multi-tenant para talleres automotrices: recepción de vehículos, diagnóstico con checklist guiado (RADAR), presupuestos, agenda con calendario real, bandeja de WhatsApp, bodega, informes y un panel de notificaciones por rol.

Este repositorio es una **versión de demostración**, adaptada de un proyecto en producción real para un taller multimarca. Los datos de clientes, vehículos, órdenes de trabajo y conversaciones de WhatsApp que vienen cargados son **ficticios** — nombres, patentes y números de teléfono no corresponden a personas ni negocios reales.

## Probarlo

En el login, elige un rol del menú desplegable y entra sin contraseña — cada rol tiene una cuenta de prueba propia, con exactamente los permisos que tendría en un taller real (RLS por fila, no solo ocultar botones en la interfaz).

| Rol | Qué puede ver/hacer |
| --- | --- |
| Administrador | Acceso total, incluyendo informes, turnos y todas las notificaciones |
| Asesor | Recepción, presupuestos, mensajes de WhatsApp |
| Jefe de taller | Kanban y plano del taller, bodega, presupuestos |
| Encargado de bodega | Presupuestos, repuestos pendientes y asignados |
| Técnico | Órdenes de trabajo y sesiones RADAR |
| Recepcionista | Agenda, mensajes de WhatsApp |

Desde "Mi cuenta" (barra superior) se puede **cambiar de rol** sin volver al login, y cargar **correos de prueba** para recibir de verdad los correos del sistema (encuestas, avisos) sin que la demo le escriba a nadie más.

## Stack

- **Frontend:** React 18 + Vite + Tailwind, PWA instalable.
- **Backend:** Supabase (Postgres + Row Level Security + Auth + Storage + Edge Functions).
- **Multi-tenant desde el esquema:** cada tabla queda aislada por `empresa_id` vía RLS — dos talleres en la misma base nunca pueden verse los datos entre sí.

## Características

- **Recepción con dos flujos de ingreso**: diagnóstico (con checklist guiado de 48 puntos y hallazgos con foto) o servicio agendado.
- **Presupuestos** con aceptación parcial ítem por ítem y protección de precios en dos capas (RLS de fila + `REVOKE` de columna) para que solo quien tiene acceso a montos vea costos/precios reales.
- **Catálogo de servicios y precios** con selección guiada (tipo de vehículo → categoría → servicio) que resuelve el precio de mano de obra exacto y carga los repuestos típicos como pendientes de cotizar.
- **Agenda con calendario real** por bloques de 30 minutos, respetando horario de atención y corte de mediodía por isla.
- **Bandeja de WhatsApp** con categorización de conversación por estado, vínculo automático a la ficha del cliente por teléfono, y un bot de agendamiento por menú guiado (sin IA generativa: pasos numerados, así siempre agenda en un horario real con cupo).
- **Cierre de OT con bloqueo de edición**: al marcar "entregado", tareas/ítems/precios quedan fijos (con reapertura auditada para admin/socia), y la encuesta de postventa se agenda sola para el día siguiente.
- **Panel de notificaciones por rol**: presupuesto pendiente de aprobación, encuesta negativa, cita nueva, vehículo listo para entrega, repuesto sin presupuestar — cada una llega solo a quien le compete, y se resuelve sola cuando el motivo deja de aplicar.
- **Bodega** con control de stock por movimiento (compra/uso en OT/ajuste/devolución), nunca editado a mano directamente, y código de bodega automático.
- **Taller: Kanban + plano en vivo**: tablero por estado (sincronizado con ClickUp) con detalle de la OT a pantalla completa, asignación de técnico por tarea, listas de control editables y un plano del taller (33 x 65 m, rotación libre) donde cada puesto muestra el vehículo que tiene encima.
- **Agenda por disponibilidad del personal**: la capacidad depende de cuántas personas con cada habilidad hay en el bloque; vistas de día, semana, mes y año, con reagendamiento.
- **Facturación electrónica (DTE)**: factura, boleta, notas de crédito/débito y guía de despacho, con un proveedor *sandbox* que emite documentos simulados (sin validez tributaria).
- **Descuento en mano de obra** con tope por política para el asesor, y bloqueo de cierre si quedan tareas de mano de obra sin valorizar.
- **Observaciones del técnico y del asesor** en cada OT (bitácora), para venta cruzada y seguimiento.
- **Turnos y asistencia (RRHH)**: importa el informe del reloj control y clasifica cada día (normal, falta, incompleta, jornada extraordinaria).
- **Monitor de plataforma**: registro de accesos y uso del CRM por empresa.
- **Barra superior** con buscador global, modo nocturno, menú lateral contraíble y edición del propio perfil.

## Correr localmente

```bash
npm install
cp .env.example .env   # completar con tu propio proyecto de Supabase
npm run dev
```

Requiere un proyecto de Supabase con las migraciones de `supabase/migrations/` aplicadas en orden.

### Puesta en marcha de la demo

1. `SUPABASE_SERVICE_ROLE_KEY=... node scripts/crear-demo-vpai.mjs` — crea (o completa) las 12 cuentas demo. Se puede volver a correr: las que ya existen se saltan.
2. Correr en el SQL Editor, en orden, las migraciones `0001` a `0066`.
3. Desplegar las Edge Functions de `supabase/functions/` (`supabase functions deploy`).
4. **ClickUp (opcional, necesario para el Kanban):** crear una lista propia para la demo, pegar su ID en `0043_clickup_lista_demo.sql` y volver a correr `0043` y `0062`; cargar los secretos `CLICKUP_API_TOKEN` y `CLICKUP_WEBHOOK_SECRET_DEMO` (`scripts/clickup-demo.mjs` crea el webhook y guarda el secreto). Sin lista configurada, el resto del CRM funciona igual.
