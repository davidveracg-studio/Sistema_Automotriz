-- =============================================================================
-- 0073_solicitudes_titulares.sql
--
-- Qué resuelve (hallazgo H-04 de la auditoría de protección de datos
-- 2026-11-03):
--   La Ley 21.719 (vigente desde el 1 de diciembre de 2026) obliga al
--   responsable a atender las solicitudes de acceso, rectificación, supresión,
--   oposición, portabilidad y bloqueo de los titulares, con plazos y con
--   respaldo de la respuesta (art. 10 y 11 de la Ley 19.628 tal como queda). La
--   app no tenía dónde registrarlas ni quién vigilara los plazos.
--
-- Qué hace:
--   Crea `solicitudes_titulares`, con los plazos calculados por trigger:
--     - Respuesta: 30 días corridos desde el ingreso; prórroga única de 30 más.
--     - Bloqueo temporal (en solicitudes de rectificación, supresión u
--       oposición): respuesta en 2 días hábiles. Se cuentan lunes a viernes;
--       los feriados no se descuentan (confirmar con el abogado).
--     - Una solicitud respondida o rechazada no se puede modificar ni borrar:
--       es el respaldo que la ley pide guardar (fecha y contenido íntegro).
--     - Un rechazo exige fundamento.
--   Solo admin y socia la ven y la editan.
--
-- No hace: eliminar ni anonimizar datos del cliente. Qué se puede suprimir y
-- qué debe conservarse por ley (tributaria, garantías, laboral) lo debe definir
-- un abogado antes de automatizarlo.
--
-- Idempotente.
-- =============================================================================

-- Días hábiles = lunes a viernes. Los feriados no se descuentan.
create or replace function public.sumar_dias_habiles(p_desde date, p_dias integer)
returns date
language plpgsql
immutable
as $$
declare
  v_fecha date := p_desde;
  v_restantes integer := p_dias;
begin
  while v_restantes > 0 loop
    v_fecha := v_fecha + 1;
    if extract(isodow from v_fecha) < 6 then
      v_restantes := v_restantes - 1;
    end if;
  end loop;
  return v_fecha;
end;
$$;

comment on function public.sumar_dias_habiles(date, integer) is 'Suma días hábiles (lunes a viernes) a una fecha. No descuenta feriados.';

create table if not exists public.solicitudes_titulares (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  tipo text not null check (tipo in ('acceso', 'rectificacion', 'supresion', 'oposicion', 'portabilidad', 'bloqueo')),
  estado text not null default 'recibida' check (estado in ('recibida', 'en_proceso', 'respondida', 'rechazada')),
  canal text not null default 'correo' check (canal in ('correo', 'formulario', 'presencial', 'telefono', 'otro')),
  solicitante_nombre text not null check (length(btrim(solicitante_nombre)) > 0),
  solicitante_rut text,
  solicitante_contacto text not null check (length(btrim(solicitante_contacto)) > 0),
  cliente_id uuid references public.clientes (id) on delete set null,
  detalle text not null check (length(btrim(detalle)) > 0),
  causal text,
  recibida_en date not null default current_date,
  vence_en date not null,
  prorrogada boolean not null default false,
  bloqueo_solicitado boolean not null default false,
  bloqueo_solicitado_en date,
  bloqueo_vence_en date,
  respuesta text,
  motivo_rechazo text,
  respondida_en timestamptz,
  respondida_por uuid references public.usuarios (id),
  creado_por uuid references public.usuarios (id) default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint chk_solicitud_bloqueo_tipo check (not bloqueo_solicitado or tipo in ('rectificacion', 'supresion', 'oposicion')),
  constraint chk_solicitud_respuesta check (estado not in ('respondida', 'rechazada') or length(btrim(coalesce(respuesta, ''))) > 0),
  constraint chk_solicitud_rechazo check (estado <> 'rechazada' or length(btrim(coalesce(motivo_rechazo, ''))) > 0)
);

