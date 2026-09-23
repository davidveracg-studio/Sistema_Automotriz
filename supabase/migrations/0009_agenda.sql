-- =============================================================================
-- 0009_agenda.sql
--
-- Qué resuelve:
--   Bloque 8: Recepción — agenda con capacidad por isla. Antes de construir
--   esto se resolvió con el cliente la definición pendiente sobre la
--   capacidad real (el spec original decía "5 vehículos/día con 4 islas",
--   que no cuadraba): la capacidad real no es un número único, es por TIPO
--   de isla -4 de taller mecánico, 2 de servicio rápido, 1 de alineación,
--   1 de pintura, 1 de lavado-, y se cuentan vehículos simultáneos, no
--   citas por día. `tipos_isla` queda como catálogo por empresa (no una
--   lista fija en código) porque es multi-tenant: cada taller que se sume
--   a la plataforma va a tener su propia distribución de islas.
--
--   WhatsApp (Meta Cloud API) queda fuera de este bloque a pedido explícito
--   del cliente: requiere verificación de negocio y aprobación de
--   plantillas, un proceso externo que puede tardar días. Se retoma como
--   bloque aparte cuando esas credenciales estén listas.
--
--   `categoria_servicio` de `trabajos_taller` (Bloque 3/4) es un concepto
--   distinto y no se reutiliza aquí a propósito: ese campo existe para
--   cruzar con el campo "Tipo de servicio" de ClickUp (3 valores fijos,
--   ligados a esa integración) y no cubre alineación ni lavado. Mezclar
--   ambos habría atado la agenda a la taxonomía de un sistema externo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Catálogo de islas por empresa: nombre + cuántos vehículos caben a la vez.
-- ---------------------------------------------------------------------------
create table if not exists public.tipos_isla (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nombre text not null,
  capacidad integer not null check (capacidad > 0),
  orden integer not null default 0,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint uq_tipos_isla_nombre unique (empresa_id, nombre)
);

comment on table public.tipos_isla is 'Catálogo por empresa de tipos de isla y su capacidad simultánea. Definido con el cliente antes de construir la agenda (capacidad real, no la del spec original que no cuadraba).';

insert into public.tipos_isla (empresa_id, nombre, capacidad, orden)
select e.id, v.nombre, v.capacidad, v.orden
from public.empresas e
cross join (values
  ('Taller mecánico', 4, 1),
  ('Servicio rápido', 2, 2),
  ('Alineación', 1, 3),
  ('Pintura', 1, 4),
  ('Lavado', 1, 5)
) as v(nombre, capacidad, orden)
where e.nombre = 'Servicio Automotriz Didial Ltda.'
  and not exists (
    select 1 from public.tipos_isla t where t.empresa_id = e.id and t.nombre = v.nombre
  );

