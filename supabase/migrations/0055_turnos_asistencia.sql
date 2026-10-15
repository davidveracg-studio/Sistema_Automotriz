-- =============================================================================
-- 0055_turnos_asistencia.sql
--
-- Qué resuelve:
--   Módulo de turnos y asistencia (RRHH), a partir del informe de eventos del
--   reloj control (.xls, una fila por marca suelta: ficha, RUT, nombre,
--   jornada, fecha, hora, tipo ENTRADA/SALIDA, estado Pareado/S/Parear/
--   Anulado). La lógica es un PORTE del informe Power Query que ya usaba el
--   cliente (Cumplimiento_Turnos / Resumen_Asistencia_Mensual) -no un
--   rediseño-, verificada columna a columna contra ese código el 2026-09-27:
--
--   - personal_turnos: nómina de personas con turno (no son necesariamente
--     usuarios del sistema -la mayoría no tiene ni necesita cuenta del CRM-,
--     por eso es una tabla propia y no una extensión de usuarios ni de
--     personal_taller de la Agenda, que tienen otro propósito y otra gente).
--     Grupos: 'azul'/'verde' (rotativos, uno siempre el patrón contrario al
--     otro) y 'fijo_lv'/'fijo_ms' (sin rotación).
--   - turnos_feriados: días sin turno esperado para nadie. Tabla editable
--     -no una lista fija en código-, porque los feriados cambian cada año;
--     acá solo se cargan los 3 días que dio el cliente como ejemplo.
--   - turnos_marcas: las marcas importadas del reloj (sin las "Anulado": no
--     son una marca real). Guarda fecha_real+hora (el instante real de la
--     marca) Y dia_trabajo (a qué jornada pertenece -la columna JORNADA del
--     reloj, cuando viene informada, manda por sobre la fecha real: una
--     marca de la madrugada puede pertenecer a la jornada del día
--     anterior-). En el informe real de agosto 2026, 14 de 903 marcas
--     tenían jornada distinta de su fecha real.
--   - turnos_justificativos: para que una falta no quede como "sin más" si
--     tiene licencia médica, permiso sin goce, día recuperado (con su fecha
--     de recuperación) u otro motivo -igual que la tabla "Justificativos"
--     que el cliente mantenía a mano en Excel-. No cambia la clasificación
--     del día (sigue siendo "falta"): es una anotación para el resumen
--     mensual.
--   - Rotación Azul/Verde: semana ancla lunes 03-08-2026 a domingo
--     09-08-2026, donde Azul trabajó Lunes-Viernes y Verde Martes-Sábado.
--     La paridad de cualquier otra semana (par = mismo patrón que el ancla)
--     se calcula contando semanas completas de diferencia con esa semana,
--     hacia adelante o hacia atrás sin límite.
--   - Horas trabajadas de una jornada: PRIMERA marca del día menos ÚLTIMA
--     marca del día, sin importar el tipo (entrada/salida) ni restar
--     colación -un solo número por jornada, igual que Pares_Entrada_Salida
--     del cliente-. No es una suma de sesiones entrada→salida.
--   - Clasificación por día (turnos_resumen_diario):
--       sin turno esperado (feriado, día de descanso según el patrón de la
--         semana, o después de la fecha de salida) + con marcas -> "jornada_extraordinaria"
--       con turno esperado + sin marcas -> "falta"
--       con turno esperado + UNA sola marca ese día -> "incompleta" (la
--         persona vino pero el reloj no le tomó el par -jornada partida sin
--         marcar la vuelta, por ejemplo-)
--       con turno esperado + 2 o más marcas -> "normal"
--       sin turno esperado + sin marcas -> no genera fila (nada que
--         registrar ese día para esa persona)
--   Verificado contra un informe real de agosto 2026 del cliente (14 personas,
--   903 marcas reales, 14 con jornada distinta de la fecha real, 19 días
--   con una sola marca).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Nómina.
-- ---------------------------------------------------------------------------
create table if not exists public.personal_turnos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nombre_completo text not null,
  rut text,
  ficha_reloj text,
  grupo text not null check (grupo in ('azul', 'verde', 'fijo_lv', 'fijo_ms')),
  usuario_id uuid references public.usuarios (id) on delete set null,
  fecha_salida date,
  activo boolean not null default true,
  orden integer not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint uq_personal_turnos_ficha unique (empresa_id, ficha_reloj)
);

