-- =============================================================================
-- 0005_permisos_postgrest.sql
--
-- Qué resuelve:
--   Un problema real que apareció al probar el Bloque 4 contra la base de
--   datos de verdad: PostgREST devolvía "Could not find the table 'public.X'
--   in the schema cache" (código PGRST205) para tablas que sí existían.
--   La causa no era la caché (un NOTIFY pgrst, 'reload schema' no lo
--   arregló) sino permisos: las tablas creadas por SQL suelto en el SQL
--   Editor no traen automáticamente los GRANT que Supabase sí agrega cuando
--   el propio dashboard crea una tabla. PostgREST oculta como "no
--   encontrada" cualquier tabla que el rol que hace la consulta no pueda
--   ver, en vez de devolver un error de permisos -por diseño, para no
--   filtrar qué existe-.
--
--   Esta migración dos veces: registra el GRANT que ya se corrió a mano
--   contra el proyecto real el 2026-09-14, y lo deja versionado para que
--   una base nueva (otro tenant, un entorno de pruebas) no tropiece con lo
--   mismo. RLS sigue siendo quien de verdad decide qué fila ve cada quien;
--   esto solo habilita que los roles de la app puedan ver la tabla.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated;

-- Para que las tablas de los próximos bloques nazcan ya con esto, sin
-- repetir esta migración cada vez.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación: authenticated debe tener SELECT sobre las tablas de negocio
-- ya creadas (si esto da 0, el problema original va a repetirse).
-- ---------------------------------------------------------------------------
select count(*) as tablas_con_select_authenticated_esperado_mayor_a_0
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_schema = 'public'
  and privilege_type = 'SELECT'
  and table_name in ('empresas', 'usuarios', 'clientes', 'vehiculos', 'trabajos_taller', 'tareas_taller', 'ot_detalle');
