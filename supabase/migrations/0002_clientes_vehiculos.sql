-- =============================================================================
-- 0002_clientes_vehiculos.sql
--
-- Qué resuelve:
--   El núcleo del CRM: `clientes` y `vehiculos`. Casi todo lo que se construya
--   después cuelga de estas dos tablas, así que las defensas van desde esta
--   primera migración, no se agregan después:
--
--     - Patente: columna legible (`patente`) + `patente_norm` generada
--       (solo alfanuméricos, mayúsculas) con índice ÚNICO por empresa. Toda
--       búsqueda futura debe ir contra `patente_norm`, nunca contra `patente`.
--     - RUT: `rut_norm` generado + validación de dígito verificador (módulo
--       11) como CHECK. Índice normal por ahora, NO único: la migración de
--       datos reales de Didial todavía no pasó y hoy solo el 8,7% de los
--       clientes tiene RUT cargado -es esperable que haya duplicados sin
--       resolver-. El índice único se agrega en una migración posterior,
--       después de fusionar duplicados (definición pendiente #2 del spec).
--     - Teléfono: `telefono_norm` generado a formato internacional (+56...).
--     - Detección de duplicados: función `clientes_buscar_posibles_duplicados`
--       para que el frontend avise ANTES de insertar (no es un constraint:
--       un aviso que se puede ignorar, no un bloqueo).
--     - Cliente-Vehículo es muchos-a-muchos (una tabla puente), no una FK
--       simple `vehiculo.cliente_id`: un vehículo puede tener más de un
--       dueño/conductor (empresas con flota, matrimonios). Idea tomada de la
--       documentación de arquitectura de la plataforma (VPAI), no estaba en
--       el spec original de Didial pero encaja con casos reales del taller.
--     - Eliminar (lógicamente) una ficha de cliente o vehículo: solo admin.
--       Se aplica con un trigger, no con RLS, porque la política de acceso
--       no puede distinguir "solo cambié el teléfono" de "estoy anulando la
--       ficha" dentro del mismo UPDATE.
--     - ON DELETE RESTRICT (nunca CASCADE) entre clientes/vehículos y la
--       tabla puente: un DELETE físico accidental no debe poder arrastrar
--       historial. El borrado real de una ficha siempre es lógico
--       (`eliminado_en`), la fila nunca se borra de verdad salvo mantención
--       manual de un admin.
-- =============================================================================

create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- Funciones de normalización. IMMUTABLE: son puras (mismo input -> mismo
-- output siempre), lo que permite usarlas en columnas GENERATED.
-- ---------------------------------------------------------------------------
create or replace function public.normalizar_patente(patente text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(patente, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

create or replace function public.normalizar_rut(rut text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(rut, ''), '[^0-9kK]', '', 'g'));
$$;

-- Dígito verificador chileno (módulo 11) a partir del cuerpo del RUT (sin DV).
create or replace function public.rut_dv_calculado(cuerpo text)
returns text
language plpgsql
immutable
as $$
declare
  suma integer := 0;
  multiplicador integer := 2;
  i integer;
  digito integer;
  resto integer;
begin
  if cuerpo is null or cuerpo = '' or cuerpo !~ '^[0-9]+$' then
    return null;
  end if;

  for i in reverse length(cuerpo)..1 loop
    digito := substring(cuerpo from i for 1)::integer;
    suma := suma + digito * multiplicador;
    multiplicador := multiplicador + 1;
    if multiplicador > 7 then
      multiplicador := 2;
    end if;
  end loop;

  resto := 11 - (suma % 11);
  if resto = 11 then
    return '0';
  elsif resto = 10 then
    return 'K';
  else
    return resto::text;
  end if;
end;
$$;

create or replace function public.rut_valido(rut text)
returns boolean
language plpgsql
immutable
as $$
declare
  limpio text;
  cuerpo text;
  dv_ingresado text;
begin
  if rut is null then
    return true; -- la columna es opcional; NULL se valida por separado en el CHECK
  end if;

  limpio := public.normalizar_rut(rut);
  if length(limpio) < 2 then
    return false;
  end if;

  cuerpo := substring(limpio from 1 for length(limpio) - 1);
  dv_ingresado := substring(limpio from length(limpio) for 1);

  return dv_ingresado = public.rut_dv_calculado(cuerpo);
end;
$$;

-- Heurística de normalización a formato internacional chileno. No reemplaza
-- una librería completa de telefonía, pero cubre los casos reales: número ya
-- con 56, celular de 9 dígitos sin 56, o de 8 dígitos sin el 9 inicial.
create or replace function public.normalizar_telefono(telefono text)
returns text
language plpgsql
immutable
as $$
declare
  solo_digitos text;
begin
  if telefono is null or trim(telefono) = '' then
    return null;
  end if;

  solo_digitos := regexp_replace(telefono, '[^0-9]', '', 'g');

  if solo_digitos = '' then
    return null;
  elsif solo_digitos like '56%' then
    return '+' || solo_digitos;
  elsif length(solo_digitos) = 9 then
    return '+56' || solo_digitos;
  elsif length(solo_digitos) = 8 then
    return '+569' || solo_digitos;
  else
    return '+' || solo_digitos;
  end if;
end;
$$;

create or replace function public.actualizar_marca_de_tiempo()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- Solo un admin puede eliminar (lógicamente) una ficha de cliente o vehículo.
-- Se revisa en un trigger, no en RLS, porque hay que distinguir "cambié el
-- teléfono" de "estoy anulando la ficha" dentro del mismo UPDATE.
create or replace function public.impedir_eliminacion_logica_sin_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.eliminado_en is distinct from old.eliminado_en and not public.es_admin() then
    raise exception 'Solo un administrador puede eliminar (lógicamente) esta ficha.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tabla clientes.
-- ---------------------------------------------------------------------------
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  tipo text not null default 'persona' check (tipo in ('persona', 'empresa')),
  rut text,
  rut_norm text generated always as (public.normalizar_rut(rut)) stored,
  nombre text not null,
  apellido text,
  razon_social text,
  telefono text,
  telefono_norm text generated always as (public.normalizar_telefono(telefono)) stored,
  telefono_alt text,
  email text,
  direccion text,
  notas text,
  activo boolean not null default true,
  eliminado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint chk_clientes_rut_valido check (rut is null or public.rut_valido(rut))
);

comment on table public.clientes is 'Núcleo del CRM. Casi todo cuelga de aquí: cuidar duplicados y datos mal cargados.';
comment on column public.clientes.rut_norm is 'Solo dígitos + dígito verificador, sin puntos ni guión. Toda búsqueda va contra esta columna.';
comment on column public.clientes.telefono_norm is 'Formato internacional (+56...). Heurística, no reemplaza una librería de telefonía.';
comment on column public.clientes.eliminado_en is 'Borrado lógico. Solo un admin puede fijar esta columna (ver trigger impedir_eliminacion_logica_sin_admin).';

create index if not exists clientes_empresa_idx on public.clientes (empresa_id);
create index if not exists clientes_rut_norm_idx on public.clientes (empresa_id, rut_norm) where rut_norm is not null;
create index if not exists clientes_telefono_norm_idx on public.clientes (empresa_id, telefono_norm) where telefono_norm is not null;
create index if not exists clientes_nombre_trgm_idx on public.clientes using gin (nombre gin_trgm_ops);
create index if not exists clientes_razon_social_trgm_idx on public.clientes using gin (razon_social gin_trgm_ops) where razon_social is not null;
create index if not exists clientes_activos_idx on public.clientes (empresa_id, activo) where eliminado_en is null;

drop trigger if exists trg_clientes_actualizado_en on public.clientes;
create trigger trg_clientes_actualizado_en
  before update on public.clientes
  for each row execute function public.actualizar_marca_de_tiempo();

drop trigger if exists trg_clientes_eliminacion_admin on public.clientes;
create trigger trg_clientes_eliminacion_admin
  before update on public.clientes
  for each row execute function public.impedir_eliminacion_logica_sin_admin();

-- ---------------------------------------------------------------------------
-- Tabla vehiculos.
-- ---------------------------------------------------------------------------
create table if not exists public.vehiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  patente text not null,
  patente_norm text generated always as (public.normalizar_patente(patente)) stored,
  marca text not null,
  modelo text not null,
  anio integer check (anio is null or anio between 1950 and 2100),
  color text,
  vin text,
  motor text,
  kilometraje integer check (kilometraje is null or kilometraje >= 0),
  tipo_combustible text check (tipo_combustible is null or tipo_combustible in ('bencina', 'diesel', 'electrico', 'hibrido', 'gas')),
  notas text,
  activo boolean not null default true,
  eliminado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.vehiculos is 'Activo principal del taller. Historial único: cuelgan años de OTs de cada fila.';
comment on column public.vehiculos.patente_norm is 'Solo alfanumérico, mayúsculas. Única por empresa. Toda búsqueda va contra esta columna.';
comment on column public.vehiculos.kilometraje is 'Hoy solo el 35% de los vehículos lo tiene cargado; captura obligatoria desde el ingreso (Bloque 3).';

create unique index if not exists vehiculos_patente_empresa_uk on public.vehiculos (empresa_id, patente_norm);
create index if not exists vehiculos_empresa_idx on public.vehiculos (empresa_id);
create index if not exists vehiculos_marca_modelo_idx on public.vehiculos (empresa_id, marca, modelo);
create index if not exists vehiculos_activos_idx on public.vehiculos (empresa_id, activo) where eliminado_en is null;

drop trigger if exists trg_vehiculos_actualizado_en on public.vehiculos;
create trigger trg_vehiculos_actualizado_en
  before update on public.vehiculos
  for each row execute function public.actualizar_marca_de_tiempo();

drop trigger if exists trg_vehiculos_eliminacion_admin on public.vehiculos;
create trigger trg_vehiculos_eliminacion_admin
  before update on public.vehiculos
  for each row execute function public.impedir_eliminacion_logica_sin_admin();

-- ---------------------------------------------------------------------------
-- Tabla puente clientes_vehiculos: un vehículo puede tener más de un
-- dueño/conductor (flota de una empresa cliente, matrimonios).
-- ---------------------------------------------------------------------------
create table if not exists public.clientes_vehiculos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  vehiculo_id uuid not null references public.vehiculos (id) on delete restrict,
  es_propietario boolean not null default true,
  es_conductor boolean not null default false,
  creado_en timestamptz not null default now(),
  constraint uq_cliente_vehiculo unique (cliente_id, vehiculo_id)
);