comment on table public.personal_turnos is 'Nómina para turnos y asistencia. No es lo mismo que usuarios (cuenta de acceso al CRM) ni personal_taller (equipo de la Agenda): puede haber gente aquí sin ninguna de las otras dos.';
comment on column public.personal_turnos.grupo is 'azul/verde = rotativos (uno siempre el patrón contrario del otro); fijo_lv/fijo_ms = sin rotación.';
comment on column public.personal_turnos.fecha_salida is 'Último día con turno esperado. Desde el día siguiente, la persona deja de tener turno esperado (pero una marca ese día igual se clasifica, como jornada extraordinaria).';
comment on column public.personal_turnos.ficha_reloj is 'Código de ficha del reloj control, para cruzar el informe de eventos importado.';

create index if not exists personal_turnos_empresa_idx on public.personal_turnos (empresa_id) where activo;

drop trigger if exists trg_personal_turnos_actualizado_en on public.personal_turnos;
create trigger trg_personal_turnos_actualizado_en
  before update on public.personal_turnos
  for each row execute function public.actualizar_marca_de_tiempo();

-- ---------------------------------------------------------------------------
-- Feriados: se completa a mano (Admin/RRHH), no es una lista fija en código.
-- ---------------------------------------------------------------------------
create table if not exists public.turnos_feriados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  fecha date not null,
  motivo text,
  creado_en timestamptz not null default now(),
  constraint uq_turnos_feriados unique (empresa_id, fecha)
);

comment on table public.turnos_feriados is 'Días sin turno esperado para nadie, sin importar el grupo. Se mantiene completa a mano -los feriados cambian cada año-.';

-- ---------------------------------------------------------------------------
-- Marcas importadas del reloj control (una fila por marca; las "Anulado" del
-- reloj no se importan -no son una marca real-).
-- ---------------------------------------------------------------------------
create table if not exists public.turnos_marcas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  personal_id uuid not null references public.personal_turnos (id) on delete cascade,
  fecha_real date not null,
  dia_trabajo date not null,
  hora time not null,
  tipo text not null check (tipo in ('entrada', 'salida')),
  estado_reloj text,
  importado_por uuid references public.usuarios (id) on delete set null,
  creado_en timestamptz not null default now(),
  constraint uq_turnos_marcas unique (personal_id, fecha_real, hora, tipo)
);

comment on table public.turnos_marcas is 'Marcas de entrada/salida importadas del informe de eventos del reloj control. uq (sobre fecha_real, no dia_trabajo) evita duplicar si se reimporta el mismo período.';
comment on column public.turnos_marcas.fecha_real is 'Fecha real en que ocurrió la marca (columna FECHA del reloj).';
comment on column public.turnos_marcas.dia_trabajo is 'Jornada a la que pertenece la marca (columna JORNADA del reloj si viene informada, si no fecha_real). Es la fecha contra la que se compara el turno esperado.';
comment on column public.turnos_marcas.estado_reloj is 'Estado tal como lo entrega el reloj (Pareado/S/Parear), solo informativo -no afecta el cálculo de horas.';
comment on column public.turnos_marcas.tipo is 'Informativo: el cálculo de horas usa la primera y la última marca del día sin importar el tipo (igual que el informe que ya usaba el cliente), no un emparejamiento entrada/salida.';

create index if not exists turnos_marcas_personal_dia_idx on public.turnos_marcas (personal_id, dia_trabajo);

