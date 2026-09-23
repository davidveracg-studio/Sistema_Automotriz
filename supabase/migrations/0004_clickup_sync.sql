-- =============================================================================
-- 0004_clickup_sync.sql
--
-- Qué resuelve:
--   Bloque 4: sincronización bidireccional con ClickUp. El taller ejecuta en
--   ClickUp, no en una pantalla nueva; el CRM solo necesita saber qué existe
--   allá y reflejar los cambios en ambos sentidos.
--
--   Verificado contra la API real de ClickUp (no solo el spec) el
--   2026-09-14: cada ítem de mano de obra es una SUBTAREA directa de la OT
--   (no anidada bajo un contenedor); repuestos/lubricantes e insumos/
--   servicio externo se manejan como CHECKLISTS (uno por área) dentro de la
--   tarjeta. Los 13 estados reales de la lista "Vehiculos en Taller" no se
--   copian a un CHECK rígido: ClickUp puede agregar/renombrar estados sin
--   avisar, y forzar un catálogo fijo aquí rompería la sincronización cada
--   vez que eso pase. `tareas_taller.estado` guarda el texto tal como lo
--   entrega ClickUp; `clickup_estados` es solo una tabla de referencia para
--   mostrar la lista conocida en la interfaz (sugerencia, no restricción).
--
--   `ot_detalle` cubre las cuatro áreas de la OT (mano de obra, repuestos,
--   lubricantes e insumos, servicios externos) desde ya, aunque este bloque
--   solo sincroniza con ClickUp las tres últimas -mano de obra sigue
--   viviendo en `tareas_taller` mientras no tenga precio-. Se hace así para
--   no tener que alterar el CHECK de `area` cuando llegue el Bloque 5
--   (valorización), que es cuando `costo_unitario`/`precio_unitario` se
--   empiezan a llenar de verdad.
--
--   El token de la API de ClickUp NUNCA vive en esta base de datos: es un
--   secreto de Edge Function (`supabase secrets set CLICKUP_API_TOKEN=...`).
--   Lo que sí vive acá es la configuración no sensible (qué listas usa cada
--   empresa), porque en un esquema multi-tenant esas listas no pueden
--   quedar hardcodeadas en el código del Edge Function -cada taller tendrá
--   las suyas-.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Configuración de ClickUp por empresa. Nunca credenciales acá -esas son
-- secretos de Edge Function-, solo qué listas usar.
-- ---------------------------------------------------------------------------
create table if not exists public.clickup_config (
  empresa_id uuid primary key references public.empresas (id) on delete cascade,
  lista_trabajos_id text not null,
  lista_radar_id text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

comment on table public.clickup_config is 'IDs de listas de ClickUp por empresa (tenant). El token de API es un secreto de Edge Function, nunca vive aquí.';

-- Versión de portafolio/demo: los IDs de lista reales del cliente original
-- no van acá -clickup_config queda vacía, la sincronización con ClickUp no
-- está conectada en esta demo-.

-- ---------------------------------------------------------------------------
-- Tabla de referencia de estados conocidos de ClickUp, solo para mostrar en
-- la interfaz (colores, orden). No es un CHECK: tareas_taller.estado acepta
-- cualquier texto, porque el estado real lo define ClickUp, no este esquema.
-- ---------------------------------------------------------------------------
create table if not exists public.clickup_estados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  clickup_status_id text not null,
  nombre text not null,
  orden integer not null default 0,
  tipo text,
  color text,
  constraint uq_clickup_estados unique (empresa_id, clickup_status_id)
);

comment on table public.clickup_estados is 'Catálogo de referencia (solo UI) de los estados que existen hoy en la lista de ClickUp de esta empresa. Se actualiza re-sincronizando, no a mano.';

-- ---------------------------------------------------------------------------
-- Tareas de taller: mano de obra, un ítem por subtarea de ClickUp.
-- ---------------------------------------------------------------------------
create table if not exists public.tareas_taller (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references public.trabajos_taller (id) on delete restrict,
  descripcion text not null,
  tecnico_id uuid references public.usuarios (id),
  clickup_asignado_nombre text,
  estado text not null default 'agenda',
  clickup_task_id text,
  orden integer not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint uq_tareas_taller_clickup_task unique (clickup_task_id)
);

