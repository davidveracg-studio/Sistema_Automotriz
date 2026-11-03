-- =============================================================================
-- 0074_retencion_datos.sql
--
-- Qué resuelve (hallazgo H-05 de la auditoría de protección de datos
-- 2026-11-03):
--   Los datos personales solo se pueden conservar el tiempo necesario para su
--   finalidad; después hay que suprimirlos o anonimizarlos (art. 3 c de la Ley
--   19.628 tal como la reemplaza la Ley 21.719). La base acumulaba bitácoras,
--   notificaciones y mensajes sin ningún plazo ni purga.
--
-- Qué hace:
--   1. `politicas_retencion`: cada taller (el responsable de sus datos) define
--      por categoría cuántos días conserva y si la purga está activa. Nace todo
--      inactivo: NO se borra nada hasta que el taller lo active. Los plazos no
--      los fija el código; los define el taller con su asesoría legal.
--   2. `purgar_datos_vencidos()`: borra, por cada política activa, lo anterior
--      al plazo, y deja constancia en `retencion_ejecuciones` (qué categoría,
--      cuántas filas, cuándo). La ejecuta un job programado de GitHub Actions
--      con la conexión de base de datos; no la puede llamar ningún usuario.
--      Aplica además dos plazos fijos de la plataforma, sin empresa: intentos
--      de ingreso rechazados y errores de Brevo sin empresa, 90 días.
--   3. `retencion_contar()`: cuántas filas se borrarían con un plazo dado, para
--      que el taller lo vea antes de activar.
--
--   Categorías: uso_eventos, notificaciones, whatsapp_mensajes y
--   errores_integracion (Brevo y ClickUp).
--
-- No hace: borrar clientes, vehículos, trabajos, documentos tributarios,
-- fotos ni solicitudes de titulares. Qué debe conservarse por ley lo debe
-- definir un abogado; las solicitudes de titulares se conservan siempre
-- como respaldo.
--
-- Idempotente.
-- =============================================================================

create table if not exists public.politicas_retencion (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  categoria text not null check (categoria in ('uso_eventos', 'notificaciones', 'whatsapp_mensajes', 'errores_integracion')),
  dias integer not null check (dias between 30 and 3650),
  activa boolean not null default false,
  actualizado_por uuid references public.usuarios (id) default auth.uid(),
  actualizado_en timestamptz not null default now(),
  constraint uq_politicas_retencion unique (empresa_id, categoria)
);

comment on table public.politicas_retencion is 'Plazo de conservación por categoría y empresa. Nace inactiva: la purga solo borra lo de las políticas activadas por el taller.';

create or replace function public.politicas_retencion_marca()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_politicas_retencion_marca on public.politicas_retencion;
create trigger trg_politicas_retencion_marca
  before insert or update on public.politicas_retencion
  for each row execute function public.politicas_retencion_marca();

create table if not exists public.retencion_ejecuciones (
  id bigint generated always as identity primary key,
  empresa_id uuid references public.empresas (id) on delete cascade,
  categoria text not null,
  dias integer not null,
  filas bigint not null,
  ejecutada_en timestamptz not null default now()
);

comment on table public.retencion_ejecuciones is 'Constancia de cada purga: categoría, plazo aplicado, filas borradas y cuándo. empresa_id nulo = plazos fijos de la plataforma.';
comment on column public.retencion_ejecuciones.filas is 'Se registra aunque sea 0: sirve de evidencia de que el job corrió.';

create index if not exists retencion_ejecuciones_empresa_idx on public.retencion_ejecuciones (empresa_id, ejecutada_en desc);

alter table public.politicas_retencion enable row level security;
alter table public.retencion_ejecuciones enable row level security;

