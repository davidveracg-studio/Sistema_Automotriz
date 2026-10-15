-- =============================================================================
-- 0050_demo_equipo_tecnico.sql
--
-- Qué resuelve:
--   El equipo técnico de la demo, con las funciones de un taller real y
--   nombres ficticios:
--     Cristian Morales, Nicolás Herrera, Matías Silva  -> mecánicos master
--     Joaquín Vergara                                  -> lavador / servicios rápidos
--     Felipe Contreras                                 -> detailer / pintura
--     Francisco Gómez                                  -> alineador / lavador
--   - Las cuentas demo de técnico y detailer pasan a llamarse Cristian Morales
--     y Felipe Contreras (mismos correos de acceso de siempre).
--   - Se crean cuatro usuarios más (Nicolás, Matías, Joaquín y Francisco). Sus
--     cuentas de acceso se crean antes con scripts/crear-demo-vpai.mjs.
--   - Cada persona del equipo (personal_taller) queda ligada a su usuario.
--   - Cada puesto del plano queda a cargo del técnico de su función.
--   - Las tareas de las OT activas pasan al técnico del puesto donde está el
--     vehículo. Las OT ya entregadas quedan bloqueadas y conservan lo suyo.
--   Solo toca el tenant demo. Se puede volver a correr.
--
-- Antes de correr esto:  SUPABASE_SERVICE_ROLE_KEY=... node scripts/crear-demo-vpai.mjs
-- =============================================================================

do $$
declare
  emp constant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_cristian constant uuid := 'a0000000-0000-4000-8000-000000000006';
  v_felipe constant uuid := 'a0000000-0000-4000-8000-000000000007';
  v_nicolas constant uuid := 'a0000000-0000-4000-8000-000000000009';
  v_matias constant uuid := 'a0000000-0000-4000-8000-00000000000a';
  v_joaquin constant uuid := 'a0000000-0000-4000-8000-00000000000b';
  v_francisco constant uuid := 'a0000000-0000-4000-8000-00000000000c';
begin
  if not exists (select 1 from public.empresas where id = emp) then
    raise notice 'No existe el tenant demo: no se cambia nada.';
    return;
  end if;

  if (select count(*) from auth.users where id in (v_nicolas, v_matias, v_joaquin, v_francisco)) < 4 then
    raise exception 'Faltan las cuentas de acceso de los técnicos nuevos: corre antes scripts/crear-demo-vpai.mjs.';
  end if;

  insert into public.usuarios (id, empresa_id, nombre_completo, correo, rol, activo) values
    (v_cristian, emp, 'Cristian Morales', 'demo-tecnico@vpai.dev', 'tecnico', true),
    (v_felipe, emp, 'Felipe Contreras', 'demo-detailer@vpai.dev', 'detailer', true),
    (v_nicolas, emp, 'Nicolás Herrera', 'demo-mecanico2@vpai.dev', 'tecnico', true),
    (v_matias, emp, 'Matías Silva', 'demo-mecanico3@vpai.dev', 'tecnico', true),
    (v_joaquin, emp, 'Joaquín Vergara', 'demo-lavador@vpai.dev', 'tecnico', true),
    (v_francisco, emp, 'Francisco Gómez', 'demo-alineador@vpai.dev', 'tecnico', true)
  on conflict (id) do update set
    empresa_id = excluded.empresa_id, nombre_completo = excluded.nombre_completo, correo = excluded.correo,
    rol = excluded.rol, activo = excluded.activo;

  -- Cada persona del equipo, ligada a su usuario.
  update public.personal_taller p
  set usuario_id = u.id
  from public.usuarios u
  where p.empresa_id = emp and u.empresa_id = emp and lower(u.nombre_completo) = lower(p.nombre);

  -- Técnico a cargo de cada puesto del plano.
  update public.plano_elementos e
  set tecnico_id = x.tecnico
  from (values
    ('Elevador 1', v_cristian), ('Elevador 2', v_nicolas), ('Elevador 3', v_matias),
    ('Servicio rápido 1', v_joaquin), ('Servicio rápido 2', v_joaquin), ('Lavado', v_joaquin),
    ('Alineadora', v_francisco), ('Pintura', v_felipe)
  ) as x(nombre, tecnico)
  where e.empresa_id = emp and e.nombre = x.nombre;

  -- Las tareas de las OT activas pasan al técnico del puesto donde está el vehículo.
  update public.tareas_taller ta
  set tecnico_id = pe.tecnico_id
  from public.trabajos_taller o
  join public.plano_ocupacion po on po.trabajo_id = o.id
  join public.plano_elementos pe on pe.id = po.elemento_id
  where ta.trabajo_id = o.id
    and o.empresa_id = emp
    and o.estado not in ('entregado', 'anulado')
    and o.bloqueada_en is null
    and pe.tecnico_id is not null
    and ta.tecnico_id is not null;
end $$;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.usuarios where empresa_id = 'b0000000-0000-4000-8000-000000000001' and rol in ('tecnico', 'detailer')) as tecnicos_esperado_6,
  (select count(*) from public.personal_taller where empresa_id = 'b0000000-0000-4000-8000-000000000001' and usuario_id is not null) as equipo_ligado_esperado_6,
  (select string_agg(e.nombre || '=' || u.nombre_completo, ', ' order by e.nombre)
     from public.plano_elementos e join public.usuarios u on u.id = e.tecnico_id
     where e.empresa_id = 'b0000000-0000-4000-8000-000000000001') as puestos_a_cargo;
