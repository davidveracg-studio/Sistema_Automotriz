-- =============================================================================
-- 0016_forzar_cambio_clave.sql
--
-- Qué resuelve:
--   Alta masiva del equipo de Didial (12 personas, planilla Usuarios.xlsx):
--   cada cuenta se crea con la "Ficha" (número de legajo) como clave
--   provisoria. Se necesita forzar que la persona defina su propia clave la
--   primera vez que entra, en vez de confiar en que lo haga por su cuenta.
--
--   No hay policy de UPDATE que un usuario normal pueda usar sobre su propia
--   fila de `usuarios` (la única existente exige es_admin()) -a propósito,
--   para que nadie pueda auto-asignarse rol o activarse-. En vez de abrir esa
--   policy (lo que permitiría a cualquiera tocar su propio rol/activo/
--   empresa_id), se agrega una función SECURITY DEFINER de alcance mínimo:
--   solo apaga su propio `debe_cambiar_clave`, nada más.
-- =============================================================================

alter table public.usuarios
  add column if not exists debe_cambiar_clave boolean not null default false;

comment on column public.usuarios.debe_cambiar_clave is 'true = la cuenta se creó con una clave provisoria (ej. número de ficha); el frontend redirige a /cambiar-clave hasta que la persona defina la suya.';

create or replace function public.marcar_clave_cambiada()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.usuarios set debe_cambiar_clave = false where id = auth.uid();
end;
$$;

comment on function public.marcar_clave_cambiada is 'Apaga debe_cambiar_clave solo para el usuario autenticado (auth.uid()). No usar para nada más: alcance intencionalmente mínimo.';

grant execute on function public.marcar_clave_cambiada() to authenticated;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'usuarios' and column_name = 'debe_cambiar_clave') as columna_esperado_1,
  (select count(*) from pg_proc where proname = 'marcar_clave_cambiada') as funcion_esperado_1;
