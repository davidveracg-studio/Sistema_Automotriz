-- =============================================================================
-- 0007_radar.sql
--
-- Qué resuelve:
--   Bloque 6: el RADAR del técnico (Tipo A) y la revisión del asesor
--   (Tipo B) son la misma herramienta de venta con dos orígenes distintos
--   -"ambos tipos alimentan el mismo circuito de hallazgos → oportunidades →
--   presupuesto", dice el spec-, así que es UNA tabla de sesión
--   (`radar_inspecciones`) con una columna `origen`, no dos tablas
--   separadas. Eso es lo que permite comparar más adelante cuál de los dos
--   convierte mejor.
--
--   El RADAR "no es un registro técnico: es evidencia física que el asesor
--   le muestra al cliente mientras el auto está arriba" -por eso
--   `radar_hallazgos` guarda un precio REFERENCIAL por hallazgo (el que se
--   muestra con el cliente delante, con el vehículo todavía arriba) y
--   `ot_detalle.hallazgo_radar_id` permite comparar ese precio contra el
--   precio final que ponga el encargado de presupuestos en el Bloque 5: "el
--   sistema avisa si el presupuesto final se aleja demasiado" se resuelve
--   comparando estas dos columnas en el frontend, no duplicando el precio.
--
--   Primer uso real de Storage en el proyecto (las fotos son evidencia
--   pesada, a diferencia de la firma del Bloque 3, que se quedó como base64
--   por su bajo volumen -ver comentario en 0003_ingresos.sql-). El bucket
--   es privado; el acceso se controla igual que las tablas, por empresa,
--   usando el primer segmento de la ruta del archivo como empresa_id.
-- =============================================================================

create table if not exists public.radar_inspecciones (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references public.trabajos_taller (id) on delete restrict,
  origen text not null check (origen in ('radar_tecnico', 'revision_asesor')),
  realizado_por uuid references public.usuarios (id),
  iniciado_en timestamptz,
  finalizado_en timestamptz,
  observaciones_generales text,
  creado_en timestamptz not null default now()
);

comment on table public.radar_inspecciones is 'Una sesión de detección por trabajo. origen distingue RADAR del técnico (Tipo A) de revisión del asesor (Tipo B) para poder comparar conversión.';

create index if not exists radar_inspecciones_trabajo_idx on public.radar_inspecciones (trabajo_id);

