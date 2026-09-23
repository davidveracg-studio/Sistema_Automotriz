-- =============================================================================
-- 0017_taller_islas.sql
--
-- Qué resuelve:
--   Ahora que la sincronización por tarea con ClickUp funciona de verdad
--   (0015/0016), el cliente pidió una vista que imite el taller físico:
--   quién (qué mecánico) está haciendo qué, agrupado por isla -no por
--   estado de OT como ya muestra ClickUp-, para ver carga de trabajo
--   acumulada del día y tiempo real de cada trabajo.
--
--   Dos piezas nuevas, decididas con el cliente antes de construir:
--   1. `usuarios_islas`: qué isla(s) cubre cada técnico. Tabla configurable
--      (no fija en código) porque un técnico puede cubrir más de una -caso
--      real confirmado: Pablo Donoso es alineación Y auxiliar de compras-.
--      `tipos_isla` (Bloque 8) ya existía pero solo para la capacidad de la
--      agenda de citas; nunca estuvo conectada a qué persona trabaja ahí.
--   2. `trabajos_taller.estado_cambiado_en`: el "tiempo de cada trabajo" que
--      importa acá es cuánto lleva la OT en su etapa actual del taller
--      (EN REPARACIÓN, PINTURA/DESABOLLADURA, etc. -el campo
--      `clickup_estado_actual` agregado en 0015-), no el micro-estado de
--      cada subtarea (`tareas_taller.estado` vive en un namespace de
--      ClickUp completamente distinto, propio de la subtarea, y no
--      corresponde a las columnas del tablero que ve el jefe de taller).
--      Se agrega un timestamp que solo se toca cuando `clickup_estado_actual`
--      realmente cambia, vía trigger BEFORE UPDATE.
-- =============================================================================

create table if not exists public.usuarios_islas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  tipo_isla_id uuid not null references public.tipos_isla (id) on delete cascade,
  creado_en timestamptz not null default now(),
  constraint uq_usuarios_islas unique (usuario_id, tipo_isla_id)
);

comment on table public.usuarios_islas is 'Qué isla(s) del taller cubre cada técnico. Configurable desde la pantalla de Taller por un admin/jefe de taller -un técnico puede cubrir más de una isla (ej. Pablo Donoso: Alineación y Compras)-.';

create index if not exists usuarios_islas_usuario_idx on public.usuarios_islas (usuario_id);
create index if not exists usuarios_islas_isla_idx on public.usuarios_islas (tipo_isla_id);

alter table public.trabajos_taller
  add column if not exists estado_cambiado_en timestamptz not null default now();

comment on column public.trabajos_taller.estado_cambiado_en is 'Desde cuándo la OT está en su `clickup_estado_actual` actual (EN REPARACIÓN, PINTURA/DESABOLLADURA, etc.). Se actualiza solo en la transición real de ese campo, vía trigger -no con cualquier cambio a la fila-.';

create or replace function public.marcar_cambio_estado_trabajo()
returns trigger
language plpgsql
as $$
begin
  if new.clickup_estado_actual is distinct from old.clickup_estado_actual then
    new.estado_cambiado_en := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trabajos_taller_estado_cambiado on public.trabajos_taller;
create trigger trg_trabajos_taller_estado_cambiado
  before update on public.trabajos_taller
  for each row execute function public.marcar_cambio_estado_trabajo();

-- ---------------------------------------------------------------------------
-- RLS: lectura abierta a cualquiera activo de la empresa (el tablero de
-- taller lo necesita ver cualquier rol, igual que Bodega/Agenda). Escritura
-- -quién cubre qué isla es una decisión de staffing- restringida a
-- jefe_taller/admin/socia.
-- ---------------------------------------------------------------------------
alter table public.usuarios_islas enable row level security;

drop policy if exists usuarios_islas_select on public.usuarios_islas;
create policy usuarios_islas_select on public.usuarios_islas
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists usuarios_islas_insert on public.usuarios_islas;
create policy usuarios_islas_insert on public.usuarios_islas
  for insert
  with check (
    empresa_id = public.mi_empresa_id()
    and public.auth_rol() in ('jefe_taller', 'admin', 'socia')
  );

drop policy if exists usuarios_islas_delete on public.usuarios_islas;
create policy usuarios_islas_delete on public.usuarios_islas
  for delete
  using (
    empresa_id = public.mi_empresa_id()
    and public.auth_rol() in ('jefe_taller', 'admin', 'socia')
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_name = 'usuarios_islas') as tabla_esperado_1,
  (select count(*) from information_schema.columns where table_name = 'trabajos_taller' and column_name = 'estado_cambiado_en') as columna_esperado_1,
  (select count(*) from pg_proc where proname = 'marcar_cambio_estado_trabajo') as funcion_esperado_1,
  (select relrowsecurity from pg_class where relname = 'usuarios_islas') as rls_esperado_true;
