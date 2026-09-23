-- =============================================================================
-- 0031_notificaciones.sql
--
-- Qué resuelve:
--   El panel de inicio (Bloque 1, nunca desarrollado más allá del saludo)
--   pasa a listar las notificaciones que le competen a quien inició sesión:
--   con patente y OT cuando aplica, o solo con datos de la cita cuando es
--   un agendamiento de Recepción (todavía no tiene OT en ese momento, ver
--   más abajo). Administración (admin/socia) ve TODAS las notificaciones,
--   sin importar el rol al que estén dirigidas.
--
--   Eventos confirmados con el cliente (2026-09-21):
--   1. Presupuesto pendiente de aprobación → asesor + encargado_presupuestos.
--   2. Encuesta postventa negativa → admin/socia (mismo destinatario que ya
--      usa el correo de alerta del Bloque 7, ver 0025_encuesta_detallada.sql).
--   3. Cita nueva agendada por Recepción → asesor. Una cita recién agendada
--      no tiene trabajo_id todavía (se vincula recién cuando el vehículo
--      llega, ver comentario original en 0009_agenda.sql) — se decidió con
--      el cliente mostrar fecha/hora/cliente en vez de forzar un OT que
--      todavía no existe, en vez de cambiar ese flujo.
--   4. "Listo para entrega" (ya dispara correo al asesor asignado desde
--      clickup-webhook, ver 0015_clickup_estados_avanzados.sql) → se agrega
--      también como notificación en la app, al mismo asesor (usuario_destino_id,
--      no un rol completo: ya se sabía a quién avisar).
--   5. "Compra reptos" (mismo mecanismo de transición de estado de ClickUp
--      que "listo para entrega") → jefe_taller + encargado_presupuestos,
--      quienes gestionan bodega/compras (mismo grupo de acceso de /bodega).
--
--   Deliberadamente AFUERA de esta tabla: facturas vencidas de Cuentas por
--   Cobrar. No hay un evento puntual que la dispare (se vuelve vencida por
--   el simple paso del tiempo, no por un INSERT/UPDATE) y este proyecto no
--   tiene pg_cron ni un job programado todavía — se calcula en vivo desde
--   el frontend contra trabajos_taller.fecha_vencimiento_pago en cada carga
--   del panel, sin necesitar una fila persistida ni marca de "leída" (una
--   factura vencida debe seguir apareciendo hasta que se pague, no hasta
--   que alguien la mire).
--
--   Resolución automática: varias notificaciones dejan de tener sentido
--   solas cuando el estado real cambia (presupuesto ya no está "enviado",
--   la cita ya tiene OT o se canceló, la OT ya se entregó) — se borran con
--   un trigger en ese momento en vez de acumular como historial muerto. La
--   única excepción es la encuesta negativa, que sí es un evento puntual
--   sin una "vuelta al estado normal" que la resuelva sola.
-- =============================================================================

create table if not exists public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  tipo text not null check (tipo in (
    'presupuesto_pendiente', 'encuesta_negativa', 'cita_nueva',
    'listo_para_entrega', 'compra_reptos_pendiente'
  )),
  trabajo_id uuid references public.trabajos_taller (id) on delete cascade,
  cita_id uuid references public.citas (id) on delete cascade,
  presupuesto_id uuid references public.presupuestos_taller (id) on delete cascade,
  encuesta_id uuid references public.encuestas (id) on delete cascade,
  roles_destino text[] not null default '{}',
  usuario_destino_id uuid references public.usuarios (id) on delete cascade,
  titulo text not null,
  mensaje text not null,
  creado_en timestamptz not null default now()
);

comment on table public.notificaciones is 'Avisos accionables para el panel de inicio. roles_destino y/o usuario_destino_id definen quién la ve además de admin/socia (que ven todas, sin filtro). Se borran por trigger cuando el estado que las originó ya no aplica -no son un log histórico-.';
comment on column public.notificaciones.roles_destino is 'Roles que ven esta notificación (además de admin/socia). Vacío si solo se dirige a usuario_destino_id.';
comment on column public.notificaciones.usuario_destino_id is 'Usuario específico (ej. el asesor ya asignado a la OT), cuando el destinatario no es "cualquiera del rol" sino una persona puntual.';

