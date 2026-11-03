-- =============================================================================
-- 0072_revocar_select_anon.sql
--
-- Qué resuelve (hallazgo H-07 de la auditoría de protección de datos
-- 2026-11-03):
--   0005_permisos_postgrest.sql dio `select` al rol `anon` sobre TODAS las
--   tablas de public, presentes y futuras. Hoy lo contiene RLS, pero la clave
--   `anon` es pública (va en el bundle del frontend) y una tabla nueva sin RLS
--   -creada a mano en el panel o por olvido- quedaría legible por cualquiera.
--   Es defensa en profundidad: RLS sigue siendo quien decide, pero ya no es la
--   única barrera.
--
-- Qué hace:
--   1. Quita `select` a `anon` en todas las tablas y en los privilegios por
--      defecto de las tablas nuevas.
--   2. Crea `public.keepalive()`: una función mínima que el workflow
--      supabase-keepalive.yml llama con la clave anónima. Antes consultaba la
--      tabla `empresas`; sin este cambio ese workflow dejaría de dar 200 y el
--      proyecto se pausaría por inactividad.
--
-- Lo que NO cambia (verificado en el código):
--   - Las pantallas públicas usan solo auth (login) y las funciones RPC de
--     encuesta (`encuesta_*`) y `registrar_acceso_fallido`, que son security
--     definer y tienen su propio `grant execute` a anon.
--   - Las Edge Functions usan la clave anónima solo para validar la sesión de
--     la persona (rol `authenticated`); el resto usa service_role.
--   - `authenticated` y `service_role` conservan todos sus permisos.
--
-- Cómo deshacerlo, si algo inesperado dependiera de `anon`:
--   grant select on all tables in schema public to anon;
--   alter default privileges in schema public grant select on tables to anon;
--
-- Idempotente.
-- =============================================================================

create or replace function public.keepalive()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select true;
$$;

comment on function public.keepalive() is 'Consulta mínima para el workflow supabase-keepalive.yml: cuenta como actividad de base de datos sin exponer ninguna tabla.';

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

revoke select on all tables in schema public from anon;
alter default privileges in schema public revoke select on tables from anon;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación (todo debe dar lo esperado):
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public' and privilege_type = 'SELECT') as tablas_con_select_anon_esperado_0,
  has_function_privilege('anon', 'public.keepalive()', 'execute') as anon_ejecuta_keepalive_esperado_true,
  has_function_privilege('anon', 'public.encuesta_obtener_por_token(text)', 'execute') as anon_ejecuta_encuesta_esperado_true,
  has_table_privilege('authenticated', 'public.clientes', 'select') as authenticated_lee_clientes_esperado_true;
