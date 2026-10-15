-- =============================================================================
-- 0045_plano_layout_taller.sql
--
-- Qué resuelve:
--   Lleva el plano del taller al layout real (33 m x 65 m, 2.145 m2):
--   - plano_elementos.rotacion: giro libre en grados (las dos islas de
--     servicio rápido van en diagonal). Girar 90 grados sigue siendo
--     intercambiar ancho y alto.
--   - Nuevo tipo de figura recepcion_ingreso (estacionamientos de ingreso).
--   - Tenant demo: reemplaza su plano por el layout completo (15 puestos
--     productivos, 15 de pulmón, 2 de recepción/ingreso y las salas) y vuelve
--     a ubicar en él las 10 OT que estaban en el plano anterior. El tenant
--     real NO se toca: ahí se carga con el botón "Cargar plano base del
--     taller" en Taller > Editar plano.
--   - La capacidad de la Agenda no cambia: solo 4 puestos de mecánica llevan
--     tipo de isla (3 elevadores + Puesto 1), más 2 de servicio rápido, 1 de
--     alineación, 1 de pintura y 1 de lavado.
-- =============================================================================

alter table public.plano_elementos
  add column if not exists rotacion integer not null default 0 check (rotacion between 0 and 359);

comment on column public.plano_elementos.rotacion is 'Giro libre en grados (sentido horario). El alto y ancho son los del dibujo sin girar.';
comment on table public.plano_elementos is 'Figuras del plano del taller. x/y/ancho/alto en celdas de grilla (1 celda = 1 m). Girar 90 grados = intercambiar ancho y alto; rotacion permite ángulos libres.';

alter table public.plano_elementos drop constraint if exists plano_elementos_tipo_check;
alter table public.plano_elementos
  add constraint plano_elementos_tipo_check check (tipo in (
    'isla_elevador', 'isla_simple', 'isla_pozo', 'alineadora', 'vulcanizacion',
    'pulmon', 'desabolladura_pintura', 'lavado', 'recepcion_ingreso', 'oficina'
  ));

