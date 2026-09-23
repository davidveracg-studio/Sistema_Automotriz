-- =============================================================================
-- 0019_precio_venta_asesor.sql
--
-- Qué resuelve:
--   El cliente recordó una regla de negocio central que el módulo de
--   Presupuestos de ayer no respetaba: "el asesor es el único que tiene
--   contacto con el cliente en todo momento. Él envía y negocia los
--   presupuestos". Hoy `tiene_acceso_montos()` (Bloque 5) agrupa costo Y
--   precio de venta en un solo permiso, y el asesor queda fuera de los dos
--   -correcto para el costo/margen (nunca debe verlo), pero un problema real
--   para el precio de venta: no puede negociar un número que no ve-.
--
--   Se separa en dos niveles: `tiene_acceso_montos()` sigue siendo el único
--   que ve COSTO (margen, nunca para el asesor); `tiene_acceso_precio_venta()`
--   es nuevo y agrega al asesor para ver PRECIO/TOTAL (lo que se le cobra al
--   cliente, no lo que cuesta). La escritura de costo/precio en ot_detalle
--   sigue exigiendo tiene_acceso_montos() sin cambios -el asesor sigue sin
--   poder fijar precios, solo verlos-.
--
--   También se habilita que el asesor pueda cambiar el estado de un
--   presupuesto (aceptado/parcial/rechazado) -es él quien recibe la
--   respuesta real del cliente tras negociar, no el encargado de
--   presupuestos-. Generar el presupuesto (insert) sigue siendo tarea
--   exclusiva del encargado de presupuestos/admin/socia/jefe_taller.
-- =============================================================================

create or replace function public.tiene_acceso_precio_venta()
returns boolean language sql stable security definer set search_path = public
as $$
  select public.tiene_acceso_montos() or public.auth_rol() = 'asesor';
$$;

comment on function public.tiene_acceso_precio_venta is 'Quién ve precio_unitario/total_linea (lo que se cobra al cliente): el mismo grupo de tiene_acceso_montos() más el asesor -que negocia el precio con el cliente pero nunca debe ver costo/margen-.';

-- ot_detalle_con_permiso: mismo listado de columnas que 0015 (nunca se
-- reordena, gotcha ya documentado), solo cambia el predicado de precio y
-- total_linea de tiene_acceso_montos() a tiene_acceso_precio_venta().
create or replace view public.ot_detalle_con_permiso
with (security_invoker = true) as
select
  d.id,
  d.trabajo_id,
  d.area,
  d.tarea_taller_id,
  d.codigo,
  d.detalle,
  d.cantidad,
  case when public.tiene_acceso_montos() then d.costo_unitario end as costo_unitario,
  case when public.tiene_acceso_precio_venta() then d.precio_unitario end as precio_unitario,
  case when public.tiene_acceso_precio_venta() then d.total_linea end as total_linea,
  d.verificado,
  d.responsable_id,
  d.decision,
  d.motivo_rechazo,
  d.fecha_postergado,
  d.presupuesto_id,
  d.clickup_checklist_item_id,
  d.creado_en,
  d.actualizado_en,
  d.hallazgo_radar_id,
  h.precio_referencial as hallazgo_precio_referencial,
  d.producto_id,
  p.nombre as producto_nombre,
  p.stock_actual as producto_stock_actual,
  p.unidad_medida as producto_unidad_medida,
  d.provisto_por_cliente
from public.ot_detalle d
left join public.radar_hallazgos h on h.id = d.hallazgo_radar_id
left join public.productos p on p.id = d.producto_id;

-- presupuestos_taller: el asesor puede actualizar (estado/fecha_respuesta al
-- marcar la respuesta del cliente), pero no crear presupuestos nuevos -el
-- insert sigue exigiendo tiene_acceso_montos() sin cambios-.
drop policy if exists presupuestos_taller_update on public.presupuestos_taller;
create policy presupuestos_taller_update on public.presupuestos_taller
  for update using (
    (public.tiene_acceso_montos() or public.auth_rol() = 'asesor')
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = presupuestos_taller.trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'tiene_acceso_precio_venta') as funcion_esperado_1,
  (select count(*) from information_schema.columns where table_name = 'ot_detalle_con_permiso') as columnas_vista_esperado_26;
