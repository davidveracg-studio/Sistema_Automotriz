-- =============================================================================
-- 0051_descuento_mano_obra.sql
--
-- Qué resuelve:
--   Descuento comercial sobre la MANO DE OBRA de una OT, negociado por el asesor:
--   - Solo aplica a la mano de obra (no a repuestos, lubricantes ni servicios
--     externos), en porcentaje del subtotal de mano de obra de la OT.
--   - El asesor puede aplicar hasta el límite de la política interna
--     (empresas.descuento_max_asesor_pct, 15 por defecto). Un porcentaje mayor
--     queda como solicitud pendiente y lo autoriza administración (admin o
--     socia), que recibe una notificación y puede aprobar o rechazar.
--     Admin y socia pueden aplicarlo directo.
--   - trabajos_taller.descuento_mano_obra_pct guarda el porcentaje vigente; los
--     documentos (presupuesto, orden de egreso, factura/boleta) lo aplican al
--     subtotal de mano de obra. descuentos_ot deja el historial (quién lo pidió,
--     quién lo autorizó y por qué).
--   - El porcentaje solo cambia por las funciones de abajo: un trigger impide
--     modificarlo con un UPDATE directo (así el límite no se esquiva desde la app).
--   - Una OT entregada, anulada o bloqueada ya no admite cambios.
-- =============================================================================

alter table public.empresas
  add column if not exists descuento_max_asesor_pct numeric(5, 2) not null default 15
  check (descuento_max_asesor_pct >= 0 and descuento_max_asesor_pct <= 100);

comment on column public.empresas.descuento_max_asesor_pct is 'Descuento máximo sobre la mano de obra que el asesor puede aplicar por su cuenta (política interna). Sobre este valor autoriza administración.';

alter table public.trabajos_taller
  add column if not exists descuento_mano_obra_pct numeric(5, 2) not null default 0
  check (descuento_mano_obra_pct >= 0 and descuento_mano_obra_pct <= 100);

comment on column public.trabajos_taller.descuento_mano_obra_pct is 'Descuento vigente sobre el subtotal de mano de obra de la OT, en %. Solo cambia con ot_descuento_mano_obra_solicitar / _resolver.';

create table if not exists public.descuentos_ot (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  trabajo_id uuid not null references public.trabajos_taller (id) on delete cascade,
  porcentaje numeric(5, 2) not null check (porcentaje >= 0 and porcentaje <= 100),
  motivo text,
  estado text not null check (estado in ('pendiente', 'aplicado', 'rechazado')),
  solicitado_por uuid references public.usuarios (id) on delete set null,
  resuelto_por uuid references public.usuarios (id) on delete set null,
  nota text,
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz
);

comment on table public.descuentos_ot is 'Historial de descuentos a la mano de obra de una OT: aplicados, pendientes de autorización y rechazados.';

create index if not exists descuentos_ot_trabajo_idx on public.descuentos_ot (trabajo_id, creado_en desc);
create index if not exists descuentos_ot_empresa_idx on public.descuentos_ot (empresa_id, estado);

-- Solo lectura desde la app: se escribe por las funciones de más abajo.
alter table public.descuentos_ot enable row level security;

drop policy if exists descuentos_ot_select on public.descuentos_ot;
create policy descuentos_ot_select on public.descuentos_ot
  for select using (empresa_id = public.mi_empresa_id());

-- ---------------------------------------------------------------------------
-- El porcentaje no se cambia con un UPDATE directo.
-- ---------------------------------------------------------------------------
create or replace function public.proteger_descuento_mano_obra()
returns trigger
language plpgsql
as $$
begin
  if new.descuento_mano_obra_pct is distinct from old.descuento_mano_obra_pct
     and coalesce(current_setting('app.descuento_rpc', true), 'off') <> 'on' then
    raise exception 'El descuento de mano de obra se cambia desde la sección "Descuento" de la OT.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trabajos_taller_proteger_descuento on public.trabajos_taller;
create trigger trg_trabajos_taller_proteger_descuento
  before update of descuento_mano_obra_pct on public.trabajos_taller
  for each row execute function public.proteger_descuento_mano_obra();

-- ---------------------------------------------------------------------------
-- Notificaciones nuevas.
-- ---------------------------------------------------------------------------
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'presupuesto_pendiente', 'encuesta_negativa', 'cita_nueva',
  'listo_para_entrega', 'compra_reptos_pendiente', 'whatsapp_desconectado',
  'repuesto_pendiente_presupuesto', 'descuento_pendiente', 'descuento_resuelto'
));

