-- =============================================================================
-- 0021_kilometraje_egreso.sql
--
-- Qué resuelve:
--   El kilometraje que se pide en el ingreso puede no ser el mismo al
--   momento de retirar el vehículo (pruebas en ruta, servicios externos,
--   etc.). El cliente pidió que se vuelva a pedir el kilometraje al cerrar,
--   igual que el papel real de "Egreso del Vehículo" lo muestra en su
--   bloque de datos del vehículo.
-- =============================================================================

alter table public.egresos_vehiculo
  add column if not exists kilometraje_egreso integer check (kilometraje_egreso is null or kilometraje_egreso >= 0);

comment on column public.egresos_vehiculo.kilometraje_egreso is 'Kilometraje registrado al momento del retiro -puede diferir del kilometraje de ingreso (pruebas en ruta, traslados a servicios externos)-. Actualiza vehiculos.kilometraje si es mayor al ya registrado.';

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'egresos_vehiculo' and column_name = 'kilometraje_egreso') as columna_esperado_1;
