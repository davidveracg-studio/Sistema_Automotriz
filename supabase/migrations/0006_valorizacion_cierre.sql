-- =============================================================================
-- 0006_valorizacion_cierre.sql
--
-- Qué resuelve:
--   Bloque 5: "el ciclo del dinero queda cerrado". El encargado de
--   presupuestos pone costo y precio a cada línea (mano de obra incluida),
--   arma un presupuesto con correlativo propio (P-00001), el asesor registra
--   la decisión del cliente ítem por ítem (aceptado/rechazado/postergado -no
--   todo o nada-), y la OT se cierra con el número de documento que emitió
--   Dimasoft.
--
--   Mano de obra: hasta ahora `tareas_taller` no tenía precio a propósito
--   (Bloque 4). Esta migración crea, con un trigger, una fila de
--   `ot_detalle` (area = 'mano_obra') por cada tarea existente y por cada
--   una nueva, para que el precio de TODA la OT -incluida la mano de obra-
--   viva en un solo lugar (`ot_detalle`), como pide el spec.
--
--   Protección de precios -no solo RLS-: "Montos y márgenes: socia, admin,
--   encargado de presupuestos, jefe de taller" no es una regla de fila (RLS
--   filtra filas, no columnas), es una regla de COLUMNA: un técnico debe
--   poder ver y editar `detalle`/`cantidad`/`decision` de una línea pero
--   nunca `costo_unitario`/`precio_unitario` de esa misma fila. Postgres no
--   tiene "RLS por columna condicional a un rol de negocio" nativo -el GRANT
--   por columna es por rol de Postgres, y todos los usuarios de la app
--   comparten el rol `authenticated`-, así que se resuelve con dos capas:
--     1. Un trigger (`impedir_precio_sin_acceso_montos`) que bloquea
--        escribir costo/precio sin `tiene_acceso_montos()`.
--     2. Para lectura: se revoca el SELECT de esas columnas en la tabla
--        base y se expone `ot_detalle_con_permiso`, una vista que las
--        muestra en NULL a quien no tiene acceso. El frontend debe leer
--        desde la vista, no desde la tabla, para que el técnico ni siquiera
--        reciba el dato en la respuesta.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Contador de presupuestos por empresa (mismo patrón que numero_ot: UPDATE
-- atómico sobre la fila de la empresa, no una secuencia global -evita
-- mezclar el conteo entre tenants-).
-- ---------------------------------------------------------------------------
alter table public.empresas add column if not exists siguiente_numero_presupuesto integer not null default 1;

comment on column public.empresas.siguiente_numero_presupuesto is 'Próximo correlativo P-XXXXX a asignar. Solo lo actualiza asignar_correlativo_presupuesto().';

-- ---------------------------------------------------------------------------
-- Tabla presupuestos_taller.
-- ---------------------------------------------------------------------------
create table if not exists public.presupuestos_taller (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references public.trabajos_taller (id) on delete restrict,
  correlativo text,
  estado text not null default 'borrador' check (estado in ('borrador', 'enviado', 'aceptado', 'parcial', 'rechazado', 'anulado')),
  creado_por uuid references public.usuarios (id),
  fecha_envio timestamptz,
  fecha_respuesta timestamptz,
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint uq_presupuestos_taller_correlativo unique (correlativo)
);

comment on table public.presupuestos_taller is 'Cotización presentada al cliente. Correlativo propio (P-00001): una OT puede tener varias.';

create index if not exists presupuestos_taller_trabajo_idx on public.presupuestos_taller (trabajo_id);

drop trigger if exists trg_presupuestos_taller_actualizado_en on public.presupuestos_taller;
create trigger trg_presupuestos_taller_actualizado_en
  before update on public.presupuestos_taller
  for each row execute function public.actualizar_marca_de_tiempo();

create or replace function public.asignar_correlativo_presupuesto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa_id uuid;
  v_numero integer;