create table if not exists public.radar_hallazgos (
  id uuid primary key default gen_random_uuid(),
  radar_inspeccion_id uuid not null references public.radar_inspecciones (id) on delete restrict,
  detalle text not null,
  area text check (area is null or area in ('mano_obra', 'repuestos', 'lubricantes_insumos', 'servicios_externos')),
  precio_referencial numeric(12, 2) check (precio_referencial is null or precio_referencial >= 0),
  urgencia text not null default 'media' check (urgencia in ('baja', 'media', 'alta')),
  foto_path text,
  orden integer not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.radar_hallazgos is 'Hallazgos de una sesión de detección. precio_referencial es el que ve el cliente con el auto arriba -se guarda marcado como tal, no como precio final-.';
comment on column public.radar_hallazgos.foto_path is 'Ruta dentro del bucket radar-fotos: {empresa_id}/{trabajo_id}/{archivo}. Opcional.';

create index if not exists radar_hallazgos_inspeccion_idx on public.radar_hallazgos (radar_inspeccion_id);

drop trigger if exists trg_radar_hallazgos_actualizado_en on public.radar_hallazgos;
create trigger trg_radar_hallazgos_actualizado_en
  before update on public.radar_hallazgos
  for each row execute function public.actualizar_marca_de_tiempo();

-- ---------------------------------------------------------------------------
-- ot_detalle: vínculo opcional al hallazgo que lo originó, para poder
-- comparar precio_referencial (Bloque 6) contra precio_unitario final
-- (Bloque 5) en el frontend.
-- ---------------------------------------------------------------------------
alter table public.ot_detalle add column if not exists hallazgo_radar_id uuid references public.radar_hallazgos (id);

comment on column public.ot_detalle.hallazgo_radar_id is 'Si este ítem nació de un hallazgo de RADAR/revisión, referencia aquí para poder avisar si el precio final se aleja mucho del referencial.';

-- ---------------------------------------------------------------------------
-- RLS: mismo patrón que tareas_taller/ot_detalle (empresa vía join,
-- abierto a cualquier persona activa -detección es tarea de técnico o
-- asesor según el tipo, ninguno de los dos necesita ser distinto de los
-- demás roles operativos ya cubiertos por este patrón-).
-- ---------------------------------------------------------------------------
alter table public.radar_inspecciones enable row level security;
alter table public.radar_hallazgos enable row level security;

drop policy if exists radar_inspecciones_select on public.radar_inspecciones;
create policy radar_inspecciones_select on public.radar_inspecciones
  for select using (exists (
    select 1 from public.trabajos_taller t
    where t.id = radar_inspecciones.trabajo_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists radar_inspecciones_insert on public.radar_inspecciones;
create policy radar_inspecciones_insert on public.radar_inspecciones
  for insert with check (
    public.auth_rol() is not null
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists radar_inspecciones_update on public.radar_inspecciones;
create policy radar_inspecciones_update on public.radar_inspecciones
  for update using (
    public.auth_rol() is not null
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = radar_inspecciones.trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists radar_hallazgos_select on public.radar_hallazgos;
create policy radar_hallazgos_select on public.radar_hallazgos
  for select using (exists (
    select 1 from public.radar_inspecciones r
    join public.trabajos_taller t on t.id = r.trabajo_id
    where r.id = radar_hallazgos.radar_inspeccion_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists radar_hallazgos_insert on public.radar_hallazgos;
create policy radar_hallazgos_insert on public.radar_hallazgos
  for insert with check (
    public.auth_rol() is not null
    and exists (
      select 1 from public.radar_inspecciones r
      join public.trabajos_taller t on t.id = r.trabajo_id
      where r.id = radar_inspeccion_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists radar_hallazgos_update on public.radar_hallazgos;
create policy radar_hallazgos_update on public.radar_hallazgos
  for update using (
    public.auth_rol() is not null
    and exists (
      select 1 from public.radar_inspecciones r
      join public.trabajos_taller t on t.id = r.trabajo_id
      where r.id = radar_hallazgos.radar_inspeccion_id and t.empresa_id = public.mi_empresa_id()
    )
  );

-- ---------------------------------------------------------------------------
-- La vista ot_detalle_con_permiso (Bloque 5) tiene una lista fija de
-- columnas: agregar hallazgo_radar_id a ot_detalle no la actualiza sola.
-- Se recrea agregando ese vínculo y el precio_referencial del hallazgo, para
-- que el frontend pueda avisar si el precio final se aleja del referencial
-- sin tener que hacer una segunda consulta.
-- ---------------------------------------------------------------------------
-- Postgres solo permite agregar columnas al FINAL de una vista existente
-- con CREATE OR REPLACE (insertarlas en medio se interpreta como un intento
-- de renombrar la columna que quedó desplazada, y lo rechaza). Por eso
-- hallazgo_radar_id y hallazgo_precio_referencial van al final de la lista,
-- no junto a las demás columnas de ot_detalle con las que se relacionan.
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
  h.precio_referencial as hallazgo_precio_referencial
from public.ot_detalle d
left join public.radar_hallazgos h on h.id = d.hallazgo_radar_id;

-- ---------------------------------------------------------------------------
-- Storage: bucket privado para las fotos de RADAR. Acceso acotado por
-- empresa usando el primer segmento de la ruta del archivo.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('radar-fotos', 'radar-fotos', false)
on conflict (id) do nothing;

drop policy if exists radar_fotos_select on storage.objects;
create policy radar_fotos_select on storage.objects
  for select using (
    bucket_id = 'radar-fotos'
    and (storage.foldername(name))[1] = public.mi_empresa_id()::text
  );

drop policy if exists radar_fotos_insert on storage.objects;
create policy radar_fotos_insert on storage.objects
  for insert with check (
    bucket_id = 'radar-fotos'
    and (storage.foldername(name))[1] = public.mi_empresa_id()::text
    and public.auth_rol() is not null
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select relrowsecurity from pg_class where relname = 'radar_inspecciones') as rls_radar_inspecciones_esperado_true,
  (select relrowsecurity from pg_class where relname = 'radar_hallazgos') as rls_radar_hallazgos_esperado_true,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ot_detalle' and column_name = 'hallazgo_radar_id') as columna_vinculo_esperado_1,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ot_detalle_con_permiso' and column_name = 'hallazgo_precio_referencial') as vista_actualizada_esperado_1,
  (select count(*) from storage.buckets where id = 'radar-fotos') as bucket_creado_esperado_1,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('radar_fotos_select', 'radar_fotos_insert')) as politicas_storage_esperado_2;