drop policy if exists politicas_retencion_select on public.politicas_retencion;
create policy politicas_retencion_select on public.politicas_retencion
  for select using (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'));

drop policy if exists politicas_retencion_insert on public.politicas_retencion;
create policy politicas_retencion_insert on public.politicas_retencion
  for insert with check (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'));

drop policy if exists politicas_retencion_update on public.politicas_retencion;
create policy politicas_retencion_update on public.politicas_retencion
  for update
  using (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'))
  with check (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'));

-- Sin política de delete ni de insert/update en las ejecuciones: solo las escribe la función.
drop policy if exists retencion_ejecuciones_select on public.retencion_ejecuciones;
create policy retencion_ejecuciones_select on public.retencion_ejecuciones
  for select using (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'));

-- ---------------------------------------------------------------------------
-- Auxiliares internos (sin permiso de ejecución para nadie más que el dueño).
-- ---------------------------------------------------------------------------
create or replace function public.retencion_filas_vencidas(p_empresa uuid, p_categoria text, p_dias integer)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limite timestamptz := now() - make_interval(days => p_dias);
  v_total bigint;
begin
  if p_categoria = 'uso_eventos' then
    select count(*) into v_total from public.uso_eventos t where t.empresa_id = p_empresa and t.creado_en < v_limite;
  elsif p_categoria = 'notificaciones' then
    select count(*) into v_total from public.notificaciones t where t.empresa_id = p_empresa and t.creado_en < v_limite;
  elsif p_categoria = 'whatsapp_mensajes' then
    select count(*) into v_total from public.whatsapp_mensajes t where t.empresa_id = p_empresa and t.wa_timestamp < v_limite;
  elsif p_categoria = 'errores_integracion' then
    select (select count(*) from public.integraciones_brevo_errores t where t.empresa_id = p_empresa and t.creado_en < v_limite)
         + (select count(*) from public.integraciones_clickup_errores t where t.empresa_id = p_empresa and t.creado_en < v_limite)
      into v_total;
  else
    raise exception 'Categoría de retención desconocida: %', p_categoria;
  end if;
  return v_total;
end;
$$;

create or replace function public.retencion_borrar(p_empresa uuid, p_categoria text, p_dias integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limite timestamptz := now() - make_interval(days => p_dias);
  v_total bigint := 0;
  v_parcial bigint;
begin
  if p_categoria = 'uso_eventos' then
    delete from public.uso_eventos t where t.empresa_id = p_empresa and t.creado_en < v_limite;
    get diagnostics v_total = row_count;
  elsif p_categoria = 'notificaciones' then
    delete from public.notificaciones t where t.empresa_id = p_empresa and t.creado_en < v_limite;
    get diagnostics v_total = row_count;
  elsif p_categoria = 'whatsapp_mensajes' then
    delete from public.whatsapp_mensajes t where t.empresa_id = p_empresa and t.wa_timestamp < v_limite;
    get diagnostics v_total = row_count;
  elsif p_categoria = 'errores_integracion' then
    delete from public.integraciones_brevo_errores t where t.empresa_id = p_empresa and t.creado_en < v_limite;
    get diagnostics v_parcial = row_count;
    v_total := v_parcial;
    delete from public.integraciones_clickup_errores t where t.empresa_id = p_empresa and t.creado_en < v_limite;
    get diagnostics v_parcial = row_count;
    v_total := v_total + v_parcial;
  else
    raise exception 'Categoría de retención desconocida: %', p_categoria;
  end if;
  return v_total;
end;
$$;

revoke all on function public.retencion_filas_vencidas(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.retencion_borrar(uuid, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Para el taller: cuántas filas se borrarían con un plazo dado (solo cuenta).
-- ---------------------------------------------------------------------------
create or replace function public.retencion_contar(p_categoria text, p_dias integer)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.auth_rol() is null or public.auth_rol() not in ('admin', 'socia') then
    raise exception 'Tu rol no puede consultar la retención de datos.' using errcode = '42501';
  end if;
  if p_dias is null or p_dias < 30 then
    raise exception 'El plazo mínimo es de 30 días.';
  end if;
  return public.retencion_filas_vencidas(public.mi_empresa_id(), p_categoria, p_dias);
end;
$$;

revoke all on function public.retencion_contar(text, integer) from public, anon;
grant execute on function public.retencion_contar(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Purga. La corre el job programado con la conexión de base de datos; ningún
-- usuario de la app puede ejecutarla.
-- ---------------------------------------------------------------------------
create or replace function public.purgar_datos_vencidos()
returns table (empresa uuid, categoria_purgada text, filas_borradas bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_politica record;
  v_total bigint;
begin
  for v_politica in
    select p.empresa_id as emp, p.categoria as cat, p.dias as plazo
    from public.politicas_retencion p
    where p.activa
    order by p.empresa_id, p.categoria
  loop
    v_total := public.retencion_borrar(v_politica.emp, v_politica.cat, v_politica.plazo);
    insert into public.retencion_ejecuciones (empresa_id, categoria, dias, filas)
      values (v_politica.emp, v_politica.cat, v_politica.plazo, v_total);
    empresa := v_politica.emp;
    categoria_purgada := v_politica.cat;
    filas_borradas := v_total;
    return next;
  end loop;

  -- Plazos fijos de la plataforma (sin empresa): 90 días.
  delete from public.uso_accesos_fallidos f where f.creado_en < now() - interval '90 days';
  get diagnostics v_total = row_count;
  insert into public.retencion_ejecuciones (empresa_id, categoria, dias, filas) values (null, 'accesos_fallidos', 90, v_total);
  empresa := null;
  categoria_purgada := 'accesos_fallidos';
  filas_borradas := v_total;
  return next;

  delete from public.integraciones_brevo_errores e where e.empresa_id is null and e.creado_en < now() - interval '90 days';
  get diagnostics v_total = row_count;
  insert into public.retencion_ejecuciones (empresa_id, categoria, dias, filas) values (null, 'errores_brevo_sin_empresa', 90, v_total);
  empresa := null;
  categoria_purgada := 'errores_brevo_sin_empresa';
  filas_borradas := v_total;
  return next;
end;
$$;

comment on function public.purgar_datos_vencidos() is 'Borra lo vencido según las políticas activas y los plazos fijos de la plataforma, y deja constancia en retencion_ejecuciones. La corre el job programado (workflow retencion-purga.yml); no la puede ejecutar ningún usuario de la app.';

revoke all on function public.purgar_datos_vencidos() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación (todo debe dar lo esperado):
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('politicas_retencion', 'retencion_ejecuciones')) as politicas_esperado_4,
  has_function_privilege('authenticated', 'public.purgar_datos_vencidos()', 'execute') as authenticated_purga_esperado_false,
  has_function_privilege('anon', 'public.retencion_contar(text, integer)', 'execute') as anon_cuenta_esperado_false,
  has_function_privilege('authenticated', 'public.retencion_contar(text, integer)', 'execute') as authenticated_cuenta_esperado_true,
  (select count(*) from public.politicas_retencion where activa) as politicas_activas_esperado_0;
