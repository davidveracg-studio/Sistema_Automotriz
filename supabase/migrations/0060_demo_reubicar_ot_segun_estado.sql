-- =============================================================================
-- 0060_demo_reubicar_ot_segun_estado.sql
--
-- Qué resuelve:
--   Ajuste puntual de datos del tenant demo (no toca el real): reubica cada
--   OT activa en el puesto que le corresponde según su estado actual, con
--   las mismas reglas del Kanban (lib/tallerReglas.js, dadas por el cliente
--   el 2026-09-28). El plano demo se armó antes de que existieran estas
--   reglas, así que varios vehículos quedaron en un puesto que ya no calza
--   -esto es justo lo que el aviso rojo del Kanban venía señalando-.
--
--   Reglas replicadas (ver tallerReglas.js para la versión que usa la app):
--     por designar                          -> Ingreso 1 o Ingreso 2
--     en reparación                         -> un elevador o Puesto 1-6
--     reparación servicio externo           -> Puesto 1-6 o un pulmón
--     compra reptos (...)                   -> Puesto 1-6 o un pulmón
--     espera reptos (...)                   -> un pulmón
--     pintura/desabolladura                 -> Pintura
--     lavado                                -> Lavado
--     alineación                            -> Alineadora
--     listo para entrega                    -> un pulmón o un ingreso
--     subtarea de vulcanización/rotación/
--     balanceo en curso (no completada,
--     no agenda/por designar)               -> Puesto 7, manda sobre el estado
--   Estados sin regla (agenda, prueba en ruta, retroceso, etc.) no se tocan:
--   no hay un puesto "correcto" definido para ellos.
--
--   Si una OT ya está en un puesto permitido, no se mueve. Si no hay ningún
--   puesto de la categoría con cupo libre, se deja donde está y queda un
--   aviso (NOTICE) para revisar a mano -no se saca a nadie de su puesto sin
--   tener a dónde ponerlo-.
-- =============================================================================

do $$
declare
  emp constant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_ot record;
  v_clave text;
  v_ingreso boolean; v_elevador boolean; v_puesto16 boolean; v_puesto7 boolean;
  v_pulmon boolean; v_pintura boolean; v_lavado boolean; v_alineadora boolean;
  v_vulcanizacion boolean;
  v_ya_ok boolean;
  v_elemento_id uuid;
  v_movidas integer := 0;
  v_sin_cupo integer := 0;
begin
  if not exists (select 1 from public.empresas where id = emp) then
    raise notice 'No existe el tenant demo: se omite.';
    return;
  end if;

  for v_ot in
    select t.id, t.numero_ot, coalesce(t.clickup_estado_actual, t.estado) as estado_actual
    from public.trabajos_taller t
    where t.empresa_id = emp and t.estado not in ('entregado', 'anulado')
  loop
    v_clave := lower(trim(coalesce(v_ot.estado_actual, '')));

    select exists (
      select 1 from public.tareas_taller tt
      where tt.trabajo_id = v_ot.id
        and tt.descripcion ~* '(vulcaniz|rotaci.n|balanceo)'
        and tt.descripcion !~* 'alinea'
        and not tt.completada
        and lower(tt.estado) not in ('agenda', 'por designar')
    ) into v_vulcanizacion;

    v_ingreso := false; v_elevador := false; v_puesto16 := false; v_puesto7 := false;
    v_pulmon := false; v_pintura := false; v_lavado := false; v_alineadora := false;

    if v_vulcanizacion then
      v_puesto7 := true;
    elsif v_clave = 'por designar' then
      v_ingreso := true;
    elsif v_clave like 'en reparaci_n' then
      v_elevador := true; v_puesto16 := true;
    elsif v_clave like 'reparaci_n servicio externo%' then
      v_puesto16 := true; v_pulmon := true;
    elsif v_clave like 'compra reptos%' then
      v_puesto16 := true; v_pulmon := true;
    elsif v_clave like 'espera reptos%' then
      v_pulmon := true;
    elsif v_clave like 'pintura%' then
      v_pintura := true;
    elsif v_clave = 'lavado' then
      v_lavado := true;
    elsif v_clave like 'alineaci_n%' then
      v_alineadora := true;
    elsif v_clave = 'listo para entrega' then
      v_pulmon := true; v_ingreso := true;
    else
      continue; -- sin regla para este estado: no se toca
    end if;

    select exists (
      select 1
      from public.plano_ocupacion po
      join public.plano_elementos pe on pe.id = po.elemento_id
      where po.trabajo_id = v_ot.id
        and (
          (v_ingreso and pe.tipo = 'recepcion_ingreso') or
          (v_elevador and pe.tipo = 'isla_elevador') or
          (v_puesto16 and pe.tipo = 'isla_simple' and pe.nombre ~* '^puesto\s*[1-6]$') or
          (v_puesto7 and pe.tipo = 'isla_simple' and pe.nombre ~* '^puesto\s*7$') or
          (v_pulmon and pe.tipo = 'pulmon') or
          (v_pintura and pe.tipo = 'desabolladura_pintura') or
          (v_lavado and pe.tipo = 'lavado') or
          (v_alineadora and pe.tipo = 'alineadora')
        )
    ) into v_ya_ok;

    if v_ya_ok then
      continue;
    end if;

    select pe.id into v_elemento_id
    from public.plano_elementos pe
    where pe.empresa_id = emp
      and (
        (v_ingreso and pe.tipo = 'recepcion_ingreso') or
        (v_elevador and pe.tipo = 'isla_elevador') or
        (v_puesto16 and pe.tipo = 'isla_simple' and pe.nombre ~* '^puesto\s*[1-6]$') or
        (v_puesto7 and pe.tipo = 'isla_simple' and pe.nombre ~* '^puesto\s*7$') or
        (v_pulmon and pe.tipo = 'pulmon') or
        (v_pintura and pe.tipo = 'desabolladura_pintura') or
        (v_lavado and pe.tipo = 'lavado') or
        (v_alineadora and pe.tipo = 'alineadora')
      )
      and (select count(*) from public.plano_ocupacion po2 where po2.elemento_id = pe.id) < pe.capacidad_vehiculos
    order by pe.nombre
    limit 1;

    if v_elemento_id is null then
      v_sin_cupo := v_sin_cupo + 1;
      raise notice 'OT % (estado "%"): sin puesto libre de su categoría, se deja donde está.', v_ot.numero_ot, v_ot.estado_actual;
      continue;
    end if;

    delete from public.plano_ocupacion where trabajo_id = v_ot.id;
    insert into public.plano_ocupacion (empresa_id, elemento_id, trabajo_id)
    values (emp, v_elemento_id, v_ot.id);
    v_movidas := v_movidas + 1;
  end loop;

  raise notice 'Reubicadas % OT; % sin puesto libre para su estado.', v_movidas, v_sin_cupo;
end $$;

-- ---------------------------------------------------------------------------
-- Verificación: ninguna OT activa con regla debería quedar fuera de su
-- categoría después de correr esto (salvo las que avisó el NOTICE "sin cupo").
-- ---------------------------------------------------------------------------
select t.numero_ot, coalesce(t.clickup_estado_actual, t.estado) as estado, pe.nombre as puesto_actual
from public.trabajos_taller t
left join public.plano_ocupacion po on po.trabajo_id = t.id
left join public.plano_elementos pe on pe.id = po.elemento_id
where t.empresa_id = 'b0000000-0000-4000-8000-000000000001' and t.estado not in ('entregado', 'anulado')
order by t.numero_ot;
