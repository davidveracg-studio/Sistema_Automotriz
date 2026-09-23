-- =============================================================================
-- 0001_esquema_roles.sql
--
-- Qué resuelve:
--   Base de autenticación, multi-tenancy y permisos. Este CRM es el primer
--   producto construido sobre una arquitectura multi-tenant (cada taller es
--   una fila de `empresas`); Servicio Automotriz Didial Ltda. es el primer
--   tenant. Crea `empresas`, la tabla `usuarios` (perfil de cada persona del
--   equipo, vinculado 1:1 a auth.users y a una empresa), las funciones
--   auxiliares para RLS (auth_rol, es_admin, es_asesor, etc.) y las políticas
--   de acceso descritas en la sección "Personas y roles" de la especificación:
--     - Montos y márgenes: socia, admin, encargado de presupuestos, jefe de taller.
--     - Eliminar fichas de cliente o vehículo: solo admin (borrado lógico, en
--       una migración futura cuando existan esas tablas).
--     - Técnicos: ven y completan lo suyo, no editan precios.
--
--   Los roles se guardan con el nombre real de la función en el taller
--   (asesor, jefe_taller, encargado_presupuestos, detailer...) y no con la
--   taxonomía genérica R00-R09 de la documentación de arquitectura de la
--   plataforma (VPAI): esa taxonomía todavía no cubre roles que sí existen en
--   la operación real de Didial (encargado_presupuestos, detailer, y una
--   recepcionista separada del asesor). Cuando haya un segundo tenant con
--   necesidades distintas, ahí se decide si conviene generalizar.
--
--   Las funciones son SECURITY DEFINER + STABLE para poder usarse dentro de
--   políticas RLS sin que cada política tenga que repetir el JOIN contra
--   `usuarios`, y para evitar recursión (una policy de `usuarios` que hiciera
--   SELECT sobre `usuarios` directamente se llamaría a sí misma).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tabla empresas: un tenant por taller. Servicio Automotriz Didial Ltda. es
-- el primero; el resto del esquema (usuarios, y en bloques futuros clientes,
-- vehículos, OTs) siempre cuelga de una empresa vía empresa_id.
-- ---------------------------------------------------------------------------
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  direccion text,
  telefono text,
  correo text,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

comment on table public.empresas is 'Un tenant por taller.';

-- Versión de portafolio/demo: el tenant real de este esquema se siembra
-- aparte (ver 0036_tenant_demo_vpai.sql), no acá -el proyecto original del
-- que se adaptó este esquema sembraba su primer tenant en esta misma
-- migración, con datos reales del cliente que no corresponden en una demo
-- pública.

-- ---------------------------------------------------------------------------
-- Tabla usuarios: perfil de cada persona del equipo, dentro de una empresa.
--
-- El nombre completo se guarda siempre (nunca solo el de pila): cualquier
-- medición por persona -comisiones, retrabajos, productividad- depende de
-- poder distinguir sin ambigüedad quién hizo qué. El correo es el
-- identificador de cruce con sistemas externos (ClickUp), nunca el nombre.
--
-- rol puede quedar en NULL para una cuenta recién creada por el trigger de
-- abajo: significa "pendiente de asignar" y no otorga ningún permiso hasta
-- que un admin lo complete.
-- ---------------------------------------------------------------------------
create table if not exists public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id),
  nombre_completo text not null default '',
  correo text not null unique,
  rol text check (
    rol is null or rol in (
      'socia',
      'admin',
      'asesor',
      'jefe_taller',
      'encargado_presupuestos',
      'tecnico',
      'detailer',
      'recepcionista'
    )
  ),
  activo boolean not null default false,
  creado_en timestamptz not null default now()
);

comment on table public.usuarios is 'Perfil, rol y empresa (tenant) de cada persona del equipo. 1:1 con auth.users.';
comment on column public.usuarios.empresa_id is 'Tenant al que pertenece. Toda política RLS de esta tabla y de las que sigan debe filtrar por esto.';
comment on column public.usuarios.rol is 'NULL = pendiente de asignar por un admin. No otorga permisos.';
comment on column public.usuarios.correo is 'Identificador de cruce con sistemas externos (ej. ClickUp). Nunca usar nombre_completo para eso.';

create index if not exists usuarios_empresa_idx on public.usuarios (empresa_id);
create index if not exists usuarios_rol_idx on public.usuarios (empresa_id, rol) where activo;

