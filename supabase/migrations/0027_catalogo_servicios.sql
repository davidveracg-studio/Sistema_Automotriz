-- =============================================================================
-- 0027_catalogo_servicios.sql
--
-- Qué resuelve:
--   El cliente compartió su planilla real de precios (330+ servicios, con
--   mano de obra tarifada por tipo de vehículo, repuestos típicos por
--   servicio, y lubricantes/insumos) y pidió que el sistema arme un flujo
--   guiado: tipo de vehículo → categoría → servicio → precio de mano de
--   obra automático + lista de repuestos sugerida (se cargan a la OT
--   editable/eliminable, con precio pendiente de presupuesto).
--
--   El "tipo de vehículo" de la planilla tiene 13 variantes (tamaño +
--   combustible mezclados). El cliente decidió simplificarlo a las 4
--   categorías de carrocería que ya existen (`vehiculos.tipo_carroceria`,
--   agrupando sedán/hatchback como "auto") cruzadas con combustible
--   bencina/diésel -que también ya existe como `vehiculos.tipo_combustible`
--   desde el Bloque 2, nunca se había usado en ninguna pantalla-.
--
--   Diseño multi-tenant: las 4 tablas nuevas llevan `empresa_id` como
--   cualquier otro catálogo de este proyecto (ver `tipos_isla` del Bloque 8)
--   -el precio de Didial no debe quedar hardcodeado en el código, es dato
--   de la empresa, para que un tenant futuro cargue el suyo propio-.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Catálogo de repuestos (nombres genéricos, sin precio -el precio real de
-- un repuesto se cotiza caso a caso, por eso en la OT queda "pendiente de
-- presupuesto"-).
-- ---------------------------------------------------------------------------
create table if not exists public.catalogo_repuestos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint uq_catalogo_repuestos_nombre unique (empresa_id, nombre)
);

comment on table public.catalogo_repuestos is 'Catálogo de referencia de repuestos (nombres genéricos, sin precio ni stock -no confundir con productos de Bodega, que sí llevan costo/stock real-).';

-- ---------------------------------------------------------------------------
-- Servicios del catálogo: segmento (isla)/categoría/código/nombre.
-- ---------------------------------------------------------------------------
create table if not exists public.catalogo_servicios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  segmento text not null,
  categoria text not null,
  codigo text,
  servicio text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint uq_catalogo_servicios_nombre unique (empresa_id, categoria, servicio)
);

comment on table public.catalogo_servicios is 'Un servicio ofrecido (ej. "Cambio de pastillas delanteras"), agrupado por categoría (ej. "Frenos") dentro de un segmento/isla (ej. "Taller Mecánico"). El código de la planilla original se guarda como referencia, no como identificador único -la misma planilla reutiliza códigos entre servicios distintos-.';

create index if not exists catalogo_servicios_categoria_idx on public.catalogo_servicios (empresa_id, categoria);

-- ---------------------------------------------------------------------------
-- Precio de mano de obra por servicio, según tipo de vehículo/combustible.
-- tipo_vehiculo/combustible NULL = aplica sin distinción (mismo precio para
-- cualquier tipo/combustible que no tenga una fila más específica).
-- ---------------------------------------------------------------------------
create table if not exists public.catalogo_servicio_precios (
  id uuid primary key default gen_random_uuid(),
  servicio_id uuid not null references public.catalogo_servicios (id) on delete cascade,
  tipo_vehiculo text check (tipo_vehiculo is null or tipo_vehiculo in ('auto', 'pickup', 'suv', 'furgon')),
  combustible text check (combustible is null or combustible in ('bencina', 'diesel')),
  horas_mo numeric,
  valor_mo integer not null default 0,
  repuestos_min integer,
  repuestos_max integer,
  insumos_clp integer,
  notas text,
  constraint uq_catalogo_servicio_precios unique (servicio_id, tipo_vehiculo, combustible)
);

comment on table public.catalogo_servicio_precios is 'Precio de mano de obra de un servicio, cruzado por tipo de vehículo/combustible -match más específico primero: tipo+combustible exacto, luego tipo con combustible NULL (aplica a ambos), luego la fila NULL/NULL (aplica a todos, ej. "TODOS" de la planilla)-. `repuestos_min/max` e `insumos_clp` son valores informativos de la planilla original, no precios finales.';

create index if not exists catalogo_servicio_precios_servicio_idx on public.catalogo_servicio_precios (servicio_id);

-- ---------------------------------------------------------------------------
-- Qué repuestos suele necesitar cada servicio (sugerencia, no obligación:
-- el cliente pidió que se carguen automáticamente a la OT pero se puedan
-- editar/agregar/eliminar).
-- ---------------------------------------------------------------------------
create table if not exists public.catalogo_servicio_repuestos (
  servicio_id uuid not null references public.catalogo_servicios (id) on delete cascade,
  repuesto_id uuid not null references public.catalogo_repuestos (id) on delete cascade,
  primary key (servicio_id, repuesto_id)
);

