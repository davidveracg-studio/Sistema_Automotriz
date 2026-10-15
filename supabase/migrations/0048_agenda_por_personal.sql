-- =============================================================================
-- 0048_agenda_por_personal.sql
--
-- Qué resuelve:
--   La capacidad de la Agenda pasa de ser un número fijo por isla a depender de
--   las personas disponibles: cuántos mecánicos, detailer, alineadores y
--   lavadores hay ese día, a esa hora. Los puestos físicos del plano ya no
--   limitan la agenda (varios quedan ocupados por vehículos en espera de un
--   repuesto), así que se quita la sincronización plano -> capacidad.
--
--   - personal_taller: las personas del equipo que atienden vehículos (no
--     necesitan usuario del sistema; usuario_id es opcional).
--   - personal_habilidades: qué tipos de isla atiende cada persona (una persona
--     puede atender más de uno: Gabriel rápidos + lavado, Pablo alineación +
--     lavado).
--   - personal_horarios: horario semanal propio. Una persona SIN filas usa el
--     horario de atención del taller.
--   - personal_ausencias: vacaciones, licencias y permisos, por rango de fechas
--     (día completo o solo unas horas).
--   - personal_disponible_en / agenda_cupos_bloque: cuántos cupos quedan en un
--     bloque de 30 minutos. Una persona atiende una cosa a la vez: se
--     resuelve como asignación de citas a personas (condición de Hall sobre
--     los tipos de isla), no como suma de capacidades.
--   - citas_cupos_disponibles se reescribe sobre lo anterior, con la MISMA
--     firma: el calendario, el aviso del formulario, los horarios sugeridos y
--     el bot de WhatsApp quedan con la disponibilidad real sin cambiar nada
--     más. Una empresa sin personal registrado sigue usando
--     tipos_isla.capacidad como antes.
--   - Carga inicial del equipo técnico de la demo (nombres ficticios).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table if not exists public.personal_taller (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nombre text not null,
  cargo text,
  usuario_id uuid references public.usuarios (id) on delete set null,
  activo boolean not null default true,
  orden integer not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.personal_taller is 'Personas del equipo que atienden vehículos. La capacidad de la Agenda sale de cuántas están disponibles en cada bloque.';

create index if not exists personal_taller_empresa_idx on public.personal_taller (empresa_id);

drop trigger if exists trg_personal_taller_actualizado_en on public.personal_taller;
create trigger trg_personal_taller_actualizado_en
  before update on public.personal_taller
  for each row execute function public.actualizar_marca_de_tiempo();

create table if not exists public.personal_habilidades (
  personal_id uuid not null references public.personal_taller (id) on delete cascade,
  tipo_isla_id uuid not null references public.tipos_isla (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  primary key (personal_id, tipo_isla_id)
);

comment on table public.personal_habilidades is 'Tipos de isla que atiende cada persona. Con dos o más, la persona atiende una sola cosa a la vez.';

create index if not exists personal_habilidades_isla_idx on public.personal_habilidades (tipo_isla_id);
create index if not exists personal_habilidades_empresa_idx on public.personal_habilidades (empresa_id);

create table if not exists public.personal_horarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  personal_id uuid not null references public.personal_taller (id) on delete cascade,
  dia_semana integer not null check (dia_semana between 0 and 6),
  hora_inicio time not null,
  hora_fin time not null,
  constraint ck_personal_horarios_rango check (hora_fin > hora_inicio),
  constraint uq_personal_horarios_dia unique (personal_id, dia_semana)
);

comment on table public.personal_horarios is 'Horario semanal propio de una persona (0 = domingo). Sin filas = usa el horario de atención del taller; un día sin fila = no trabaja ese día.';

create index if not exists personal_horarios_empresa_idx on public.personal_horarios (empresa_id);

create table if not exists public.personal_ausencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  personal_id uuid not null references public.personal_taller (id) on delete cascade,
  desde date not null,
  hasta date not null,
  hora_desde time,
  hora_hasta time,
  motivo text,
  creado_por uuid references public.usuarios (id) on delete set null,
  creado_en timestamptz not null default now(),
  constraint ck_personal_ausencias_fechas check (hasta >= desde),
  constraint ck_personal_ausencias_horas check (
    (hora_desde is null and hora_hasta is null) or (hora_desde is not null and hora_hasta is not null and hora_hasta > hora_desde)
  )
);

