-- =============================================================================
-- 0003_ingresos.sql
--
-- Qué resuelve:
--   Bloque 3: "Nuevo Ingreso". El taller puede recibir un vehículo, tipo A
--   (diagnóstico) o tipo B (servicio agendado), con la inspección de ingreso
--   y la firma del cliente. Crea `trabajos_taller` (la OT, con su número
--   asignado desde este momento) e `inspecciones_ingreso`.
--
--   Numeración de OT (definición que el spec marcaba como pendiente,
--   resuelta con el cliente el 2026-09-13): serie nueva y propia del CRM,
--   parte en 14000 para Didial. Las OT anteriores de Dimasoft NO se numeran
--   en el CRM.
--
--   Como este esquema es multi-tenant, la numeración no puede ser una única
--   secuencia global de Postgres (eso mezclaría el conteo de distintos
--   talleres y filtraría cuánto factura cada uno). En su lugar, cada empresa
--   lleva su propio contador (`empresas.siguiente_numero_ot`) y el trigger
--   hace un UPDATE atómico sobre esa fila al crear el trabajo -no al
--   cerrarlo-, igual de seguro ante ingresos simultáneos que una secuencia
--   nativa, porque el UPDATE toma el lock de la fila de la empresa.
--
--   El asesor carga el ingreso sin precios (separación clave del spec: el
--   "qué" es del asesor, el "cuánto" es del encargado de presupuestos en un
--   bloque posterior). Por eso `trabajos_taller` todavía no tiene columnas
--   de costo/precio -esas viven en `ot_detalle`, que se agrega en el
--   Bloque 5-.
--
--   La firma se guarda como imagen (dataURL PNG) en una columna de texto, no
--   en Storage: el volumen es bajo (~5 vehículos/día) y el archivo es
--   pequeño. Vale la pena revisar esto cuando el Bloque 6 (RADAR) agregue
--   fotos, que sí son pesadas.
--
--   El "documento" del ingreso es una vista imprimible en el frontend (el
--   asesor o el cliente la guardan como PDF desde el navegador), no un PDF
--   generado en el servidor: evita depender de una librería o Edge Function
--   de PDF que hoy no hace falta.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Contador de OT por empresa. Arranca en 1 por defecto; se ajusta a 14000
-- para Didial en esta misma migración.
-- ---------------------------------------------------------------------------
alter table public.empresas add column if not exists siguiente_numero_ot integer not null default 1;

update public.empresas
set siguiente_numero_ot = 14000
where nombre = 'Servicio Automotriz Didial Ltda.' and siguiente_numero_ot = 1;

comment on column public.empresas.siguiente_numero_ot is 'Próximo número de OT a asignar en esta empresa. Lo actualiza únicamente el trigger asignar_numero_ot(); no escribir aquí a mano.';