create index if not exists notificaciones_empresa_idx on public.notificaciones (empresa_id, creado_en desc);
create index if not exists notificaciones_trabajo_idx on public.notificaciones (trabajo_id);

create table if not exists public.notificaciones_lecturas (
  id uuid primary key default gen_random_uuid(),
  notificacion_id uuid not null references public.notificaciones (id) on delete cascade,
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  leido_en timestamptz not null default now(),
  constraint uq_notificaciones_lecturas unique (notificacion_id, usuario_id)
);

comment on table public.notificaciones_lecturas is 'Marca de "ya la vi" por persona -una notificación con roles_destino la puede ver más de un usuario, y cada quien la lee (o no) por su cuenta-.';

-- ---------------------------------------------------------------------------
-- RLS. Sin policy de insert/update/delete para usuarios comunes a propósito:
-- toda escritura en notificaciones sale de funciones SECURITY DEFINER
-- (triggers de este archivo, o el Edge Function clickup-webhook con su
-- service role), nunca de un INSERT directo del frontend.
-- ---------------------------------------------------------------------------
alter table public.notificaciones enable row level security;
alter table public.notificaciones_lecturas enable row level security;

drop policy if exists notificaciones_select on public.notificaciones;
create policy notificaciones_select on public.notificaciones
  for select using (
    empresa_id = public.mi_empresa_id()
    and (
      public.es_admin() or public.es_socia()
      or usuario_destino_id = auth.uid()
      or (public.auth_rol() is not null and public.auth_rol() = any (roles_destino))
    )
  );

drop policy if exists notificaciones_lecturas_select on public.notificaciones_lecturas;
create policy notificaciones_lecturas_select on public.notificaciones_lecturas
  for select using (usuario_id = auth.uid());