-- ---------------------------------------------------------------------------
-- Alta automática del perfil cuando se crea una cuenta en auth.users.
-- Queda inactiva y sin rol: el admin la activa y le asigna el rol desde el CRM.
--
-- empresa_id se toma de raw_user_meta_data si el alta lo especifica (así
-- deberá hacerlo la futura Edge Function de invitación, una vez exista más de
-- un tenant). Mientras Didial sea la única empresa, se usa como resguardo la
-- primera empresa activa que exista -no hay ambigüedad posible con un solo
-- tenant-. Ese resguardo deja de ser válido en cuanto se dé de alta un
-- segundo tenant: en ese momento la Edge Function de invitación pasa a ser
-- obligatoria y este fallback debe eliminarse.
-- ---------------------------------------------------------------------------
create or replace function public.manejar_usuario_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa_id uuid;
begin
  v_empresa_id := nullif(new.raw_user_meta_data ->> 'empresa_id', '')::uuid;

  if v_empresa_id is null then
    select id into v_empresa_id from public.empresas where activa = true order by creado_en asc limit 1;
  end if;

  insert into public.usuarios (id, empresa_id, correo, nombre_completo)
  values (
    new.id,
    v_empresa_id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nombre_completo', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.manejar_usuario_nuevo();

-- ---------------------------------------------------------------------------
-- Funciones auxiliares para RLS.
-- STABLE: dentro de una misma sentencia SQL, Postgres puede cachear el
-- resultado en lugar de recalcularlo por cada fila evaluada.
-- ---------------------------------------------------------------------------
create or replace function public.mi_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select empresa_id from public.usuarios where id = auth.uid() and activo = true;
$$;

create or replace function public.auth_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.usuarios where id = auth.uid() and activo = true;
$$;

create or replace function public.es_socia()
returns boolean language sql stable security definer set search_path = public
as $$ select public.auth_rol() = 'socia'; $$;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select public.auth_rol() = 'admin'; $$;

create or replace function public.es_asesor()
returns boolean language sql stable security definer set search_path = public
as $$ select public.auth_rol() = 'asesor'; $$;

create or replace function public.es_jefe_taller()
returns boolean language sql stable security definer set search_path = public
as $$ select public.auth_rol() = 'jefe_taller'; $$;

create or replace function public.es_encargado_presupuestos()
returns boolean language sql stable security definer set search_path = public
as $$ select public.auth_rol() = 'encargado_presupuestos'; $$;

create or replace function public.es_tecnico()
returns boolean language sql stable security definer set search_path = public
as $$ select public.auth_rol() = 'tecnico'; $$;

create or replace function public.es_detailer()
returns boolean language sql stable security definer set search_path = public
as $$ select public.auth_rol() = 'detailer'; $$;

create or replace function public.es_recepcionista()
returns boolean language sql stable security definer set search_path = public
as $$ select public.auth_rol() = 'recepcionista'; $$;

-- Socia, admin, encargado de presupuestos y jefe de taller: los únicos que
-- ven montos y márgenes (sección "Permisos" de la especificación).
create or replace function public.tiene_acceso_montos()
returns boolean language sql stable security definer set search_path = public
as $$
  select public.auth_rol() in ('socia', 'admin', 'encargado_presupuestos', 'jefe_taller');
$$;

-- Solo admin puede eliminar (lógicamente) fichas de cliente o vehículo.
create or replace function public.puede_eliminar_fichas()
returns boolean language sql stable security definer set search_path = public
as $$ select public.es_admin(); $$;

-- ---------------------------------------------------------------------------
-- RLS de empresas: cada quien lee solo la suya. Sin policy de insert/update/
-- delete todavía -alta de tenants es tarea de servicio, no de la app-.
-- ---------------------------------------------------------------------------
alter table public.empresas enable row level security;

drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas
  for select
  using (id = public.mi_empresa_id());

-- ---------------------------------------------------------------------------
-- RLS de la tabla usuarios: todo queda acotado a la propia empresa, además
-- de a la persona o a admin/socia.
-- ---------------------------------------------------------------------------
alter table public.usuarios enable row level security;

drop policy if exists usuarios_select on public.usuarios;
create policy usuarios_select on public.usuarios
  for select
  using (
    id = auth.uid()
    or (empresa_id = public.mi_empresa_id() and (public.es_admin() or public.es_socia()))
  );

drop policy if exists usuarios_update on public.usuarios;
create policy usuarios_update on public.usuarios
  for update
  using (empresa_id = public.mi_empresa_id() and public.es_admin())
  with check (empresa_id = public.mi_empresa_id() and public.es_admin());

-- El insert real lo hace el trigger (security definer), no un usuario final;
-- esta policy solo cubre el caso de que un admin cree el perfil a mano.
drop policy if exists usuarios_insert on public.usuarios;
create policy usuarios_insert on public.usuarios
  for insert
  with check (empresa_id = public.mi_empresa_id() and public.es_admin());

-- ---------------------------------------------------------------------------
-- Verificación: deben existir las 12 funciones, ambas tablas con RLS activo,
-- y la empresa Didial debe existir.
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname in (
    'mi_empresa_id', 'auth_rol', 'es_socia', 'es_admin', 'es_asesor',
    'es_jefe_taller', 'es_encargado_presupuestos', 'es_tecnico', 'es_detailer',
    'es_recepcionista', 'tiene_acceso_montos', 'puede_eliminar_fichas'
  )) as funciones_creadas_esperado_12,
  (select relrowsecurity from pg_class where relname = 'usuarios') as rls_usuarios_esperado_true,
  (select relrowsecurity from pg_class where relname = 'empresas') as rls_empresas_esperado_true,
  (select count(*) from public.empresas where nombre = 'Servicio Automotriz Didial Ltda.') as empresa_didial_esperado_1;
