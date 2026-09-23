-- =============================================================================
-- 0010_agenda_duracion.sql
--
-- Qué resuelve:
--   Corrección real al modelo de capacidad de 0009, encontrada al revisar el
--   resultado con el cliente: "capacidad" no es un cupo por día completo por
--   isla -eso subestima muchísimo lo que el taller puede recibir-, es un
--   cupo SIMULTÁNEO que rota durante la jornada. Una mantención de taller
--   mecánico dura 1-2h de 8h disponibles (una isla puede recibir varios
--   vehículos en el día); un servicio rápido o una alineación duran 30 min;
--   pintura no tiene duración definida (ocupa el cupo hasta el cierre del
--   día, no se puede prometer hora de término).
--
--   Se agrega `duracion_estimada_minutos` a `citas` y se reescribe
--   `citas_cupos_disponibles` para que compare SOLAPAMIENTO de horario
--   (candidato vs. citas existentes ese día), no un conteo plano. Duración
--   NULL (u hora NULL) se trata como "ocupa el cupo hasta el cierre del día
--   calendario" -conservador a propósito: si no se sabe cuánto dura, mejor
--   sobreestimar la ocupación que prometer un cupo que en realidad no está
--   libre-.
-- =============================================================================

alter table public.citas
  add column if not exists duracion_estimada_minutos integer
    check (duracion_estimada_minutos is null or duracion_estimada_minutos > 0);

comment on column public.citas.duracion_estimada_minutos is 'Minutos que se estima que la cita ocupa la isla. NULL = ocupa el cupo hasta el cierre del día calendario (duración indefinida, ej. pintura, o simplemente no se especificó).';

-- Cambia de firma (agrega p_hora/p_duracion_minutos): se elimina la versión
-- vieja de 2 parámetros explícitamente, porque CREATE OR REPLACE con una
-- lista de parámetros distinta crea una función nueva en vez de reemplazar
-- la anterior, y quedarían las dos.
drop function if exists public.citas_cupos_disponibles(uuid, date);

create or replace function public.citas_cupos_disponibles(
  p_tipo_isla_id uuid,
  p_fecha date,
  p_hora time default null,
  p_duracion_minutos integer default null
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select t.capacidad - count(c.id)::integer
  from public.tipos_isla t
  left join public.citas c
    on c.tipo_isla_id = t.id
    and c.fecha = p_fecha
    and c.estado in ('agendada', 'confirmada')
    -- Solapamiento estándar de intervalos: existente.inicio < candidato.fin
    -- AND candidato.inicio < existente.fin.
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
$$;

comment on function public.citas_cupos_disponibles is 'Cupos disponibles de una isla considerando solapamiento de horario (no un conteo plano por día). Duración NULL = ocupa hasta el cierre del día calendario.';

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'citas' and column_name = 'duracion_estimada_minutos') as columna_duracion_esperado_1,
  (select count(*) from pg_proc where proname = 'citas_cupos_disponibles') as funciones_cupos_esperado_1,
  (select pg_get_function_arguments(oid) from pg_proc where proname = 'citas_cupos_disponibles') as firma_funcion;
