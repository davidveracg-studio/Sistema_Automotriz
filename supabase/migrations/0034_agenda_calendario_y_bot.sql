-- =============================================================================
-- 0034_agenda_calendario_y_bot.sql
--
-- Qué resuelve:
--   Rediseño de Agenda (de lista de cupos por día a un calendario real por
--   bloques de 30 minutos) + la base para que el bot de WhatsApp (Mensajes)
--   agende directo cuando encuentra un horario que encaja, según el
--   servicio que el cliente elige en un menú guiado. Confirmado con el
--   cliente el 2026-09-22:
--   - Bloques de 30 minutos.
--   - Bot sin IA: menú numerado (segmento → categoría → servicio →
--     horario), no texto libre interpretado.
--   - El bot agenda directo apenas encuentra un horario que encaja y avisa
--     a Recepción -reutiliza la notificación "cita nueva" del Bloque
--     anterior, no hace falta un tipo nuevo-.
--   - Horario real del taller: lunes a jueves 09:00-18:00, viernes y
--     sábado 09:00-17:30, domingo cerrado. Corte de mediodía 13:00-15:00
--     donde SOLO "Servicio rápido" sigue operando -el resto de las islas
--     no reciben en ese bloque-.
--
--   La duración de cada servicio YA estaba importada (`horas_mo` en
--   `catalogo_servicio_precios`, Bloque de precios 2026-09-20) pero nunca
--   se había conectado a la Agenda -queda usada acá por primera vez-. El
--   cálculo de cupos por solapamiento de horario tampoco es nuevo
--   (`citas_cupos_disponibles`, 0010_agenda_duracion.sql): este bloque
--   agrega el calendario visual y el buscador de "próximo horario
--   disponible" sobre esa base ya construida, no la reemplaza.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Horario de atención por día de la semana (0=domingo ... 6=sábado, mismo
-- criterio que EXTRACT(DOW) de Postgres). Sin fila para un día = cerrado
-- ese día. Por empresa, no hardcodeado, aunque hoy solo exista Didial.
-- ---------------------------------------------------------------------------
create table if not exists public.horario_atencion (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  dia_semana integer not null check (dia_semana between 0 and 6),
  hora_apertura time not null,
  hora_cierre time not null check (hora_cierre > hora_apertura),
  constraint uq_horario_atencion unique (empresa_id, dia_semana)
);

comment on table public.horario_atencion is 'Horario de atención por día de la semana. Sin fila para un dia_semana = el taller no atiende ese día (ej. domingo). Usado por citas_buscar_horarios para no ofrecer horarios fuera de atención.';

insert into public.horario_atencion (empresa_id, dia_semana, hora_apertura, hora_cierre)
select e.id, v.dia_semana, v.apertura, v.cierre
from public.empresas e
cross join (values
  (1, '09:00'::time, '18:00'::time), -- lunes
  (2, '09:00'::time, '18:00'::time), -- martes
  (3, '09:00'::time, '18:00'::time), -- miércoles
  (4, '09:00'::time, '18:00'::time), -- jueves
  (5, '09:00'::time, '17:30'::time), -- viernes
  (6, '09:00'::time, '17:30'::time)  -- sábado
) as v(dia_semana, apertura, cierre)
where e.nombre = 'Servicio Automotriz Didial Ltda.'
  and not exists (
    select 1 from public.horario_atencion h where h.empresa_id = e.id and h.dia_semana = v.dia_semana
  );

-- ---------------------------------------------------------------------------
-- Corte de mediodía: por empresa (NULL = sin corte, para un tenant futuro
-- que no lo necesite). Aplica a todas las islas EXCEPTO las marcadas
-- tipos_isla.opera_en_corte.
-- ---------------------------------------------------------------------------
alter table public.empresas add column if not exists corte_mediodia_inicio time;
alter table public.empresas add column if not exists corte_mediodia_fin time;

comment on column public.empresas.corte_mediodia_inicio is 'Inicio del corte de mediodía (ej. atención reducida a solo la isla marcada opera_en_corte). NULL = sin corte.';

update public.empresas
set corte_mediodia_inicio = '13:00', corte_mediodia_fin = '15:00'
where nombre = 'Servicio Automotriz Didial Ltda.' and corte_mediodia_inicio is null;

alter table public.tipos_isla add column if not exists opera_en_corte boolean not null default false;

comment on column public.tipos_isla.opera_en_corte is 'true = esta isla sigue recibiendo vehículos durante el corte de mediodía de la empresa (ej. "Servicio rápido" en Didial); el resto de las islas no ofrecen horarios en ese rango.';

update public.tipos_isla t
set opera_en_corte = true
from public.empresas e
where t.empresa_id = e.id and e.nombre = 'Servicio Automotriz Didial Ltda.' and t.nombre = 'Servicio rápido';

-- ---------------------------------------------------------------------------
-- Vínculo de la cita con el servicio del catálogo elegido (opcional: sigue
-- existiendo la descripción libre para lo que no está en el catálogo). Con
-- esto se puede mostrar/recalcular la duración sugerida y, para el bot, dar
-- trazabilidad de qué servicio motivó cada cita.
-- ---------------------------------------------------------------------------
alter table public.citas add column if not exists catalogo_servicio_id uuid references public.catalogo_servicios (id) on delete set null;
alter table public.citas add column if not exists origen text not null default 'manual' check (origen in ('manual', 'bot_whatsapp'));

