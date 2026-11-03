-- =============================================================================
-- 0069_inspeccion_ia_inventario.sql
--
-- Qué resuelve:
--   Fase 2 del escáner de inspección (0068):
--   1. Análisis con visión por API (Edge Function `analizar-inspeccion`): las
--      fotos ya guardadas se analizan para sugerir el inventario del interior
--      (`inventario_sugerido`, que 0068 dejó reservada) y detectar daños
--      (`danos_detectados`, con una caja de ubicación 0-1 sobre la foto).
--      La función escribe con service role; el usuario nunca escribe estas
--      columnas desde el navegador, salvo descartar una sugerencia.
--   2. Inventario confirmado (`inspeccion_inventario`): lo sugerido por la IA
--      NO es inventario hasta que una persona lo acepta; también se puede
--      agregar a mano. Es lo que se imprime en la orden de ingreso.
--   3. Eliminar fotos ya guardadas (política de borrado en tabla y Storage) y
--      descartar sugerencias (política de update).
-- =============================================================================

alter table public.inspeccion_fotos
  add column if not exists danos_detectados jsonb,
  add column if not exists analizado_en timestamptz,
  add column if not exists analisis_error text;

comment on column public.inspeccion_fotos.inventario_sugerido is 'Sugerencias de la IA: array de {nombre, categoria, cantidad, confianza}. Solo fotos de interior. No es inventario hasta aceptarse (inspeccion_inventario).';
comment on column public.inspeccion_fotos.danos_detectados is 'Daños detectados por la IA: array de {descripcion, tipo, severidad, confianza, caja:{x,y,ancho,alto}} con caja como fracción 0-1 de la foto.';
comment on column public.inspeccion_fotos.analizado_en is 'NULL = pendiente de análisis. Lo fija la Edge Function analizar-inspeccion al terminar bien.';
comment on column public.inspeccion_fotos.analisis_error is 'Último error del análisis (si falló). NULL si no hubo.';

create index if not exists inspeccion_fotos_pendientes_idx on public.inspeccion_fotos (trabajo_id) where analizado_en is null;

drop policy if exists inspeccion_fotos_update on public.inspeccion_fotos;
create policy inspeccion_fotos_update on public.inspeccion_fotos
  for update
  using (empresa_id = public.mi_empresa_id() and (public.es_asesor() or public.es_admin() or public.es_socia()))
  with check (empresa_id = public.mi_empresa_id());

drop policy if exists inspeccion_fotos_delete on public.inspeccion_fotos;
create policy inspeccion_fotos_delete on public.inspeccion_fotos
  for delete
  using (empresa_id = public.mi_empresa_id() and (public.es_asesor() or public.es_admin() or public.es_socia()));

drop policy if exists inspeccion_fotos_storage_delete on storage.objects;
create policy inspeccion_fotos_storage_delete on storage.objects
  for delete using (
    bucket_id = 'inspeccion-fotos'
    and (storage.foldername(name))[1] = public.mi_empresa_id()::text
    and (public.es_asesor() or public.es_admin() or public.es_socia())
  );

-- ---------------------------------------------------------------------------
-- Inventario confirmado del vehículo al ingreso.
-- ---------------------------------------------------------------------------
create table if not exists public.inspeccion_inventario (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  trabajo_id uuid not null references public.trabajos_taller (id) on delete cascade,
  foto_id uuid references public.inspeccion_fotos (id) on delete set null,
  nombre text not null check (length(btrim(nombre)) > 0),
  categoria text not null default 'otros' check (categoria in (
    'documentos', 'herramientas', 'rueda_repuesto', 'accesorios', 'electronica', 'otros'
  )),
  cantidad integer not null default 1 check (cantidad > 0),
  origen text not null check (origen in ('sugerido_ia', 'manual')),
  creado_por uuid references public.usuarios (id) on delete set null,
  creado_en timestamptz not null default now()
);

comment on table public.inspeccion_inventario is 'Inventario del vehículo al ingreso, confirmado por una persona (sugerido por la IA o ingresado a mano).';

create index if not exists inspeccion_inventario_trabajo_idx on public.inspeccion_inventario (trabajo_id);

alter table public.inspeccion_inventario enable row level security;

drop policy if exists inspeccion_inventario_select on public.inspeccion_inventario;
create policy inspeccion_inventario_select on public.inspeccion_inventario
  for select
  using (empresa_id = public.mi_empresa_id());

drop policy if exists inspeccion_inventario_insert on public.inspeccion_inventario;
create policy inspeccion_inventario_insert on public.inspeccion_inventario
  for insert
  with check (
    empresa_id = public.mi_empresa_id()
    and (public.es_asesor() or public.es_admin() or public.es_socia())
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists inspeccion_inventario_delete on public.inspeccion_inventario;
create policy inspeccion_inventario_delete on public.inspeccion_inventario
  for delete
  using (empresa_id = public.mi_empresa_id() and (public.es_asesor() or public.es_admin() or public.es_socia()));

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'inspeccion_fotos' and column_name in ('danos_detectados', 'analizado_en', 'analisis_error')) as columnas_ia_esperado_3,
  (select relrowsecurity from pg_class where relname = 'inspeccion_inventario') as rls_inventario_esperado_true,
  (select count(*) from pg_policies where tablename = 'inspeccion_inventario') as politicas_inventario_esperado_3,
  (select count(*) from pg_policies where tablename = 'inspeccion_fotos') as politicas_fotos_esperado_4,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'inspeccion_fotos_storage_delete') as politica_storage_delete_esperado_1;