comment on table public.clientes_vehiculos is 'Relación muchos-a-muchos entre clientes y vehículos.';

create index if not exists clientes_vehiculos_cliente_idx on public.clientes_vehiculos (cliente_id);
create index if not exists clientes_vehiculos_vehiculo_idx on public.clientes_vehiculos (vehiculo_id);

-- ---------------------------------------------------------------------------
-- Detección de duplicados: se llama ANTES de insertar (aviso, no bloqueo).
-- Empareja por RUT exacto, teléfono exacto o similitud de nombre (trigram).
-- ---------------------------------------------------------------------------
create or replace function public.clientes_buscar_posibles_duplicados(
  p_rut text default null,
  p_telefono text default null,
  p_nombre text default null
)
returns table (
  id uuid,
  nombre text,
  apellido text,
  razon_social text,
  rut text,
  telefono text,
  motivo text,
  similitud real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.nombre,
    c.apellido,
    c.razon_social,
    c.rut,
    c.telefono,
    case
      when p_rut is not null and c.rut_norm = public.normalizar_rut(p_rut) then 'rut'
      when p_telefono is not null and c.telefono_norm = public.normalizar_telefono(p_telefono) then 'telefono'
      else 'nombre'
    end as motivo,
    greatest(
      similarity(coalesce(c.nombre, ''), coalesce(p_nombre, '')),
      similarity(coalesce(c.razon_social, ''), coalesce(p_nombre, ''))
    ) as similitud
  from public.clientes c
  where c.empresa_id = public.mi_empresa_id()
    and c.eliminado_en is null
    and (
      (p_rut is not null and c.rut_norm = public.normalizar_rut(p_rut))
      or (p_telefono is not null and c.telefono_norm = public.normalizar_telefono(p_telefono))
      or (p_nombre is not null and (
        similarity(coalesce(c.nombre, ''), p_nombre) > 0.4
        or similarity(coalesce(c.razon_social, ''), p_nombre) > 0.4
      ))
    )
  order by similitud desc nulls last
  limit 10;
$$;

-- ---------------------------------------------------------------------------
-- RLS: acotado por empresa. Cualquier persona activa de la empresa puede
-- leer, crear y editar; solo el trigger de arriba permite (o no) el borrado
-- lógico. Sin policy de DELETE físico: nadie puede borrar la fila de verdad
-- desde la app.
-- ---------------------------------------------------------------------------
alter table public.clientes enable row level security;
alter table public.vehiculos enable row level security;
alter table public.clientes_vehiculos enable row level security;

drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
  for select
  using (empresa_id = public.mi_empresa_id());

drop policy if exists clientes_insert on public.clientes;
create policy clientes_insert on public.clientes
  for insert
  with check (empresa_id = public.mi_empresa_id() and public.auth_rol() is not null);

drop policy if exists clientes_update on public.clientes;
create policy clientes_update on public.clientes
  for update
  using (empresa_id = public.mi_empresa_id() and public.auth_rol() is not null)
  with check (empresa_id = public.mi_empresa_id());

drop policy if exists vehiculos_select on public.vehiculos;
create policy vehiculos_select on public.vehiculos
  for select
  using (empresa_id = public.mi_empresa_id());

drop policy if exists vehiculos_insert on public.vehiculos;
create policy vehiculos_insert on public.vehiculos
  for insert
  with check (empresa_id = public.mi_empresa_id() and public.auth_rol() is not null);

drop policy if exists vehiculos_update on public.vehiculos;
create policy vehiculos_update on public.vehiculos
  for update
  using (empresa_id = public.mi_empresa_id() and public.auth_rol() is not null)
  with check (empresa_id = public.mi_empresa_id());

drop policy if exists clientes_vehiculos_select on public.clientes_vehiculos;
create policy clientes_vehiculos_select on public.clientes_vehiculos
  for select
  using (exists (
    select 1 from public.clientes c
    where c.id = clientes_vehiculos.cliente_id and c.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists clientes_vehiculos_insert on public.clientes_vehiculos;
create policy clientes_vehiculos_insert on public.clientes_vehiculos
  for insert
  with check (
    public.auth_rol() is not null
    and exists (select 1 from public.clientes c where c.id = cliente_id and c.empresa_id = public.mi_empresa_id())
    and exists (select 1 from public.vehiculos v where v.id = vehiculo_id and v.empresa_id = public.mi_empresa_id())
  );

drop policy if exists clientes_vehiculos_update on public.clientes_vehiculos;
create policy clientes_vehiculos_update on public.clientes_vehiculos
  for update
  using (exists (
    select 1 from public.clientes c
    where c.id = clientes_vehiculos.cliente_id and c.empresa_id = public.mi_empresa_id()
  ))
  with check (
    exists (select 1 from public.clientes c where c.id = cliente_id and c.empresa_id = public.mi_empresa_id())
    and exists (select 1 from public.vehiculos v where v.id = vehiculo_id and v.empresa_id = public.mi_empresa_id())
  );

drop policy if exists clientes_vehiculos_delete on public.clientes_vehiculos;
create policy clientes_vehiculos_delete on public.clientes_vehiculos
  for delete
  using (exists (
    select 1 from public.clientes c
    where c.id = clientes_vehiculos.cliente_id and c.empresa_id = public.mi_empresa_id()
  ));

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  public.rut_valido('12.345.678-5') as rut_conocido_valido_esperado_true,
  public.rut_valido('12.345.678-9') as rut_conocido_invalido_esperado_false,
  public.normalizar_patente('gh ty 34') as patente_normalizada_esperado_ghty34,
  public.normalizar_telefono('987654321') as telefono_normalizado_esperado_mas56987654321,
  (select relrowsecurity from pg_class where relname = 'clientes') as rls_clientes_esperado_true,
  (select relrowsecurity from pg_class where relname = 'vehiculos') as rls_vehiculos_esperado_true,
  (select relrowsecurity from pg_class where relname = 'clientes_vehiculos') as rls_puente_esperado_true,
  (select count(*) from pg_indexes where indexname = 'vehiculos_patente_empresa_uk') as indice_patente_unico_esperado_1,
  (select count(*) from pg_proc where proname in (
    'normalizar_patente', 'normalizar_rut', 'rut_dv_calculado', 'rut_valido',
    'normalizar_telefono', 'actualizar_marca_de_tiempo',
    'impedir_eliminacion_logica_sin_admin', 'clientes_buscar_posibles_duplicados'
  )) as funciones_creadas_esperado_8;