-- ---------------------------------------------------------------------------
-- Tabla trabajos_taller: la OT. El número se asigna al crearla, no al
-- cerrarla, para que el vehículo tenga número desde que entra.
-- ---------------------------------------------------------------------------
create table if not exists public.trabajos_taller (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  numero_ot integer,
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  vehiculo_id uuid not null references public.vehiculos (id) on delete restrict,
  tipo_ingreso text not null check (tipo_ingreso in ('diagnostico', 'servicio_agendado')),
  categoria_servicio text check (categoria_servicio is null or categoria_servicio in ('taller_mecanico', 'servicio_rapido', 'dyp')),
  estado text not null default 'ingresado' check (estado in (
    'ingresado', 'en_deteccion', 'presentado', 'valorizado', 'negociado',
    'en_ejecucion', 'entregado', 'anulado'
  )),
  asesor_id uuid references public.usuarios (id),
  kilometraje_ingreso integer check (kilometraje_ingreso is null or kilometraje_ingreso >= 0),
  nivel_combustible text check (nivel_combustible is null or nivel_combustible in ('vacio', '1/4', '1/2', '3/4', 'lleno')),
  fecha_ingreso timestamptz not null default now(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint uq_trabajos_taller_numero_ot unique (empresa_id, numero_ot)
);

comment on table public.trabajos_taller is 'La OT. Nace en el ingreso (Bloque 3); precio y costo se agregan en ot_detalle (Bloque 5).';
comment on column public.trabajos_taller.numero_ot is 'Asignado por el trigger asignar_numero_ot al insertar. Nunca calcular con count(*): dos ingresos simultáneos chocarían.';
comment on column public.trabajos_taller.tipo_ingreso is 'diagnostico = Tipo A (con RADAR del técnico). servicio_agendado = Tipo B (con revisión del asesor).';

create index if not exists trabajos_taller_empresa_idx on public.trabajos_taller (empresa_id);
create index if not exists trabajos_taller_cliente_idx on public.trabajos_taller (cliente_id);
create index if not exists trabajos_taller_vehiculo_idx on public.trabajos_taller (vehiculo_id);
create index if not exists trabajos_taller_estado_idx on public.trabajos_taller (empresa_id, estado);

-- ---------------------------------------------------------------------------
-- Asignación atómica del número de OT desde el contador de la empresa.
-- ---------------------------------------------------------------------------
create or replace function public.asignar_numero_ot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero integer;
begin
  if new.numero_ot is not null then
    return new;
  end if;

  update public.empresas
  set siguiente_numero_ot = siguiente_numero_ot + 1
  where id = new.empresa_id
  returning siguiente_numero_ot - 1 into v_numero;

  if v_numero is null then
    raise exception 'No se pudo asignar número de OT: empresa % no existe.', new.empresa_id;
  end if;

  new.numero_ot := v_numero;
  return new;
end;
$$;

drop trigger if exists trg_trabajos_taller_numero_ot on public.trabajos_taller;
create trigger trg_trabajos_taller_numero_ot
  before insert on public.trabajos_taller
  for each row execute function public.asignar_numero_ot();

drop trigger if exists trg_trabajos_taller_actualizado_en on public.trabajos_taller;
create trigger trg_trabajos_taller_actualizado_en
  before update on public.trabajos_taller
  for each row execute function public.actualizar_marca_de_tiempo();

-- ---------------------------------------------------------------------------
-- Tabla inspecciones_ingreso: la inspección de ingreso + firma. Una por
-- trabajo (la revisión del asesor del Tipo B vive en esta misma fila; el
-- RADAR del técnico del Tipo A es una tabla aparte, radar_inspecciones,
-- del Bloque 6).
-- ---------------------------------------------------------------------------
create table if not exists public.inspecciones_ingreso (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references public.trabajos_taller (id) on delete restrict,
  danos_visibles text,
  accesorios text,
  observaciones text,
  preguntas_descubrimiento jsonb,
  firma_png text,
  firmado_por text,
  firmado_en timestamptz,
  creado_en timestamptz not null default now(),
  constraint uq_inspeccion_por_trabajo unique (trabajo_id)
);

comment on table public.inspecciones_ingreso is 'Inspección de ingreso (ambos tipos) + firma del cliente.';
comment on column public.inspecciones_ingreso.preguntas_descubrimiento is 'Solo Tipo A (diagnóstico): respuestas a las preguntas de descubrimiento del asesor.';
comment on column public.inspecciones_ingreso.firma_png is 'Imagen de la firma (dataURL PNG). Volumen bajo hoy; revisar si conviene mover a Storage cuando el Bloque 6 agregue fotos.';

create index if not exists inspecciones_ingreso_trabajo_idx on public.inspecciones_ingreso (trabajo_id);

-- ---------------------------------------------------------------------------
-- RLS. El alta de ingreso es tarea del asesor (según el spec: "1 · RECEPCIÓN
-- asesor"); admin y socia pueden hacerlo también por su acceso total. Leer y
-- avanzar el estado queda abierto a cualquier persona activa de la empresa,
-- igual que en clientes/vehículos -las restricciones finas de precio llegan
-- con ot_detalle en el Bloque 5-.
-- ---------------------------------------------------------------------------
alter table public.trabajos_taller enable row level security;
alter table public.inspecciones_ingreso enable row level security;

drop policy if exists trabajos_taller_select on public.trabajos_taller;
create policy trabajos_taller_select on public.trabajos_taller
  for select
  using (empresa_id = public.mi_empresa_id());

drop policy if exists trabajos_taller_insert on public.trabajos_taller;
create policy trabajos_taller_insert on public.trabajos_taller
  for insert
  with check (
    empresa_id = public.mi_empresa_id()
    and (public.es_asesor() or public.es_admin() or public.es_socia())
  );

drop policy if exists trabajos_taller_update on public.trabajos_taller;
create policy trabajos_taller_update on public.trabajos_taller
  for update
  using (empresa_id = public.mi_empresa_id() and public.auth_rol() is not null)
  with check (empresa_id = public.mi_empresa_id());

drop policy if exists inspecciones_ingreso_select on public.inspecciones_ingreso;
create policy inspecciones_ingreso_select on public.inspecciones_ingreso
  for select
  using (exists (
    select 1 from public.trabajos_taller t
    where t.id = inspecciones_ingreso.trabajo_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists inspecciones_ingreso_insert on public.inspecciones_ingreso;
create policy inspecciones_ingreso_insert on public.inspecciones_ingreso
  for insert
  with check (
    (public.es_asesor() or public.es_admin() or public.es_socia())
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

drop policy if exists inspecciones_ingreso_update on public.inspecciones_ingreso;
create policy inspecciones_ingreso_update on public.inspecciones_ingreso
  for update
  using (
    (public.es_asesor() or public.es_admin() or public.es_socia())
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = inspecciones_ingreso.trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select siguiente_numero_ot from public.empresas where nombre = 'Servicio Automotriz Didial Ltda.') as siguiente_numero_ot_didial_esperado_14000,
  (select relrowsecurity from pg_class where relname = 'trabajos_taller') as rls_trabajos_taller_esperado_true,
  (select relrowsecurity from pg_class where relname = 'inspecciones_ingreso') as rls_inspecciones_esperado_true,
  (select count(*) from pg_proc where proname = 'asignar_numero_ot') as funcion_numero_ot_esperado_1;
