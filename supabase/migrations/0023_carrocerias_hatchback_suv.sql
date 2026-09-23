-- =============================================================================
-- 0023_carrocerias_hatchback_suv.sql
--
-- Qué resuelve:
--   El cliente agregó dos dibujos de referencia más (hatchback, SUV) además
--   de los tres originales (sedán, furgón, pick up) para el diagrama de
--   daños del ingreso. Amplía el CHECK de `vehiculos.tipo_carroceria` -no
--   hace falta tocar `inspecciones_ingreso.diagrama_danos` (jsonb, sin
--   CHECK propio de valores)-.
--
--   No se puede usar `alter table ... alter column ... add check` sobre un
--   CHECK ya existente con el mismo enfoque simple: hay que borrar el
--   CHECK viejo (sin nombre explícito, Postgres le puso uno automático al
--   crearlo en 0022) y crear uno nuevo. Se nombra explícitamente esta vez
--   para poder reemplazarlo limpio si se agregan más tipos después.
-- =============================================================================

alter table public.vehiculos
  drop constraint if exists vehiculos_tipo_carroceria_check;

alter table public.vehiculos
  add constraint vehiculos_tipo_carroceria_check
  check (tipo_carroceria is null or tipo_carroceria in ('sedan', 'furgon', 'pickup', 'hatchback', 'suv'));

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.check_constraints where constraint_name = 'vehiculos_tipo_carroceria_check') as constraint_esperado_1;