drop policy if exists notificaciones_lecturas_insert on public.notificaciones_lecturas;
create policy notificaciones_lecturas_insert on public.notificaciones_lecturas
  for insert with check (usuario_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 1. Presupuesto pendiente de aprobación. Se crea directo en estado
--    'enviado' desde TrabajoDetalle.jsx (al generar), o llega a 'enviado'
--    después desde 'borrador' vía PresupuestoDetalle.jsx -de ahí dos
--    triggers separados (insert / update of estado) en vez de uno solo:
--    referenciar OLD en un trigger de INSERT revienta en PL/pgSQL
--    ("record 'old' is not assigned yet"), no es un simple null.
-- ---------------------------------------------------------------------------
create or replace function public.notificar_presupuesto_enviado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notificaciones (empresa_id, tipo, trabajo_id, presupuesto_id, roles_destino, titulo, mensaje)
  select t.empresa_id, 'presupuesto_pendiente', new.trabajo_id, new.id,
    array['asesor', 'encargado_presupuestos'],
    'Presupuesto pendiente de aprobación',
    'El presupuesto ' || coalesce(new.correlativo, 'nuevo') || ' está esperando la decisión del cliente.'
  from public.trabajos_taller t
  where t.id = new.trabajo_id;
  return new;
end;
$$;

drop trigger if exists trg_notificar_presupuesto_enviado on public.presupuestos_taller;
create trigger trg_notificar_presupuesto_enviado
  after insert on public.presupuestos_taller
  for each row when (new.estado = 'enviado')
  execute function public.notificar_presupuesto_enviado();

create or replace function public.notificar_presupuesto_actualizado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa_id uuid;
begin
  if new.estado = 'enviado' and old.estado is distinct from 'enviado' then
    select empresa_id into v_empresa_id from public.trabajos_taller where id = new.trabajo_id;
    insert into public.notificaciones (empresa_id, tipo, trabajo_id, presupuesto_id, roles_destino, titulo, mensaje)
    values (
      v_empresa_id, 'presupuesto_pendiente', new.trabajo_id, new.id,
      array['asesor', 'encargado_presupuestos'],
      'Presupuesto pendiente de aprobación',
      'El presupuesto ' || coalesce(new.correlativo, 'nuevo') || ' está esperando la decisión del cliente.'
    );
  elsif old.estado = 'enviado' and new.estado is distinct from 'enviado' then
    delete from public.notificaciones where presupuesto_id = new.id and tipo = 'presupuesto_pendiente';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notificar_presupuesto_actualizado on public.presupuestos_taller;
create trigger trg_notificar_presupuesto_actualizado
  after update of estado on public.presupuestos_taller
  for each row execute function public.notificar_presupuesto_actualizado();

-- ---------------------------------------------------------------------------
-- 2. Encuesta negativa. Se agrega dentro de la misma encuesta_responder()
--    que ya calcula la clasificación (Bloque 7) -mismo criterio "no
--    promedio, cualquier área en 1-2 estrellas es negativo" ya definido
--    ahí-, en vez de un trigger aparte: evita duplicar la lógica de
--    clasificación en dos lugares. CREATE OR REPLACE con la misma firma y
--    tipo de retorno, no hace falta DROP FUNCTION.
-- ---------------------------------------------------------------------------
create or replace function public.encuesta_responder(
  p_token text,
  p_entrega_tiempo integer,
  p_atencion_cliente integer,
  p_servicio_mecanico integer,
  p_recomendaria integer,
  p_como_conocio text,
  p_sugerencia text
)
returns table (clasificacion text, areas_bajas text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clasificacion text;
  v_areas_bajas text[] := array[]::text[];
  v_encuesta_id uuid;
  v_trabajo_id uuid;
  v_empresa_id uuid;
  v_areas_label text;
begin
  if p_entrega_tiempo is null or p_entrega_tiempo not between 1 and 5
     or p_atencion_cliente is null or p_atencion_cliente not between 1 and 5
     or p_servicio_mecanico is null or p_servicio_mecanico not between 1 and 5
     or p_recomendaria is null or p_recomendaria not between 1 and 5 then
    raise exception 'Cada calificación debe ser un número entre 1 y 5.';
  end if;

  if p_como_conocio is not null and p_como_conocio not in (
    'redes_sociales', 'recomendacion', 'google', 'publicidad', 'pase_por_el_lugar', 'cliente_anterior', 'otro'
  ) then
    raise exception 'Valor de "cómo conociste" no reconocido.';
  end if;

  if p_entrega_tiempo <= 2 then v_areas_bajas := array_append(v_areas_bajas, 'entrega_tiempo'); end if;
  if p_atencion_cliente <= 2 then v_areas_bajas := array_append(v_areas_bajas, 'atencion_cliente'); end if;
  if p_servicio_mecanico <= 2 then v_areas_bajas := array_append(v_areas_bajas, 'servicio_mecanico'); end if;
  if p_recomendaria <= 2 then v_areas_bajas := array_append(v_areas_bajas, 'recomendaria'); end if;

  if array_length(v_areas_bajas, 1) > 0 then
    v_clasificacion := 'negativo';
  elsif p_recomendaria = 5 then
    v_clasificacion := 'excelente';
  else
    v_clasificacion := 'positivo';
  end if;

  update public.encuestas
  set calificacion_entrega_tiempo = p_entrega_tiempo,
      calificacion_atencion_cliente = p_atencion_cliente,
      calificacion_servicio_mecanico = p_servicio_mecanico,
      calificacion_recomendaria = p_recomendaria,
      como_conocio = p_como_conocio,
      sugerencia = p_sugerencia,
      clasificacion = v_clasificacion,
      areas_bajas = v_areas_bajas,
      respondido_en = now()
  where token = p_token and respondido_en is null
  returning id, trabajo_id into v_encuesta_id, v_trabajo_id;

  if not found then
    raise exception 'No encontramos esta encuesta, o ya fue respondida.';
  end if;

  if v_clasificacion = 'negativo' then
    select empresa_id into v_empresa_id from public.trabajos_taller where id = v_trabajo_id;

    select string_agg(
      case a
        when 'entrega_tiempo' then 'entrega a tiempo'
        when 'atencion_cliente' then 'atención del asesor'
        when 'servicio_mecanico' then 'servicio mecánico'
        when 'recomendaria' then 'recomendaría'
        else a
      end, ', '
    ) into v_areas_label
    from unnest(v_areas_bajas) as a;

    insert into public.notificaciones (empresa_id, tipo, trabajo_id, encuesta_id, titulo, mensaje)
    values (
      v_empresa_id, 'encuesta_negativa', v_trabajo_id, v_encuesta_id,
      'Encuesta con calificación negativa',
      'Un cliente calificó mal en: ' || coalesce(v_areas_label, 'una o más áreas') || '.'
    );
  end if;

  return query select v_clasificacion, v_areas_bajas;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Cita nueva agendada por Recepción. Sin trabajo_id -no existe todavía-,
--    solo cita_id: el frontend arma el texto con fecha/hora/cliente en vez
--    de patente+OT, decisión tomada explícitamente con el cliente para no
--    tener que adelantar la creación de la OT al momento de agendar.
-- ---------------------------------------------------------------------------
create or replace function public.notificar_cita_nueva()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente text;
  v_isla text;
begin
  select coalesce(nullif(razon_social, ''), trim(both ' ' from nombre || ' ' || coalesce(apellido, '')))
    into v_cliente
    from public.clientes where id = new.cliente_id;

  select nombre into v_isla from public.tipos_isla where id = new.tipo_isla_id;

  insert into public.notificaciones (empresa_id, tipo, cita_id, roles_destino, titulo, mensaje)
  values (
    new.empresa_id, 'cita_nueva', new.id, array['asesor'],
    'Nueva cita agendada',
    'Recepción agendó a ' || coalesce(v_cliente, 'un cliente') || ' para el ' || to_char(new.fecha, 'DD-MM-YYYY')
      || coalesce(' ' || to_char(new.hora, 'HH24:MI'), '') || ' (' || coalesce(v_isla, 'isla') || ').'
  );
  return new;
end;
$$;

drop trigger if exists trg_notificar_cita_nueva on public.citas;
create trigger trg_notificar_cita_nueva
  after insert on public.citas
  for each row execute function public.notificar_cita_nueva();

create or replace function public.limpiar_notificacion_cita()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.trabajo_id is not null or new.estado in ('cancelada', 'no_asistio', 'completada') then
    delete from public.notificaciones where cita_id = new.id and tipo = 'cita_nueva';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_limpiar_notificacion_cita on public.citas;
create trigger trg_limpiar_notificacion_cita
  after update on public.citas
  for each row execute function public.limpiar_notificacion_cita();

-- ---------------------------------------------------------------------------
-- 4/5. "Listo para entrega" y "Compra reptos" se insertan desde
--    clickup-webhook (ya detecta esas transiciones de estado de ClickUp,
--    ver 0015_clickup_estados_avanzados.sql) con su service role -no hace
--    falta trigger de Postgres para crearlas-. Sí hace falta resolverlas
--    automáticamente cuando la OT se entrega, con un trigger acá.
-- ---------------------------------------------------------------------------
create or replace function public.limpiar_notificacion_ot_entregada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'entregado' and old.estado is distinct from 'entregado' then
    delete from public.notificaciones
    where trabajo_id = new.id and tipo in ('listo_para_entrega', 'compra_reptos_pendiente');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_limpiar_notificacion_ot_entregada on public.trabajos_taller;
create trigger trg_limpiar_notificacion_ot_entregada
  after update of estado on public.trabajos_taller
  for each row execute function public.limpiar_notificacion_ot_entregada();

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_name in ('notificaciones', 'notificaciones_lecturas')) as tablas_esperado_2,
  (select relrowsecurity from pg_class where relname = 'notificaciones') as rls_notificaciones_esperado_true,
  (select count(*) from pg_trigger where tgname in (
    'trg_notificar_presupuesto_enviado', 'trg_notificar_presupuesto_actualizado',
    'trg_notificar_cita_nueva', 'trg_limpiar_notificacion_cita', 'trg_limpiar_notificacion_ot_entregada'
  )) as triggers_esperado_5,
  (select count(*) from pg_proc where proname = 'encuesta_responder') as funcion_encuesta_responder_esperado_1;
