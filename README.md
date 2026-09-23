# VPAI CRM — Demo

CRM multi-tenant para talleres automotrices: recepción de vehículos, diagnóstico con checklist guiado (RADAR), presupuestos, agenda con calendario real, bandeja de WhatsApp, bodega, informes y un panel de notificaciones por rol.

Este repositorio es una **versión de demostración**, adaptada de un proyecto en producción real para un taller multimarca. Los datos de clientes, vehículos, órdenes de trabajo y conversaciones de WhatsApp que vienen cargados son **ficticios** — nombres, patentes y números de teléfono no corresponden a personas ni negocios reales.

## Probarlo

En el login, elige un rol del menú desplegable y entra sin contraseña — cada rol tiene una cuenta de prueba propia, con exactamente los permisos que tendría en un taller real (RLS por fila, no solo ocultar botones en la interfaz).

| Rol | Qué puede ver/hacer |
| --- | --- |
| Admin / Socia | Acceso total, incluyendo informes y todas las notificaciones |
| Asesor | Recepción, presupuestos, mensajes de WhatsApp |
| Jefe de taller | Taller por islas, bodega, presupuestos |
| Encargado de presupuestos | Presupuestos, notificaciones de repuestos pendientes |
| Técnico | Órdenes de trabajo y sesiones RADAR |
| Detailer | Órdenes de trabajo (detailing) |
| Recepcionista | Agenda, mensajes de WhatsApp |

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
- **Bodega** con control de stock por movimiento (compra/uso en OT/ajuste/devolución), nunca editado a mano directamente.

## Correr localmente

```bash
npm install
cp .env.example .env   # completar con tu propio proyecto de Supabase
npm run dev
```

Requiere un proyecto de Supabase con las migraciones de `supabase/migrations/` aplicadas en orden.