comment on table public.catalogo_servicio_repuestos is 'Repuestos típicos de un servicio (muchos a muchos). Al elegir el servicio en la OT, estos repuestos se agregan solos como ítems pendientes de presupuesto.';

-- ---------------------------------------------------------------------------
-- RLS: lectura abierta a cualquiera activo de la empresa (es un catálogo de
-- consulta, como tipos_isla); escritura -mantenimiento del catálogo- solo
-- admin/socia.
-- ---------------------------------------------------------------------------
alter table public.catalogo_repuestos enable row level security;
alter table public.catalogo_servicios enable row level security;
alter table public.catalogo_servicio_precios enable row level security;
alter table public.catalogo_servicio_repuestos enable row level security;

drop policy if exists catalogo_repuestos_select on public.catalogo_repuestos;
create policy catalogo_repuestos_select on public.catalogo_repuestos
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists catalogo_repuestos_write on public.catalogo_repuestos;
create policy catalogo_repuestos_write on public.catalogo_repuestos
  for all
  using (empresa_id = public.mi_empresa_id() and (public.es_admin() or public.es_socia()))
  with check (empresa_id = public.mi_empresa_id() and (public.es_admin() or public.es_socia()));

drop policy if exists catalogo_servicios_select on public.catalogo_servicios;
create policy catalogo_servicios_select on public.catalogo_servicios
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists catalogo_servicios_write on public.catalogo_servicios;
create policy catalogo_servicios_write on public.catalogo_servicios
  for all
  using (empresa_id = public.mi_empresa_id() and (public.es_admin() or public.es_socia()))
  with check (empresa_id = public.mi_empresa_id() and (public.es_admin() or public.es_socia()));

