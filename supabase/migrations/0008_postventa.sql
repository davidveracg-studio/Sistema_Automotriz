-- =============================================================================
-- 0008_postventa.sql
--
-- Qué resuelve:
--   Bloque 7: ataca el 65,9% de clientes que vienen una sola vez. La
--   encuesta de satisfacción se dispara SOLA al día siguiente de la entrega
--   -nunca se pregunta en el mostrador, "el cliente no le dice a la cara al
--   asesor que lo atendió mal"-.
--
--   El cliente responde la encuesta sin iniciar sesión (es un link que le
--   llega por correo). Por diseño, RLS no puede autorizar "quien conozca
--   este token" -una policy no puede validar un valor secreto que el
--   cliente aporta, solo comparar columnas de la fila ya visible-, así que
--   el acceso público no pasa por una policy de la tabla `encuestas`: pasa
--   por dos funciones RPC (`encuesta_obtener_por_token`,
--   `encuesta_responder`) que hacen la validación del token puertas
--   adentro. `anon` no tiene ningún permiso directo sobre la tabla.
-- =============================================================================

create table if not exists public.encuestas (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references public.trabajos_taller (id) on delete restrict,
  token text not null default encode(gen_random_bytes(16), 'hex'),
  programado_para date not null,
  enviado_en timestamptz,
  respondido_en timestamptz,
  calificacion integer check (calificacion is null or calificacion between 1 and 5),
  comentario text,
  creado_en timestamptz not null default now(),
  constraint uq_encuestas_trabajo unique (trabajo_id),
  constraint uq_encuestas_token unique (token)
);

comment on table public.encuestas is 'Una encuesta por OT entregada. Se programa sola para el día siguiente de la entrega; nunca se pregunta en el mostrador.';
comment on column public.encuestas.token is 'Identificador público impredecible para el link del correo. anon nunca accede a la tabla directo, solo vía las funciones encuesta_*.';

create index if not exists encuestas_pendientes_idx on public.encuestas (programado_para) where enviado_en is null;

-- ---------------------------------------------------------------------------
-- Programación automática: al marcar una OT como entregada (Bloque 5), se
-- crea la encuesta para el día siguiente. No se envía todavía -eso lo hace
-- el Edge Function enviar-encuestas-pendientes-, solo queda agendada.
-- ---------------------------------------------------------------------------
create or replace function public.programar_encuesta_postventa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'entregado' and (old.estado is distinct from new.estado) then
    insert into public.encuestas (trabajo_id, programado_para)
    values (new.id, (coalesce(new.fecha_entrega, now())::date) + 1)
    on conflict (trabajo_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trabajos_taller_programar_encuesta on public.trabajos_taller;
create trigger trg_trabajos_taller_programar_encuesta
  after update on public.trabajos_taller
  for each row execute function public.programar_encuesta_postventa();

-- ---------------------------------------------------------------------------
-- Acceso público por token: dos funciones angostas, no una policy de anon
-- sobre la tabla completa. security definer + search_path fijo, como el
-- resto de las funciones auxiliares del proyecto.
-- ---------------------------------------------------------------------------
create or replace function public.encuesta_obtener_por_token(p_token text)
returns table (numero_ot integer, patente text, marca text, modelo text, respondido_en timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select t.numero_ot, v.patente, v.marca, v.modelo, e.respondido_en
  from public.encuestas e
  join public.trabajos_taller t on t.id = e.trabajo_id
  join public.vehiculos v on v.id = t.vehiculo_id
  where e.token = p_token;
$$;

create or replace function public.encuesta_responder(p_token text, p_calificacion integer, p_comentario text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_calificacion is null or p_calificacion not between 1 and 5 then
    raise exception 'La calificación debe ser un número entre 1 y 5.';
  end if;

  update public.encuestas
  set calificacion = p_calificacion, comentario = p_comentario, respondido_en = now()
  where token = p_token and respondido_en is null;

  return found;
end;
$$;

revoke all on function public.encuesta_obtener_por_token(text) from public;
revoke all on function public.encuesta_responder(text, integer, text) from public;
grant execute on function public.encuesta_obtener_por_token(text) to anon, authenticated;
grant execute on function public.encuesta_responder(text, integer, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS para el personal (nunca para anon: ese acceso va solo por las
-- funciones de arriba).
-- ---------------------------------------------------------------------------
alter table public.encuestas enable row level security;

drop policy if exists encuestas_select on public.encuestas;
create policy encuestas_select on public.encuestas
  for select using (exists (
    select 1 from public.trabajos_taller t
    where t.id = encuestas.trabajo_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists encuestas_update on public.encuestas;
create policy encuestas_update on public.encuestas
  for update using (
    public.auth_rol() is not null
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = encuestas.trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Registro de errores de Brevo, mismo patrón que integraciones_clickup_errores:
-- nunca fallar en silencio.
-- ---------------------------------------------------------------------------
create table if not exists public.integraciones_brevo_errores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas (id) on delete set null,
  encuesta_id uuid references public.encuestas (id) on delete set null,
  operacion text not null,
  mensaje text not null,
  detalle jsonb,
  creado_en timestamptz not null default now()
);

comment on table public.integraciones_brevo_errores is 'Toda falla al enviar un correo vía Brevo se registra aquí con su causa real.';

alter table public.integraciones_brevo_errores enable row level security;

drop policy if exists integraciones_brevo_errores_select on public.integraciones_brevo_errores;
create policy integraciones_brevo_errores_select on public.integraciones_brevo_errores
  for select using (empresa_id = public.mi_empresa_id() and (public.es_admin() or public.es_socia()));

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select relrowsecurity from pg_class where relname = 'encuestas') as rls_encuestas_esperado_true,
  (select count(*) from pg_proc where proname in ('programar_encuesta_postventa', 'encuesta_obtener_por_token', 'encuesta_responder')) as funciones_esperado_3,
  (select count(*) from information_schema.role_routine_grants where routine_name = 'encuesta_responder' and grantee = 'anon') as permiso_anon_responder_esperado_mayor_a_0,
  (select relrowsecurity from pg_class where relname = 'integraciones_brevo_errores') as rls_brevo_errores_esperado_true;
