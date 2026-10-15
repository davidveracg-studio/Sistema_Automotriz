-- =============================================================================
-- 0049_demo_estados_clickup.sql
--
-- Qué resuelve:
--   Las OT activas del tenant demo traían estados inventados ("en ejecución",
--   "esperando aprobación", "presentado al cliente", "en detección", "ingresado",
--   "compra reptos") que no existen en la lista de ClickUp. Al sincronizar la
--   demo, ClickUp devolvió sus propios estados y pisó los de la base (quedaron
--   11 OT en "por designar"). Esto deja cada OT activa de la demo en un estado
--   real de la lista de ClickUp, con el tiempo que lleva en él, y hace que las
--   subtareas de mano de obra tomen el estado de su OT.
--   Solo toca el tenant demo. Se puede volver a correr.
--   Después se repite "Sincronizar la demo con ClickUp" (Trabajos) para que las
--   tarjetas de ClickUp queden en los mismos estados.
-- =============================================================================

do $$
declare
  emp constant uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  if not exists (select 1 from public.empresas where id = emp) then
    raise notice 'No existe el tenant demo: no se cambia nada.';
    return;
  end if;

  -- Primero el estado y, en un UPDATE aparte, el tiempo que lleva en él: el
  -- trigger marcar_cambio_estado_trabajo (0017) reinicia estado_cambiado_en cada
  -- vez que cambia clickup_estado_actual.
  update public.trabajos_taller t
  set clickup_estado_actual = x.estado
  from (values
    ('VPAI03', 'en reparación', 95),
    ('VPAI04', 'espera reptos (cliente)', 300),
    ('VPAI05', 'compra reptos (victor)', 1500),
    ('VPAI07', 'alineacion', 45),
    ('VPAI09', 'por designar', 20),
    ('VPAI10', 'por designar', 30),
    ('VPAI23', 'lavado', 50),
    ('VPAI26', 'pintura/desabolladura', 1400),
    ('VPAI21', 'en reparación', 25),
    ('VPAI28', 'prueba en ruta', 15),
    ('VPAI29', 'espera reptos (cliente)', 170)
  ) as x(patente, estado, mins)
  where t.empresa_id = emp and t.estado not in ('entregado', 'anulado')
    and t.vehiculo_id = (select id from public.vehiculos where empresa_id = emp and patente = x.patente);

  update public.trabajos_taller t
  set estado_cambiado_en = now() - make_interval(mins => x.mins)
  from (values
    ('VPAI03', 'en reparación', 95),
    ('VPAI04', 'espera reptos (cliente)', 300),
    ('VPAI05', 'compra reptos (victor)', 1500),
    ('VPAI07', 'alineacion', 45),
    ('VPAI09', 'por designar', 20),
    ('VPAI10', 'por designar', 30),
    ('VPAI23', 'lavado', 50),
    ('VPAI26', 'pintura/desabolladura', 1400),
    ('VPAI21', 'en reparación', 25),
    ('VPAI28', 'prueba en ruta', 15),
    ('VPAI29', 'espera reptos (cliente)', 170)
  ) as x(patente, estado, mins)
  where t.empresa_id = emp and t.estado not in ('entregado', 'anulado')
    and t.vehiculo_id = (select id from public.vehiculos where empresa_id = emp and patente = x.patente);

  -- Subtareas de mano de obra: el estado de su OT (las que están en "agenda" o
  -- "por designar" se quedan como están).
  update public.tareas_taller ta
  set estado = o.clickup_estado_actual
  from public.trabajos_taller o
  where o.id = ta.trabajo_id
    and o.empresa_id = emp
    and o.estado not in ('entregado', 'anulado')
    and o.clickup_estado_actual is not null
    and o.clickup_estado_actual not in ('agenda', 'por designar');
end $$;

-- ---------------------------------------------------------------------------
-- Verificación: ningún estado inventado y la variedad de estados reales.
-- ---------------------------------------------------------------------------
select 'OT' as tipo, clickup_estado_actual as estado, count(*) as cantidad
from public.trabajos_taller
where empresa_id = 'b0000000-0000-4000-8000-000000000001' and estado not in ('entregado', 'anulado')
group by clickup_estado_actual
union all
select 'Tarea', ta.estado, count(*)
from public.tareas_taller ta
join public.trabajos_taller o on o.id = ta.trabajo_id
where o.empresa_id = 'b0000000-0000-4000-8000-000000000001' and o.estado not in ('entregado', 'anulado')
group by ta.estado
order by 1, 2;
