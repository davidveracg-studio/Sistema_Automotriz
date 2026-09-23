-- =============================================================================
-- 0035_fix_rls_horario_atencion.sql
--
-- Qué resuelve:
--   Bug propio encontrado probando el calendario en el navegador (2026-09-22):
--   `horario_atencion` (0034_agenda_calendario_y_bot.sql) quedó sin
--   `enable row level security` ni policy de lectura -al probar la Agenda
--   con una sesión real, `select * from horario_atencion` devolvía un
--   array vacío en vez de las 6 filas reales (confirmado que sí existían,
--   vía SQL Editor), así que el calendario mostraba "El taller no atiende
--   este día" todos los días-. Mismo patrón de RLS que cualquier otra
--   tabla del proyecto, que en este caso se saltó por error.
-- =============================================================================

alter table public.horario_atencion enable row level security;

drop policy if exists horario_atencion_select on public.horario_atencion;
create policy horario_atencion_select on public.horario_atencion
  for select using (empresa_id = public.mi_empresa_id());

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select relrowsecurity from pg_class where relname = 'horario_atencion') as rls_esperado_true,
  (select count(*) from pg_policies where tablename = 'horario_atencion') as policies_esperado_1;
