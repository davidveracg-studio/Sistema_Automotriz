-- =============================================================================
-- 0064_notificacion_repuesto_asignado.sql
--
-- Qué resuelve:
--   Al coordinador de repuestos (clickup_config.responsable_repuestos_id,
--   0062) le debe llegar un aviso cuando le asignan un
--   ítem nuevo de Repuestos o Lubricantes e insumos, para que sepa que tiene
--   que prepararlo o comprarlo. Confirmado por el cliente (2026-09-28) que
--   debe avisar sin importar por dónde entró el ítem: agregado desde el
--   Kanban del CRM (clickup-item), o agregado directo en ClickUp
--   (clickup-webhook).
--
--   Mismo patrón que repuesto_pendiente_presupuesto (0033): un trigger en
--   `ot_detalle` -el único punto por el que pasan los dos orígenes sin
--   excepción, RLS/service_role no afecta a triggers-, en vez de duplicar la
--   notificación en cada función. Reutiliza las columnas que ya existían
--   (usuario_destino_id de 0031, ot_detalle_id de 0033): no hace falta
--   ninguna columna nueva, solo el tipo y los triggers.
--
--   Se resuelve sola cuando el ítem queda verificado (ya se preparó/compró)
--   o cuando la OT se entrega -mismo criterio que las demás notificaciones
--   de transición-.
-- =============================================================================

alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'presupuesto_pendiente', 'encuesta_negativa', 'cita_nueva',
  'listo_para_entrega', 'compra_reptos_pendiente', 'whatsapp_desconectado',
  'repuesto_pendiente_presupuesto', 'descuento_pendiente', 'descuento_resuelto',
  'observacion_tecnico', 'tarea_asignada', 'repuesto_asignado'
));

create or replace function public.notificar_repuesto_asignado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa_id uuid;
  v_etiqueta_area text;
begin
  select empresa_id into v_empresa_id from public.trabajos_taller where id = new.trabajo_id;
  v_etiqueta_area := case new.area when 'repuestos' then 'Repuestos' else 'Lubricantes e insumos' end;

  insert into public.notificaciones (empresa_id, tipo, trabajo_id, ot_detalle_id, usuario_destino_id, titulo, mensaje)
  values (
    v_empresa_id, 'repuesto_asignado', new.trabajo_id, new.id, new.responsable_id,
    'Repuesto para preparar',
    '"' || new.detalle || '" (' || v_etiqueta_area || ') quedó asignado para preparar o comprar.'
  );
  return new;
end;
$$;

drop trigger if exists trg_notificar_repuesto_asignado on public.ot_detalle;
create trigger trg_notificar_repuesto_asignado
  after insert on public.ot_detalle
  for each row
  when (new.area in ('repuestos', 'lubricantes_insumos') and new.responsable_id is not null)
  execute function public.notificar_repuesto_asignado();

-- ---------------------------------------------------------------------------
-- Se resuelve sola cuando el ítem queda verificado (mismo gotcha de
-- 0031/0033: trigger de UPDATE aparte, referenciar OLD en uno de INSERT
-- revienta en PL/pgSQL).
-- ---------------------------------------------------------------------------
create or replace function public.limpiar_notificacion_repuesto_asignado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verificado and not old.verificado then
    delete from public.notificaciones where ot_detalle_id = new.id and tipo = 'repuesto_asignado';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_limpiar_notificacion_repuesto_asignado on public.ot_detalle;
create trigger trg_limpiar_notificacion_repuesto_asignado
  after update of verificado on public.ot_detalle
  for each row
  when (new.area in ('repuestos', 'lubricantes_insumos'))
  execute function public.limpiar_notificacion_repuesto_asignado();

-- Al entregar la OT, de paso se limpia también tarea_asignada -mismo gap
-- real, no solo repuesto_asignado: sin esto, un técnico podía quedar con un
-- aviso de tarea pendiente de una OT que ya salió del taller-.
create or replace function public.limpiar_notificacion_ot_entregada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'entregado' and old.estado is distinct from 'entregado' then
    delete from public.notificaciones
    where trabajo_id = new.id and tipo in ('listo_para_entrega', 'compra_reptos_pendiente', 'repuesto_asignado', 'tarea_asignada');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_trigger where tgname in ('trg_notificar_repuesto_asignado', 'trg_limpiar_notificacion_repuesto_asignado')) as triggers_esperado_2,
  (select pg_get_constraintdef(oid) like '%repuesto_asignado%' from pg_constraint where conname = 'notificaciones_tipo_check') as tipo_incluye_repuesto_asignado_esperado_true;
