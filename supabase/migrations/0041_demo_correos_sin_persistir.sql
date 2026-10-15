-- =============================================================================
-- 0041_demo_correos_sin_persistir.sql
--
-- Qué resuelve:
--   0040 guardaba los correos de prueba de la demo en la tabla empresas. Se
--   cambió de enfoque: los correos se piden en CADA inicio de sesión, viven solo
--   en la pestaña del navegador y viajan con la llamada a la función de correo
--   (el del asesor, dentro del enlace de la encuesta y firmado). Así no queda
--   ningún correo en la base y no hay nada que limpiar entre pruebas.
--
--   Se elimina lo que 0040 agregó y ya no se usa: la función
--   demo_guardar_correos y las columnas demo_correo_cliente / demo_correo_asesor
--   (junto con cualquier correo de prueba que hubiera quedado en ellas).
--   empresas.es_demo se mantiene: marca el tenant de demostración.
--
--   ORDEN: desplegar antes las Edge Functions enviar-encuestas-pendientes y
--   notificar-encuesta-negativa nuevas (ya no leen esas columnas).
-- =============================================================================

drop function if exists public.demo_guardar_correos(text, text);

alter table public.empresas drop column if exists demo_correo_cliente;
alter table public.empresas drop column if exists demo_correo_asesor;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'empresas' and column_name in ('demo_correo_cliente', 'demo_correo_asesor')) as columnas_de_correo_esperado_0,
  (select count(*) from pg_proc where proname = 'demo_guardar_correos') as funcion_esperado_0,
  (select count(*) from information_schema.columns where table_name = 'empresas' and column_name = 'es_demo') as es_demo_esperado_1,
  (select count(*) from public.empresas where es_demo) as empresas_demo_esperado_1;
