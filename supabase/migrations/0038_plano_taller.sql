-- =============================================================================
-- 0038_plano_taller.sql
--
-- Qué resuelve:
--   Plano (layout) del taller: un lienzo de grilla donde se dibujan los
--   puestos de trabajo (islas con/sin elevador, con pozo, alineadora,
--   vulcanización, pulmón, desabolladura y pintura, lavado) y las oficinas,
--   y donde cada puesto muestra en vivo el vehículo/OT que tiene encima.
--   Reemplaza la pantalla "Taller por islas" (/taller).
--
--   - plano_elementos: cada figura del plano (posición/tamaño en celdas de
--     la grilla, tipo, nombre, técnico responsable y, para los puestos, el
--     tipo de isla de la Agenda al que suma capacidad).
--   - plano_ocupacion: qué OT está ahora en qué puesto. Tabla aparte (no una
--     columna de trabajos_taller) para no chocar con el bloqueo de OT
--     entregadas de 0026.
--   - La capacidad de cada tipo de isla (tipos_isla.capacidad, que usa la
--     Agenda) pasa a ser la cantidad de puestos dibujados de ese tipo. Solo
--     se sobreescribe si hay al menos un puesto: un plano vacío no deja la
--     Agenda sin capacidad.
--   - Al pasar una OT a entregado/anulado se libera sola de su puesto.
-- =============================================================================

