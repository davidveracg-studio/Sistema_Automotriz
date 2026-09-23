-- =============================================================================
-- 0012_bodega.sql
--
-- Qué resuelve:
--   Bloque 10 (Bodega), etapa 1. El spec marca este bloque como "el más
--   grande del proyecto, conviene dividirlo en etapas" y deja su alcance
--   explícitamente sin definir -a diferencia de los demás bloques, no tiene
--   sección propia en el spec-. Alcance de la etapa 1, acordado con el
--   cliente el 2026-09-14:
--     - Los tres problemas a la vez: no hay visibilidad de stock real, los
--       repuestos de la OT no descuentan inventario, y las compras a
--       proveedores no quedan registradas.
--     - Una sola bodega física (no hay múltiples ubicaciones todavía).
--     - Conectado a la OT desde el día 1 (no como etapa separada): al
--       marcar un ítem de repuestos/lubricantes e insumos como verificado,
--       descuenta stock automáticamente si está vinculado a un producto del
--       catálogo.
--
--   Fuera de esta etapa a propósito (para no sobre-construir el módulo más
--   grande del spec de una sola vez): múltiples bodegas/ubicaciones, código
--   de barras, órdenes de compra con flujo de aprobación, costeo FIFO/
--   promedio ponderado (se usa "último costo conocido", más simple), y
--   alertas automáticas por correo/WhatsApp de stock bajo (la pantalla sí
--   muestra el aviso visual).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Proveedores: catálogo simple, alimenta las entradas de stock por compra.
-- ---------------------------------------------------------------------------
create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nombre text not null,
  contacto text,
  telefono text,
  email text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint uq_proveedores_nombre unique (empresa_id, nombre)
);

comment on table public.proveedores is 'Catálogo de proveedores de repuestos/insumos. Bloque 10, etapa 1.';

-- ---------------------------------------------------------------------------
-- Productos: el catálogo de bodega. stock_actual y costo_promedio los
-- mantiene el trigger de movimientos_stock -nunca se editan a mano
-- directamente, mismo criterio que total_linea en ot_detalle (Bloque 4):
-- un valor calculado no se confía al frontend-.
-- ---------------------------------------------------------------------------
create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  codigo text,
  nombre text not null,
  categoria text,
  unidad_medida text not null default 'unidad',
  costo_promedio numeric(12, 2) check (costo_promedio is null or costo_promedio >= 0),
  stock_actual numeric(12, 2) not null default 0,
  stock_minimo numeric(12, 2) not null default 0 check (stock_minimo >= 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint uq_productos_nombre unique (empresa_id, nombre),
  constraint uq_productos_codigo unique (empresa_id, codigo)
);

comment on table public.productos is 'Catálogo de bodega (repuestos/insumos con control de stock). Bloque 10, etapa 1.';
comment on column public.productos.costo_promedio is 'Último costo unitario conocido de una entrada, no promedio ponderado -se simplifica a propósito en esta etapa-. Lo actualiza el trigger de movimientos_stock.';
comment on column public.productos.stock_actual is 'Mantenido por el trigger aplicar_movimiento_stock(). No editar directamente: registrar un movimiento de ajuste en su lugar, para no perder la trazabilidad de por qué cambió.';

create index if not exists productos_empresa_idx on public.productos (empresa_id) where activo;

drop trigger if exists trg_productos_actualizado_en on public.productos;
create trigger trg_productos_actualizado_en
  before update on public.productos
  for each row execute function public.actualizar_marca_de_tiempo();

-- ---------------------------------------------------------------------------
-- Movimientos de stock: toda entrada/salida/ajuste queda trazada, nunca se
-- toca stock_actual directo. cantidad positiva = entrada, negativa = salida
-- -el signo ES la dirección, no una columna de tipo aparte-.
-- ---------------------------------------------------------------------------
create table if not exists public.movimientos_stock (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  producto_id uuid not null references public.productos (id) on delete restrict,
  cantidad numeric(12, 2) not null check (cantidad <> 0),
  costo_unitario numeric(12, 2) check (costo_unitario is null or costo_unitario >= 0),
  motivo text not null check (motivo in ('compra', 'uso_ot', 'ajuste', 'devolucion')),
  proveedor_id uuid references public.proveedores (id),
  ot_detalle_id uuid references public.ot_detalle (id),
  referencia text,
  creado_por uuid references public.usuarios (id),
  creado_en timestamptz not null default now()
);

comment on table public.movimientos_stock is 'Historial de entradas/salidas/ajustes de stock. cantidad positiva = entrada, negativa = salida. Bloque 10, etapa 1.';
comment on column public.movimientos_stock.referencia is 'Texto libre: N° de factura del proveedor, o el motivo de un ajuste manual.';

create index if not exists movimientos_stock_producto_idx on public.movimientos_stock (producto_id, creado_en desc);
create index if not exists movimientos_stock_empresa_idx on public.movimientos_stock (empresa_id, creado_en desc);

create or replace function public.aplicar_movimiento_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.productos
  set stock_actual = stock_actual + new.cantidad,
      costo_promedio = coalesce(new.costo_unitario, costo_promedio)
  where id = new.producto_id;
  return new;
end;
$$;

drop trigger if exists trg_movimientos_stock_aplicar on public.movimientos_stock;
create trigger trg_movimientos_stock_aplicar
  after insert on public.movimientos_stock
  for each row execute function public.aplicar_movimiento_stock();

