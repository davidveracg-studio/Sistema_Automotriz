-- =============================================================================
-- 0029_radar_checklist.sql
--
-- Qué resuelve:
--   El RADAR (Bloque 6) hasta ahora era 100% texto libre: el técnico solo
--   registraba un hallazgo cuando encontraba algo, sin ninguna guía de qué
--   revisar. El cliente compartió su lista real de inspección (7 áreas, 48
--   puntos: tren delantero/trasero, luces, interior, compartimiento motor,
--   frenos y neumáticos con el vehículo levantado, prueba en ruta) para que
--   el técnico la recorra punto por punto durante la sesión.
--
--   Diseño: catálogo de puntos (`radar_checklist_items`, multi-tenant como
--   cualquier otro catálogo del proyecto) + una respuesta por punto y por
--   sesión (`radar_checklist_respuestas`, bien/requiere atención/no
--   aplica + nota opcional). Se mantiene separado de `radar_hallazgos` a
--   propósito -la lista es "qué se revisó y cómo quedó", los hallazgos
--   siguen siendo "qué se le va a cobrar al cliente", con su propio precio
--   referencial y urgencia-. El frontend ofrece un atajo para convertir un
--   punto marcado "requiere atención" en un hallazgo, sin duplicar el dato
--   a mano.
-- =============================================================================

create table if not exists public.radar_checklist_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  area text not null,
  item text not null,
  orden integer not null default 0,
  activo boolean not null default true,
  constraint uq_radar_checklist_items unique (empresa_id, area, item)
);

comment on table public.radar_checklist_items is 'Puntos de la lista de inspección del RADAR, agrupados por área física del vehículo (no confundir con el área de ot_detalle -mano_obra/repuestos/etc-, es otra dimensión).';

create index if not exists radar_checklist_items_empresa_idx on public.radar_checklist_items (empresa_id, area, orden);

create table if not exists public.radar_checklist_respuestas (
  id uuid primary key default gen_random_uuid(),
  radar_inspeccion_id uuid not null references public.radar_inspecciones (id) on delete cascade,
  checklist_item_id uuid not null references public.radar_checklist_items (id) on delete restrict,
  estado text not null default 'bien' check (estado in ('bien', 'atencion', 'no_aplica')),
  nota text,
  actualizado_en timestamptz not null default now(),
  constraint uq_radar_checklist_respuestas unique (radar_inspeccion_id, checklist_item_id)
);

comment on table public.radar_checklist_respuestas is 'Una respuesta por punto de la lista y por sesión de RADAR. estado=atencion es candidato a convertirse en radar_hallazgos (acción del frontend, no automática).';

create index if not exists radar_checklist_respuestas_inspeccion_idx on public.radar_checklist_respuestas (radar_inspeccion_id);

drop trigger if exists trg_radar_checklist_respuestas_actualizado_en on public.radar_checklist_respuestas;
create trigger trg_radar_checklist_respuestas_actualizado_en
  before update on public.radar_checklist_respuestas
  for each row execute function public.actualizar_marca_de_tiempo();

-- ---------------------------------------------------------------------------
-- RLS: el catálogo de puntos se lee como cualquier catálogo de empresa y se
-- mantiene solo admin/socia; las respuestas siguen el mismo patrón que
-- radar_hallazgos (acceso vía la sesión -> la OT -> la empresa, abierto a
-- cualquier persona activa: detección es tarea de técnico o asesor según
-- el tipo).
-- ---------------------------------------------------------------------------
alter table public.radar_checklist_items enable row level security;
alter table public.radar_checklist_respuestas enable row level security;

drop policy if exists radar_checklist_items_select on public.radar_checklist_items;
create policy radar_checklist_items_select on public.radar_checklist_items
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists radar_checklist_items_write on public.radar_checklist_items;
create policy radar_checklist_items_write on public.radar_checklist_items
  for all
  using (empresa_id = public.mi_empresa_id() and (public.es_admin() or public.es_socia()))
  with check (empresa_id = public.mi_empresa_id() and (public.es_admin() or public.es_socia()));

drop policy if exists radar_checklist_respuestas_select on public.radar_checklist_respuestas;
create policy radar_checklist_respuestas_select on public.radar_checklist_respuestas
  for select using (exists (
    select 1 from public.radar_inspecciones r
    join public.trabajos_taller t on t.id = r.trabajo_id
    where r.id = radar_checklist_respuestas.radar_inspeccion_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists radar_checklist_respuestas_insert on public.radar_checklist_respuestas;
create policy radar_checklist_respuestas_insert on public.radar_checklist_respuestas
  for insert with check (
    public.auth_rol() is not null
    and exists (
      select 1 from public.radar_inspecciones r
      join public.trabajos_taller t on t.id = r.trabajo_id
      where r.id = radar_inspeccion_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists radar_checklist_respuestas_update on public.radar_checklist_respuestas;
create policy radar_checklist_respuestas_update on public.radar_checklist_respuestas
  for update using (
    public.auth_rol() is not null
    and exists (
      select 1 from public.radar_inspecciones r
      join public.trabajos_taller t on t.id = r.trabajo_id
      where r.id = radar_checklist_respuestas.radar_inspeccion_id and t.empresa_id = public.mi_empresa_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_name in ('radar_checklist_items', 'radar_checklist_respuestas')) as tablas_esperado_2,
  (select relrowsecurity from pg_class where relname = 'radar_checklist_items') as rls_esperado_true;
