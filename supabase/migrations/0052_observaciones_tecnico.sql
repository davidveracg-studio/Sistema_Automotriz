-- =============================================================================
-- 0052_observaciones_tecnico.sql
--
-- Qué resuelve:
--   La observación que el técnico escribe en la DESCRIPCIÓN de una subtarea de
--   ClickUp (spec: puede detectar una venta cruzada -ej. "neumáticos gastados",
--   "batería con signos de fallo"- que el asesor debe ofrecer al cliente) pasa
--   a verse en la OT del CRM.
--   - tareas_taller.observaciones_tecnico: el texto tal como está hoy en
--     ClickUp (se sobreescribe completo en cada evento, no es un historial).
--   - Notificación 'observacion_tecnico' al asesor de la OT cuando aparece una
--     observación nueva o cambia (no se repite si el texto no cambió).
--   No lee campos personalizados de la subtarea -ClickUp no permite campos
--   personalizados en subtareas de listas "no compartidas"- ni comentarios:
--   la Descripción es el único lugar disponible para una nota libre por
--   subtarea, y no requiere configurar nada nuevo en ClickUp.
-- =============================================================================

alter table public.tareas_taller add column if not exists observaciones_tecnico text;

comment on column public.tareas_taller.observaciones_tecnico is 'Descripción de la subtarea en ClickUp, tal como está hoy: notas del técnico que pueden indicar una venta cruzada para el asesor.';

alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'presupuesto_pendiente', 'encuesta_negativa', 'cita_nueva',
  'listo_para_entrega', 'compra_reptos_pendiente', 'whatsapp_desconectado',
  'repuesto_pendiente_presupuesto', 'descuento_pendiente', 'descuento_resuelto',
  'observacion_tecnico'
));

-- ---------------------------------------------------------------------------
-- Demo: una observación de ejemplo, en una tarea de mano de obra vigente.
-- ---------------------------------------------------------------------------
do $$
declare
  emp constant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_tarea uuid;
begin
  if not exists (select 1 from public.empresas where id = emp) then
    return;
  end if;

  select ta.id into v_tarea
  from public.tareas_taller ta
  join public.trabajos_taller o on o.id = ta.trabajo_id
  join public.vehiculos v on v.id = o.vehiculo_id
  where o.empresa_id = emp and v.patente = 'VPAI04' and o.estado not in ('entregado', 'anulado')
  order by ta.orden limit 1;

  if v_tarea is not null then
    update public.tareas_taller
    set observaciones_tecnico = 'Neumáticos delanteros con desgaste irregular (borde interior), probable desalineación. Batería marca fecha 2023, sin signos de falla por ahora. Vale la pena ofrecer alineación y revisión de batería en la próxima visita.'
    where id = v_tarea;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'tareas_taller' and column_name = 'observaciones_tecnico') as columna_esperado_1,
  (select conname from pg_constraint where conname = 'notificaciones_tipo_check') as constraint_actualizado,
  (select count(*) from public.tareas_taller where observaciones_tecnico is not null and trabajo_id in (select id from public.trabajos_taller where empresa_id = 'b0000000-0000-4000-8000-000000000001')) as demo_observaciones_esperado_1;
