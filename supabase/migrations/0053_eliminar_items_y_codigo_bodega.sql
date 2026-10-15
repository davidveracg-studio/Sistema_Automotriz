-- =============================================================================
-- 0053_eliminar_items_y_codigo_bodega.sql
--
-- Qué resuelve:
--   1. Permite eliminar un ítem de repuestos/lubricantes/servicios externos de
--      una OT (hoy la tabla no tenía policy de DELETE: RLS lo bloqueaba en
--      silencio aunque el botón existiera). Si el ítem ya estaba verificado y
--      vinculado a bodega (el stock ya se había descontado), al eliminarlo se
--      repone el stock automáticamente (movimiento 'devolucion').
--   2. Cuando un ítem de repuestos/lubricantes se vincula a un producto de
--      bodega, ot_detalle.codigo copia solo el código de ese producto
--      -hasta ahora quedaba siempre vacío en los documentos impresos (Orden
--      de Egreso, Presupuesto), porque nada lo llenaba-.
--   El borrado desde ClickUp de un ítem de checklist (Repuestos/Lubricantes/
--   Servicios Rápidos) se maneja en código, en clickup-webhook -no requiere
--   cambios de esquema, se despliega aparte.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Código de bodega automático.
-- ---------------------------------------------------------------------------
create or replace function public.copiar_codigo_producto_ot_detalle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.producto_id is not null then
    select p.codigo into new.codigo from public.productos p where p.id = new.producto_id;
  end if;
  return new;
end;
$$;

comment on function public.copiar_codigo_producto_ot_detalle is 'Copia productos.codigo a ot_detalle.codigo cuando el ítem se vincula a un producto de bodega -el código impreso en los documentos sale de ahí, nunca se escribe a mano.';

drop trigger if exists trg_ot_detalle_codigo_producto on public.ot_detalle;
create trigger trg_ot_detalle_codigo_producto
  before insert or update of producto_id on public.ot_detalle
  for each row execute function public.copiar_codigo_producto_ot_detalle();

-- Los ítems que ya estaban vinculados a un producto antes de este cambio
-- quedan con su código al día -incluidos los de una OT ya entregada: es un
-- respaldo de datos, no una edición manual, así que se hace con el guardia
-- de OT cerrada (0026) desactivado solo para este UPDATE.
alter table public.ot_detalle disable trigger trg_ot_detalle_bloqueo;

update public.ot_detalle d
set codigo = p.codigo
from public.productos p
where d.producto_id = p.id and d.codigo is distinct from p.codigo;

alter table public.ot_detalle enable trigger trg_ot_detalle_bloqueo;

-- ---------------------------------------------------------------------------
-- 2. Eliminar un ítem: falta la policy de DELETE (mismo criterio que insert/
--    update: cualquier rol activo de la empresa; el bloqueo de OT cerrada
--    -0026- lo sigue impidiendo cuando corresponde).
-- ---------------------------------------------------------------------------
drop policy if exists ot_detalle_delete on public.ot_detalle;
create policy ot_detalle_delete on public.ot_detalle
  for delete using (
    public.auth_rol() is not null
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = ot_detalle.trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

-- Para poder borrar un ot_detalle sin romper el historial de stock: el
-- movimiento que quedó registrado pierde el vínculo, no se borra.
alter table public.movimientos_stock drop constraint if exists movimientos_stock_ot_detalle_id_fkey;
alter table public.movimientos_stock
  add constraint movimientos_stock_ot_detalle_id_fkey
  foreign key (ot_detalle_id) references public.ot_detalle (id) on delete set null;

-- Si el ítem ya estaba verificado (su stock ya se había descontado), al
-- eliminarlo se repone -misma cantidad, movimiento 'devolucion'-. BEFORE
-- DELETE: el id de la fila todavía existe cuando se inserta el movimiento.
create or replace function public.reponer_stock_al_eliminar_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.verificado = true and old.producto_id is not null and old.area in ('repuestos', 'lubricantes_insumos') then
    insert into public.movimientos_stock (empresa_id, producto_id, cantidad, motivo, ot_detalle_id, creado_por, referencia)
    select t.empresa_id, old.producto_id, old.cantidad, 'devolucion', old.id, auth.uid(), 'Ítem eliminado de la OT'
    from public.trabajos_taller t
    where t.id = old.trabajo_id;
  end if;
  return old;
end;
$$;

comment on function public.reponer_stock_al_eliminar_item is 'Repone el stock (movimiento devolucion) al eliminar un ítem de repuestos/lubricantes que ya estaba verificado -su stock ya se había descontado en descontar_stock_al_verificar().';

drop trigger if exists trg_ot_detalle_reponer_stock on public.ot_detalle;
create trigger trg_ot_detalle_reponer_stock
  before delete on public.ot_detalle
  for each row execute function public.reponer_stock_al_eliminar_item();

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_policies where tablename = 'ot_detalle' and cmd = 'DELETE') as policy_delete_esperado_1,
  (select count(*) from pg_trigger where tgname in ('trg_ot_detalle_codigo_producto', 'trg_ot_detalle_reponer_stock')) as triggers_esperado_2,
  (select confdeltype from pg_constraint where conname = 'movimientos_stock_ot_detalle_id_fkey') as fk_on_delete_esperado_n,
  (select count(*) from public.ot_detalle where producto_id is not null and codigo is null) as sin_codigo_esperado_0;
