-- =============================================================================
-- 0025_encuesta_detallada.sql
--
-- Qué resuelve:
--   La encuesta de postventa (Bloque 7) solo pedía una calificación única
--   1-5. El cliente pidió desglosarla en 4 preguntas que cubren áreas
--   distintas del negocio -tiempo de entrega (operación), atención del
--   asesor, calidad del servicio mecánico (operación) y una pregunta de
--   recomendación que mezcla todo-, más un campo de "cómo conociste la
--   empresa" (para medir origen real de clientes) y un espacio de
--   sugerencias. Cada área requiere un tratamiento distinto: "no puedo
--   dejar pasar a nivel interno ninguno de los puntos anteriores", así que
--   la clasificación no puede depender de un solo promedio.
--
--   Clasificación (calculada acá, no en el frontend, para que quede
--   consistente entre la página pública y la pantalla de resultados):
--     - NEGATIVO: cualquiera de las 4 preguntas quedó en 1 o 2 estrellas
--       -se guarda además qué área(s) fallaron, para poder profundizar en
--       la razón de fondo de cada una por separado-.
--     - Si ninguna quedó baja, la pregunta "Recomendaría" decide:
--       5 estrellas = EXCELENTE (se invita a dejar reseña en Google),
--       3-4 = POSITIVO (se agradece la preferencia).
-- =============================================================================

alter table public.encuestas
  add column if not exists calificacion_entrega_tiempo integer
    check (calificacion_entrega_tiempo is null or calificacion_entrega_tiempo between 1 and 5),
  add column if not exists calificacion_atencion_cliente integer
    check (calificacion_atencion_cliente is null or calificacion_atencion_cliente between 1 and 5),
  add column if not exists calificacion_servicio_mecanico integer
    check (calificacion_servicio_mecanico is null or calificacion_servicio_mecanico between 1 and 5),
  add column if not exists calificacion_recomendaria integer
    check (calificacion_recomendaria is null or calificacion_recomendaria between 1 and 5),
  add column if not exists como_conocio text
    check (como_conocio is null or como_conocio in (
      'redes_sociales', 'recomendacion', 'google', 'publicidad', 'pase_por_el_lugar', 'cliente_anterior', 'otro'
    )),
  add column if not exists sugerencia text,
  add column if not exists clasificacion text
    check (clasificacion is null or clasificacion in ('negativo', 'positivo', 'excelente')),
  add column if not exists areas_bajas text[],
  add column if not exists notificado_en timestamptz;

comment on column public.encuestas.como_conocio is 'Catálogo fijo: redes_sociales/recomendacion/google/publicidad/pase_por_el_lugar/cliente_anterior/otro. Se guarda como texto (no una tabla aparte) porque es un catálogo chico y estable.';
comment on column public.encuestas.areas_bajas is 'Subconjunto de {entrega_tiempo, atencion_cliente, servicio_mecanico, recomendaria}: qué preguntas quedaron en 1-2 estrellas, calculado por encuesta_responder().';
comment on column public.encuestas.notificado_en is 'Cuándo se avisó por correo a admin/socia de una respuesta negativa -evita reenviar el aviso si la página pública reintenta la llamada-.';

-- Las respuestas viejas de un solo puntaje (si las hay) se preservan en el
-- campo más parecido antes de retirar las columnas anteriores: la
-- calificación general pasa a "recomendaría" y el comentario libre a
-- "sugerencia".
update public.encuestas
set calificacion_recomendaria = calificacion,
    sugerencia = comentario
where calificacion is not null and calificacion_recomendaria is null;

alter table public.encuestas
  drop column if exists calificacion,
  drop column if exists comentario;

-- ---------------------------------------------------------------------------
-- Link de la ficha de Google del negocio, para la invitación a reseñar
-- cuando la encuesta sale "excelente". Mismo patrón multi-tenant que
-- empresas.logo_url (Bloque de formato de documentos): NULL = no se
-- muestra el botón, cada tenant completa el suyo cuando lo tenga.
-- ---------------------------------------------------------------------------
alter table public.empresas
  add column if not exists google_review_url text;

comment on column public.empresas.google_review_url is 'URL para dejar una reseña en Google Business. NULL = la encuesta "excelente" no muestra el botón de invitar a reseñar.';

-- ---------------------------------------------------------------------------
-- Acceso público por token (mismo esquema de seguridad del Bloque 7: anon
-- nunca toca la tabla directo, solo estas funciones SECURITY DEFINER).
-- ---------------------------------------------------------------------------
drop function if exists public.encuesta_obtener_por_token(text);