-- ---------------------------------------------------------------------------
-- Justificativos de una falta (licencia médica, permiso sin goce, día
-- recuperado -con su fecha de recuperación-, u otro). No cambia la
-- clasificación del día (sigue "falta"): es una anotación para el resumen
-- mensual, igual que la tabla que el cliente mantenía a mano en Excel.
-- ---------------------------------------------------------------------------
create table if not exists public.turnos_justificativos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  personal_id uuid not null references public.personal_turnos (id) on delete cascade,
  fecha date not null,
  tipo text not null check (tipo in ('licencia', 'permiso_sin_goce', 'dia_recuperado', 'otro')),
  fecha_recuperacion date,
  nota text,
  creado_por uuid references public.usuarios (id) on delete set null,
  creado_en timestamptz not null default now(),
  constraint uq_turnos_justificativos unique (personal_id, fecha),
  constraint ck_turnos_justificativos_recuperacion check (tipo = 'dia_recuperado' or fecha_recuperacion is null)
);

comment on table public.turnos_justificativos is 'Motivo de una falta (licencia/permiso sin goce/día recuperado/otro), para el resumen mensual. No cambia la clasificación del día en turnos_resumen_diario.';

-- ---------------------------------------------------------------------------
-- RLS: lectura para la empresa; escritura para admin, socia y jefe de taller.
-- ---------------------------------------------------------------------------
alter table public.personal_turnos enable row level security;
alter table public.turnos_feriados enable row level security;
alter table public.turnos_marcas enable row level security;
alter table public.turnos_justificativos enable row level security;

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['personal_turnos', 'turnos_feriados', 'turnos_marcas', 'turnos_justificativos'] loop
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
-- Patrón de una semana para un grupo rotativo ('lv'/'ms'). Semana ancla:
-- lunes 03-08-2026, donde Azul = lv y Verde = ms. date_trunc('week', ...) usa
-- semana ISO (empieza lunes), igual que el enunciado del cliente.
-- ---------------------------------------------------------------------------
create or replace function public.turnos_patron_semana(p_fecha date, p_grupo text)
returns text
language plpgsql
immutable
as $$
declare
  v_ancla constant date := '2026-08-03';
  v_lunes date;
  v_semanas integer;
  v_paridad integer;
  v_patron_ancla text;
begin
  if p_grupo = 'fijo_lv' then return 'lv'; end if;
  if p_grupo = 'fijo_ms' then return 'ms'; end if;
  if p_grupo not in ('azul', 'verde') then return null; end if;

  v_lunes := date_trunc('week', p_fecha)::date;
  v_semanas := (v_lunes - v_ancla) / 7;
  v_paridad := ((v_semanas % 2) + 2) % 2;
  v_patron_ancla := case when p_grupo = 'azul' then 'lv' else 'ms' end;
  return case when v_paridad = 0 then v_patron_ancla when v_patron_ancla = 'lv' then 'ms' else 'lv' end;
end;
$$;

comment on function public.turnos_patron_semana is 'Patrón (lv/ms) que le toca a un grupo en la semana de p_fecha. Semana ancla: 03-08-2026, Azul=lv.';