create table if not exists public.plano_elementos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  tipo text not null check (tipo in (
    'isla_elevador', 'isla_simple', 'isla_pozo', 'alineadora', 'vulcanizacion',
    'pulmon', 'desabolladura_pintura', 'lavado', 'oficina'
  )),
  nombre text not null,
  x integer not null default 0 check (x >= 0 and x <= 500),
  y integer not null default 0 check (y >= 0 and y <= 500),
  ancho integer not null default 3 check (ancho between 1 and 100),
  alto integer not null default 5 check (alto between 1 and 100),
  capacidad_vehiculos integer not null default 1 check (capacidad_vehiculos between 1 and 20),
  tipo_isla_id uuid references public.tipos_isla (id) on delete set null,
  tecnico_id uuid references public.usuarios (id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.plano_elementos is 'Figuras del plano del taller. x/y/ancho/alto en celdas de grilla. Girar 90 grados = intercambiar ancho y alto; el dibujo deduce la orientación del largo mayor.';
comment on column public.plano_elementos.tipo_isla_id is 'Tipo de isla de la Agenda al que suma capacidad este puesto (null en oficinas, pulmón, vulcanización).';
comment on column public.plano_elementos.capacidad_vehiculos is 'Cuántos vehículos caben a la vez en este espacio (1 en un puesto, más en un pulmón).';

create index if not exists plano_elementos_empresa_idx on public.plano_elementos (empresa_id);
create index if not exists plano_elementos_tipo_isla_idx on public.plano_elementos (tipo_isla_id) where tipo_isla_id is not null;

drop trigger if exists trg_plano_elementos_actualizado_en on public.plano_elementos;
create trigger trg_plano_elementos_actualizado_en
  before update on public.plano_elementos
  for each row execute function public.actualizar_marca_de_tiempo();

create table if not exists public.plano_ocupacion (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  elemento_id uuid not null references public.plano_elementos (id) on delete cascade,
  trabajo_id uuid not null references public.trabajos_taller (id) on delete cascade,
  asignado_por uuid references public.usuarios (id) on delete set null,
  desde timestamptz not null default now(),
  constraint uq_plano_ocupacion_trabajo unique (trabajo_id)
);

comment on table public.plano_ocupacion is 'Qué OT está ahora en qué puesto del plano. Una OT ocupa como máximo un puesto.';

create index if not exists plano_ocupacion_elemento_idx on public.plano_ocupacion (elemento_id);

-- ---------------------------------------------------------------------------
-- Un puesto no admite más vehículos que su capacidad.
-- ---------------------------------------------------------------------------
create or replace function public.validar_capacidad_puesto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacidad integer;
  v_ocupados integer;
begin
  select capacidad_vehiculos into v_capacidad from public.plano_elementos where id = new.elemento_id;
  select count(*) into v_ocupados from public.plano_ocupacion
  where elemento_id = new.elemento_id and id is distinct from new.id;

  if v_ocupados >= coalesce(v_capacidad, 1) then
    raise exception 'Este puesto ya está completo. Libera un vehículo antes de ubicar otro.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plano_ocupacion_capacidad on public.plano_ocupacion;
create trigger trg_plano_ocupacion_capacidad
  before insert or update on public.plano_ocupacion
  for each row execute function public.validar_capacidad_puesto();

-- ---------------------------------------------------------------------------
-- La capacidad de la Agenda sigue al plano. OLD solo se toca dentro de ramas
-- que descartan INSERT (en un trigger de INSERT "old" no está asignado).
-- ---------------------------------------------------------------------------
create or replace function public.sincronizar_capacidad_isla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_cantidad integer;
begin
  if TG_OP <> 'INSERT' then
    if old.tipo_isla_id is not null then
      v_ids := v_ids || old.tipo_isla_id;
    end if;
  end if;
  if TG_OP <> 'DELETE' then
    if new.tipo_isla_id is not null then
      v_ids := v_ids || new.tipo_isla_id;
    end if;
  end if;

  foreach v_id in array v_ids loop
    select count(*) into v_cantidad from public.plano_elementos where tipo_isla_id = v_id;
    if v_cantidad > 0 then
      update public.tipos_isla set capacidad = v_cantidad where id = v_id and capacidad <> v_cantidad;
    end if;
  end loop;

  return null;
end;
$$;

drop trigger if exists trg_plano_elementos_capacidad_isla on public.plano_elementos;
create trigger trg_plano_elementos_capacidad_isla
  after insert or update of tipo_isla_id or delete on public.plano_elementos
  for each row execute function public.sincronizar_capacidad_isla();

-- ---------------------------------------------------------------------------
-- Una OT entregada o anulada libera su puesto sola.
-- ---------------------------------------------------------------------------
create or replace function public.liberar_puesto_al_cerrar_ot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.plano_ocupacion where trabajo_id = new.id;
  return null;
end;
$$;

drop trigger if exists trg_trabajos_taller_liberar_puesto on public.trabajos_taller;
create trigger trg_trabajos_taller_liberar_puesto
  after update of estado on public.trabajos_taller
  for each row
  when (new.estado in ('entregado', 'anulado') and old.estado is distinct from new.estado)
  execute function public.liberar_puesto_al_cerrar_ot();

-- ---------------------------------------------------------------------------
-- RLS: lectura para cualquiera de la empresa; escritura (dibujar el plano y
-- ubicar vehículos) solo jefe de taller, admin y socia.
-- ---------------------------------------------------------------------------
alter table public.plano_elementos enable row level security;
alter table public.plano_ocupacion enable row level security;

drop policy if exists plano_elementos_select on public.plano_elementos;
create policy plano_elementos_select on public.plano_elementos
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists plano_elementos_insert on public.plano_elementos;
create policy plano_elementos_insert on public.plano_elementos
  for insert with check (
    empresa_id = public.mi_empresa_id() and public.auth_rol() in ('jefe_taller', 'admin', 'socia')
  );

drop policy if exists plano_elementos_update on public.plano_elementos;
create policy plano_elementos_update on public.plano_elementos
  for update
  using (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('jefe_taller', 'admin', 'socia'))
  with check (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('jefe_taller', 'admin', 'socia'));

drop policy if exists plano_elementos_delete on public.plano_elementos;
create policy plano_elementos_delete on public.plano_elementos
  for delete using (
    empresa_id = public.mi_empresa_id() and public.auth_rol() in ('jefe_taller', 'admin', 'socia')
  );

drop policy if exists plano_ocupacion_select on public.plano_ocupacion;
create policy plano_ocupacion_select on public.plano_ocupacion
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists plano_ocupacion_insert on public.plano_ocupacion;
create policy plano_ocupacion_insert on public.plano_ocupacion
  for insert with check (
    empresa_id = public.mi_empresa_id() and public.auth_rol() in ('jefe_taller', 'admin', 'socia')
  );

drop policy if exists plano_ocupacion_delete on public.plano_ocupacion;
create policy plano_ocupacion_delete on public.plano_ocupacion
  for delete using (
    empresa_id = public.mi_empresa_id() and public.auth_rol() in ('jefe_taller', 'admin', 'socia')
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_name in ('plano_elementos', 'plano_ocupacion')) as tablas_esperado_2,
  (select count(*) from pg_class where relname in ('plano_elementos', 'plano_ocupacion') and relrowsecurity) as rls_esperado_2,
  (select count(*) from pg_policies where tablename in ('plano_elementos', 'plano_ocupacion')) as politicas_esperado_7,
  (select count(*) from pg_trigger where tgname in (
    'trg_plano_elementos_actualizado_en', 'trg_plano_ocupacion_capacidad',
    'trg_plano_elementos_capacidad_isla', 'trg_trabajos_taller_liberar_puesto'
  )) as triggers_esperado_4;