drop policy if exists catalogo_servicio_precios_select on public.catalogo_servicio_precios;
create policy catalogo_servicio_precios_select on public.catalogo_servicio_precios
  for select using (exists (
    select 1 from public.catalogo_servicios s
    where s.id = catalogo_servicio_precios.servicio_id and s.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists catalogo_servicio_precios_write on public.catalogo_servicio_precios;
create policy catalogo_servicio_precios_write on public.catalogo_servicio_precios
  for all
  using (exists (
    select 1 from public.catalogo_servicios s
    where s.id = catalogo_servicio_precios.servicio_id and s.empresa_id = public.mi_empresa_id()
      and (public.es_admin() or public.es_socia())
  ))
  with check (exists (
    select 1 from public.catalogo_servicios s
    where s.id = catalogo_servicio_precios.servicio_id and s.empresa_id = public.mi_empresa_id()
      and (public.es_admin() or public.es_socia())
  ));

drop policy if exists catalogo_servicio_repuestos_select on public.catalogo_servicio_repuestos;
create policy catalogo_servicio_repuestos_select on public.catalogo_servicio_repuestos
  for select using (exists (
    select 1 from public.catalogo_servicios s
    where s.id = catalogo_servicio_repuestos.servicio_id and s.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists catalogo_servicio_repuestos_write on public.catalogo_servicio_repuestos;
create policy catalogo_servicio_repuestos_write on public.catalogo_servicio_repuestos
  for all
  using (exists (
    select 1 from public.catalogo_servicios s
    where s.id = catalogo_servicio_repuestos.servicio_id and s.empresa_id = public.mi_empresa_id()
      and (public.es_admin() or public.es_socia())
  ))
  with check (exists (
    select 1 from public.catalogo_servicios s
    where s.id = catalogo_servicio_repuestos.servicio_id and s.empresa_id = public.mi_empresa_id()
      and (public.es_admin() or public.es_socia())
  ));

-- ---------------------------------------------------------------------------
-- El precio de mano de obra del catálogo es un precio ya aprobado por la
-- empresa (no una edición manual de costo/margen), así que agregar un
-- servicio del catálogo debe poder fijar `ot_detalle.precio_unitario` aunque
-- quien lo agregue (técnico, asesor) no tenga tiene_acceso_montos(). Se
-- resuelve con una bandera de sesión que solo esta función enciende, en vez
-- de debilitar la protección general de precios del Bloque 5.
-- ---------------------------------------------------------------------------
create or replace function public.impedir_precio_sin_acceso_montos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.bypass_precio_protegido', true) = 'true' then
    return new;
  end if;

  if public.tiene_acceso_montos() then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    if new.costo_unitario is not null or new.precio_unitario is not null then
      raise exception 'No tienes permiso para cargar costos o precios.';
    end if;
  elsif TG_OP = 'UPDATE' then
    if new.costo_unitario is distinct from old.costo_unitario or new.precio_unitario is distinct from old.precio_unitario then
      raise exception 'No tienes permiso para modificar costos o precios.';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- agregar_servicio_catalogo: crea la tarea de mano de obra (con su precio
-- de catálogo ya cargado, según el tipo de vehículo/combustible real de la
-- OT), agrega los repuestos típicos como ítems pendientes de presupuesto, y
-- si el servicio trae un insumo estimado (`insumos_clp`) lo agrega también.
-- ---------------------------------------------------------------------------
create or replace function public.agregar_servicio_catalogo(
  p_trabajo_id uuid,
  p_servicio_id uuid,
  p_tecnico_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa_id uuid;
  v_tipo_carroceria text;
  v_tipo_combustible text;
  v_tipo_precio text;
  v_combustible_precio text;
  v_valor_mo integer;
  v_insumos_clp integer;
  v_servicio_nombre text;
  v_tarea_id uuid;
  v_insumo_id uuid;
  v_orden integer;
begin
  select t.empresa_id, v.tipo_carroceria, v.tipo_combustible
  into v_empresa_id, v_tipo_carroceria, v_tipo_combustible
  from public.trabajos_taller t
  join public.vehiculos v on v.id = t.vehiculo_id
  where t.id = p_trabajo_id;

  if v_empresa_id is null or v_empresa_id <> public.mi_empresa_id() then
    raise exception 'OT no encontrada.';
  end if;

  select servicio into v_servicio_nombre
  from public.catalogo_servicios
  where id = p_servicio_id and empresa_id = v_empresa_id;

  if v_servicio_nombre is null then
    raise exception 'Servicio de catálogo no encontrado.';
  end if;

  v_tipo_precio := case v_tipo_carroceria
    when 'sedan' then 'auto'
    when 'hatchback' then 'auto'
    when 'suv' then 'suv'
    when 'furgon' then 'furgon'
    when 'pickup' then 'pickup'
    else null
  end;

  -- combustible no reconocido por la planilla (eléctrico/híbrido/gas/sin
  -- dato): se trata como bencina para el calce de precio -aproximación
  -- consciente, la planilla no distingue esos casos-.
  v_combustible_precio := case when v_tipo_combustible = 'diesel' then 'diesel' else 'bencina' end;

  -- Si el servicio no tiene un precio que aplique a este tipo de
  -- vehículo/combustible (la planilla original lo marca "No aplica"),
  -- v_valor_mo/v_insumos_clp quedan NULL: se crea igual la tarea, sin
  -- precio -queda pendiente de presupuesto como cualquier ítem manual-.
  select valor_mo, insumos_clp into v_valor_mo, v_insumos_clp
  from public.catalogo_servicio_precios
  where servicio_id = p_servicio_id
    and (tipo_vehiculo = v_tipo_precio or tipo_vehiculo is null)
    and (combustible = v_combustible_precio or combustible is null)
  order by (tipo_vehiculo is not null) desc, (combustible is not null) desc
  limit 1;

  select coalesce(max(orden) + 1, 0) into v_orden from public.tareas_taller where trabajo_id = p_trabajo_id;

  insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id, orden)
  values (p_trabajo_id, v_servicio_nombre, p_tecnico_id, v_orden)
  returning id into v_tarea_id;

  if v_valor_mo is not null and v_valor_mo > 0 then
    perform set_config('app.bypass_precio_protegido', 'true', true);
    update public.ot_detalle
    set precio_unitario = v_valor_mo
    where tarea_taller_id = v_tarea_id;
    perform set_config('app.bypass_precio_protegido', 'false', true);
  end if;

  insert into public.ot_detalle (trabajo_id, area, detalle, cantidad)
  select p_trabajo_id, 'repuestos', r.nombre, 1
  from public.catalogo_servicio_repuestos sr
  join public.catalogo_repuestos r on r.id = sr.repuesto_id
  where sr.servicio_id = p_servicio_id;

  if v_insumos_clp is not null and v_insumos_clp > 0 then
    insert into public.ot_detalle (trabajo_id, area, detalle, cantidad)
    values (p_trabajo_id, 'lubricantes_insumos', 'Insumos — ' || v_servicio_nombre, 1)
    returning id into v_insumo_id;

    perform set_config('app.bypass_precio_protegido', 'true', true);
    update public.ot_detalle set precio_unitario = v_insumos_clp where id = v_insumo_id;
    perform set_config('app.bypass_precio_protegido', 'false', true);
  end if;

  return v_tarea_id;
end;
$$;

revoke all on function public.agregar_servicio_catalogo(uuid, uuid, uuid) from public;
grant execute on function public.agregar_servicio_catalogo(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_name in (
    'catalogo_repuestos', 'catalogo_servicios', 'catalogo_servicio_precios', 'catalogo_servicio_repuestos'
  )) as tablas_esperado_4,
  (select count(*) from pg_proc where proname = 'agregar_servicio_catalogo') as funcion_esperado_1,
  (select relrowsecurity from pg_class where relname = 'catalogo_servicios') as rls_esperado_true;
