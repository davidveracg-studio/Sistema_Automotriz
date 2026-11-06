-- =============================================================================
-- 0077_acotar_funciones_agenda.sql
--
-- Hallazgo H4 de las pruebas de aislamiento (FASE0.md, WP0.2): seis funciones de
-- agenda y catálogo eran SECURITY DEFINER, ejecutables por cualquiera (Postgres da
-- EXECUTE a PUBLIC por defecto y Supabase las expone por RPC) y recibían un id sin
-- comprobar a qué empresa pertenece:
--
--   agenda_cupos_bloque(isla, fecha, minuto)       holgura de capacidad de una isla
--   citas_cupos_disponibles(isla, fecha, hora, …)  cupos libres de una isla
--   citas_buscar_horarios(isla, duración, …)       próximos horarios con cupo
--   personal_disponible_en(persona, fecha, min)    si una persona está disponible
--   catalogo_isla_para_servicio(servicio)          id de la isla de un servicio
--   catalogo_horas_servicio(servicio, …)           horas de mano de obra de un servicio
--
-- Con un id de otra empresa devolvían su disponibilidad, sus horarios o sus horas de
-- mano de obra, y un visitante sin sesión podía llamarlas. Sin sesión no hay motivo
-- para hacerlo: las usa la pantalla de Agenda (usuario con sesión) y el bot de
-- WhatsApp (Edge Function con la clave de service role). Además, citas_buscar_horarios
-- y agenda_cupos_bloque hacen un cálculo costoso (agenda_cupos_bloque es exponencial
-- en el número de islas), así que dejarlas abiertas a cualquiera es también un
-- riesgo de abuso.
--
-- Qué hace esta migración:
--   1. Crea puede_ver_empresa(empresa): verdadero solo si quien llama es service_role
--      (mismo criterio que 0026) o pertenece a esa empresa. Es de uso interno: nadie
--      más que el dueño de las funciones puede ejecutarla.
--   2. Redefine las seis funciones agregando esa comprobación justo donde ya
--      resolvían la empresa del id (con un id ajeno responden como con un id
--      inexistente: null / false / sin filas). No cambia nada más de su lógica: los
--      cuerpos se generaron de las definiciones vigentes con un reemplazo por función.
--   3. Quita EXECUTE a public y anon y lo concede a authenticated y service_role.
--      Las llamadas entre estas funciones son de su dueño (SECURITY DEFINER), así que
--      no necesitan permiso de EXECUTE de quien consulta.
--
-- Cómo deshacerlo (reabre H4):
--   grant execute on function public.agenda_cupos_bloque(uuid, date, integer) to public;
--   (y lo mismo para las otras cinco); las definiciones anteriores están en 0034,
--   0048 y las migraciones del catálogo.
-- =============================================================================

create or replace function public.puede_ver_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_empresa_id is not null
     and (auth.role() = 'service_role' or p_empresa_id = public.mi_empresa_id())
$$;

comment on function public.puede_ver_empresa(uuid) is
  'Verdadero si quien llama es service_role o pertenece a la empresa indicada. Uso interno de las funciones de agenda y catálogo (0077).';