comment on table public.tareas_taller is 'Mano de obra: el "qué" y "quién", sin precio (eso lo agrega ot_detalle en el Bloque 5). Un registro = una subtarea de ClickUp.';
comment on column public.tareas_taller.clickup_task_id is 'Único campo usado tanto para subir como para importar el identificador de ClickUp, como pide el spec.';
comment on column public.tareas_taller.clickup_asignado_nombre is 'Nombre que muestra ClickUp cuando el asignado no cruza por correo con ningún usuario. Saber quién lo hizo importa aunque falte la ficha.';
comment on column public.tareas_taller.estado is 'Texto libre: el estado real vive en ClickUp (13 estados hoy, pueden cambiar). Ver clickup_estados para la lista de referencia.';

create index if not exists tareas_taller_trabajo_idx on public.tareas_taller (trabajo_id);
create index if not exists tareas_taller_tecnico_idx on public.tareas_taller (tecnico_id);

drop trigger if exists trg_tareas_taller_actualizado_en on public.tareas_taller;
create trigger trg_tareas_taller_actualizado_en
  before update on public.tareas_taller
  for each row execute function public.actualizar_marca_de_tiempo();

-- ---------------------------------------------------------------------------
-- ot_detalle: las cuatro áreas de la OT. Repuestos/Lubricantes e insumos/
-- Servicios externos se sincronizan como checklist de ClickUp desde este
-- bloque; mano_obra queda contemplada en el CHECK pero sin filas todavía
-- (llega en el Bloque 5, vinculada a tareas_taller por tarea_taller_id).
-- ---------------------------------------------------------------------------
create table if not exists public.ot_detalle (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references public.trabajos_taller (id) on delete restrict,
  area text not null check (area in ('mano_obra', 'repuestos', 'lubricantes_insumos', 'servicios_externos')),
  tarea_taller_id uuid references public.tareas_taller (id),
  codigo text,
  detalle text not null,
  cantidad numeric(10, 2) not null default 1 check (cantidad > 0),
  costo_unitario numeric(12, 2) check (costo_unitario is null or costo_unitario >= 0),
  precio_unitario numeric(12, 2) check (precio_unitario is null or precio_unitario >= 0),
  total_linea numeric(12, 2) generated always as (
    case when precio_unitario is null then null else round(cantidad * precio_unitario, 2) end
  ) stored,
  verificado boolean not null default false,
  responsable_id uuid references public.usuarios (id),
  clickup_checklist_item_id text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint uq_ot_detalle_clickup_item unique (clickup_checklist_item_id),
  constraint chk_ot_detalle_mano_obra_vinculada check (
    (area = 'mano_obra') = (tarea_taller_id is not null)
  )
);

comment on table public.ot_detalle is 'Las cuatro áreas de la OT. El total de línea lo calcula la base (columna generada), nunca el frontend, para que el documento no quede descuadrado.';
comment on column public.ot_detalle.verificado is 'Repuestos/insumos/servicios: si ya se compró/confirmó. Corresponde al "resolved" del ítem de checklist en ClickUp.';

create index if not exists ot_detalle_trabajo_idx on public.ot_detalle (trabajo_id);
create index if not exists ot_detalle_area_idx on public.ot_detalle (trabajo_id, area);

drop trigger if exists trg_ot_detalle_actualizado_en on public.ot_detalle;
create trigger trg_ot_detalle_actualizado_en
  before update on public.ot_detalle
  for each row execute function public.actualizar_marca_de_tiempo();

-- ---------------------------------------------------------------------------
-- trabajos_taller: agrega el vínculo con la tarjeta de ClickUp.
-- ---------------------------------------------------------------------------
alter table public.trabajos_taller add column if not exists clickup_task_id text;
alter table public.trabajos_taller add constraint uq_trabajos_taller_clickup_task unique (clickup_task_id);

comment on column public.trabajos_taller.clickup_task_id is 'Tarjeta (tarea padre) en ClickUp. Se crea la primera vez que se sincroniza el trabajo, no antes.';