begin
  if new.correlativo is not null then
    return new;
  end if;

  select empresa_id into v_empresa_id from public.trabajos_taller where id = new.trabajo_id;
  if v_empresa_id is null then
    raise exception 'No se pudo determinar la empresa del trabajo % para asignar el correlativo.', new.trabajo_id;
  end if;

  update public.empresas
  set siguiente_numero_presupuesto = siguiente_numero_presupuesto + 1
  where id = v_empresa_id
  returning siguiente_numero_presupuesto - 1 into v_numero;

  new.correlativo := 'P-' || lpad(v_numero::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists trg_presupuestos_taller_correlativo on public.presupuestos_taller;
create trigger trg_presupuestos_taller_correlativo
  before insert on public.presupuestos_taller
  for each row execute function public.asignar_correlativo_presupuesto();

-- ---------------------------------------------------------------------------
-- ot_detalle: decisión del cliente ítem por ítem + vínculo al presupuesto.
-- ---------------------------------------------------------------------------
alter table public.ot_detalle add column if not exists decision text not null default 'pendiente';
alter table public.ot_detalle add column if not exists motivo_rechazo text;
alter table public.ot_detalle add column if not exists fecha_postergado date;
alter table public.ot_detalle add column if not exists presupuesto_id uuid references public.presupuestos_taller (id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_ot_detalle_decision'
  ) then
    alter table public.ot_detalle
      add constraint chk_ot_detalle_decision check (decision in ('pendiente', 'aceptado', 'rechazado', 'postergado'));
  end if;
end $$;

comment on column public.ot_detalle.decision is 'Aceptación parcial por ítem, no por OT completa: lo que el spec pide explícitamente.';
comment on column public.ot_detalle.fecha_postergado is 'Alimenta oportunidades (venta agendada, no perdida) vía el trigger crear_oportunidad_si_postergado.';

create index if not exists ot_detalle_presupuesto_idx on public.ot_detalle (presupuesto_id);

-- ---------------------------------------------------------------------------
-- trabajos_taller: cierre con documento de salida (el número lo emite
-- Dimasoft; este sistema solo lo registra, como dice el spec).
-- ---------------------------------------------------------------------------
alter table public.trabajos_taller add column if not exists numero_documento_facturacion text;
alter table public.trabajos_taller add column if not exists fecha_entrega timestamptz;
alter table public.trabajos_taller add column if not exists entregado_por uuid references public.usuarios (id);

comment on column public.trabajos_taller.numero_documento_facturacion is 'Número de boleta/factura emitida en Dimasoft. Sin integración: se registra a mano.';

-- ---------------------------------------------------------------------------
-- oportunidades: lo postergado con fecha es una venta agendada, no perdida.
-- ---------------------------------------------------------------------------
create table if not exists public.oportunidades (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references public.trabajos_taller (id) on delete restrict,
  ot_detalle_id uuid references public.ot_detalle (id) on delete restrict,
  descripcion text not null,
  fecha_sugerida date,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'contactado', 'convertido', 'descartado')),
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.oportunidades is 'Ítems postergados por el cliente: alimentan campañas futuras (Bloque 7). No es una venta perdida.';

create index if not exists oportunidades_trabajo_idx on public.oportunidades (trabajo_id);
create index if not exists oportunidades_estado_idx on public.oportunidades (estado) where estado = 'pendiente';

drop trigger if exists trg_oportunidades_actualizado_en on public.oportunidades;
create trigger trg_oportunidades_actualizado_en
  before update on public.oportunidades
  for each row execute function public.actualizar_marca_de_tiempo();

create or replace function public.crear_oportunidad_si_postergado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.decision = 'postergado' and (old.decision is distinct from new.decision or old.fecha_postergado is distinct from new.fecha_postergado) then
    insert into public.oportunidades (trabajo_id, ot_detalle_id, descripcion, fecha_sugerida)
    values (new.trabajo_id, new.id, new.detalle, new.fecha_postergado);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ot_detalle_crear_oportunidad on public.ot_detalle;
create trigger trg_ot_detalle_crear_oportunidad
  after update on public.ot_detalle
  for each row execute function public.crear_oportunidad_si_postergado();

-- ---------------------------------------------------------------------------
-- Mano de obra en ot_detalle: una fila por tarea, creada y mantenida en
-- sincronía automáticamente -nadie tiene que acordarse de hacerlo a mano-.
-- ---------------------------------------------------------------------------
create or replace function public.sincronizar_ot_detalle_mano_obra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.ot_detalle (trabajo_id, area, tarea_taller_id, detalle, cantidad)
    values (new.trabajo_id, 'mano_obra', new.id, new.descripcion, 1);
  elsif TG_OP = 'UPDATE' and old.descripcion is distinct from new.descripcion then
    update public.ot_detalle set detalle = new.descripcion where tarea_taller_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tareas_taller_sync_detalle on public.tareas_taller;
create trigger trg_tareas_taller_sync_detalle
  after insert or update on public.tareas_taller
  for each row execute function public.sincronizar_ot_detalle_mano_obra();