-- ---------------------------------------------------------------------------
-- Citas: reserva de una isla en una fecha (y opcionalmente hora). El
-- vehículo es opcional -se suele agendar por teléfono antes de confirmar
-- patente-; cuando el vehículo llega de verdad, la cita se vincula al
-- trabajo_id real creado en Nuevo Ingreso (Bloque 3), a mano por ahora.
-- ---------------------------------------------------------------------------
create table if not exists public.citas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  tipo_isla_id uuid not null references public.tipos_isla (id) on delete restrict,
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  vehiculo_id uuid references public.vehiculos (id) on delete restrict,
  trabajo_id uuid references public.trabajos_taller (id) on delete restrict,
  fecha date not null,
  hora time,
  descripcion text,
  estado text not null default 'agendada' check (estado in (
    'agendada', 'confirmada', 'completada', 'cancelada', 'no_asistio'
  )),
  creado_por uuid references public.usuarios (id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.citas is 'Reserva de un cupo de isla en una fecha. Bloque 8 (Recepción).';
comment on column public.citas.vehiculo_id is 'Opcional: al agendar por teléfono no siempre se confirma la patente todavía.';
comment on column public.citas.trabajo_id is 'Se vincula manualmente al crear el Nuevo Ingreso real (Bloque 3) el día que el vehículo llega. No hay automatismo todavía.';

create index if not exists citas_empresa_fecha_idx on public.citas (empresa_id, fecha);
create index if not exists citas_tipo_isla_fecha_idx on public.citas (tipo_isla_id, fecha) where estado in ('agendada', 'confirmada');
create index if not exists citas_cliente_idx on public.citas (cliente_id);

drop trigger if exists trg_citas_actualizado_en on public.citas;
create trigger trg_citas_actualizado_en
  before update on public.citas
  for each row execute function public.actualizar_marca_de_tiempo();

-- ---------------------------------------------------------------------------
-- Cupos disponibles de una isla en una fecha. Se usa como aviso en el
-- frontend antes de agendar -mismo criterio "avisa, no bloquea" que ya se
-- usa para duplicados de cliente (Bloque 2)-, nunca como validación dura en
-- la base: un taller real necesita poder sobre-agendar a propósito.
-- ---------------------------------------------------------------------------
create or replace function public.citas_cupos_disponibles(p_tipo_isla_id uuid, p_fecha date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select t.capacidad - count(c.id)::integer
  from public.tipos_isla t
  left join public.citas c
    on c.tipo_isla_id = t.id
    and c.fecha = p_fecha
    and c.estado in ('agendada', 'confirmada')
  where t.id = p_tipo_isla_id
  group by t.capacidad;
$$;

comment on function public.citas_cupos_disponibles is 'Cupos = capacidad de la isla menos citas agendadas/confirmadas ese día. Puede dar negativo si se agendó a propósito por sobre la capacidad.';

-- ---------------------------------------------------------------------------
-- RLS. tipos_isla es catálogo de lectura para cualquiera activo de la
-- empresa. citas: alta/edición para quien recibe vehículos -asesor,
-- recepcionista- más admin/socia (mismo criterio de "1 · RECEPCIÓN" que ya
-- se usó para trabajos_taller en el Bloque 3); lectura abierta a cualquiera
-- activo de la empresa.
-- ---------------------------------------------------------------------------
alter table public.tipos_isla enable row level security;
alter table public.citas enable row level security;

drop policy if exists tipos_isla_select on public.tipos_isla;
create policy tipos_isla_select on public.tipos_isla
  for select
  using (empresa_id = public.mi_empresa_id());

drop policy if exists citas_select on public.citas;
create policy citas_select on public.citas
  for select
  using (empresa_id = public.mi_empresa_id());

drop policy if exists citas_insert on public.citas;
create policy citas_insert on public.citas
  for insert
  with check (
    empresa_id = public.mi_empresa_id()
    and (public.es_asesor() or public.es_recepcionista() or public.es_admin() or public.es_socia())
  );

drop policy if exists citas_update on public.citas;
create policy citas_update on public.citas
  for update
  using (
    empresa_id = public.mi_empresa_id()
    and (public.es_asesor() or public.es_recepcionista() or public.es_admin() or public.es_socia())
  )
  with check (empresa_id = public.mi_empresa_id());

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.tipos_isla ti join public.empresas e on e.id = ti.empresa_id where e.nombre = 'Servicio Automotriz Didial Ltda.') as tipos_isla_didial_esperado_5,
  (select sum(capacidad) from public.tipos_isla ti join public.empresas e on e.id = ti.empresa_id where e.nombre = 'Servicio Automotriz Didial Ltda.') as capacidad_total_didial_esperado_9,
  (select relrowsecurity from pg_class where relname = 'tipos_isla') as rls_tipos_isla_esperado_true,
  (select relrowsecurity from pg_class where relname = 'citas') as rls_citas_esperado_true,
  (select count(*) from pg_proc where proname = 'citas_cupos_disponibles') as funcion_cupos_esperado_1;
