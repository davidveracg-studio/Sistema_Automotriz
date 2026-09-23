-- =============================================================================
-- 0013_punto_venta.sql
--
-- Qué resuelve:
--   Punto de venta: venta libre en el mostrador, sin pasar por Nuevo
--   Ingreso ni crear una OT -pedido explícito del cliente, no parte del
--   spec original-. Dos tipos de línea:
--     - "servicio": texto libre con precio (ej. una revisión puntual,
--       inflar neumáticos, un servicio rápido de mostrador). No pasa por
--       el catálogo de 313 servicios del spec (nunca se construyó como
--       tabla estructurada en ningún bloque; esto sigue el mismo patrón de
--       texto libre que ya usa ot_detalle.detalle) ni crea trabajos_taller.
--     - "producto": vinculado al catálogo de Bodega (Bloque 10). Descuenta
--       stock de inmediato al agregar el ítem -no al cerrar la venta-,
--       porque una venta de mostrador es instantánea: el producto sale de
--       la bodega en el momento, no después. Se puede corregir un ítem
--       agregado por error borrándolo MIENTRAS la venta sigue "abierta"
--       -eso repone el stock-; una vez "cerrada" (cobrada), la venta queda
--       fija, mismo criterio que una OT "entregada".
--
--   No hay precio de lista: el cajero escribe el precio de venta a mano en
--   cada línea, igual que ot_detalle -no existe (todavía) un catálogo de
--   precios estructurado en este proyecto, y agregarlo solo para esto sería
--   sobre-construir-.
--
--   Sin manejo de pago real (monto recibido, vuelto, método de pago): el
--   sistema solo registra el número de documento que emite Dimasoft, mismo
--   patrón que el cierre de OT desde el Bloque 5. Dimasoft sigue siendo el
--   único facturador.
-- =============================================================================

-- movimientos_stock (Bloque 10) necesita un motivo nuevo para esto. No se
-- puede agregar un valor a un CHECK con ALTER ... ADD CHECK sin antes
-- quitar el viejo.
alter table public.movimientos_stock drop constraint if exists movimientos_stock_motivo_check;
alter table public.movimientos_stock add constraint movimientos_stock_motivo_check
  check (motivo in ('compra', 'uso_ot', 'ajuste', 'devolucion', 'venta'));

create table if not exists public.ventas_directas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  cliente_id uuid references public.clientes (id),
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada', 'anulada')),
  numero_documento_facturacion text,
  creado_por uuid references public.usuarios (id),
  creado_en timestamptz not null default now(),
  cerrada_en timestamptz
);

comment on table public.ventas_directas is 'Venta de mostrador sin OT: servicios rápidos o productos de bodega como venta libre.';
comment on column public.ventas_directas.cliente_id is 'Opcional: una venta de mostrador no siempre necesita identificar al cliente.';

create index if not exists ventas_directas_empresa_idx on public.ventas_directas (empresa_id, creado_en desc);

create table if not exists public.ventas_directas_detalle (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas_directas (id) on delete restrict,
  tipo text not null check (tipo in ('servicio', 'producto')),
  producto_id uuid references public.productos (id),
  detalle text not null,
  cantidad numeric(10, 2) not null default 1 check (cantidad > 0),
  precio_unitario numeric(12, 2) not null check (precio_unitario >= 0),
  total_linea numeric(12, 2) generated always as (round(cantidad * precio_unitario, 2)) stored,
  creado_en timestamptz not null default now(),
  constraint chk_ventas_detalle_producto_segun_tipo check ((tipo = 'producto') = (producto_id is not null))
);

comment on table public.ventas_directas_detalle is 'Líneas de una venta directa. Al insertar una línea "producto" se descuenta stock de inmediato (trigger); al borrarla mientras la venta sigue abierta, se repone.';

create index if not exists ventas_directas_detalle_venta_idx on public.ventas_directas_detalle (venta_id);

-- ---------------------------------------------------------------------------
-- Descuenta/repone stock. Reutiliza movimientos_stock (Bloque 10), motivo
-- 'venta', igual que descontar_stock_al_verificar reutiliza el mismo
-- mecanismo para repuestos usados en una OT -un solo lugar mantiene
-- stock_actual al día, sin importar el origen del movimiento-.
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_venta_directa_detalle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tipo = 'producto' then
    insert into public.movimientos_stock (empresa_id, producto_id, cantidad, motivo, referencia, creado_por)
    select v.empresa_id, new.producto_id, -new.cantidad, 'venta', 'Venta directa ' || new.venta_id, v.creado_por
    from public.ventas_directas v
    where v.id = new.venta_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ventas_directas_detalle_insert on public.ventas_directas_detalle;