-- ---------------------------------------------------------------------------
-- Tenant demo: plano nuevo, conservando técnicos responsables y ocupación.
-- ---------------------------------------------------------------------------
do $$
declare
  emp constant uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  if not exists (select 1 from public.empresas where id = emp) then
    raise notice 'No existe el tenant demo: se omite el plano.';
    return;
  end if;

  create temp table _plano_tecnicos on commit drop as
  select
    case pe.nombre when 'Pozo 1' then 'Puesto 1' else pe.nombre end as nombre,
    pe.tecnico_id
  from public.plano_elementos pe
  where pe.empresa_id = emp and pe.tecnico_id is not null;

  create temp table _plano_ocupacion on commit drop as
  select
    po.trabajo_id,
    po.desde,
    case pe.nombre when 'Pozo 1' then 'Puesto 1' when 'Pulmón' then 'Pulmón 1' else pe.nombre end as puesto
  from public.plano_ocupacion po
  join public.plano_elementos pe on pe.id = po.elemento_id
  where po.empresa_id = emp;

  delete from public.plano_elementos where empresa_id = emp;

  insert into public.plano_elementos
    (empresa_id, tipo, nombre, x, y, ancho, alto, rotacion, capacidad_vehiculos, tipo_isla_id, tecnico_id)
  select emp, x.tipo, x.nombre, x.px, x.py, x.ancho, x.alto, x.rotacion, 1, ti.id, tec.tecnico_id
  from (values
    ('pulmon', 'Pulmón 1', 0, 0, 3, 5, 0, null),
    ('pulmon', 'Pulmón 2', 4, 0, 3, 5, 0, null),
    ('pulmon', 'Pulmón 3', 7, 0, 3, 5, 0, null),
    ('pulmon', 'Pulmón 4', 12, 7, 3, 5, 0, null),
    ('pulmon', 'Pulmón 5', 12, 13, 3, 5, 0, null),
    ('pulmon', 'Pulmón 6', 0, 7, 6, 3, 0, null),
    ('pulmon', 'Pulmón 7', 0, 11, 6, 3, 0, null),
    ('pulmon', 'Pulmón 8', 0, 14, 6, 3, 0, null),
    ('pulmon', 'Pulmón 9', 0, 18, 6, 3, 0, null),
    ('pulmon', 'Pulmón 10', 0, 21, 6, 3, 0, null),
    ('pulmon', 'Pulmón 11', 0, 24, 6, 3, 0, null),
    ('pulmon', 'Pulmón 12', 0, 28, 6, 3, 0, null),
    ('pulmon', 'Pulmón 13', 0, 35, 3, 5, 0, null),
    ('pulmon', 'Pulmón 14', 4, 35, 3, 5, 0, null),
    ('pulmon', 'Pulmón 15', 7, 35, 3, 5, 0, null),
    ('desabolladura_pintura', 'Pintura', 11, 0, 3, 5, 0, 'Pintura'),
    ('lavado', 'Lavado', 11, 35, 3, 5, 0, 'Lavado'),
    ('alineadora', 'Alineadora', 19, 3, 2, 15, 0, 'Alineación'),
    ('isla_simple', 'Puesto 1', 27, 21, 6, 3, 0, 'Taller mecánico'),
    ('isla_elevador', 'Elevador 1', 27, 24, 6, 4, 0, 'Taller mecánico'),
    ('isla_elevador', 'Elevador 2', 27, 28, 6, 4, 0, 'Taller mecánico'),
    ('isla_simple', 'Puesto 2', 27, 33, 6, 3, 0, null),
    ('isla_simple', 'Puesto 3', 27, 36, 6, 3, 0, null),
    ('isla_elevador', 'Elevador 3', 27, 40, 6, 4, 0, 'Taller mecánico'),
    ('isla_simple', 'Puesto 4', 27, 44, 6, 3, 0, null),
    ('isla_simple', 'Puesto 5', 27, 47, 6, 3, 0, null),
    ('isla_simple', 'Puesto 6', 27, 50, 6, 3, 0, null),
    ('isla_simple', 'Puesto 7', 15, 44, 3, 5, 0, null),
    ('isla_pozo', 'Servicio rápido 1', 0, 56, 6, 2, 30, 'Servicio rápido'),
    ('isla_pozo', 'Servicio rápido 2', 0, 58, 6, 2, 30, 'Servicio rápido'),
    ('recepcion_ingreso', 'Ingreso 1', 27, 55, 6, 3, 0, null),
    ('recepcion_ingreso', 'Ingreso 2', 11, 56, 3, 5, 0, null),
    ('oficina', 'Sala 1', 15, 0, 3, 3, 0, null),
    ('oficina', 'Sala 2', 24, 0, 9, 20, 0, null),
    ('oficina', 'Sala 3', 15, 33, 6, 8, 0, null),
    ('oficina', 'Oficina 1', 2, 42, 5, 6, 0, null),
    ('oficina', 'Oficina 2', 7, 42, 7, 4, 0, null),
    ('oficina', 'Oficina 3', 2, 48, 6, 6, 0, null),
    ('oficina', 'Oficina 4', 8, 46, 6, 8, 0, null),
    ('oficina', 'Sala 4', 14, 50, 3, 4, 0, null),
    ('oficina', 'Sala 5', 27, 60, 6, 4, 0, null)
  ) as x(tipo, nombre, px, py, ancho, alto, rotacion, isla)
  left join public.tipos_isla ti on ti.empresa_id = emp and ti.nombre = x.isla
  left join _plano_tecnicos tec on tec.nombre = x.nombre;

  insert into public.plano_ocupacion (empresa_id, elemento_id, trabajo_id, desde)
  select emp, pe.id, o.trabajo_id, o.desde
  from _plano_ocupacion o
  join public.plano_elementos pe on pe.empresa_id = emp and pe.nombre = o.puesto;
end $$;

-- ---------------------------------------------------------------------------
-- Verificación (tenant demo).
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'plano_elementos' and column_name = 'rotacion') as columna_rotacion_esperado_1,
  (select count(*) from public.plano_elementos where empresa_id = 'b0000000-0000-4000-8000-000000000001') as figuras_esperado_41,
  (select count(*) from public.plano_elementos where empresa_id = 'b0000000-0000-4000-8000-000000000001' and tipo = 'pulmon') as pulmon_esperado_15,
  (select count(*) from public.plano_elementos where empresa_id = 'b0000000-0000-4000-8000-000000000001' and tipo = 'recepcion_ingreso') as recepcion_esperado_2,
  (select count(*) from public.plano_ocupacion where empresa_id = 'b0000000-0000-4000-8000-000000000001') as ocupacion_esperado_10,
  (select string_agg(ti.nombre || '=' || ti.capacidad, ', ' order by ti.orden)
     from public.tipos_isla ti where ti.empresa_id = 'b0000000-0000-4000-8000-000000000001') as capacidades_agenda;