comment on table public.solicitudes_titulares is 'Solicitudes de derechos de los titulares de datos (acceso, rectificación, supresión, oposición, portabilidad, bloqueo). Respaldo exigido por la Ley 21.719: no se borran ni se modifican una vez respondidas.';
comment on column public.solicitudes_titulares.recibida_en is 'Fecha de ingreso de la solicitud: desde ahí corre el plazo de 30 días corridos.';
comment on column public.solicitudes_titulares.vence_en is 'Calculada por trigger: recibida_en + 30 días corridos (+30 si hubo prórroga). No editar a mano.';
comment on column public.solicitudes_titulares.bloqueo_vence_en is 'Calculada por trigger: 2 días hábiles (lunes a viernes) desde que se pidió el bloqueo temporal.';
comment on column public.solicitudes_titulares.motivo_rechazo is 'Fundamento del rechazo, obligatorio al rechazar. Al rechazar hay que informar que el titular tiene 30 días hábiles para reclamar ante la Agencia.';

create index if not exists solicitudes_titulares_empresa_estado_idx
  on public.solicitudes_titulares (empresa_id, estado, vence_en);

create or replace function public.solicitudes_titulares_reglas()
returns trigger
language plpgsql
as $$
declare
  v_bloqueo_nuevo boolean;
  v_respuesta_nueva boolean;
begin
  if tg_op = 'UPDATE' then
    if old.prorrogada and not new.prorrogada then
      raise exception 'La prórroga solo se puede usar una vez y no se puede deshacer.';
    end if;
    if old.bloqueo_solicitado and not new.bloqueo_solicitado then
      raise exception 'Un bloqueo temporal solicitado queda registrado y no se puede deshacer.';
    end if;
    if old.estado in ('respondida', 'rechazada')
       and (new.estado is distinct from old.estado
            or new.respuesta is distinct from old.respuesta
            or new.motivo_rechazo is distinct from old.motivo_rechazo
            or new.recibida_en is distinct from old.recibida_en) then
      raise exception 'La solicitud ya fue respondida: la respuesta queda como respaldo y no se puede modificar.';
    end if;
    v_bloqueo_nuevo := new.bloqueo_solicitado and not old.bloqueo_solicitado;
    v_respuesta_nueva := new.estado in ('respondida', 'rechazada') and old.estado not in ('respondida', 'rechazada');
  else
    v_bloqueo_nuevo := new.bloqueo_solicitado;
    v_respuesta_nueva := new.estado in ('respondida', 'rechazada');
  end if;

  new.vence_en := new.recibida_en + case when new.prorrogada then 60 else 30 end;

  if v_bloqueo_nuevo then
    new.bloqueo_solicitado_en := current_date;
    new.bloqueo_vence_en := public.sumar_dias_habiles(current_date, 2);
  end if;

  if v_respuesta_nueva then
    new.respondida_en := now();
    new.respondida_por := auth.uid();
  end if;

  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists trg_solicitudes_titulares_reglas on public.solicitudes_titulares;
create trigger trg_solicitudes_titulares_reglas
  before insert or update on public.solicitudes_titulares
  for each row execute function public.solicitudes_titulares_reglas();

alter table public.solicitudes_titulares enable row level security;

-- Solo admin y socia. Sin política de delete: el respaldo no se borra.
drop policy if exists solicitudes_titulares_select on public.solicitudes_titulares;
create policy solicitudes_titulares_select on public.solicitudes_titulares
  for select using (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'));

drop policy if exists solicitudes_titulares_insert on public.solicitudes_titulares;
create policy solicitudes_titulares_insert on public.solicitudes_titulares
  for insert with check (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'));

drop policy if exists solicitudes_titulares_update on public.solicitudes_titulares;
create policy solicitudes_titulares_update on public.solicitudes_titulares
  for update
  using (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'))
  with check (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación (todo debe dar lo esperado):
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'solicitudes_titulares') as politicas_esperado_3,
  has_table_privilege('anon', 'public.solicitudes_titulares', 'select') as anon_lee_esperado_false,
  (public.sumar_dias_habiles(date '2026-11-06', 2) = date '2026-11-10') as viernes_mas_2_habiles_es_martes_esperado_true,
  (public.sumar_dias_habiles(date '2026-11-03', 2) = date '2026-11-05') as martes_mas_2_habiles_es_jueves_esperado_true;
