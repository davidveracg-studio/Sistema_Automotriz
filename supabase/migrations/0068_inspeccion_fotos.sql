-- =============================================================================
-- 0068_inspeccion_fotos.sql
--
-- Qué resuelve:
--   Escáner de inspección de ingreso: el usuario recorre el vehículo con la
--   cámara del teléfono y el sistema extrae fotos automáticamente (exterior e
--   interior). El video NUNCA se sube ni se guarda: se procesa en el
--   dispositivo y solo llegan las fotos ya comprimidas.
--
--   - Bucket privado `inspeccion-fotos`, mismo patrón que `radar-fotos`
--     (0007): el primer segmento de la ruta es el empresa_id, y la RLS de
--     Storage se acota por él. Ruta: {empresa_id}/{trabajo_id}/{foto_id}.jpg
--   - Tabla `inspeccion_fotos`: una fila por foto, con zona (exterior/
--     interior), subzona, fecha/hora, usuario y marca de daño.
--     `inventario_sugerido` queda reservada para la fase 2 (detección de
--     objetos en el interior); el MVP no la escribe.
--
--   Escribir: asesor, admin y socia (igual que inspecciones_ingreso).
--   Leer: cualquier persona de la empresa.
-- =============================================================================

create table if not exists public.inspeccion_fotos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  trabajo_id uuid not null references public.trabajos_taller (id) on delete cascade,
  vehiculo_id uuid references public.vehiculos (id) on delete set null,
  zona text not null check (zona in ('exterior', 'interior')),
  subzona text,
  storage_path text not null,
  nota text,
  es_dano boolean not null default false,
  origen text not null default 'auto' check (origen in ('auto', 'manual')),
  ancho integer check (ancho is null or ancho > 0),
  alto integer check (alto is null or alto > 0),
  bytes integer check (bytes is null or bytes >= 0),
  inventario_sugerido jsonb,
  tomada_en timestamptz not null default now(),
  tomada_por uuid references public.usuarios (id) on delete set null,
  creado_en timestamptz not null default now()
);

comment on table public.inspeccion_fotos is 'Fotos de la inspección de ingreso capturadas con el escáner (exterior/interior). El video no se almacena.';
comment on column public.inspeccion_fotos.subzona is 'Zona guiada activa al capturar: frontal, lateral_izq, tablero, maletero, etc. (catálogo en src/lib/escaner/zonas.js).';
comment on column public.inspeccion_fotos.storage_path is 'Ruta dentro del bucket inspeccion-fotos: {empresa_id}/{trabajo_id}/{id}.jpg';
comment on column public.inspeccion_fotos.es_dano is 'Foto marcada por el usuario como detalle/daño a destacar (raya, abolladura).';
comment on column public.inspeccion_fotos.inventario_sugerido is 'Fase 2: objetos detectados en la foto (documentos, herramientas, rueda de repuesto…). El MVP no la usa.';

create index if not exists inspeccion_fotos_trabajo_idx on public.inspeccion_fotos (trabajo_id);
create index if not exists inspeccion_fotos_empresa_trabajo_idx on public.inspeccion_fotos (empresa_id, trabajo_id);

alter table public.inspeccion_fotos enable row level security;

drop policy if exists inspeccion_fotos_select on public.inspeccion_fotos;
create policy inspeccion_fotos_select on public.inspeccion_fotos
  for select
  using (empresa_id = public.mi_empresa_id());

drop policy if exists inspeccion_fotos_insert on public.inspeccion_fotos;
create policy inspeccion_fotos_insert on public.inspeccion_fotos
  for insert
  with check (
    empresa_id = public.mi_empresa_id()
    and (public.es_asesor() or public.es_admin() or public.es_socia())
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: bucket privado, acotado por empresa con el primer segmento de la
-- ruta (igual que radar-fotos).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('inspeccion-fotos', 'inspeccion-fotos', false)
on conflict (id) do nothing;

drop policy if exists inspeccion_fotos_storage_select on storage.objects;
create policy inspeccion_fotos_storage_select on storage.objects
  for select using (
    bucket_id = 'inspeccion-fotos'
    and (storage.foldername(name))[1] = public.mi_empresa_id()::text
  );

drop policy if exists inspeccion_fotos_storage_insert on storage.objects;
create policy inspeccion_fotos_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'inspeccion-fotos'
    and (storage.foldername(name))[1] = public.mi_empresa_id()::text
    and (public.es_asesor() or public.es_admin() or public.es_socia())
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select relrowsecurity from pg_class where relname = 'inspeccion_fotos') as rls_inspeccion_fotos_esperado_true,
  (select count(*) from storage.buckets where id = 'inspeccion-fotos') as bucket_creado_esperado_1,
  (select count(*) from pg_policies where tablename = 'inspeccion_fotos') as politicas_tabla_esperado_2,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('inspeccion_fotos_storage_select', 'inspeccion_fotos_storage_insert')) as politicas_storage_esperado_2;
