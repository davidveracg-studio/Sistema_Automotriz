-- =============================================================================
-- 0059_detalle_ot_clickup.sql
--
-- Qué resuelve:
--   Vista de detalle al abrir una tarjeta del Kanban del taller, parecida a
--   como se ve la tarjeta en ClickUp: encabezado (patente/modelo/km/OT/
--   cliente/teléfono), estado, personas asignadas, fechas, la descripción
--   larga de la tarjeta, subtareas con su observación y las listas de
--   control (repuestos/lubricantes e insumos/servicios externos).
--
--   Casi todo ese detalle YA vive en la base (vehiculos, clientes,
--   trabajos_taller, tareas_taller, ot_detalle) -no hace falta traer nada
--   nuevo de ClickUp para armarlo-. Las dos excepciones son:
--   - clickup_descripcion: el texto libre de la tarjeta en ClickUp (lo que
--     el técnico/asesor escribe ahí -diagnóstico, presupuestos enviados,
--     etc.-). No es lo mismo que el campo personalizado "Observaciones"
--     (ese ya se llena desde inspecciones_ingreso.observaciones al
--     sincronizar, ver clickup-sincronizar): es la descripción nativa de
--     ClickUp, que nadie escribe desde el CRM.
--   - clickup_fecha_inicio: fecha de inicio de la tarjeta en ClickUp (la de
--     vencimiento ya se guarda desde 0058).
--   Ambas se traen bajo demanda, al abrir el detalle de una OT (acción
--   "detalle" de clickup-kanban) -no en cada refresco del kanban-, y se
--   guardan de paso para no perderlas.
-- =============================================================================

alter table public.trabajos_taller
  add column if not exists clickup_descripcion text,
  add column if not exists clickup_fecha_inicio timestamptz;

comment on column public.trabajos_taller.clickup_descripcion is 'Descripción/texto libre de la tarjeta en ClickUp (no es el campo personalizado "Observaciones"). Se trae al abrir el detalle de la OT en el Kanban, no en cada refresco de la lista.';
comment on column public.trabajos_taller.clickup_fecha_inicio is 'Fecha de inicio de la tarjeta en ClickUp. Misma fuente que clickup_fecha_programada (0058), que es la de vencimiento.';

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'trabajos_taller'
     and column_name in ('clickup_descripcion', 'clickup_fecha_inicio')) as columnas_esperado_2;
