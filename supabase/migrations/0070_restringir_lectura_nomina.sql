-- =============================================================================
-- 0070_restringir_lectura_nomina.sql
--
-- Qué resuelve (hallazgo H-02 de la auditoría 2026-11-03):
--   La nómina de turnos y asistencia (0055) la podía leer CUALQUIER rol de la
--   empresa: la política `select` de personal_turnos, turnos_marcas y
--   turnos_justificativos solo exigía `empresa_id = mi_empresa_id()`. Un
--   técnico o recepcionista veía RUT, marcas del reloj y justificativos
--   (incluye licencias médicas, dato de salud) de todos sus compañeros.
--
--   Había una segunda puerta: la función `turnos_resumen_diario` es
--   security definer (se salta RLS) y solo comprobaba la empresa, no el rol;
--   por defecto cualquier usuario autenticado puede ejecutarla. Cerrar solo
--   las tablas habría dejado esa puerta abierta.
--
-- Qué hace:
--   1. Las tres tablas con datos de personas pasan a lectura solo para
--      admin / socia / jefe_taller (los mismos roles que ya podían escribir
--      y que ven la pantalla /turnos en la navegación).
--      turnos_feriados NO se toca: es una lista de fechas sin datos
--      personales.
--   2. `turnos_resumen_diario` conserva su nombre y firma (el frontend la
--      llama así) pero ahora es una envoltura que exige el rol y delega en
--      `turnos_resumen_diario_interno`, que es la función original
--      renombrada y sin permiso de ejecución para nadie más.
--
-- Efecto en la app: ninguno para los roles que usan Turnos.jsx (admin, socia,
-- jefe_taller). Para los demás roles las consultas devuelven 0 filas y la
-- función da error 42501; hoy ninguna otra pantalla las usa (se buscó en
-- src/ y en las migraciones 0001-0069).
--
-- Idempotente: se puede correr más de una vez.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Lectura de las tablas con datos de personas, solo para RR. HH.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['personal_turnos', 'turnos_marcas', 'turnos_justificativos'] loop
    execute format('drop policy if exists %I on public.%I', v_tabla || '_select', v_tabla);
    execute format(
      'create policy %I on public.%I for select using (empresa_id = public.mi_empresa_id() and public.auth_rol() in (''admin'', ''socia'', ''jefe_taller''))',
      v_tabla || '_select', v_tabla
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. turnos_resumen_diario: exigir el rol antes de ejecutar.
--    La función original pasa a llamarse *_interno (solo si aún no se hizo).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.turnos_resumen_diario_interno(uuid, date, date)') is null then
    alter function public.turnos_resumen_diario(uuid, date, date) rename to turnos_resumen_diario_interno;
  end if;
end $$;

create or replace function public.turnos_resumen_diario(p_empresa_id uuid, p_desde date, p_hasta date)
returns table (
  personal_id uuid,
  nombre_completo text,
  grupo text,
  fecha date,
  turno_esperado boolean,
  es_feriado boolean,
  primera_marca time,
  ultima_marca time,
  horas_trabajadas numeric,
  cantidad_marcas integer,
  clasificacion text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.auth_rol() is null or public.auth_rol() not in ('admin', 'socia', 'jefe_taller') then
    raise exception 'Tu rol no tiene acceso a turnos y asistencia.' using errcode = '42501';
  end if;

  return query select * from public.turnos_resumen_diario_interno(p_empresa_id, p_desde, p_hasta);
end;
$$;

comment on function public.turnos_resumen_diario(uuid, date, date) is 'Resumen diario de turnos y asistencia. Exige rol admin/socia/jefe_taller y delega en turnos_resumen_diario_interno (que además valida la empresa).';
comment on function public.turnos_resumen_diario_interno(uuid, date, date) is 'Lógica original de turnos_resumen_diario (0055). No llamar directo: solo la ejecuta la envoltura turnos_resumen_diario, que valida el rol.';

revoke all on function public.turnos_resumen_diario_interno(uuid, date, date) from public, anon, authenticated;
revoke all on function public.turnos_resumen_diario(uuid, date, date) from public, anon;
grant execute on function public.turnos_resumen_diario(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación (todo debe dar lo esperado):
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('personal_turnos', 'turnos_marcas', 'turnos_justificativos')
      and cmd = 'SELECT' and qual like '%auth_rol%') as politicas_select_con_rol_esperado_3,
  has_function_privilege('anon', 'public.turnos_resumen_diario(uuid, date, date)', 'execute') as anon_ejecuta_resumen_esperado_false,
  has_function_privilege('authenticated', 'public.turnos_resumen_diario(uuid, date, date)', 'execute') as authenticated_ejecuta_resumen_esperado_true,
  has_function_privilege('authenticated', 'public.turnos_resumen_diario_interno(uuid, date, date)', 'execute') as authenticated_ejecuta_interno_esperado_false;

-- ---------------------------------------------------------------------------
-- Prueba manual (opcional, en el SQL Editor; todo se deshace con ROLLBACK).
-- Reemplaza los uuid por un usuario TÉCNICO y uno ADMIN de la misma empresa.
--
--   begin;
--   set local role authenticated;
--
--   -- Como técnico: 0 filas y error 42501 en la función.
--   set local request.jwt.claims = '{"sub":"<UUID_TECNICO>","role":"authenticated"}';
--   select count(*) from public.personal_turnos;            -- esperado: 0
--   select count(*) from public.turnos_marcas;              -- esperado: 0
--   select * from public.turnos_resumen_diario('<UUID_EMPRESA>', current_date - 7, current_date);  -- esperado: ERROR 42501
--
--   -- Como admin: ve todo.
--   set local request.jwt.claims = '{"sub":"<UUID_ADMIN>","role":"authenticated"}';
--   select count(*) from public.personal_turnos;            -- esperado: > 0
--   select count(*) from public.turnos_resumen_diario('<UUID_EMPRESA>', current_date - 7, current_date);  -- esperado: > 0
--   rollback;
-- ---------------------------------------------------------------------------
