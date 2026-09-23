-- =============================================================================
-- 0015_clickup_estados_avanzados.sql
--
-- Qué resuelve:
--   El cliente detalló el resto del flujo real de estados de ClickUp
--   después de "agenda"/"POR DESIGNAR" (2026-09-15): EN REPARACIÓN, EN REP.
--   SERVICIO EXTERNO, COMPRA REPTOS, ESPERA REPTOS (CLIENTE), PINTURA/
--   DESABOLLADURA, PRUEBA EN RUTA, RETROCESO, LAVADO, ALINEACIÓN, LISTO
--   PARA ENTREGA, COMPLETADAS. De ahí surgieron tres necesidades concretas:
--
--   1. RETROCESO = el concepto de "retrabajo" que ya mide calidad por
--      técnico (Bloque 9), visto desde el lado de ClickUp. Cuando el jefe
--      de taller mueve una tarjeta a RETROCESO, hay que vincularla
--      automáticamente a la OT original del mismo vehículo si se puede
--      identificar con certeza (la más reciente ya entregada).
--   2. "ESPERA REPTOS (CLIENTE)": repuestos que trae el cliente, que se
--      registran en la OT pero nunca se valorizan. Necesita un campo
--      explícito -no alcanza con dejar el precio en blanco, porque eso es
--      indistinguible de "todavía no se ha valorizado"-.
--   3. "LISTO PARA ENTREGA": el asesor necesita un aviso activo, no solo
--      que el dato quede reflejado en algún lado a la espera de que
--      alguien lo revise. Para detectar la TRANSICIÓN (y no reenviar el
--      aviso en cada evento mientras la tarjeta sigue en ese estado) hace
--      falta guardar el último estado de ClickUp conocido.
-- =============================================================================

alter table public.trabajos_taller
  add column if not exists clickup_estado_actual text;

comment on column public.trabajos_taller.clickup_estado_actual is 'Último estado de ClickUp reconciliado (texto tal cual lo entrega la API, normalizado a minúsculas). Sirve para detectar transiciones -ej. aviso de "listo para entrega"- sin reenviar en cada evento mientras la tarjeta sigue en el mismo estado.';

alter table public.ot_detalle
  add column if not exists provisto_por_cliente boolean not null default false;

comment on column public.ot_detalle.provisto_por_cliente is 'El repuesto/insumo lo trae el cliente (ClickUp: "ESPERA REPTOS (CLIENTE)"). Se registra en la OT pero nunca se valoriza -costo/precio quedan sin sentido para esta línea-.';

-- ot_detalle_con_permiso (Bloques 5/6/10) se extiende de nuevo: la columna
-- nueva va al final, mismo gotcha ya documentado varias veces (42P16 si se
-- inserta en medio).
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
  case when public.tiene_acceso_montos() then d.precio_unitario end as precio_unitario,
  case when public.tiene_acceso_montos() then d.total_linea end as total_linea,
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

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'trabajos_taller' and column_name = 'clickup_estado_actual') as columna_clickup_estado_esperado_1,
  (select count(*) from information_schema.columns where table_name = 'ot_detalle' and column_name = 'provisto_por_cliente') as columna_provisto_cliente_esperado_1,
  (select count(*) from information_schema.columns where table_name = 'ot_detalle_con_permiso' and column_name = 'provisto_por_cliente') as vista_provisto_cliente_esperado_1;