revoke all on function public.puede_ver_empresa(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.agenda_cupos_bloque(p_tipo_isla_id uuid, p_fecha date, p_minuto integer)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if v_empresa is null or not public.puede_ver_empresa(v_empresa) then
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
$function$;

CREATE OR REPLACE FUNCTION public.citas_cupos_disponibles(p_tipo_isla_id uuid, p_fecha date, p_hora time without time zone DEFAULT NULL::time without time zone, p_duracion_minutos integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if v_empresa is null or not public.puede_ver_empresa(v_empresa) then
    return null;
  end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.citas_buscar_horarios(p_tipo_isla_id uuid, p_duracion_minutos integer, p_fecha_desde date DEFAULT CURRENT_DATE, p_dias_a_buscar integer DEFAULT 14, p_limite integer DEFAULT 5)
 RETURNS TABLE(fecha date, hora time without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_empresa_id uuid;
  v_opera_en_corte boolean;
  v_corte_inicio time;
  v_corte_fin time;
  v_dia date;
  v_dow integer;
  v_apertura time;
  v_cierre time;
  v_hora_candidata time;
  v_encontrados integer := 0;
  v_cupos integer;
begin
  select empresa_id, opera_en_corte into v_empresa_id, v_opera_en_corte
  from public.tipos_isla
  where id = p_tipo_isla_id;

  if v_empresa_id is null or not public.puede_ver_empresa(v_empresa_id)
     or p_duracion_minutos is null or p_duracion_minutos <= 0 then
    return;
  end if;

  select corte_mediodia_inicio, corte_mediodia_fin into v_corte_inicio, v_corte_fin
  from public.empresas
  where id = v_empresa_id;

  for v_dia in select generate_series(p_fecha_desde, p_fecha_desde + (p_dias_a_buscar - 1), interval '1 day')::date loop
    v_dow := extract(dow from v_dia);

    select hora_apertura, hora_cierre into v_apertura, v_cierre
    from public.horario_atencion
    where empresa_id = v_empresa_id and dia_semana = v_dow;

    if v_apertura is null then
      continue; -- sin horario ese día de la semana = cerrado
    end if;

    v_hora_candidata := v_apertura;
    while v_hora_candidata + make_interval(mins => p_duracion_minutos) <= v_cierre loop
      if v_opera_en_corte or v_corte_inicio is null
         or v_hora_candidata >= v_corte_fin
         or (v_hora_candidata + make_interval(mins => p_duracion_minutos)) <= v_corte_inicio then

        select public.citas_cupos_disponibles(p_tipo_isla_id, v_dia, v_hora_candidata, p_duracion_minutos)
        into v_cupos;

        if v_cupos > 0 then
          fecha := v_dia;
          hora := v_hora_candidata;
          return next;
          v_encontrados := v_encontrados + 1;
          if v_encontrados >= p_limite then
            return;
          end if;
        end if;
      end if;

      v_hora_candidata := v_hora_candidata + interval '30 minutes';
    end loop;
  end loop;

  return;
end;
$function$;

CREATE OR REPLACE FUNCTION public.personal_disponible_en(p_personal_id uuid, p_fecha date, p_minuto integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_empresa uuid;
  v_dow integer := extract(dow from p_fecha)::integer;
  v_inicio integer;
  v_fin integer;
begin
  select empresa_id into v_empresa from public.personal_taller where id = p_personal_id and activo;
  if v_empresa is null or not public.puede_ver_empresa(v_empresa) then
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
$function$;

CREATE OR REPLACE FUNCTION public.catalogo_isla_para_servicio(p_servicio_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_empresa_id uuid;
  v_segmento text;
  v_categoria text;
  v_nombre_isla text;
  v_isla_id uuid;
begin
  select empresa_id, segmento, categoria into v_empresa_id, v_segmento, v_categoria
  from public.catalogo_servicios
  where id = p_servicio_id;

  if v_empresa_id is null or not public.puede_ver_empresa(v_empresa_id) then
    return null;
  end if;

  v_nombre_isla := case
    when v_segmento = 'Taller Mecánico' then 'Taller mecánico'
    when v_segmento = 'Servicio Rápido' and v_categoria = 'Alineación' then 'Alineación'
    when v_segmento = 'Servicio Rápido' then 'Servicio rápido'
    when v_segmento = 'DyP' and v_categoria = 'Desabolladura y Pintura' then 'Pintura'
    when v_segmento = 'DyP' and v_categoria = 'Limpieza' then 'Lavado'
    else null
  end;

  if v_nombre_isla is null then
    return null;
  end if;

  select id into v_isla_id from public.tipos_isla where empresa_id = v_empresa_id and nombre = v_nombre_isla;
  return v_isla_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.catalogo_horas_servicio(p_servicio_id uuid, p_tipo_vehiculo text DEFAULT NULL::text, p_combustible text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select cp.horas_mo
  from public.catalogo_servicio_precios cp
  join public.catalogo_servicios s on s.id = cp.servicio_id
  where cp.servicio_id = p_servicio_id
    and public.puede_ver_empresa(s.empresa_id)
    and (cp.tipo_vehiculo = p_tipo_vehiculo or cp.tipo_vehiculo is null)
    and (cp.combustible = p_combustible or cp.combustible is null)
  order by (cp.tipo_vehiculo is not null) desc, (cp.combustible is not null) desc
  limit 1;
$function$;

revoke execute on function public.agenda_cupos_bloque(uuid, date, integer) from public, anon;
grant execute on function public.agenda_cupos_bloque(uuid, date, integer) to authenticated, service_role;

revoke execute on function public.citas_cupos_disponibles(uuid, date, time without time zone, integer) from public, anon;
grant execute on function public.citas_cupos_disponibles(uuid, date, time without time zone, integer) to authenticated, service_role;

revoke execute on function public.citas_buscar_horarios(uuid, integer, date, integer, integer) from public, anon;
grant execute on function public.citas_buscar_horarios(uuid, integer, date, integer, integer) to authenticated, service_role;

revoke execute on function public.personal_disponible_en(uuid, date, integer) from public, anon;
grant execute on function public.personal_disponible_en(uuid, date, integer) to authenticated, service_role;

revoke execute on function public.catalogo_isla_para_servicio(uuid) from public, anon;
grant execute on function public.catalogo_isla_para_servicio(uuid) to authenticated, service_role;

revoke execute on function public.catalogo_horas_servicio(uuid, text, text) from public, anon;
grant execute on function public.catalogo_horas_servicio(uuid, text, text) to authenticated, service_role;