-- ---------------------------------------------------------------------------
-- Pedir o aplicar un descuento. Devuelve 'aplicado' o 'pendiente'.
-- Porcentaje 0 quita el descuento. Cualquier solicitud pendiente anterior de la
-- misma OT queda reemplazada.
-- ---------------------------------------------------------------------------
create or replace function public.ot_descuento_mano_obra_solicitar(p_trabajo_id uuid, p_porcentaje numeric, p_motivo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text := public.auth_rol();
  v_trabajo record;
  v_limite numeric;
  v_es_admin boolean;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_rol is null or v_rol not in ('asesor', 'admin', 'socia') then
    raise exception 'Tu rol no puede aplicar descuentos.';
  end if;

  select t.id, t.empresa_id, t.numero_ot, t.estado, t.bloqueada_en
  into v_trabajo
  from public.trabajos_taller t
  where t.id = p_trabajo_id and t.empresa_id = public.mi_empresa_id();
  if not found then
    raise exception 'OT no encontrada.';
  end if;
  if v_trabajo.estado in ('entregado', 'anulado') or v_trabajo.bloqueada_en is not null then
    raise exception 'La OT ya está cerrada: no se puede cambiar el descuento.';
  end if;
  if p_porcentaje is null or p_porcentaje < 0 or p_porcentaje > 100 then
    raise exception 'El descuento debe estar entre 0 y 100 por ciento.';
  end if;
  if p_porcentaje > 0 and (v_motivo is null or length(v_motivo) < 3) then
    raise exception 'Indica el motivo del descuento.';
  end if;

  select coalesce(descuento_max_asesor_pct, 15) into v_limite from public.empresas where id = v_trabajo.empresa_id;
  v_es_admin := v_rol in ('admin', 'socia');

  update public.descuentos_ot
  set estado = 'rechazado', resuelto_por = auth.uid(), resuelto_en = now(), nota = 'Reemplazada por una solicitud nueva.'
  where trabajo_id = p_trabajo_id and estado = 'pendiente';
  delete from public.notificaciones where trabajo_id = p_trabajo_id and tipo = 'descuento_pendiente';

  if v_es_admin or p_porcentaje <= v_limite then
    perform set_config('app.descuento_rpc', 'on', true);
    update public.trabajos_taller set descuento_mano_obra_pct = p_porcentaje where id = p_trabajo_id;
    perform set_config('app.descuento_rpc', 'off', true);

    insert into public.descuentos_ot (empresa_id, trabajo_id, porcentaje, motivo, estado, solicitado_por, resuelto_por, resuelto_en)
    values (v_trabajo.empresa_id, p_trabajo_id, p_porcentaje, v_motivo, 'aplicado', auth.uid(), auth.uid(), now());
    return 'aplicado';
  end if;

  insert into public.descuentos_ot (empresa_id, trabajo_id, porcentaje, motivo, estado, solicitado_por)
  values (v_trabajo.empresa_id, p_trabajo_id, p_porcentaje, v_motivo, 'pendiente', auth.uid());

  insert into public.notificaciones (empresa_id, tipo, trabajo_id, roles_destino, titulo, mensaje)
  values (
    v_trabajo.empresa_id, 'descuento_pendiente', p_trabajo_id, array['admin', 'socia'],
    'Descuento por autorizar',
    'OT ' || v_trabajo.numero_ot || ': el asesor pide ' || p_porcentaje || '% de descuento en mano de obra (su límite es ' || v_limite || '%). Motivo: ' || v_motivo
  );
  return 'pendiente';
end;
$$;

comment on function public.ot_descuento_mano_obra_solicitar is 'Aplica un descuento a la mano de obra de la OT (asesor hasta el límite de la empresa; admin y socia sin límite) o deja una solicitud pendiente de autorización. Devuelve aplicado o pendiente.';

-- ---------------------------------------------------------------------------
-- Aprobar o rechazar una solicitud pendiente (solo admin y socia).
-- ---------------------------------------------------------------------------
create or replace function public.ot_descuento_mano_obra_resolver(p_descuento_id uuid, p_aprobar boolean, p_nota text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solicitud record;
  v_trabajo record;
  v_nota text := nullif(trim(coalesce(p_nota, '')), '');
begin
  if public.auth_rol() is null or public.auth_rol() not in ('admin', 'socia') then
    raise exception 'Solo administración puede autorizar descuentos.';
  end if;

  select * into v_solicitud
  from public.descuentos_ot
  where id = p_descuento_id and empresa_id = public.mi_empresa_id() and estado = 'pendiente';
  if not found then
    raise exception 'La solicitud ya no está pendiente.';
  end if;

  select t.numero_ot, t.estado, t.bloqueada_en into v_trabajo from public.trabajos_taller t where t.id = v_solicitud.trabajo_id;
  if v_trabajo.estado in ('entregado', 'anulado') or v_trabajo.bloqueada_en is not null then
    raise exception 'La OT ya está cerrada: no se puede cambiar el descuento.';
  end if;

  if p_aprobar then
    perform set_config('app.descuento_rpc', 'on', true);
    update public.trabajos_taller set descuento_mano_obra_pct = v_solicitud.porcentaje where id = v_solicitud.trabajo_id;
    perform set_config('app.descuento_rpc', 'off', true);
  end if;

  update public.descuentos_ot
  set estado = case when p_aprobar then 'aplicado' else 'rechazado' end,
      resuelto_por = auth.uid(), resuelto_en = now(), nota = v_nota
  where id = p_descuento_id;

  delete from public.notificaciones where trabajo_id = v_solicitud.trabajo_id and tipo = 'descuento_pendiente';

  if v_solicitud.solicitado_por is not null then
    insert into public.notificaciones (empresa_id, tipo, trabajo_id, usuario_destino_id, titulo, mensaje)
    values (
      v_solicitud.empresa_id, 'descuento_resuelto', v_solicitud.trabajo_id, v_solicitud.solicitado_por,
      case when p_aprobar then 'Descuento autorizado' else 'Descuento rechazado' end,
      'OT ' || v_trabajo.numero_ot || ': ' || v_solicitud.porcentaje || '% en mano de obra ' ||
        case when p_aprobar then 'autorizado.' else 'rechazado.' end || coalesce(' ' || v_nota, '')
    );
  end if;

  return case when p_aprobar then 'aplicado' else 'rechazado' end;
end;
$$;

comment on function public.ot_descuento_mano_obra_resolver is 'Admin o socia aprueban o rechazan una solicitud de descuento pendiente; avisa al asesor que la pidió.';

-- ---------------------------------------------------------------------------
-- Demo: un descuento ya aplicado y una solicitud pendiente, para mostrar el flujo.
-- ---------------------------------------------------------------------------
do $$
declare
  emp constant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_asesor constant uuid := 'a0000000-0000-4000-8000-000000000003';
  v_ot_aplicada uuid;
  v_ot_pendiente uuid;
  v_id uuid;
begin
  if not exists (select 1 from public.empresas where id = emp) or exists (select 1 from public.descuentos_ot where empresa_id = emp) then
    return;
  end if;

  select o.id into v_ot_aplicada
  from public.trabajos_taller o join public.vehiculos v on v.id = o.vehiculo_id
  where o.empresa_id = emp and v.patente = 'VPAI04' and o.estado not in ('entregado', 'anulado') limit 1;
  select o.id into v_ot_pendiente
  from public.trabajos_taller o join public.vehiculos v on v.id = o.vehiculo_id
  where o.empresa_id = emp and v.patente = 'VPAI05' and o.estado not in ('entregado', 'anulado') limit 1;

  if v_ot_aplicada is not null then
    perform set_config('app.descuento_rpc', 'on', true);
    update public.trabajos_taller set descuento_mano_obra_pct = 10 where id = v_ot_aplicada;
    perform set_config('app.descuento_rpc', 'off', true);
    insert into public.descuentos_ot (empresa_id, trabajo_id, porcentaje, motivo, estado, solicitado_por, resuelto_por, resuelto_en)
    values (emp, v_ot_aplicada, 10, 'Cliente frecuente', 'aplicado', v_asesor, v_asesor, now());
  end if;

  if v_ot_pendiente is not null then
    insert into public.descuentos_ot (empresa_id, trabajo_id, porcentaje, motivo, estado, solicitado_por)
    values (emp, v_ot_pendiente, 20, 'Cliente de flota, negocia el trabajo completo', 'pendiente', v_asesor)
    returning id into v_id;
    insert into public.notificaciones (empresa_id, tipo, trabajo_id, roles_destino, titulo, mensaje)
    values (emp, 'descuento_pendiente', v_ot_pendiente, array['admin', 'socia'], 'Descuento por autorizar',
      'OT: el asesor pide 20% de descuento en mano de obra (su límite es 15%). Motivo: Cliente de flota, negocia el trabajo completo');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'trabajos_taller' and column_name = 'descuento_mano_obra_pct') as col_trabajo_esperado_1,
  (select count(*) from information_schema.columns where table_name = 'empresas' and column_name = 'descuento_max_asesor_pct') as col_empresa_esperado_1,
  (select count(*) from pg_proc where proname in ('ot_descuento_mano_obra_solicitar', 'ot_descuento_mano_obra_resolver')) as funciones_esperado_2,
  (select count(*) from pg_class where relname = 'descuentos_ot' and relrowsecurity) as rls_esperado_1,
  (select count(*) from public.descuentos_ot where empresa_id = 'b0000000-0000-4000-8000-000000000001') as demo_descuentos_esperado_2;