comment on column public.citas.origen is 'manual = agendada por una persona (Recepción/asesor); bot_whatsapp = el bot la agendó directo tras encontrar un horario que encaja.';

-- ---------------------------------------------------------------------------
-- Mapeo real segmento+categoría (planilla de precios) -> isla del taller.
-- No es 1:1: el segmento "Servicio Rápido" de la planilla se reparte entre
-- la isla "Servicio rápido" y la isla "Alineación" según la categoría, y
-- "DyP" (Desabolladura y Pintura) se reparte entre "Pintura" y "Lavado".
-- Confirmado contra los datos reales del catálogo ya importado
-- (0028_seed_catalogo_didial.sql), no una suposición.
-- ---------------------------------------------------------------------------
create or replace function public.catalogo_isla_para_servicio(p_servicio_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
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

  if v_empresa_id is null then
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
$$;

comment on function public.catalogo_isla_para_servicio is 'Resuelve a qué isla pertenece un servicio del catálogo, para saber contra qué capacidad buscar horario. Devuelve NULL si el servicio no calza con ninguna isla conocida (revisar el mapeo si el catálogo agrega un segmento/categoría nuevo).';

-- ---------------------------------------------------------------------------
-- Horas de mano de obra de un servicio, mismo criterio de calce
-- específico->genérico que ya usa agregar_servicio_catalogo() para el
-- precio (tipo+combustible exacto, si no tipo solo, si no combustible solo,
-- si no la fila genérica). p_tipo_vehiculo/p_combustible NULL = todavía no
-- se sabe el vehículo (ej. el bot preguntando antes de identificar la
-- patente): toma la fila más genérica disponible.
-- ---------------------------------------------------------------------------
create or replace function public.catalogo_horas_servicio(
  p_servicio_id uuid,
  p_tipo_vehiculo text default null,
  p_combustible text default null
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select horas_mo
  from public.catalogo_servicio_precios
  where servicio_id = p_servicio_id
    and (tipo_vehiculo = p_tipo_vehiculo or tipo_vehiculo is null)
    and (combustible = p_combustible or combustible is null)
  order by (tipo_vehiculo is not null) desc, (combustible is not null) desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Próximos horarios disponibles para una isla y una duración dada, dentro
-- del horario de atención real (y respetando el corte de mediodía). Se
-- apoya en citas_cupos_disponibles (0010_agenda_duracion.sql) para el
-- chequeo de solapamiento en vez de reimplementarlo. Usada por el
-- calendario (sugerir horario) y por el bot (encontrar dónde agendar).
-- ---------------------------------------------------------------------------
create or replace function public.citas_buscar_horarios(
  p_tipo_isla_id uuid,
  p_duracion_minutos integer,
  p_fecha_desde date default current_date,
  p_dias_a_buscar integer default 14,
  p_limite integer default 5
)
returns table (fecha date, hora time)
language plpgsql
stable
security definer
set search_path = public
as $$
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

  if v_empresa_id is null or p_duracion_minutos is null or p_duracion_minutos <= 0 then
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
$$;

comment on function public.citas_buscar_horarios is 'Primeros p_limite horarios con cupo para una isla+duración, respetando horario_atencion y el corte de mediodía. No agenda nada -solo busca-; agendar sigue siendo un INSERT en citas aparte (a mano desde el calendario, o por el bot).';

-- ---------------------------------------------------------------------------
-- Estado de conversación del bot de agendamiento en Mensajes. Vive en
-- whatsapp_contactos (0032_whatsapp_recepcion.sql) porque es un estado por
-- CONTACTO, igual que estado/cliente_id/vehiculo_id.
-- ---------------------------------------------------------------------------
alter table public.whatsapp_contactos add column if not exists bot_estado text
  check (bot_estado is null or bot_estado in ('saludo', 'elige_segmento', 'elige_categoria', 'elige_servicio', 'elige_horario'));
alter table public.whatsapp_contactos add column if not exists bot_contexto jsonb;
alter table public.whatsapp_contactos add column if not exists bot_pausado boolean not null default false;

comment on column public.whatsapp_contactos.bot_estado is 'Paso actual del menú guiado del bot de agendamiento. NULL = el bot no está en medio de una conversación con este contacto.';
comment on column public.whatsapp_contactos.bot_contexto is 'Datos transitorios del flujo en curso: segmento/categoría elegidos, servicio_id, lista de horarios ofrecidos (para poder mapear la respuesta numérica del cliente a la opción correcta) y página actual si la lista se paginó.';
comment on column public.whatsapp_contactos.bot_pausado is 'true = un humano ya está atendiendo esta conversación (se marca solo al mandar una respuesta manual desde el panel o desde la app del celular); el bot no contesta mientras esté en true. Recepción puede reactivarlo a mano.';

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.horario_atencion h join public.empresas e on e.id = h.empresa_id where e.nombre = 'Servicio Automotriz Didial Ltda.') as horario_dias_esperado_6,
  (select count(*) from public.tipos_isla t join public.empresas e on e.id = t.empresa_id where e.nombre = 'Servicio Automotriz Didial Ltda.' and t.opera_en_corte) as islas_opera_corte_esperado_1,
  (select count(*) from pg_proc where proname in ('catalogo_isla_para_servicio', 'catalogo_horas_servicio', 'citas_buscar_horarios')) as funciones_esperado_3,
  (select count(*) from information_schema.columns where table_name = 'whatsapp_contactos' and column_name in ('bot_estado', 'bot_contexto', 'bot_pausado')) as columnas_bot_esperado_3;
