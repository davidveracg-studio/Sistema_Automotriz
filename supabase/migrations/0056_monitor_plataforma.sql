-- =============================================================================
-- 0056_monitor_plataforma.sql
--
-- Qué resuelve:
--   Base de datos del "Monitor de plataforma": un panel INDEPENDIENTE del CRM
--   (otra app, otra URL, su propio login) para que el dueño de la plataforma
--   vea accesos y uso del CRM en todas las empresas (tenants).
--
--   - plataforma_admins: quién puede entrar al monitor. Es una lista aparte
--     de los usuarios/roles del CRM: ningún rol del CRM (ni admin ni socia)
--     ve estos datos, y el monitor no depende del rol de nadie en una empresa.
--   - uso_eventos: bitácora de uso que escribe el propio CRM (login, vista de
--     pantalla, error del navegador). Nadie la lee directo -RLS sin políticas-:
--     solo se escribe por registrar_eventos_uso (que toma empresa y usuario de
--     la sesión, no del cliente) y solo se lee por las funciones plataforma_*.
--   - uso_accesos_fallidos: intentos de ingreso rechazados (Supabase no los
--     guarda en ninguna tabla consultable). Se escribe por
--     registrar_acceso_fallido, que es lo único que puede llamar alguien SIN
--     sesión -por eso tiene tope por hora, para que nadie pueda inflar la
--     tabla-.
--   - Funciones plataforma_*: todas exigen ser plataforma_admin (si no,
--     lanzan error) y se pueden filtrar por empresa; por defecto excluyen la
--     empresa demo, para que las pruebas no ensucien las métricas reales.
--   - "Acciones clave" (OT, presupuestos, documentos, ventas, citas) NO se
--     registran aparte: se cuentan directo de las tablas del negocio, para que
--     el monitor nunca discrepe con lo que de verdad existe.
--   - Hora local de los días y del mapa de calor: America/Santiago.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Quién puede ver el monitor.
-- ---------------------------------------------------------------------------
create table if not exists public.plataforma_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  creado_en timestamptz not null default now()
);

comment on table public.plataforma_admins is 'Dueños de la plataforma con acceso al Monitor. Lista aparte de usuarios/roles del CRM. Se administra por SQL, no desde ninguna pantalla.';

alter table public.plataforma_admins enable row level security;
-- Sin políticas a propósito: nadie la lee ni escribe por la API; solo las funciones SECURITY DEFINER.

create or replace function public.es_plataforma_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.plataforma_admins pa where pa.user_id = auth.uid())
$$;

-- Lanza error si quien llama no es plataforma_admin; devuelve true si lo es
-- (para usarla en un WHERE de las funciones de consulta).
create or replace function public.plataforma_exigir()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.plataforma_admins pa where pa.user_id = auth.uid()) then
    raise exception 'Sin acceso al monitor de plataforma.' using errcode = '42501';
  end if;
  return true;
end;
$$;

