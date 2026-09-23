-- =============================================================================
-- 0014_ingreso_desde_cita.sql
--
-- Qué resuelve:
--   Vínculo Agenda -> Nuevo Ingreso que había quedado pendiente del Bloque 8
--   (ver CHANGELOG): hasta ahora `citas.trabajo_id` existía en el esquema
--   pero ninguna pantalla lo llenaba. Se volvió necesario de verdad al
--   revisar con el cliente la sincronización con ClickUp (2026-09-15): la
--   tarjeta debe nacer en un estado distinto según si el vehículo entró por
--   una cita agendada ("agenda") o como ingreso directo sin cita
--   ("POR DESIGNAR"), y hoy no hay forma de saberlo desde trabajos_taller.
--
--   `trabajos_taller.cita_id` es la mitad que faltaba: Nuevo Ingreso la
--   completa (selecciona una cita abierta del mismo cliente) y en el mismo
--   paso marca esa cita como `completada` y le setea su `trabajo_id` -así
--   ambos lados quedan vinculados con una sola acción del asesor-.
-- =============================================================================

alter table public.trabajos_taller
  add column if not exists cita_id uuid references public.citas (id) on delete restrict;

comment on column public.trabajos_taller.cita_id is 'Cita de la que nació este ingreso, si el vehículo venía agendado. Se completa a mano en Nuevo Ingreso; de acá se deriva el estado inicial en ClickUp (agenda vs. sin cita).';

create index if not exists trabajos_taller_cita_idx on public.trabajos_taller (cita_id) where cita_id is not null;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'trabajos_taller' and column_name = 'cita_id') as columna_cita_id_esperado_1;