-- ---------------------------------------------------------------------------
-- Conexión con la OT desde el día 1: ot_detalle.producto_id es el vínculo
-- opcional al catálogo -sigue existiendo el texto libre de siempre para
-- ítems que no ameritan catalogarse-. Al marcar verificado (que ya existe
-- desde el Bloque 4: "si ya se compró/confirmó", espejo del resolved de
-- ClickUp) se descuenta stock automáticamente, una sola vez -se dispara
-- solo en la transición false→true, nunca en otros cambios del ítem, para
-- no descontar dos veces si se edita otra columna después-.
-- ---------------------------------------------------------------------------
alter table public.ot_detalle add column if not exists producto_id uuid references public.productos (id);

comment on column public.ot_detalle.producto_id is 'Vínculo opcional al catálogo de bodega (solo áreas repuestos/lubricantes_insumos). Si está seteado y el ítem pasa a verificado=true, descuenta stock automáticamente.';

create or replace function public.descontar_stock_al_verificar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verificado = true and old.verificado = false
     and new.producto_id is not null
     and new.area in ('repuestos', 'lubricantes_insumos') then
    insert into public.movimientos_stock (empresa_id, producto_id, cantidad, motivo, ot_detalle_id, creado_por)
    select t.empresa_id, new.producto_id, -new.cantidad, 'uso_ot', new.id, auth.uid()
    from public.trabajos_taller t
    where t.id = new.trabajo_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ot_detalle_descontar_stock on public.ot_detalle;
create trigger trg_ot_detalle_descontar_stock
  after update on public.ot_detalle
  for each row execute function public.descontar_stock_al_verificar();

comment on function public.descontar_stock_al_verificar is 'Descuenta stock automáticamente cuando un ítem de repuestos/insumos vinculado al catálogo se marca verificado. Solo en la transición false→true.';

-- ot_detalle_con_permiso (Bloque 5/6) no hereda columnas nuevas de la tabla
-- base: hay que agregar producto_id a mano. Se agrega AL FINAL de la lista
-- de columnas -nunca en medio-, mismo gotcha real que documentó el Bloque 6
-- (CREATE OR REPLACE VIEW rechaza con 42P16 si una columna nueva desplaza a
-- las que ya existen). Se trae también el nombre/stock del producto vía
-- join, en vez de depender del embedding automático de PostgREST sobre una
-- vista -no siempre detecta la relación igual que con una tabla real-.
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
  p.unidad_medida as producto_unidad_medida
from public.ot_detalle d
left join public.radar_hallazgos h on h.id = d.hallazgo_radar_id
left join public.productos p on p.id = d.producto_id;

-- ---------------------------------------------------------------------------
-- RLS. Lectura abierta a cualquiera activo de la empresa (igual que
-- clientes/vehículos: cualquiera necesita poder ver qué hay en bodega).
-- Escritura -incluye costos- restringida a tiene_acceso_montos(), mismo rol
-- que ya decide precios en ot_detalle desde el Bloque 5.
-- ---------------------------------------------------------------------------
alter table public.proveedores enable row level security;
alter table public.productos enable row level security;
alter table public.movimientos_stock enable row level security;

drop policy if exists proveedores_select on public.proveedores;
create policy proveedores_select on public.proveedores
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists proveedores_insert on public.proveedores;
create policy proveedores_insert on public.proveedores
  for insert with check (empresa_id = public.mi_empresa_id() and public.tiene_acceso_montos());

drop policy if exists proveedores_update on public.proveedores;
create policy proveedores_update on public.proveedores
  for update using (empresa_id = public.mi_empresa_id() and public.tiene_acceso_montos())
  with check (empresa_id = public.mi_empresa_id());

drop policy if exists productos_select on public.productos;
create policy productos_select on public.productos
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists productos_insert on public.productos;
create policy productos_insert on public.productos
  for insert with check (empresa_id = public.mi_empresa_id() and public.tiene_acceso_montos());

drop policy if exists productos_update on public.productos;
create policy productos_update on public.productos
  for update using (empresa_id = public.mi_empresa_id() and public.tiene_acceso_montos())
  with check (empresa_id = public.mi_empresa_id());

drop policy if exists movimientos_stock_select on public.movimientos_stock;
create policy movimientos_stock_select on public.movimientos_stock
  for select using (empresa_id = public.mi_empresa_id() and public.tiene_acceso_montos());

drop policy if exists movimientos_stock_insert on public.movimientos_stock;
create policy movimientos_stock_insert on public.movimientos_stock
  for insert with check (empresa_id = public.mi_empresa_id() and public.tiene_acceso_montos());

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select relrowsecurity from pg_class where relname = 'proveedores') as rls_proveedores_esperado_true,
  (select relrowsecurity from pg_class where relname = 'productos') as rls_productos_esperado_true,
  (select relrowsecurity from pg_class where relname = 'movimientos_stock') as rls_movimientos_esperado_true,
  (select count(*) from information_schema.columns where table_name = 'ot_detalle' and column_name = 'producto_id') as columna_producto_id_esperado_1,
  (select count(*) from information_schema.columns where table_name = 'ot_detalle_con_permiso' and column_name = 'producto_id') as vista_producto_id_esperado_1,
  (select count(*) from pg_proc where proname in ('aplicar_movimiento_stock', 'descontar_stock_al_verificar')) as funciones_esperado_2;