-- ---------------------------------------------------------------------------
-- Registro de errores de integración. Nunca fallar en silencio.
-- ---------------------------------------------------------------------------
create table if not exists public.integraciones_clickup_errores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  trabajo_id uuid references public.trabajos_taller (id) on delete set null,
  operacion text not null,
  mensaje text not null,
  detalle jsonb,
  creado_en timestamptz not null default now()
);

comment on table public.integraciones_clickup_errores is 'Toda falla de la API de ClickUp se registra aquí con su causa real -nunca en silencio-, para que admin pueda verla y diagnosticarla.';

create index if not exists integraciones_clickup_errores_empresa_idx on public.integraciones_clickup_errores (empresa_id, creado_en desc);

-- ---------------------------------------------------------------------------
-- RLS. Config y catálogo de estados: solo lectura para todos, escritura solo
-- admin. Tareas y detalle: mismo patrón abierto de los bloques anteriores
-- (cualquier persona activa de la empresa lee/crea/edita; las restricciones
-- finas de precio llegan con la UI de valorización del Bloque 5, que además
-- deberá ocultar costo/precio a los roles sin tiene_acceso_montos()).
-- Errores de integración: solo admin/socia -son ruido técnico, no operación
-- diaria-.
-- ---------------------------------------------------------------------------
alter table public.clickup_config enable row level security;
alter table public.clickup_estados enable row level security;
alter table public.tareas_taller enable row level security;
alter table public.ot_detalle enable row level security;
alter table public.integraciones_clickup_errores enable row level security;

drop policy if exists clickup_config_select on public.clickup_config;
create policy clickup_config_select on public.clickup_config
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists clickup_config_update on public.clickup_config;
create policy clickup_config_update on public.clickup_config
  for update using (empresa_id = public.mi_empresa_id() and public.es_admin())
  with check (empresa_id = public.mi_empresa_id());

drop policy if exists clickup_estados_select on public.clickup_estados;
create policy clickup_estados_select on public.clickup_estados
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists tareas_taller_select on public.tareas_taller;
create policy tareas_taller_select on public.tareas_taller
  for select using (exists (
    select 1 from public.trabajos_taller t
    where t.id = tareas_taller.trabajo_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists tareas_taller_insert on public.tareas_taller;
create policy tareas_taller_insert on public.tareas_taller
  for insert with check (
    public.auth_rol() is not null
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists tareas_taller_update on public.tareas_taller;
create policy tareas_taller_update on public.tareas_taller
  for update using (
    public.auth_rol() is not null
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = tareas_taller.trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists ot_detalle_select on public.ot_detalle;
create policy ot_detalle_select on public.ot_detalle
  for select using (exists (
    select 1 from public.trabajos_taller t
    where t.id = ot_detalle.trabajo_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists ot_detalle_insert on public.ot_detalle;
create policy ot_detalle_insert on public.ot_detalle
  for insert with check (
    public.auth_rol() is not null
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists ot_detalle_update on public.ot_detalle;
create policy ot_detalle_update on public.ot_detalle
  for update using (
    public.auth_rol() is not null
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = ot_detalle.trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists integraciones_clickup_errores_select on public.integraciones_clickup_errores;
create policy integraciones_clickup_errores_select on public.integraciones_clickup_errores
  for select using (
    empresa_id = public.mi_empresa_id()
    and (public.es_admin() or public.es_socia())
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select lista_trabajos_id from public.clickup_config cc
     join public.empresas e on e.id = cc.empresa_id
     where e.nombre = 'Servicio Automotriz Didial Ltda.') as lista_trabajos_esperado_901324296305,
  (select lista_radar_id from public.clickup_config cc
     join public.empresas e on e.id = cc.empresa_id
     where e.nombre = 'Servicio Automotriz Didial Ltda.') as lista_radar_esperado_901328193477,
  (select relrowsecurity from pg_class where relname = 'tareas_taller') as rls_tareas_taller_esperado_true,
  (select relrowsecurity from pg_class where relname = 'ot_detalle') as rls_ot_detalle_esperado_true,
  (select count(*) from information_schema.columns where table_name = 'trabajos_taller' and column_name = 'clickup_task_id') as columna_clickup_task_id_esperado_1;
