-- =============================================================================
-- 0020_egreso_vehiculo.sql
--
-- Qué resuelve:
--   El cliente compartió los dos papeles reales que se entregan al retirar
--   el vehículo: "Egreso del Vehículo" (quién retira, garantías, hora de
--   salida, firma) y "Orden de Trabajo" cerrada (mano de obra/repuestos
--   /insumos con su total). Pidió que se combinen en un solo documento
--   ("Orden de Egreso") que se emite al cerrar y cobrar la OT, más:
--   1. Tipo de documento (boleta/factura) junto al número -se omite si se
--      cierra sin documento-.
--   2. Un círculo azul/verde según el cliente sea empresa o particular.
--   3. Si la factura queda pendiente de pago, registro en un módulo nuevo
--      de Cuentas por Cobrar.
--
--   Decisiones tomadas con el cliente antes de construir:
--   - El documento que recibe el cliente NUNCA muestra costo (solo
--     cantidad/precio/total) -el papel de referencia sí lo mostraba, pero
--     eso filtraría el margen del taller; se omite a propósito-.
--   - Solo la FACTURA puede quedar "pendiente" (cuentas por cobrar); la
--     boleta se considera pagada al momento de cerrar -venta al contado-.
--   - El vencimiento de una factura pendiente se pide a mano (fecha
--     puntual), no un plazo fijo de días -puede variar por cliente-.
--
--   `egresos_vehiculo` es una tabla nueva (no columnas sueltas en
--   `trabajos_taller`) siguiendo el mismo patrón que `inspecciones_ingreso`:
--   un registro por OT, en un momento puntual del ciclo de vida (acá, el
--   cierre), con su propia firma. Los campos de pago (tipo_documento,
--   estado_pago, vencimiento, fecha de pago) sí van en `trabajos_taller`,
--   junto a `numero_documento_facturacion` que ya vivía ahí desde el
--   Bloque 5 -mismo criterio: son estado del negocio de la OT, no del
--   papel físico-.
-- =============================================================================

alter table public.trabajos_taller
  add column if not exists tipo_documento text check (tipo_documento is null or tipo_documento in ('boleta', 'factura'));

alter table public.trabajos_taller
  add column if not exists estado_pago text check (estado_pago is null or estado_pago in ('pagado', 'pendiente'));

alter table public.trabajos_taller
  add column if not exists fecha_vencimiento_pago date;

alter table public.trabajos_taller
  add column if not exists fecha_pago timestamptz;

comment on column public.trabajos_taller.tipo_documento is 'Boleta o factura emitida al cerrar. NULL = se cerró sin documento -el comprobante de egreso omite esta sección-.';
comment on column public.trabajos_taller.estado_pago is 'Solo aplica con tipo_documento = factura (la boleta se considera pagada al cerrar). "pendiente" = aparece en Cuentas por Cobrar hasta que se marque pagada.';
comment on column public.trabajos_taller.fecha_vencimiento_pago is 'Solo para factura pendiente: fecha límite de pago acordada, cargada a mano (no hay plazo fijo único).';

create table if not exists public.egresos_vehiculo (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references public.trabajos_taller (id) on delete restrict,
  retirado_por_nombre text,
  retirado_por_rut text,
  retirado_por_contacto text,
  comentario text,
  observaciones_cierre text,
  firma_png text,
  firmado_en timestamptz,
  creado_en timestamptz not null default now(),
  constraint uq_egresos_vehiculo_trabajo unique (trabajo_id)
);

comment on table public.egresos_vehiculo is 'Comprobante de egreso del vehículo: quién retira (puede no ser el cliente registrado), comentarios de cierre y firma. Una fila por OT, al momento de la entrega.';
comment on column public.egresos_vehiculo.retirado_por_nombre is 'Quien retira hoy -puede ser distinto al cliente registrado (ej. un conductor)-, mismo criterio que rol_persona_presente del ingreso.';

create index if not exists egresos_vehiculo_trabajo_idx on public.egresos_vehiculo (trabajo_id);

alter table public.egresos_vehiculo enable row level security;

drop policy if exists egresos_vehiculo_select on public.egresos_vehiculo;
create policy egresos_vehiculo_select on public.egresos_vehiculo
  for select
  using (exists (
    select 1 from public.trabajos_taller t
    where t.id = egresos_vehiculo.trabajo_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists egresos_vehiculo_insert on public.egresos_vehiculo;
create policy egresos_vehiculo_insert on public.egresos_vehiculo
  for insert
  with check (
    (public.es_asesor() or public.es_admin() or public.es_socia())
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists egresos_vehiculo_update on public.egresos_vehiculo;
create policy egresos_vehiculo_update on public.egresos_vehiculo
  for update
  using (
    (public.es_asesor() or public.es_admin() or public.es_socia())
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = egresos_vehiculo.trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_name = 'egresos_vehiculo') as tabla_esperado_1,
  (select count(*) from information_schema.columns where table_name = 'trabajos_taller' and column_name in ('tipo_documento', 'estado_pago', 'fecha_vencimiento_pago', 'fecha_pago')) as columnas_trabajos_esperado_4,
  (select relrowsecurity from pg_class where relname = 'egresos_vehiculo') as rls_esperado_true;
