-- =============================================================================
-- 0024_logo_empresa.sql
--
-- Qué resuelve:
--   Los tres documentos que emite el sistema (Orden de Ingreso, Presupuesto,
--   Orden de Egreso) necesitan un formato bien definido y, en particular,
--   el logo de la empresa. Como el proyecto es multi-tenant, el logo NO
--   puede quedar hardcodeado en el código -cada empresa (tenant) que se
--   sume a la plataforma en el futuro necesita poder tener el suyo propio-,
--   así que se guarda como dato de la empresa (`empresas.logo_url`),
--   apuntando a un archivo en un bucket de Storage nuevo, mismo patrón ya
--   usado para `radar-fotos` en el Bloque 6.
--
--   A diferencia de radar-fotos (privado, fotos de vehículos de clientes),
--   este bucket es público: un logo no es información sensible, y así el
--   documento impreso lo puede cargar con un <img src> directo, sin pasar
--   por una URL firmada.
-- =============================================================================

alter table public.empresas
  add column if not exists logo_url text;

comment on column public.empresas.logo_url is 'URL pública del logo de la empresa (bucket logos-empresa), usado en el encabezado de los documentos impresos. NULL = sin logo, el documento se imprime solo con el nombre.';

insert into storage.buckets (id, name, public)
values ('logos-empresa', 'logos-empresa', true)
on conflict (id) do nothing;

drop policy if exists logos_empresa_select on storage.objects;
create policy logos_empresa_select on storage.objects
  for select using (bucket_id = 'logos-empresa');

drop policy if exists logos_empresa_insert on storage.objects;
create policy logos_empresa_insert on storage.objects
  for insert with check (
    bucket_id = 'logos-empresa'
    and (storage.foldername(name))[1] = public.mi_empresa_id()::text
    and (public.es_admin() or public.es_socia())
  );

drop policy if exists logos_empresa_update on storage.objects;
create policy logos_empresa_update on storage.objects
  for update using (
    bucket_id = 'logos-empresa'
    and (storage.foldername(name))[1] = public.mi_empresa_id()::text
    and (public.es_admin() or public.es_socia())
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'empresas' and column_name = 'logo_url') as columna_esperado_1,
  (select count(*) from storage.buckets where id = 'logos-empresa') as bucket_esperado_1,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('logos_empresa_select', 'logos_empresa_insert', 'logos_empresa_update')) as politicas_esperado_3;
