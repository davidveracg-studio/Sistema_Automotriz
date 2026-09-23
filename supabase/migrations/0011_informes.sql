-- =============================================================================
-- 0011_informes.sql
--
-- Qué resuelve:
--   Bloque 9: "Los indicadores que importan" (sección 9 del spec). Tres
--   números definen el estado del negocio, y el spec pide explícitamente
--   desconfiar de indicadores perfectos ("un 100% de aprobación casi
--   siempre significa que la medición está mal hecha"):
--     1. 65,9% de vehículos vienen una sola vez -> retorno de clientes.
--     2. RUT al 8,7% / kilometraje al 35% -> captura de datos.
--     3. Presupuestos "100% aprobados" (falso: los rechazos no se
--        registraban antes del Bloque 5) -> desglose real por decisión.
--
--   Se agrega también seguimiento de retrabajos: la sección 4 del spec pide
--   "los retrabajos se vinculan a la OT original y al mecánico que ejecutó.
--   Es la base de la medición de calidad", pero ningún bloque anterior lo
--   implementó -no tenía un bloque numerado propio-. Como es exactamente lo
--   que un informe de calidad necesita, se construye acá: un vínculo
--   opcional trabajo_original_id en trabajos_taller (se completa a mano en
--   Nuevo Ingreso cuando el asesor detecta que el vehículo vuelve por el
--   mismo problema), y el mecánico se deriva de tareas_taller.tecnico_id /
--   clickup_asignado_nombre del trabajo ORIGINAL -no hay un campo separado
--   "mecánico responsable" a nivel de OT, la mano de obra ya lo registra
--   tarea por tarea-.
--
--   Todas las funciones de informe son de solo lectura, acotadas a
--   mi_empresa_id() y a admin/socia -"Visión para socia y administración",
--   tal como dice la tabla de bloques-. RLS no alcanza para esto porque no
--   son consultas sobre una tabla con policy propia, son agregaciones; el
--   chequeo de rol va adentro de cada función.
-- =============================================================================

alter table public.trabajos_taller
  add column if not exists trabajo_original_id uuid references public.trabajos_taller (id) on delete restrict;

comment on column public.trabajos_taller.trabajo_original_id is 'Si esta OT es un retrabajo (el vehículo vuelve por el mismo problema), apunta a la OT original. Se completa a mano en Nuevo Ingreso; el mecánico responsable se deriva de tareas_taller del trabajo original, no se duplica acá.';

create index if not exists trabajos_taller_original_idx on public.trabajos_taller (trabajo_original_id) where trabajo_original_id is not null;

-- ---------------------------------------------------------------------------
-- 1. Retorno de clientes.
-- ---------------------------------------------------------------------------
create or replace function public.informe_retorno_clientes()
returns table (total_clientes bigint, con_una_sola_ot bigint, con_mas_de_una_ot bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) as total_clientes,
    count(*) filter (where ot_count = 1) as con_una_sola_ot,
    count(*) filter (where ot_count > 1) as con_mas_de_una_ot
  from (
    select c.id, count(t.id) as ot_count
    from public.clientes c
    join public.trabajos_taller t on t.cliente_id = c.id
    where c.empresa_id = public.mi_empresa_id()
      and (public.es_admin() or public.es_socia())
    group by c.id
  ) x;
$$;

comment on function public.informe_retorno_clientes is 'Indicador 1 del spec (sección 9): qué porcentaje de clientes vuelve. Solo admin/socia.';

-- ---------------------------------------------------------------------------
-- 2. Captura de datos obligatorios (RUT, kilometraje).
-- ---------------------------------------------------------------------------
create or replace function public.informe_captura_datos()
returns table (total_clientes bigint, clientes_con_rut bigint, total_trabajos bigint, trabajos_con_kilometraje bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.clientes where empresa_id = public.mi_empresa_id() and eliminado_en is null) as total_clientes,
    (select count(*) from public.clientes where empresa_id = public.mi_empresa_id() and eliminado_en is null and rut is not null) as clientes_con_rut,
    (select count(*) from public.trabajos_taller where empresa_id = public.mi_empresa_id()) as total_trabajos,
    (select count(*) from public.trabajos_taller where empresa_id = public.mi_empresa_id() and kilometraje_ingreso is not null) as trabajos_con_kilometraje
  where (public.es_admin() or public.es_socia());
$$;

comment on function public.informe_captura_datos is 'Indicador 2 del spec (sección 9): captura de RUT y kilometraje en el ingreso. Solo admin/socia.';

-- ---------------------------------------------------------------------------
-- 3. Presupuestos por decisión real (no el falso 100% aprobado).
-- ---------------------------------------------------------------------------
create or replace function public.informe_presupuestos_decision()
returns table (decision text, cantidad bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(od.decision, 'pendiente') as decision, count(*) as cantidad
  from public.ot_detalle od
  join public.trabajos_taller t on t.id = od.trabajo_id
  where t.empresa_id = public.mi_empresa_id()
    and (public.es_admin() or public.es_socia())
  group by coalesce(od.decision, 'pendiente');
$$;

comment on function public.informe_presupuestos_decision is 'Indicador 3 del spec (sección 9): desglose real de decisiones (aceptado/rechazado/postergado/pendiente), no el 100% falso de Dimasoft. Solo admin/socia.';

-- ---------------------------------------------------------------------------
-- 4. Retrabajos por técnico (sección 4 del spec: "base de la medición de
--    calidad"). El técnico se deriva de las tareas del trabajo ORIGINAL.
-- ---------------------------------------------------------------------------
create or replace function public.informe_retrabajos_por_tecnico()
returns table (tecnico text, cantidad bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(u.nombre_completo, tt.clickup_asignado_nombre, 'Sin asignar') as tecnico,
    count(distinct r.id) as cantidad
  from public.trabajos_taller r
  join public.tareas_taller tt on tt.trabajo_id = r.trabajo_original_id
  left join public.usuarios u on u.id = tt.tecnico_id
  where r.empresa_id = public.mi_empresa_id()
    and r.trabajo_original_id is not null
    and (public.es_admin() or public.es_socia())
  group by coalesce(u.nombre_completo, tt.clickup_asignado_nombre, 'Sin asignar')
  order by cantidad desc;
$$;

comment on function public.informe_retrabajos_por_tecnico is 'Retrabajos vinculados a cada técnico que trabajó en la OT original. Solo admin/socia.';

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'trabajos_taller' and column_name = 'trabajo_original_id') as columna_retrabajo_esperado_1,
  (select count(*) from pg_proc where proname in (
    'informe_retorno_clientes', 'informe_captura_datos', 'informe_presupuestos_decision', 'informe_retrabajos_por_tecnico'
  )) as funciones_informe_esperado_4;