comment on table public.personal_ausencias is 'Vacaciones, licencias o permisos. Sin horas = todos los días del rango completos; con horas = solo esa franja de cada día del rango.';

create index if not exists personal_ausencias_personal_idx on public.personal_ausencias (personal_id, desde, hasta);
create index if not exists personal_ausencias_empresa_idx on public.personal_ausencias (empresa_id);

-- ---------------------------------------------------------------------------
-- RLS: lectura para la empresa; escritura para admin, socia y jefe de taller.
-- ---------------------------------------------------------------------------
alter table public.personal_taller enable row level security;
alter table public.personal_habilidades enable row level security;
alter table public.personal_horarios enable row level security;
alter table public.personal_ausencias enable row level security;

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['personal_taller', 'personal_habilidades', 'personal_horarios', 'personal_ausencias'] loop
    execute format('drop policy if exists %I on public.%I', v_tabla || '_select', v_tabla);
    execute format('create policy %I on public.%I for select using (empresa_id = public.mi_empresa_id())', v_tabla || '_select', v_tabla);

    execute format('drop policy if exists %I on public.%I', v_tabla || '_insert', v_tabla);
    execute format(
      'create policy %I on public.%I for insert with check (empresa_id = public.mi_empresa_id() and public.auth_rol() in (''admin'', ''socia'', ''jefe_taller''))',
      v_tabla || '_insert', v_tabla
    );

    execute format('drop policy if exists %I on public.%I', v_tabla || '_update', v_tabla);
    execute format(
      'create policy %I on public.%I for update using (empresa_id = public.mi_empresa_id() and public.auth_rol() in (''admin'', ''socia'', ''jefe_taller'')) with check (empresa_id = public.mi_empresa_id() and public.auth_rol() in (''admin'', ''socia'', ''jefe_taller''))',
      v_tabla || '_update', v_tabla
    );

    execute format('drop policy if exists %I on public.%I', v_tabla || '_delete', v_tabla);
    execute format(
      'create policy %I on public.%I for delete using (empresa_id = public.mi_empresa_id() and public.auth_rol() in (''admin'', ''socia'', ''jefe_taller''))',
      v_tabla || '_delete', v_tabla
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- La capacidad de la Agenda ya no sigue al plano.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_plano_elementos_capacidad_isla on public.plano_elementos;

-- ---------------------------------------------------------------------------
-- ¿Trabaja esta persona en el bloque [p_minuto, p_minuto + 30) de esa fecha?
-- Minutos desde la medianoche. Horario propio si tiene filas; si no, el del
-- taller. Descarta la persona con una ausencia que cubra el bloque.
-- ---------------------------------------------------------------------------
create or replace function public.personal_disponible_en(p_personal_id uuid, p_fecha date, p_minuto integer)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_dow integer := extract(dow from p_fecha)::integer;
  v_inicio integer;
  v_fin integer;
begin
  select empresa_id into v_empresa from public.personal_taller where id = p_personal_id and activo;
  if v_empresa is null then
    return false;
  end if;

  if exists (select 1 from public.personal_horarios where personal_id = p_personal_id) then
    select (extract(hour from hora_inicio) * 60 + extract(minute from hora_inicio))::integer,
           (extract(hour from hora_fin) * 60 + extract(minute from hora_fin))::integer
    into v_inicio, v_fin
    from public.personal_horarios
    where personal_id = p_personal_id and dia_semana = v_dow;
  else
    select (extract(hour from hora_apertura) * 60 + extract(minute from hora_apertura))::integer,
           (extract(hour from hora_cierre) * 60 + extract(minute from hora_cierre))::integer
    into v_inicio, v_fin
    from public.horario_atencion
    where empresa_id = v_empresa and dia_semana = v_dow;
  end if;

  if v_inicio is null or p_minuto < v_inicio or p_minuto + 30 > v_fin then
    return false;
  end if;

  if exists (
    select 1 from public.personal_ausencias a
    where a.personal_id = p_personal_id
      and p_fecha between a.desde and a.hasta
      and (
        a.hora_desde is null
        or (
          (extract(hour from a.hora_desde) * 60 + extract(minute from a.hora_desde)) < p_minuto + 30
          and p_minuto < (extract(hour from a.hora_hasta) * 60 + extract(minute from a.hora_hasta))
        )
      )
  ) then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.personal_disponible_en is 'true si la persona trabaja y no está ausente en el bloque de 30 minutos que parte en p_minuto.';

-- ---------------------------------------------------------------------------
-- Cupos que quedan para un tipo de isla en un bloque de 30 minutos.
-- Cada cita del bloque necesita una persona distinta que atienda su tipo de
-- isla. Hay asignación posible si, para todo conjunto S de tipos de isla, las
-- citas de esos tipos no superan a las personas que atienden alguno de ellos
-- (condición de Hall). Los cupos del tipo consultado son la menor holgura
-- entre los conjuntos que lo incluyen; negativo = sobreagendado.
-- ---------------------------------------------------------------------------
create or replace function public.agenda_cupos_bloque(p_tipo_isla_id uuid, p_fecha date, p_minuto integer)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_islas uuid[];
  v_n integer;
  v_pos integer;
  v_demanda integer[];
  v_masks integer[] := array[]::integer[];
  v_cuenta integer;
  v_mask integer;
  v_persona uuid;
  v_s integer;
  v_q integer;
  v_d integer;
  v_holgura integer;
  v_min integer;
  i integer;
  k integer;
begin
  select empresa_id into v_empresa from public.tipos_isla where id = p_tipo_isla_id;
  if v_empresa is null then
    return null;
  end if;

  select array_agg(id order by orden, id) into v_islas
  from public.tipos_isla where empresa_id = v_empresa and activo;
  v_n := coalesce(array_length(v_islas, 1), 0);
  v_pos := array_position(v_islas, p_tipo_isla_id);
  if v_pos is null or v_n > 16 then
    return null;
  end if;

  v_demanda := array_fill(0, array[v_n]);
  for i in 1..v_n loop
    select count(*)::integer into v_cuenta
    from public.citas c
    cross join lateral (
      select (coalesce(extract(hour from c.hora), 0) * 60 + coalesce(extract(minute from c.hora), 0))::integer as inicio
    ) h
    where c.tipo_isla_id = v_islas[i]
      and c.fecha = p_fecha
      and c.estado in ('agendada', 'confirmada')
      and h.inicio < p_minuto + 30
      and p_minuto < h.inicio + coalesce(c.duracion_estimada_minutos, 1440);
    v_demanda[i] := v_cuenta;
  end loop;

  for v_persona in
    select p.id from public.personal_taller p
    where p.empresa_id = v_empresa and p.activo
      and exists (select 1 from public.personal_habilidades h where h.personal_id = p.id)
  loop
    if public.personal_disponible_en(v_persona, p_fecha, p_minuto) then
      select coalesce(sum(1 << (array_position(v_islas, h.tipo_isla_id) - 1)), 0)::integer into v_mask
      from public.personal_habilidades h
      where h.personal_id = v_persona and array_position(v_islas, h.tipo_isla_id) is not null;
      v_masks := array_append(v_masks, v_mask);
    end if;
  end loop;

  for v_s in 1..((1 << v_n) - 1) loop
    if (v_s & (1 << (v_pos - 1))) = 0 then
      continue;
    end if;
    v_q := 0;
    if coalesce(array_length(v_masks, 1), 0) > 0 then
      for k in 1..array_length(v_masks, 1) loop
        if (v_masks[k] & v_s) <> 0 then
          v_q := v_q + 1;
        end if;
      end loop;
    end if;
    v_d := 0;
    for i in 1..v_n loop
      if (v_s & (1 << (i - 1))) <> 0 then
        v_d := v_d + v_demanda[i];
      end if;
    end loop;
    v_holgura := v_q - v_d;
    if v_min is null or v_holgura < v_min then
      v_min := v_holgura;
    end if;
  end loop;

  return v_min;
end;
$$;

comment on function public.agenda_cupos_bloque is 'Cupos que quedan para un tipo de isla en un bloque de 30 minutos según las personas disponibles y las citas ya agendadas. Negativo = sobreagendado.';

-- ---------------------------------------------------------------------------
-- Misma firma que 0010. Con personal registrado: el menor cupo de los bloques
-- de 30 minutos que abarca la cita. Sin personal: la cuenta de siempre contra
-- tipos_isla.capacidad.
-- ---------------------------------------------------------------------------
create or replace function public.citas_cupos_disponibles(
  p_tipo_isla_id uuid,
  p_fecha date,
  p_hora time default null,
  p_duracion_minutos integer default null
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_con_personal boolean;
  v_dow integer := extract(dow from p_fecha)::integer;
  v_apertura integer;
  v_cierre integer;
  v_inicio integer;
  v_fin integer;
  v_minuto integer;
  v_cupos integer;
  v_min integer;
  v_resultado integer;
begin
  select empresa_id into v_empresa from public.tipos_isla where id = p_tipo_isla_id;

  select exists (
    select 1
    from public.personal_habilidades h
    join public.personal_taller p on p.id = h.personal_id
    where p.empresa_id = v_empresa and p.activo
  ) into v_con_personal;

  if not v_con_personal then
    select t.capacidad - count(c.id)::integer into v_resultado
    from public.tipos_isla t
    left join public.citas c
      on c.tipo_isla_id = t.id
      and c.fecha = p_fecha
      and c.estado in ('agendada', 'confirmada')
      and (p_fecha::timestamp + coalesce(c.hora, '00:00'::time)) <
          (case when p_duracion_minutos is null
                then p_fecha::timestamp + interval '1 day'
                else p_fecha::timestamp + coalesce(p_hora, '00:00'::time) + make_interval(mins => p_duracion_minutos)
           end)
      and (p_fecha::timestamp + coalesce(p_hora, '00:00'::time)) <
          (case when c.duracion_estimada_minutos is null
                then p_fecha::timestamp + interval '1 day'
                else p_fecha::timestamp + coalesce(c.hora, '00:00'::time) + make_interval(mins => c.duracion_estimada_minutos)
           end)
    where t.id = p_tipo_isla_id
    group by t.capacidad;
    return v_resultado;
  end if;

  select (extract(hour from hora_apertura) * 60 + extract(minute from hora_apertura))::integer,
         (extract(hour from hora_cierre) * 60 + extract(minute from hora_cierre))::integer
  into v_apertura, v_cierre
  from public.horario_atencion
  where empresa_id = v_empresa and dia_semana = v_dow;

  v_inicio := case when p_hora is null then coalesce(v_apertura, 0)
                   else (extract(hour from p_hora) * 60 + extract(minute from p_hora))::integer end;
  v_fin := case when p_duracion_minutos is null then coalesce(v_cierre, v_inicio + 30) else v_inicio + p_duracion_minutos end;
  if v_fin <= v_inicio then
    v_fin := v_inicio + 30;
  end if;

  v_minuto := v_inicio;
  while v_minuto < v_fin and v_minuto < v_inicio + 1440 loop
    v_cupos := public.agenda_cupos_bloque(p_tipo_isla_id, p_fecha, v_minuto);
    if v_cupos is not null and (v_min is null or v_cupos < v_min) then
      v_min := v_cupos;
    end if;
    v_minuto := v_minuto + 30;
  end loop;

  return coalesce(v_min, 0);
end;
$$;

comment on function public.citas_cupos_disponibles is 'Cupos disponibles de un tipo de isla para una cita (fecha, hora y duración). Con personal registrado depende de las personas disponibles en cada bloque de 30 minutos; sin personal, de tipos_isla.capacidad. Duración NULL = hasta el cierre.';

-- ---------------------------------------------------------------------------
-- Carga inicial del equipo técnico de la demo (nombres ficticios).
-- Habilidades: Joaquín = servicio rápido + lavado; Felipe = pintura;
-- Francisco = alineación + lavado; los tres mecánicos master = taller mecánico.
-- Sin horario propio: usan el horario de atención del taller hasta que se
-- les defina uno desde la Agenda.
-- ---------------------------------------------------------------------------
do $$
declare
  v_emp uuid;
  v_persona record;
  v_id uuid;
  v_isla text;
begin
  foreach v_emp in array array['b0000000-0000-4000-8000-000000000001'::uuid] loop
    if not exists (select 1 from public.empresas where id = v_emp) then
      continue;
    end if;

    for v_persona in
      select * from (values
        (1, 'Cristian Morales', 'Mecánico master', array['Taller mecánico']),
        (2, 'Nicolás Herrera', 'Mecánico master', array['Taller mecánico']),
        (3, 'Matías Silva', 'Mecánico master', array['Taller mecánico']),
        (4, 'Joaquín Vergara', 'Lavador / servicios rápidos', array['Servicio rápido', 'Lavado']),
        (5, 'Felipe Contreras', 'Detailer / pintura', array['Pintura']),
        (6, 'Francisco Gómez', 'Alineador / lavador', array['Alineación', 'Lavado'])
      ) as x(orden, nombre, cargo, islas)
    loop
      select id into v_id from public.personal_taller where empresa_id = v_emp and nombre = v_persona.nombre;
      if v_id is null then
        insert into public.personal_taller (empresa_id, nombre, cargo, orden, usuario_id)
        values (
          v_emp, v_persona.nombre, v_persona.cargo, v_persona.orden,
          (select u.id from public.usuarios u where u.empresa_id = v_emp and lower(u.nombre_completo) = lower(v_persona.nombre) limit 1)
        )
        returning id into v_id;
      end if;

      foreach v_isla in array v_persona.islas loop
        insert into public.personal_habilidades (personal_id, tipo_isla_id, empresa_id)
        select v_id, t.id, v_emp
        from public.tipos_isla t
        where t.empresa_id = v_emp and t.nombre = v_isla
        on conflict do nothing;
      end loop;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Verificación. Los cupos se miden un lunes futuro a las 10:00, sin citas:
-- mecánico 3, servicio rápido 1, alineación 1, pintura 1, lavado 2 (Joaquín o
-- Francisco, si no están ocupados en lo suyo).
-- ---------------------------------------------------------------------------
select
  e.nombre || case when e.es_demo then ' (demo)' else '' end as empresa,
  (select count(*) from public.personal_taller p where p.empresa_id = e.id) as personas_esperado_6,
  (select count(*) from public.personal_habilidades h where h.empresa_id = e.id) as habilidades_esperado_8,
  (select string_agg(t.nombre || '=' || public.agenda_cupos_bloque(t.id, (date_trunc('week', current_date) + interval '7 days')::date, 600), ', ' order by t.orden)
     from public.tipos_isla t where t.empresa_id = e.id and t.activo) as cupos_lunes_10h
from public.empresas e
order by e.es_demo;
