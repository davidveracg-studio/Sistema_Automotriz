-- =============================================================================
-- 0076_proteger_columnas_ot_detalle.sql
--
-- Hallazgo H1 de las pruebas de aislamiento (FASE0.md, WP0.2):
--   El REVOKE de columna de 0006 (costo_unitario, precio_unitario, total_linea)
--   NO tenía efecto. En Postgres, quitar el SELECT de una columna no sirve si el
--   rol conserva SELECT sobre la tabla entera, y `authenticated` lo conserva
--   (privilegios por defecto de Supabase). Resultado: un rol sin acceso a montos
--   (p. ej. técnico) podía leer costos y precios directo por la API
--   (/rest/v1/ot_detalle?select=costo_unitario,...) aunque la interfaz usara la
--   vista ot_detalle_con_permiso, que los redacta.
--
-- Qué hace esta migración:
--   1. Crea la vista ot_detalle_montos_v, la ÚNICA vía de lectura de los montos.
--      Se ejecuta con los permisos de su dueño (security_invoker = false), por lo
--      que puede leer las columnas protegidas, y por eso se acota ella misma:
--        - solo devuelve líneas de la empresa de quien consulta (la misma regla de
--          la política de lectura de ot_detalle: trabajo -> empresa_id =
--          mi_empresa_id());
--        - redacta cada monto según el permiso de quien consulta
--          (tiene_acceso_montos / tiene_acceso_precio_venta).
--      Los permisos y la empresa se evalúan UNA vez por consulta (subconsulta
--      escalar), no por fila: una función por fila costaba ~200 veces más.
--   2. Redefine ot_detalle_con_permiso para leer los montos de esa vista,
--      conservando security_invoker = true: filas visibles, hallazgo y producto
--      siguen gobernados por RLS con el usuario que consulta. Mismas columnas,
--      mismos nombres, tipos y orden.
--   3. Quita el SELECT de TABLA a authenticated y le concede SELECT solo sobre las
--      columnas NO protegidas (se calculan del catálogo, así no hay que
--      listarlas a mano).
--
-- Qué NO cambia: las escrituras. INSERT, UPDATE y DELETE conservan sus
-- privilegios y políticas, y el disparador impedir_precio_sin_acceso_montos
-- sigue impidiendo que quien no tiene acceso cargue o cambie costos y precios.
-- Se verificó que el frontend (src/) y las Edge Functions leen de ot_detalle solo
-- columnas no protegidas (o usan la vista, o la clave de service role), que no se
-- pide RETURNING de columnas protegidas, y que todo disparador o función que toca
-- esas columnas es SECURITY DEFINER.
--
-- Sobre la vista con permisos del dueño: no usa security_barrier porque impediría
-- aplicar el filtro por id/trabajo_id antes de leer, y la API solo permite filtros
-- con operadores incorporados (no funciones del usuario), que no filtran datos.
--
-- ATENCIÓN para quien agregue columnas a ot_detalle: una columna nueva NO será
-- legible por authenticated hasta que se conceda explícitamente:
--     grant select (nueva_columna) on public.ot_detalle to authenticated;
-- (y, si procede, exponerla en la vista). Las pruebas de aislamiento
-- (supabase/tests/aislamiento) fallan si queda una columna sin conceder.
--
-- Cómo deshacerlo:
--     grant select on public.ot_detalle to authenticated;
--   y volver a la definición anterior de ot_detalle_con_permiso, que leía
--   d.costo_unitario, d.precio_unitario y d.total_linea directamente con
--   CASE tiene_acceso_*(); después, drop view public.ot_detalle_montos_v;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Montos de las líneas, acotados a la empresa y redactados por permiso.
-- ---------------------------------------------------------------------------
create or replace view public.ot_detalle_montos_v
with (security_invoker = false) as
select
  d.id,
  case when (select public.tiene_acceso_montos()) then d.costo_unitario end as costo_unitario,
  case when (select public.tiene_acceso_precio_venta()) then d.precio_unitario end as precio_unitario,
  case when (select public.tiene_acceso_precio_venta()) then d.total_linea end as total_linea
from public.ot_detalle d
join public.trabajos_taller t on t.id = d.trabajo_id
where t.empresa_id = (select public.mi_empresa_id());

comment on view public.ot_detalle_montos_v is
  'Costo, precio y total de las líneas de OT de la empresa de quien consulta, redactados según su permiso. Única vía de lectura de esas columnas (0076).';

revoke all on public.ot_detalle_montos_v from public, anon, authenticated;
grant select on public.ot_detalle_montos_v to authenticated;

-- ---------------------------------------------------------------------------
-- 2. La vista de lectura obtiene los montos de la vista anterior.
-- ---------------------------------------------------------------------------
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
  m.costo_unitario,
  m.precio_unitario,
  m.total_linea,
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
left join public.ot_detalle_montos_v m on m.id = d.id
left join public.radar_hallazgos h on h.id = d.hallazgo_radar_id
left join public.productos p on p.id = d.producto_id;

-- ---------------------------------------------------------------------------
-- 3. Privilegios: SELECT solo sobre las columnas no protegidas.
--    Se hace DESPUÉS de redefinir la vista (que ya no lee las protegidas).
-- ---------------------------------------------------------------------------
revoke select on public.ot_detalle from authenticated, anon;

do $$
declare
  v_columnas text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_columnas
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ot_detalle'
    and column_name not in ('costo_unitario', 'precio_unitario', 'total_linea');

  execute format('grant select (%s) on public.ot_detalle to authenticated', v_columnas);
end $$;