create trigger trg_ventas_directas_detalle_insert
  after insert on public.ventas_directas_detalle
  for each row execute function public.aplicar_venta_directa_detalle();

create or replace function public.reponer_venta_directa_detalle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.tipo = 'producto' then
    insert into public.movimientos_stock (empresa_id, producto_id, cantidad, motivo, referencia, creado_por)
    select v.empresa_id, old.producto_id, old.cantidad, 'venta', 'Reverso venta directa ' || old.venta_id, v.creado_por
    from public.ventas_directas v
    where v.id = old.venta_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_ventas_directas_detalle_delete on public.ventas_directas_detalle;
create trigger trg_ventas_directas_detalle_delete
  after delete on public.ventas_directas_detalle
  for each row execute function public.reponer_venta_directa_detalle();

-- ---------------------------------------------------------------------------
-- RLS. Mismo criterio de "1 · RECEPCIÓN" que ya se usó para citas (Bloque
-- 8): asesor y recepcionista son quienes atienden el mostrador, más
-- admin/socia. No se restringe a tiene_acceso_montos() -esa protección es
-- sobre costo/margen interno de una OT en negociación; acá el precio de
-- venta es justamente lo que el mostrador necesita poder escribir-.
-- ---------------------------------------------------------------------------
alter table public.ventas_directas enable row level security;
alter table public.ventas_directas_detalle enable row level security;

drop policy if exists ventas_directas_select on public.ventas_directas;
create policy ventas_directas_select on public.ventas_directas
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists ventas_directas_insert on public.ventas_directas;
create policy ventas_directas_insert on public.ventas_directas
  for insert with check (
    empresa_id = public.mi_empresa_id()
    and (public.es_asesor() or public.es_recepcionista() or public.es_admin() or public.es_socia())
  );

drop policy if exists ventas_directas_update on public.ventas_directas;
create policy ventas_directas_update on public.ventas_directas
  for update using (
    empresa_id = public.mi_empresa_id()
    and (public.es_asesor() or public.es_recepcionista() or public.es_admin() or public.es_socia())
  )
  with check (empresa_id = public.mi_empresa_id());

drop policy if exists ventas_directas_detalle_select on public.ventas_directas_detalle;
create policy ventas_directas_detalle_select on public.ventas_directas_detalle
  for select using (exists (
    select 1 from public.ventas_directas v
    where v.id = ventas_directas_detalle.venta_id and v.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists ventas_directas_detalle_insert on public.ventas_directas_detalle;
create policy ventas_directas_detalle_insert on public.ventas_directas_detalle
  for insert with check (
    (public.es_asesor() or public.es_recepcionista() or public.es_admin() or public.es_socia())
    and exists (
      select 1 from public.ventas_directas v
      where v.id = venta_id and v.empresa_id = public.mi_empresa_id() and v.estado = 'abierta'
    )
  );

-- Solo se puede borrar una línea mientras la venta sigue abierta -una vez
-- cobrada queda fija, mismo criterio que una OT entregada-.
drop policy if exists ventas_directas_detalle_delete on public.ventas_directas_detalle;
create policy ventas_directas_detalle_delete on public.ventas_directas_detalle
  for delete using (
    (public.es_asesor() or public.es_recepcionista() or public.es_admin() or public.es_socia())
    and exists (
      select 1 from public.ventas_directas v
      where v.id = venta_id and v.empresa_id = public.mi_empresa_id() and v.estado = 'abierta'
    )
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select relrowsecurity from pg_class where relname = 'ventas_directas') as rls_ventas_directas_esperado_true,
  (select relrowsecurity from pg_class where relname = 'ventas_directas_detalle') as rls_ventas_directas_detalle_esperado_true,
  (select count(*) from pg_proc where proname in ('aplicar_venta_directa_detalle', 'reponer_venta_directa_detalle')) as funciones_esperado_2,
  (select count(*) from pg_constraint where conname = 'movimientos_stock_motivo_check') as constraint_motivo_esperado_1;
