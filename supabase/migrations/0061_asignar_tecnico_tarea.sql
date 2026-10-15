-- =============================================================================
-- 0061_asignar_tecnico_tarea.sql
--
-- Qué resuelve:
--   Desde la tarjeta de una OT (Kanban en pantalla completa, o la pestaña
--   Mano de obra de Trabajos) el jefe de taller/admin/socia puede asignar un
--   técnico a cada tarea, y el técnico asignado puede marcarla ejecutada y
--   dejar su observación -todo esto también empuja el cambio a ClickUp
--   (asignado, estado y campo "Observaciones" de la subtarea), función
--   clickup-tarea-.
--
--   Solo hace falta una notificación nueva: "te asignaron una tarea". Las
--   demás columnas que usa este flujo (tareas_taller.tecnico_id/estado/
--   completada/observaciones_tecnico) ya existían.
-- =============================================================================

alter table public.notificaciones
  add column if not exists tarea_taller_id uuid references public.tareas_taller (id) on delete cascade;

comment on column public.notificaciones.tarea_taller_id is 'Tarea puntual de mano de obra a la que se refiere (solo tarea_asignada). Permite resolver la notificación de ESA tarea sin tocar otras del mismo técnico en la misma OT.';

-- Lista completa tal como quedó en 0052 (última vez que se tocó este check)
-- más 'tarea_asignada': quitar cualquiera de las anteriores rompería filas
-- ya guardadas con ese tipo, como pasó al probar esta migración la primera vez.
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'presupuesto_pendiente', 'encuesta_negativa', 'cita_nueva',
  'listo_para_entrega', 'compra_reptos_pendiente', 'whatsapp_desconectado',
  'repuesto_pendiente_presupuesto', 'descuento_pendiente', 'descuento_resuelto',
  'observacion_tecnico', 'tarea_asignada'
));

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'notificaciones' and column_name = 'tarea_taller_id') as columna_esperado_1,
  (select pg_get_constraintdef(oid) like '%tarea_asignada%' from pg_constraint where conname = 'notificaciones_tipo_check') as tipo_incluye_tarea_asignada_esperado_true;