create or replace function public.encuesta_obtener_por_token(p_token text)
returns table (
  numero_ot integer,
  patente text,
  marca text,
  modelo text,
  respondido_en timestamptz,
  empresa_nombre text,
  empresa_google_review_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.numero_ot, v.patente, v.marca, v.modelo, e.respondido_en, emp.nombre, emp.google_review_url
  from public.encuestas e
  join public.trabajos_taller t on t.id = e.trabajo_id
  join public.vehiculos v on v.id = t.vehiculo_id
  join public.empresas emp on emp.id = t.empresa_id
  where e.token = p_token;
$$;

drop function if exists public.encuesta_responder(text, integer, text);

create or replace function public.encuesta_responder(
  p_token text,
  p_entrega_tiempo integer,
  p_atencion_cliente integer,
  p_servicio_mecanico integer,
  p_recomendaria integer,
  p_como_conocio text,
  p_sugerencia text
)
returns table (clasificacion text, areas_bajas text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clasificacion text;
  v_areas_bajas text[] := array[]::text[];
begin
  if p_entrega_tiempo is null or p_entrega_tiempo not between 1 and 5
     or p_atencion_cliente is null or p_atencion_cliente not between 1 and 5
     or p_servicio_mecanico is null or p_servicio_mecanico not between 1 and 5
     or p_recomendaria is null or p_recomendaria not between 1 and 5 then
    raise exception 'Cada calificación debe ser un número entre 1 y 5.';
  end if;

  if p_como_conocio is not null and p_como_conocio not in (
    'redes_sociales', 'recomendacion', 'google', 'publicidad', 'pase_por_el_lugar', 'cliente_anterior', 'otro'
  ) then
    raise exception 'Valor de "cómo conociste" no reconocido.';
  end if;

  if p_entrega_tiempo <= 2 then v_areas_bajas := array_append(v_areas_bajas, 'entrega_tiempo'); end if;
  if p_atencion_cliente <= 2 then v_areas_bajas := array_append(v_areas_bajas, 'atencion_cliente'); end if;
  if p_servicio_mecanico <= 2 then v_areas_bajas := array_append(v_areas_bajas, 'servicio_mecanico'); end if;
  if p_recomendaria <= 2 then v_areas_bajas := array_append(v_areas_bajas, 'recomendaria'); end if;

  if array_length(v_areas_bajas, 1) > 0 then
    v_clasificacion := 'negativo';
  elsif p_recomendaria = 5 then
    v_clasificacion := 'excelente';
  else
    v_clasificacion := 'positivo';
  end if;

  update public.encuestas
  set calificacion_entrega_tiempo = p_entrega_tiempo,
      calificacion_atencion_cliente = p_atencion_cliente,
      calificacion_servicio_mecanico = p_servicio_mecanico,
      calificacion_recomendaria = p_recomendaria,
      como_conocio = p_como_conocio,
      sugerencia = p_sugerencia,
      clasificacion = v_clasificacion,
      areas_bajas = v_areas_bajas,
      respondido_en = now()
  where token = p_token and respondido_en is null;

  if not found then
    raise exception 'No encontramos esta encuesta, o ya fue respondida.';
  end if;

  return query select v_clasificacion, v_areas_bajas;
end;
$$;

-- ---------------------------------------------------------------------------
-- Segunda función pública, angosta a propósito: solo confirma "esta
-- encuesta ya es negativa y no se ha avisado" y marca el aviso, para que el
-- Edge Function de correo (que corre después, desde la propia página
-- pública) no dependa de exponer nada más de la fila a `anon`.
-- ---------------------------------------------------------------------------
create or replace function public.encuesta_marcar_notificada(p_token text)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.encuestas
  set notificado_en = now()
  where token = p_token and clasificacion = 'negativo' and notificado_en is null
  returning true;
$$;

revoke all on function public.encuesta_obtener_por_token(text) from public;
revoke all on function public.encuesta_responder(text, integer, integer, integer, integer, text, text) from public;
revoke all on function public.encuesta_marcar_notificada(text) from public;
grant execute on function public.encuesta_obtener_por_token(text) to anon, authenticated;
grant execute on function public.encuesta_responder(text, integer, integer, integer, integer, text, text) to anon, authenticated;
grant execute on function public.encuesta_marcar_notificada(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'encuestas' and column_name in (
    'calificacion_entrega_tiempo', 'calificacion_atencion_cliente', 'calificacion_servicio_mecanico',
    'calificacion_recomendaria', 'como_conocio', 'sugerencia', 'clasificacion', 'areas_bajas', 'notificado_en'
  )) as columnas_encuestas_esperado_9,
  (select count(*) from information_schema.columns where table_name = 'empresas' and column_name = 'google_review_url') as columna_google_esperado_1,
  (select count(*) from information_schema.columns where table_name = 'encuestas' and column_name in ('calificacion', 'comentario')) as columnas_viejas_esperado_0,
  (select count(*) from pg_proc where proname in ('encuesta_obtener_por_token', 'encuesta_responder', 'encuesta_marcar_notificada')) as funciones_esperado_3;
