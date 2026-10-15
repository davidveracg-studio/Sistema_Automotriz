-- =============================================================================
-- 0067_taller_sin_clickup.sql
--
-- Qué resuelve:
--   La demo funciona completa SIN ClickUp: el Kanban del taller, el detalle de
--   la OT, las tareas y las listas de control trabajan solo contra la base
--   cuando la empresa no tiene una lista de ClickUp activa (clickup_config).
--   Las Edge Functions (clickup-kanban, clickup-tarea, clickup-item) ya
--   detectan ese "modo local"; esta migración deja los datos que necesitan:
--
--   1. clickup_estados de la demo: los 13 estados del flujo del taller, en el
--      orden de trabajo, con su tipo y color. Son las columnas del Kanban.
--      Los ids llevan el prefijo "local-" (no vienen de ninguna lista de
--      ClickUp). Si más adelante se conecta una lista, "Releer estados" en el
--      Kanban los reemplaza por los de ClickUp.
--   2. "compra reptos (victor)" -nombre del estado en la lista original, con
--      el nombre de una persona- pasa a "compra reptos (bodega)" en la demo.
--   3. Toda OT activa sin estado de taller queda en "agenda" (si vino de una
--      cita) o "por designar" (si no), y un trigger hace lo mismo con las OT
--      nuevas de las empresas sin ClickUp -con ClickUp, ese estado lo pone la
--      tarjeta al crearse (clickup-sincronizar)-.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Estados del taller (columnas del Kanban) de la demo.
-- ---------------------------------------------------------------------------
do $$
declare
  emp constant uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  if not exists (select 1 from public.empresas where id = emp) then
    raise notice 'No existe el tenant demo: no se cargan estados.';
    return;
  end if;

  if exists (select 1 from public.clickup_config where empresa_id = emp and activo) then
    raise notice 'La demo tiene una lista de ClickUp activa: sus estados vienen de ClickUp, no se tocan.';
    return;
  end if;

  delete from public.clickup_estados where empresa_id = emp and clickup_status_id not like 'local-%';

  insert into public.clickup_estados (empresa_id, clickup_status_id, nombre, orden, tipo, color)
  values
    (emp, 'local-01', 'agenda', 0, 'open', '#87909e'),
    (emp, 'local-02', 'por designar', 1, 'custom', '#5f55ee'),
    (emp, 'local-03', 'en reparación', 2, 'custom', '#1090e0'),
    (emp, 'local-04', 'reparación servicio externo', 3, 'custom', '#0f9d9f'),
    (emp, 'local-05', 'compra reptos (bodega)', 4, 'custom', '#e16b16'),
    (emp, 'local-06', 'espera reptos (cliente)', 5, 'custom', '#ee5e99'),
    (emp, 'local-07', 'pintura/desabolladura', 6, 'custom', '#b660e0'),
    (emp, 'local-08', 'lavado', 7, 'custom', '#4466ff'),
    (emp, 'local-09', 'alineación', 8, 'custom', '#667684'),
    (emp, 'local-10', 'prueba en ruta', 9, 'custom', '#f8ae00'),
    (emp, 'local-11', 'retroceso', 10, 'custom', '#d33d44'),
    (emp, 'local-12', 'listo para entrega', 11, 'custom', '#2ea52c'),
    (emp, 'local-13', 'completadas', 12, 'done', '#008844')
  on conflict (empresa_id, clickup_status_id) do update
    set nombre = excluded.nombre, orden = excluded.orden, tipo = excluded.tipo, color = excluded.color;

  -- ---------------------------------------------------------------------------
  -- 2. Estado con nombre de persona -> nombre neutro.
  -- ---------------------------------------------------------------------------
  update public.trabajos_taller
  set clickup_estado_actual = 'compra reptos (bodega)'
  where empresa_id = emp and clickup_estado_actual = 'compra reptos (victor)';

  update public.tareas_taller ta
  set estado = 'compra reptos (bodega)'
  from public.trabajos_taller o
  where o.id = ta.trabajo_id and o.empresa_id = emp and ta.estado = 'compra reptos (victor)';

  -- "alineacion" (sin tilde, como lo dejó 0049) -> mismo nombre que la columna.
  update public.trabajos_taller
  set clickup_estado_actual = 'alineación'
  where empresa_id = emp and clickup_estado_actual = 'alineacion';

  -- ---------------------------------------------------------------------------
  -- 3. OT activas sin estado de taller.
  -- ---------------------------------------------------------------------------
  update public.trabajos_taller
  set clickup_estado_actual = case when cita_id is not null then 'agenda' else 'por designar' end
  where empresa_id = emp
    and estado not in ('entregado', 'anulado')
    and clickup_estado_actual is null;
end $$;

-- ---------------------------------------------------------------------------
-- 3b. Estado inicial de las OT nuevas en empresas sin ClickUp.
-- ---------------------------------------------------------------------------
create or replace function public.estado_taller_inicial_sin_clickup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.clickup_estado_actual is null
     and not exists (select 1 from public.clickup_config c where c.empresa_id = new.empresa_id and c.activo) then
    new.clickup_estado_actual := case when new.cita_id is not null then 'agenda' else 'por designar' end;
  end if;
  return new;
end;
$$;

comment on function public.estado_taller_inicial_sin_clickup is 'Empresas sin lista de ClickUp activa: la OT nueva nace en "agenda" (viene de una cita) o "por designar", igual que su tarjeta en ClickUp.';

drop trigger if exists trg_estado_taller_inicial_sin_clickup on public.trabajos_taller;
create trigger trg_estado_taller_inicial_sin_clickup
  before insert on public.trabajos_taller
  for each row execute function public.estado_taller_inicial_sin_clickup();

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.clickup_estados where empresa_id = 'b0000000-0000-4000-8000-000000000001' and clickup_status_id like 'local-%') as estados_locales_esperado_13,
  (select count(*) from public.trabajos_taller where empresa_id = 'b0000000-0000-4000-8000-000000000001'
     and estado not in ('entregado', 'anulado') and clickup_estado_actual is null) as ot_activas_sin_estado_esperado_0,
  (select count(*) from public.trabajos_taller where empresa_id = 'b0000000-0000-4000-8000-000000000001'
     and estado not in ('entregado', 'anulado')
     and lower(clickup_estado_actual) not in (select lower(nombre) from public.clickup_estados where empresa_id = 'b0000000-0000-4000-8000-000000000001')) as ot_en_estado_sin_columna_esperado_0,
  (select count(*) from pg_trigger where tgname = 'trg_estado_taller_inicial_sin_clickup') as trigger_esperado_1;
