-- =============================================================================
-- 0026_bloqueo_ot_cerrada.sql
--
-- Qué resuelve:
--   Hasta ahora, una OT ya entregada seguía totalmente editable: se podían
--   seguir agregando/editando tareas e ítems (precio, cantidad, decisión)
--   después de que el cliente ya se llevó el vehículo y firmó el documento
--   impreso. El cliente pidió que, al cerrar la OT, la información quede
--   fija -solo se puedan agregar observaciones de postventa (llamados de
--   seguimiento, reclamos, garantías)-, con una salida para corregir un
--   error real: admin/socia puede reabrir la OT.
--
--   Protección en dos capas, mismo criterio que la protección de precios
--   del Bloque 5 (RLS no alcanza sola porque todos los roles comparten el
--   rol `authenticated`): un trigger en `ot_detalle`/`tareas_taller`
--   rechaza cualquier escritura mientras `trabajos_taller.bloqueada_en` no
--   sea NULL. El trigger deja pasar al `service_role` -la sincronización
--   con ClickUp sigue reflejando el estado real de una tarjeta aunque la
--   OT ya esté cerrada, eso no es "editar a mano" el registro-.
-- =============================================================================

alter table public.trabajos_taller
  add column if not exists bloqueada_en timestamptz,
  add column if not exists reabierta_por uuid references public.usuarios (id),
  add column if not exists reabierta_en timestamptz;

comment on column public.trabajos_taller.bloqueada_en is 'Cuándo quedó bloqueada para edición (se setea sola al marcar "entregado"). NULL = editable.';
comment on column public.trabajos_taller.reabierta_por is 'Quién reabrió la OT por última vez (solo admin/socia pueden). Historial de la última vez, no un log completo.';

-- ---------------------------------------------------------------------------
-- Bloqueo automático al marcar "entregado".
-- ---------------------------------------------------------------------------
create or replace function public.bloquear_ot_al_entregar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'entregado' and (old.estado is distinct from new.estado) and new.bloqueada_en is null then
    new.bloqueada_en := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trabajos_taller_bloquear on public.trabajos_taller;
create trigger trg_trabajos_taller_bloquear
  before update on public.trabajos_taller
  for each row execute function public.bloquear_ot_al_entregar();

-- ---------------------------------------------------------------------------
-- Guardia real: rechaza insert/update/delete en ot_detalle y tareas_taller
-- mientras la OT dueña esté bloqueada. `auth.role() = 'service_role'` deja
-- pasar la sincronización de ClickUp (corre con la service role key, no es
-- una edición manual de una persona).
-- ---------------------------------------------------------------------------
create or replace function public.bloquear_edicion_ot_cerrada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trabajo_id uuid;
  v_bloqueada_en timestamptz;
begin
  if auth.role() = 'service_role' then
    return coalesce(new, old);
  end if;

  v_trabajo_id := coalesce(new.trabajo_id, old.trabajo_id);
  select bloqueada_en into v_bloqueada_en from public.trabajos_taller where id = v_trabajo_id;

  if v_bloqueada_en is not null then
    raise exception 'Esta OT ya fue entregada y quedó bloqueada para edición. Un admin o socia puede reabrirla desde la ficha de la OT.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_ot_detalle_bloqueo on public.ot_detalle;
create trigger trg_ot_detalle_bloqueo
  before insert or update or delete on public.ot_detalle
  for each row execute function public.bloquear_edicion_ot_cerrada();

drop trigger if exists trg_tareas_taller_bloqueo on public.tareas_taller;
create trigger trg_tareas_taller_bloqueo
  before insert or update or delete on public.tareas_taller
  for each row execute function public.bloquear_edicion_ot_cerrada();

-- ---------------------------------------------------------------------------
-- Reabrir / volver a bloquear, exclusivo admin/socia.
-- ---------------------------------------------------------------------------
create or replace function public.trabajo_reabrir(p_trabajo_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.es_admin() or public.es_socia()) then
    raise exception 'Solo un administrador o socia puede reabrir una OT cerrada.';
  end if;

  update public.trabajos_taller
  set bloqueada_en = null,
      reabierta_por = auth.uid(),
      reabierta_en = now()
  where id = p_trabajo_id
    and empresa_id = public.mi_empresa_id()
    and bloqueada_en is not null;

  return found;
end;
$$;

create or replace function public.trabajo_bloquear(p_trabajo_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.es_admin() or public.es_socia()) then
    raise exception 'Solo un administrador o socia puede volver a bloquear una OT.';
  end if;

  update public.trabajos_taller
  set bloqueada_en = now()
  where id = p_trabajo_id
    and empresa_id = public.mi_empresa_id()
    and bloqueada_en is null
    and estado = 'entregado';

  return found;
end;
$$;

revoke all on function public.trabajo_reabrir(uuid) from public;
revoke all on function public.trabajo_bloquear(uuid) from public;
grant execute on function public.trabajo_reabrir(uuid) to authenticated;
grant execute on function public.trabajo_bloquear(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Observaciones de postventa: bitácora de seguimiento (llamados, reclamos,
-- garantías) que se sigue pudiendo agregar aunque la OT ya esté bloqueada
-- -es justo lo que el cliente pidió que quedara exceptuado-. Sin UPDATE/
-- DELETE a propósito: es un registro de lo que pasó, no un campo a editar.
-- ---------------------------------------------------------------------------
create table if not exists public.observaciones_postventa (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references public.trabajos_taller (id) on delete cascade,
  autor_id uuid references public.usuarios (id),
  texto text not null,
  creado_en timestamptz not null default now()
);

comment on table public.observaciones_postventa is 'Bitácora de seguimiento post-entrega de una OT (llamados, reclamos, garantías). Se puede agregar aunque la OT esté bloqueada para edición -a propósito, es la excepción que pidió el cliente-.';

create index if not exists observaciones_postventa_trabajo_idx on public.observaciones_postventa (trabajo_id);

alter table public.observaciones_postventa enable row level security;

drop policy if exists observaciones_postventa_select on public.observaciones_postventa;
create policy observaciones_postventa_select on public.observaciones_postventa
  for select using (exists (
    select 1 from public.trabajos_taller t
    where t.id = observaciones_postventa.trabajo_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists observaciones_postventa_insert on public.observaciones_postventa;
create policy observaciones_postventa_insert on public.observaciones_postventa
  for insert with check (
    public.auth_rol() is not null
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = observaciones_postventa.trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'trabajos_taller' and column_name in ('bloqueada_en', 'reabierta_por', 'reabierta_en')) as columnas_bloqueo_esperado_3,
  (select count(*) from pg_proc where proname in ('bloquear_ot_al_entregar', 'bloquear_edicion_ot_cerrada', 'trabajo_reabrir', 'trabajo_bloquear')) as funciones_esperado_4,
  (select count(*) from pg_trigger where tgname in ('trg_trabajos_taller_bloquear', 'trg_ot_detalle_bloqueo', 'trg_tareas_taller_bloqueo')) as triggers_esperado_3,
  (select relrowsecurity from pg_class where relname = 'observaciones_postventa') as rls_postventa_esperado_true;
