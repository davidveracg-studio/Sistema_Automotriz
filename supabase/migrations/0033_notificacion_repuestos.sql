-- =============================================================================
-- 0033_notificacion_repuestos.sql
--
-- Qué resuelve:
--   Sexto tipo de notificación (ver 0031_notificaciones.sql): cada vez que
--   se agrega un repuesto a una OT que todavía necesita precio, debe
--   llegarle un aviso al encargado de presupuestos -sin esto, nada le
--   avisa de forma activa, tiene que ir revisando OT por OT-. El cliente
--   fue explícito en que esto pasa por DOS caminos distintos, y ambos
--   deben avisar igual: (1) un repuesto agregado a mano en la ficha de la
--   OT (formulario libre, o el catálogo de servicios del Bloque de
--   precios), y (2) un repuesto agregado directamente en ClickUp por el
--   taller (`reconciliarChecklists` en clickup-webhook, cuando el jefe de
--   taller suma un ítem al checklist "Repuestos" que el CRM no conocía
--   todavía). En vez de enganchar la notificación a cada uno de esos
--   puntos del código por separado, se usa un trigger en `ot_detalle`
--   -el único lugar por el que pasan los tres orígenes (manual, catálogo,
--   ClickUp) sin excepción, ya que RLS/service_role no afecta a triggers-.
-- =============================================================================

alter table public.notificaciones add column if not exists ot_detalle_id uuid references public.ot_detalle (id) on delete cascade;

comment on column public.notificaciones.ot_detalle_id is 'Ítem puntual de ot_detalle que originó la notificación (tipo=repuesto_pendiente_presupuesto). on delete cascade: si se elimina el ítem, la notificación deja de tener sentido.';

alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'presupuesto_pendiente', 'encuesta_negativa', 'cita_nueva',
  'listo_para_entrega', 'compra_reptos_pendiente', 'whatsapp_desconectado',
  'repuesto_pendiente_presupuesto'
));

-- ---------------------------------------------------------------------------
-- Se crea al agregar un repuesto sin precio y que el cliente no trae por su
-- cuenta (provisto_por_cliente=false, ver 0015_clickup_estados_avanzados.sql
-- -esos nunca se valorizan, no tiene sentido avisar de ellos-).
-- ---------------------------------------------------------------------------
create or replace function public.notificar_repuesto_pendiente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa_id uuid;
begin
  select empresa_id into v_empresa_id from public.trabajos_taller where id = new.trabajo_id;

  insert into public.notificaciones (empresa_id, tipo, trabajo_id, ot_detalle_id, roles_destino, titulo, mensaje)
  values (
    v_empresa_id, 'repuesto_pendiente_presupuesto', new.trabajo_id, new.id,
    array['encargado_presupuestos'],
    'Repuesto pendiente de presupuesto',
    'Se agregó "' || new.detalle || '" y necesita precio antes de poder presupuestarse.'
  );
  return new;
end;
$$;

drop trigger if exists trg_notificar_repuesto_pendiente on public.ot_detalle;
create trigger trg_notificar_repuesto_pendiente
  after insert on public.ot_detalle
  for each row
  when (new.area = 'repuestos' and new.provisto_por_cliente = false and new.precio_unitario is null)
  execute function public.notificar_repuesto_pendiente();

-- ---------------------------------------------------------------------------
-- Se resuelve sola cuando el ítem deja de estar "pendiente de precio": se
-- le puso precio, o resultó ser un repuesto que trae el cliente. Trigger de
-- UPDATE aparte (no INSERT OR UPDATE combinado): referenciar OLD en un
-- trigger de INSERT revienta en PL/pgSQL, mismo gotcha ya evitado en
-- 0031_notificaciones.sql.
-- ---------------------------------------------------------------------------
create or replace function public.limpiar_notificacion_repuesto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.precio_unitario is null and old.provisto_por_cliente = false
     and (new.precio_unitario is not null or new.provisto_por_cliente = true) then
    delete from public.notificaciones where ot_detalle_id = new.id and tipo = 'repuesto_pendiente_presupuesto';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_limpiar_notificacion_repuesto on public.ot_detalle;
create trigger trg_limpiar_notificacion_repuesto
  after update on public.ot_detalle
  for each row
  when (new.area = 'repuestos')
  execute function public.limpiar_notificacion_repuesto();

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'notificaciones' and column_name = 'ot_detalle_id') as columna_esperado_1,
  (select count(*) from pg_trigger where tgname in ('trg_notificar_repuesto_pendiente', 'trg_limpiar_notificacion_repuesto')) as triggers_esperado_2;