-- ¿Cuenta esta empresa para el filtro pedido? Con una empresa elegida, solo
-- esa; sin elegir, todas -y la demo solo si se pidió incluirla-.
create or replace function public.plataforma_empresa_ok(p_empresa_id uuid, p_filtro uuid, p_demo boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_filtro is not null then p_empresa_id = p_filtro
    else p_demo or not coalesce((select e.es_demo from public.empresas e where e.id = p_empresa_id), false)
  end
$$;

-- ---------------------------------------------------------------------------
-- Bitácora de uso (la escribe el CRM).
-- ---------------------------------------------------------------------------
create table if not exists public.uso_eventos (
  id bigint generated always as identity primary key,
  empresa_id uuid references public.empresas (id) on delete cascade,
  usuario_id uuid references public.usuarios (id) on delete set null,
  rol text,
  tipo text not null check (tipo in ('login', 'vista', 'error')),
  ruta text,
  detalle text,
  dispositivo text,
  creado_en timestamptz not null default now()
);

comment on table public.uso_eventos is 'Bitácora de uso del CRM: login, vista de pantalla y error del navegador. Solo la lee el Monitor (funciones plataforma_*); se escribe por registrar_eventos_uso.';
comment on column public.uso_eventos.ruta is 'Ruta ya normalizada por el cliente (ids reemplazados por :id), ej. /trabajos/:id.';

create index if not exists uso_eventos_creado_idx on public.uso_eventos (creado_en desc);
create index if not exists uso_eventos_empresa_idx on public.uso_eventos (empresa_id, creado_en desc);
create index if not exists uso_eventos_usuario_idx on public.uso_eventos (usuario_id, creado_en desc);

alter table public.uso_eventos enable row level security;

create table if not exists public.uso_accesos_fallidos (
  id bigint generated always as identity primary key,
  correo text not null,
  dispositivo text,
  creado_en timestamptz not null default now()
);

comment on table public.uso_accesos_fallidos is 'Intentos de ingreso rechazados (correo tipeado y dispositivo, nunca la clave). Se escribe por registrar_acceso_fallido, lo único que puede llamar alguien sin sesión, con tope por hora.';

create index if not exists uso_accesos_fallidos_creado_idx on public.uso_accesos_fallidos (creado_en desc);

alter table public.uso_accesos_fallidos enable row level security;

-- ---------------------------------------------------------------------------
-- Escritura desde el CRM. Empresa, usuario y rol salen de la sesión, no de lo
-- que mande el navegador; tipos y largos se validan acá.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_eventos_uso(p_eventos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario public.usuarios%rowtype;
  v_evento jsonb;
  v_cantidad integer := 0;
begin
  if auth.uid() is null or p_eventos is null or jsonb_typeof(p_eventos) <> 'array' then
    return;
  end if;

  select * into v_usuario from public.usuarios u where u.id = auth.uid();
  if not found then
    return;
  end if;

  for v_evento in select * from jsonb_array_elements(p_eventos) loop
    exit when v_cantidad >= 50;
    if (v_evento ->> 'tipo') in ('login', 'vista', 'error') then
      insert into public.uso_eventos (empresa_id, usuario_id, rol, tipo, ruta, detalle, dispositivo)
      values (
        v_usuario.empresa_id, v_usuario.id, v_usuario.rol, v_evento ->> 'tipo',
        left(v_evento ->> 'ruta', 200), left(v_evento ->> 'detalle', 500), left(v_evento ->> 'dispositivo', 120)
      );
      v_cantidad := v_cantidad + 1;
    end if;
  end loop;
end;
$$;

create or replace function public.registrar_acceso_fallido(p_correo text, p_dispositivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Lo puede llamar cualquiera sin sesión: tope por hora para que no se pueda inflar la tabla.
  if (select count(*) from public.uso_accesos_fallidos f where f.creado_en > now() - interval '1 hour') >= 300 then
    return;
  end if;
  insert into public.uso_accesos_fallidos (correo, dispositivo)
  values (left(coalesce(p_correo, ''), 200), left(p_dispositivo, 120));
end;
$$;

grant execute on function public.registrar_eventos_uso(jsonb) to authenticated;
grant execute on function public.registrar_acceso_fallido(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lectura para el Monitor.
-- ---------------------------------------------------------------------------
create or replace function public.plataforma_kpis(
  p_desde timestamptz, p_hasta timestamptz, p_empresa uuid default null, p_demo boolean default false
)
returns table (
  logins bigint, usuarios_activos bigint, vistas bigint, errores_cliente bigint, accesos_fallidos bigint,
  ots_creadas bigint, presupuestos_creados bigint, documentos_emitidos bigint, ventas_pos bigint,
  citas_creadas bigint, errores_integracion bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.uso_eventos ue
      where ue.tipo = 'login' and ue.creado_en >= p_desde and ue.creado_en < p_hasta
        and public.plataforma_empresa_ok(ue.empresa_id, p_empresa, p_demo)),
    (select count(distinct ue.usuario_id) from public.uso_eventos ue
      where ue.creado_en >= p_desde and ue.creado_en < p_hasta
        and public.plataforma_empresa_ok(ue.empresa_id, p_empresa, p_demo)),
    (select count(*) from public.uso_eventos ue
      where ue.tipo = 'vista' and ue.creado_en >= p_desde and ue.creado_en < p_hasta
        and public.plataforma_empresa_ok(ue.empresa_id, p_empresa, p_demo)),
    (select count(*) from public.uso_eventos ue
      where ue.tipo = 'error' and ue.creado_en >= p_desde and ue.creado_en < p_hasta
        and public.plataforma_empresa_ok(ue.empresa_id, p_empresa, p_demo)),
    -- Un acceso fallido no pertenece a ninguna empresa: solo cuenta sin filtro de empresa.
    (select case when p_empresa is null then count(*) else 0 end from public.uso_accesos_fallidos f
      where f.creado_en >= p_desde and f.creado_en < p_hasta),
    (select count(*) from public.trabajos_taller t
      where t.creado_en >= p_desde and t.creado_en < p_hasta
        and public.plataforma_empresa_ok(t.empresa_id, p_empresa, p_demo)),
    (select count(*) from public.presupuestos_taller pt
      join public.trabajos_taller t on t.id = pt.trabajo_id
      where pt.creado_en >= p_desde and pt.creado_en < p_hasta
        and public.plataforma_empresa_ok(t.empresa_id, p_empresa, p_demo)),
    (select count(*) from public.documentos_tributarios d
      where d.estado = 'aceptado' and d.creado_en >= p_desde and d.creado_en < p_hasta
        and public.plataforma_empresa_ok(d.empresa_id, p_empresa, p_demo)),
    (select count(*) from public.ventas_directas v
      where v.estado = 'cerrada' and v.creado_en >= p_desde and v.creado_en < p_hasta
        and public.plataforma_empresa_ok(v.empresa_id, p_empresa, p_demo)),
    (select count(*) from public.citas c
      where c.creado_en >= p_desde and c.creado_en < p_hasta
        and public.plataforma_empresa_ok(c.empresa_id, p_empresa, p_demo)),
    (select count(*) from public.integraciones_clickup_errores ec
      where ec.creado_en >= p_desde and ec.creado_en < p_hasta
        and public.plataforma_empresa_ok(ec.empresa_id, p_empresa, p_demo))
    + (select count(*) from public.integraciones_brevo_errores eb
      where eb.creado_en >= p_desde and eb.creado_en < p_hasta
        and public.plataforma_empresa_ok(eb.empresa_id, p_empresa, p_demo))
  where public.plataforma_exigir()
$$;

create or replace function public.plataforma_serie_diaria(
  p_desde timestamptz, p_hasta timestamptz, p_empresa uuid default null, p_demo boolean default false
)
returns table (dia date, logins bigint, usuarios bigint, vistas bigint, errores bigint, ots bigint, presupuestos bigint)
language sql
stable
security definer
set search_path = public
as $$
  with dias as (
    select generate_series(
      (p_desde at time zone 'America/Santiago')::date,
      ((p_hasta - interval '1 second') at time zone 'America/Santiago')::date,
      interval '1 day'
    )::date as d
  ),
  ev as (
    select (ue.creado_en at time zone 'America/Santiago')::date as d,
           count(*) filter (where ue.tipo = 'login') as n_logins,
           count(distinct ue.usuario_id) as n_usuarios,
           count(*) filter (where ue.tipo = 'vista') as n_vistas,
           count(*) filter (where ue.tipo = 'error') as n_errores
    from public.uso_eventos ue
    where ue.creado_en >= p_desde and ue.creado_en < p_hasta
      and public.plataforma_empresa_ok(ue.empresa_id, p_empresa, p_demo)
    group by 1
  ),
  ot as (
    select (t.creado_en at time zone 'America/Santiago')::date as d, count(*) as n
    from public.trabajos_taller t
    where t.creado_en >= p_desde and t.creado_en < p_hasta
      and public.plataforma_empresa_ok(t.empresa_id, p_empresa, p_demo)
    group by 1
  ),
  pr as (
    select (pt.creado_en at time zone 'America/Santiago')::date as d, count(*) as n
    from public.presupuestos_taller pt
    join public.trabajos_taller t on t.id = pt.trabajo_id
    where pt.creado_en >= p_desde and pt.creado_en < p_hasta
      and public.plataforma_empresa_ok(t.empresa_id, p_empresa, p_demo)
    group by 1
  )
  select dias.d, coalesce(ev.n_logins, 0), coalesce(ev.n_usuarios, 0), coalesce(ev.n_vistas, 0),
         coalesce(ev.n_errores, 0), coalesce(ot.n, 0), coalesce(pr.n, 0)
  from dias
  left join ev on ev.d = dias.d
  left join ot on ot.d = dias.d
  left join pr on pr.d = dias.d
  where public.plataforma_exigir()
  order by dias.d
$$;

create or replace function public.plataforma_uso_modulos(
  p_desde timestamptz, p_hasta timestamptz, p_empresa uuid default null, p_demo boolean default false
)
returns table (modulo text, vistas bigint, usuarios bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(split_part(ue.ruta, '/', 2), ''), 'inicio') as m,
         count(*) as n_vistas,
         count(distinct ue.usuario_id) as n_usuarios
  from public.uso_eventos ue
  where ue.tipo = 'vista' and ue.creado_en >= p_desde and ue.creado_en < p_hasta
    and public.plataforma_empresa_ok(ue.empresa_id, p_empresa, p_demo)
    and public.plataforma_exigir()
  group by 1
  order by n_vistas desc
$$;

create or replace function public.plataforma_horas_pico(
  p_desde timestamptz, p_hasta timestamptz, p_empresa uuid default null, p_demo boolean default false
)
returns table (dia_semana integer, hora integer, eventos bigint)
language sql
stable
security definer
set search_path = public
as $$
  select extract(dow from ue.creado_en at time zone 'America/Santiago')::integer as dow,
         extract(hour from ue.creado_en at time zone 'America/Santiago')::integer as h,
         count(*) as n
  from public.uso_eventos ue
  where ue.tipo in ('vista', 'login') and ue.creado_en >= p_desde and ue.creado_en < p_hasta
    and public.plataforma_empresa_ok(ue.empresa_id, p_empresa, p_demo)
    and public.plataforma_exigir()
  group by 1, 2
$$;

create or replace function public.plataforma_usuarios(p_empresa uuid default null, p_demo boolean default false)
returns table (
  usuario_id uuid, nombre text, correo text, rol text, empresa text, es_demo boolean, activo boolean,
  ultimo_login timestamptz, ultima_actividad timestamptz, logins_30d bigint, vistas_30d bigint, dias_activos_30d bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id, u.nombre_completo, u.correo, u.rol, e.nombre, e.es_demo, u.activo,
    au.last_sign_in_at,
    (select max(ue.creado_en) from public.uso_eventos ue where ue.usuario_id = u.id),
    (select count(*) from public.uso_eventos ue
      where ue.usuario_id = u.id and ue.tipo = 'login' and ue.creado_en > now() - interval '30 days'),
    (select count(*) from public.uso_eventos ue
      where ue.usuario_id = u.id and ue.tipo = 'vista' and ue.creado_en > now() - interval '30 days'),
    (select count(distinct (ue.creado_en at time zone 'America/Santiago')::date) from public.uso_eventos ue
      where ue.usuario_id = u.id and ue.creado_en > now() - interval '30 days')
  from public.usuarios u
  join public.empresas e on e.id = u.empresa_id
  left join auth.users au on au.id = u.id
  where public.plataforma_exigir()
    and public.plataforma_empresa_ok(u.empresa_id, p_empresa, p_demo)
  order by e.nombre, u.nombre_completo
$$;

create or replace function public.plataforma_eventos(
  p_limite integer default 100, p_empresa uuid default null, p_demo boolean default false, p_tipo text default null
)
returns table (
  id bigint, creado_en timestamptz, tipo text, usuario text, rol text, empresa text,
  ruta text, detalle text, dispositivo text
)
language sql
stable
security definer
set search_path = public
as $$
  select ue.id, ue.creado_en, ue.tipo, u.nombre_completo, ue.rol, e.nombre, ue.ruta, ue.detalle, ue.dispositivo
  from public.uso_eventos ue
  left join public.usuarios u on u.id = ue.usuario_id
  left join public.empresas e on e.id = ue.empresa_id
  where public.plataforma_exigir()
    and public.plataforma_empresa_ok(ue.empresa_id, p_empresa, p_demo)
    and (p_tipo is null or ue.tipo = p_tipo)
  order by ue.creado_en desc
  limit least(greatest(coalesce(p_limite, 100), 1), 500)
$$;

create or replace function public.plataforma_accesos_fallidos(p_limite integer default 100)
returns table (creado_en timestamptz, correo text, dispositivo text, correo_conocido boolean)
language sql
stable
security definer
set search_path = public
as $$
  select f.creado_en, f.correo, f.dispositivo,
         exists (select 1 from public.usuarios u where lower(u.correo) = lower(f.correo))
  from public.uso_accesos_fallidos f
  where public.plataforma_exigir()
  order by f.creado_en desc
  limit least(greatest(coalesce(p_limite, 100), 1), 500)
$$;

-- Sesiones abiertas según Supabase Auth (trae la IP, que el navegador no
-- puede informar). plpgsql a propósito: si la versión de Auth no tiene una
-- columna, la función se crea igual y falla solo al llamarla, sin tumbar la
-- migración.
create or replace function public.plataforma_sesiones(p_empresa uuid default null, p_demo boolean default false)
returns table (
  usuario text, correo text, empresa text, iniciada timestamptz, ultima_renovacion timestamptz, ip text, navegador text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.plataforma_exigir();
  return query
    select u.nombre_completo, u.correo, e.nombre, s.created_at, coalesce(s.refreshed_at, s.updated_at)::timestamptz,
           host(s.ip)::text, s.user_agent
    from auth.sessions s
    join public.usuarios u on u.id = s.user_id
    join public.empresas e on e.id = u.empresa_id
    where public.plataforma_empresa_ok(u.empresa_id, p_empresa, p_demo)
    order by s.created_at desc
    limit 200;
end;
$$;

create or replace function public.plataforma_errores(
  p_desde timestamptz, p_hasta timestamptz, p_empresa uuid default null, p_demo boolean default false,
  p_limite integer default 200
)
returns table (creado_en timestamptz, origen text, empresa text, operacion text, mensaje text)
language sql
stable
security definer
set search_path = public
as $$
  select x.creado_en, x.origen, x.empresa, x.operacion, x.mensaje
  from (
    select ue.creado_en, 'navegador'::text as origen, e.nombre as empresa, ue.ruta as operacion, ue.detalle as mensaje
    from public.uso_eventos ue
    left join public.empresas e on e.id = ue.empresa_id
    where ue.tipo = 'error' and ue.creado_en >= p_desde and ue.creado_en < p_hasta
      and public.plataforma_empresa_ok(ue.empresa_id, p_empresa, p_demo)
    union all
    select ec.creado_en, 'clickup'::text, e.nombre, ec.operacion, ec.mensaje
    from public.integraciones_clickup_errores ec
    left join public.empresas e on e.id = ec.empresa_id
    where ec.creado_en >= p_desde and ec.creado_en < p_hasta
      and public.plataforma_empresa_ok(ec.empresa_id, p_empresa, p_demo)
    union all
    select eb.creado_en, 'brevo'::text, e.nombre, eb.operacion, eb.mensaje
    from public.integraciones_brevo_errores eb
    left join public.empresas e on e.id = eb.empresa_id
    where eb.creado_en >= p_desde and eb.creado_en < p_hasta
      and public.plataforma_empresa_ok(eb.empresa_id, p_empresa, p_demo)
  ) x
  where public.plataforma_exigir()
  order by x.creado_en desc
  limit least(greatest(coalesce(p_limite, 200), 1), 500)
$$;

create or replace function public.plataforma_empresas()
returns table (id uuid, nombre text, es_demo boolean, usuarios_activos bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.nombre, e.es_demo, (select count(*) from public.usuarios u where u.empresa_id = e.id and u.activo)
  from public.empresas e
  where public.plataforma_exigir()
  order by e.es_demo, e.nombre
$$;

-- La bitácora crece sola; esto la poda a mano (no hay cron garantizado).
create or replace function public.plataforma_limpiar_uso(p_dias integer default 180)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_borrados bigint;
begin
  perform public.plataforma_exigir();
  delete from public.uso_eventos ue where ue.creado_en < now() - make_interval(days => greatest(p_dias, 30));
  get diagnostics v_borrados = row_count;
  delete from public.uso_accesos_fallidos f where f.creado_en < now() - make_interval(days => greatest(p_dias, 30));
  return v_borrados;
end;
$$;

-- Solo sesiones iniciadas pueden llamar a las funciones del monitor (y aun
-- así cada una exige ser plataforma_admin).
do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'plataforma\_%' or p.proname = 'es_plataforma_admin')
  loop
    execute format('revoke execute on function %s from public, anon', v_fn.firma);
    execute format('grant execute on function %s to authenticated', v_fn.firma);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'plataforma\_%' or p.proname = 'es_plataforma_admin')) as funciones_esperado_14,
  (select count(*) from pg_class where relname in ('plataforma_admins', 'uso_eventos', 'uso_accesos_fallidos') and relrowsecurity) as tablas_con_rls_esperado_3,
  (select count(*) from pg_policies where tablename in ('plataforma_admins', 'uso_eventos', 'uso_accesos_fallidos')) as politicas_esperado_0;