-- Respaldo para tareas creadas antes de esta migración (Bloque 4, ya
-- probadas y limpiadas, pero por si quedó alguna real).
insert into public.ot_detalle (trabajo_id, area, tarea_taller_id, detalle, cantidad)
select t.trabajo_id, 'mano_obra', t.id, t.descripcion, 1
from public.tareas_taller t
where not exists (select 1 from public.ot_detalle d where d.tarea_taller_id = t.id);

-- ---------------------------------------------------------------------------
-- Protección de precios: ni insertar ni editar costo/precio sin
-- tiene_acceso_montos(), sin importar lo que permita RLS de fila.
-- ---------------------------------------------------------------------------
create or replace function public.impedir_precio_sin_acceso_montos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

drop trigger if exists trg_ot_detalle_precio_protegido on public.ot_detalle;
create trigger trg_ot_detalle_precio_protegido
  before insert or update on public.ot_detalle
  for each row execute function public.impedir_precio_sin_acceso_montos();

-- ---------------------------------------------------------------------------
-- Vista de lectura con costo/precio redactados para quien no tiene acceso.
-- security_invoker: la RLS de ot_detalle se evalúa con el usuario que
-- consulta la vista, no con el dueño de la vista -si no, esto se saltaría
-- el aislamiento por empresa-.
-- ---------------------------------------------------------------------------
revoke select (costo_unitario, precio_unitario, total_linea) on public.ot_detalle from authenticated, anon;

create or replace view public.ot_detalle_con_permiso
with (security_invoker = true) as
select
  id,
  trabajo_id,
  area,
  tarea_taller_id,
  codigo,
  detalle,
  cantidad,
  case when public.tiene_acceso_montos() then costo_unitario end as costo_unitario,
  case when public.tiene_acceso_montos() then precio_unitario end as precio_unitario,
  case when public.tiene_acceso_montos() then total_linea end as total_linea,
  verificado,
  responsable_id,
  decision,
  motivo_rechazo,
  fecha_postergado,
  presupuesto_id,
  clickup_checklist_item_id,
  creado_en,
  actualizado_en
from public.ot_detalle;

comment on view public.ot_detalle_con_permiso is 'Leer ot_detalle SIEMPRE desde aquí, nunca desde la tabla base: acá costo/precio salen en NULL para quien no tiene tiene_acceso_montos().';

grant select on public.ot_detalle_con_permiso to authenticated;

-- ---------------------------------------------------------------------------
-- RLS de las tablas nuevas.
-- ---------------------------------------------------------------------------
alter table public.presupuestos_taller enable row level security;
alter table public.oportunidades enable row level security;

drop policy if exists presupuestos_taller_select on public.presupuestos_taller;
create policy presupuestos_taller_select on public.presupuestos_taller
  for select using (exists (
    select 1 from public.trabajos_taller t
    where t.id = presupuestos_taller.trabajo_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists presupuestos_taller_insert on public.presupuestos_taller;
create policy presupuestos_taller_insert on public.presupuestos_taller
  for insert with check (
    public.tiene_acceso_montos()
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists presupuestos_taller_update on public.presupuestos_taller;
create policy presupuestos_taller_update on public.presupuestos_taller
  for update using (
    public.tiene_acceso_montos()
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = presupuestos_taller.trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists oportunidades_select on public.oportunidades;
create policy oportunidades_select on public.oportunidades
  for select using (exists (
    select 1 from public.trabajos_taller t
    where t.id = oportunidades.trabajo_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists oportunidades_insert on public.oportunidades;
create policy oportunidades_insert on public.oportunidades
  for insert with check (exists (
    select 1 from public.trabajos_taller t
    where t.id = trabajo_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists oportunidades_update on public.oportunidades;
create policy oportunidades_update on public.oportunidades
  for update using (exists (
    select 1 from public.trabajos_taller t
    where t.id = oportunidades.trabajo_id and t.empresa_id = public.mi_empresa_id()
  ));

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.role_table_grants
     where grantee = 'authenticated' and table_schema = 'public'
       and table_name = 'presupuestos_taller' and privilege_type = 'SELECT'
  ) as permiso_tabla_nueva_esperado_mayor_a_0,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'ot_detalle' and column_name = 'decision'
  ) as columna_decision_esperado_1,
  (select relrowsecurity from pg_class where relname = 'presupuestos_taller') as rls_presupuestos_esperado_true,
  (select relrowsecurity from pg_class where relname = 'oportunidades') as rls_oportunidades_esperado_true,
  (select count(*) from information_schema.views where table_schema = 'public' and table_name = 'ot_detalle_con_permiso') as vista_creada_esperado_1;