-- ---------------------------------------------------------------------------
-- ¿Tiene turno esperado esa persona ese día? (sin considerar feriado ni
-- fecha de salida -eso se resuelve en turnos_resumen_diario, que sí conoce
-- a la persona completa).
-- ---------------------------------------------------------------------------
create or replace function public.turnos_dia_en_patron(p_fecha date, p_grupo text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_patron text := public.turnos_patron_semana(p_fecha, p_grupo);
  v_dow integer := extract(dow from p_fecha)::integer; -- 0=domingo .. 6=sábado
begin
  if v_patron = 'lv' then return v_dow between 1 and 5; end if;
  if v_patron = 'ms' then return v_dow between 2 and 6; end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Resumen diario por persona en un rango de fechas. Une nómina x rango de
-- fechas x marcas (agrupadas por dia_trabajo) x feriados. Solo devuelve
-- filas donde hay algo que registrar (turno esperado y/o marcas ese día).
-- ---------------------------------------------------------------------------
create or replace function public.turnos_resumen_diario(p_empresa_id uuid, p_desde date, p_hasta date)
returns table (
  personal_id uuid,
  nombre_completo text,
  grupo text,
  fecha date,
  turno_esperado boolean,
  es_feriado boolean,
  primera_marca time,
  ultima_marca time,
  horas_trabajadas numeric,
  cantidad_marcas integer,
  clasificacion text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_empresa_id is distinct from public.mi_empresa_id() then
    raise exception 'Sin acceso a los turnos de otra empresa.';
  end if;

  return query
  with dias as (
    select generate_series(p_desde, p_hasta, interval '1 day')::date as fecha
  ),
  base as (
    select
      p.id as personal_id,
      p.nombre_completo,
      p.grupo,
      d.fecha,
      (f.fecha is not null) as es_feriado,
      (f.fecha is null and (p.fecha_salida is null or d.fecha <= p.fecha_salida) and public.turnos_dia_en_patron(d.fecha, p.grupo)) as turno_esperado
    from public.personal_turnos p
    cross join dias d
    left join public.turnos_feriados f on f.empresa_id = p.empresa_id and f.fecha = d.fecha
    where p.empresa_id = p_empresa_id and p.activo
  ),
  -- Todas las marcas de la jornada juntas, sin separar por tipo: la primera
  -- y la última del día (mismo criterio que ya usaba el cliente). Columnas
  -- calificadas con el alias tm a propósito: esta función devuelve una tabla
  -- con una columna "personal_id", que en PL/pgSQL queda también como
  -- variable de la función -sin calificar, "personal_id" queda ambiguo
  -- entre esa variable y la columna de turnos_marcas.
  marcas_resumen as (
    select
      tm.personal_id,
      tm.dia_trabajo as fecha,
      min(tm.fecha_real + tm.hora) as instante_primero,
      max(tm.fecha_real + tm.hora) as instante_ultimo,
      count(*) as cantidad_marcas
    from public.turnos_marcas tm
    where tm.empresa_id = p_empresa_id and tm.dia_trabajo between p_desde and p_hasta
    group by tm.personal_id, tm.dia_trabajo
  )
  select
    b.personal_id,
    b.nombre_completo,
    b.grupo,
    b.fecha,
    b.turno_esperado,
    b.es_feriado,
    m.instante_primero::time as primera_marca,
    m.instante_ultimo::time as ultima_marca,
    round(coalesce(extract(epoch from (m.instante_ultimo - m.instante_primero)) / 3600.0, 0)::numeric, 2) as horas_trabajadas,
    coalesce(m.cantidad_marcas, 0)::integer as cantidad_marcas,
    case
      when coalesce(m.cantidad_marcas, 0) > 0 and not b.turno_esperado then 'jornada_extraordinaria'
      when coalesce(m.cantidad_marcas, 0) = 0 and b.turno_esperado then 'falta'
      when m.cantidad_marcas = 1 and b.turno_esperado then 'incompleta'
      when coalesce(m.cantidad_marcas, 0) > 0 and b.turno_esperado then 'normal'
      else null
    end as clasificacion
  from base b
  left join marcas_resumen m on m.personal_id = b.personal_id and m.fecha = b.fecha
  where b.turno_esperado or coalesce(m.cantidad_marcas, 0) > 0
  order by b.nombre_completo, b.fecha;
end;
$$;

comment on function public.turnos_resumen_diario is 'Detalle día a día de turno esperado vs marcas reales, con clasificación (normal/falta/incompleta/jornada_extraordinaria) y horas trabajadas (primera marca del día a la última, sin restar colación). Solo filas con turno esperado y/o marcas.';

-- ---------------------------------------------------------------------------
-- Feriados de ejemplo dados por el cliente. Falta completar el resto del año.
-- ---------------------------------------------------------------------------
insert into public.turnos_feriados (empresa_id, fecha, motivo)
select e.id, x.fecha, x.motivo
from public.empresas e
cross join (values
  (date '2026-08-15', 'Asunción de la Virgen'),
  (date '2026-09-18', 'Fiestas Patrias'),
  (date '2026-09-19', 'Fiestas Patrias')
) as x(fecha, motivo)
where e.id = 'b0000000-0000-4000-8000-000000000001'
on conflict (empresa_id, fecha) do nothing;

-- ---------------------------------------------------------------------------
-- Nómina de ejemplo de la demo: el equipo de usuarios demo (nombres y RUT
-- ficticios), repartido en los cuatro grupos de turno. Se puede volver a correr.
-- ---------------------------------------------------------------------------
do $$
declare
  emp constant uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  if not exists (select 1 from public.empresas where id = emp) then
    return;
  end if;

  insert into public.personal_turnos (empresa_id, nombre_completo, rut, ficha_reloj, grupo, usuario_id)
  select emp, x.nombre, x.rut, x.ficha, x.grupo,
    (select u.id from public.usuarios u where u.empresa_id = emp and lower(u.correo) = lower(x.correo))
  from (values
    ('Carlos Mendoza', '11111111-1', '11111111', 'azul', 'demo-admin@vpai.dev'),
    ('Marcelo Rojas', '12222222-5', '12222222', 'verde', 'demo-asesor@vpai.dev'),
    ('Sergio Palacios', '13333333-9', '13333333', 'fijo_lv', 'demo-jefe-taller@vpai.dev'),
    ('Rodrigo Fuentes', '14444444-2', '14444444', 'azul', 'demo-presupuestos@vpai.dev'),
    ('Cristian Morales', '15555555-6', '15555555', 'verde', 'demo-tecnico@vpai.dev'),
    ('Felipe Contreras', '16666666-k', '16666666', 'fijo_lv', 'demo-detailer@vpai.dev'),
    ('Camila Torres', '17777777-3', '17777777', 'fijo_lv', 'demo-recepcionista@vpai.dev'),
    ('Nicolás Herrera', '18888888-7', '18888888', 'verde', 'demo-mecanico2@vpai.dev'),
    ('Matías Silva', '19999999-0', '19999999', 'azul', 'demo-mecanico3@vpai.dev'),
    ('Joaquín Vergara', '20111111-0', '20111111', 'fijo_ms', 'demo-lavador@vpai.dev'),
    ('Francisco Gómez', '20222222-6', '20222222', 'azul', 'demo-alineador@vpai.dev')
  ) as x(nombre, rut, ficha, grupo, correo)
  on conflict (empresa_id, ficha_reloj) do update set
    nombre_completo = excluded.nombre_completo, rut = excluded.rut, grupo = excluded.grupo, usuario_id = excluded.usuario_id;
end $$;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.personal_turnos where empresa_id = 'b0000000-0000-4000-8000-000000000001') as personal_esperado_11,
  (select count(*) from public.turnos_feriados where empresa_id = 'b0000000-0000-4000-8000-000000000001') as feriados_esperado_3,
  (select public.turnos_patron_semana('2026-08-03', 'azul')) as ancla_azul_esperado_lv,
  (select public.turnos_patron_semana('2026-08-10', 'azul')) as semana_siguiente_azul_esperado_ms,
  (select count(*) from pg_proc where proname in ('turnos_patron_semana', 'turnos_dia_en_patron', 'turnos_resumen_diario')) as funciones_esperado_3,
  (select count(*) from pg_policies where tablename = 'turnos_justificativos') as politicas_justificativos_esperado_4;
