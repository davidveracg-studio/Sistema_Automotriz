-- =============================================================================
-- 0044_clickup_citas.sql
--
-- Qué resuelve:
--   Toda cita agendada (a mano en la Agenda o por el bot de WhatsApp, en la
--   empresa real y en la demo) crea su tarjeta en ClickUp, en el estado
--   "agenda". Cuando el vehículo llega y se crea la OT desde esa cita, la OT
--   ADOPTA esa misma tarjeta (no crea otra).
--
--   Se usa un patrón de "bandeja de salida" en la propia base de datos, en vez
--   de depender de que alguien llame a ClickUp en el momento justo:
--     - citas.clickup_pendiente = true significa "falta reflejar esta cita en
--       ClickUp". Nace en true y un trigger lo vuelve a poner en true cuando
--       cambia algo que ClickUp muestra (estado, fecha, hora, cliente, vehículo,
--       servicio, isla, duración, descripción).
--     - La Edge Function clickup-agendar-cita (y el bot de WhatsApp, con el
--       mismo código compartido) procesa las pendientes y las marca resueltas.
--     - Si falla, se cuenta el intento (clickup_intentos) y se reintenta al
--       abrir la Agenda, hasta 5 veces; el detalle queda en
--       integraciones_clickup_errores (ahora con cita_id).
--
--   Las citas que ya existían NO se envían solas (quedan en false): solo
--   viajan las nuevas y las que se modifiquen desde ahora.
--
--   clickup_config.campos guarda, por empresa, los IDs de los campos
--   personalizados de la lista (los de la lista real están fijos en el código;
--   la lista demo puede tener otros). null = usar los de la lista real.
-- =============================================================================

alter table public.citas add column if not exists clickup_task_id text;
alter table public.citas add column if not exists clickup_pendiente boolean not null default true;
alter table public.citas add column if not exists clickup_intentos integer not null default 0;
alter table public.citas add column if not exists clickup_sincronizada_en timestamptz;

comment on column public.citas.clickup_task_id is 'Tarjeta de ClickUp de esta cita (estado "agenda"). Si la OT nace de la cita, adopta esta misma tarjeta.';
comment on column public.citas.clickup_pendiente is 'true = falta reflejar esta cita en ClickUp (crear, actualizar o retirar la tarjeta).';
comment on column public.citas.clickup_intentos is 'Intentos fallidos seguidos de sincronizar con ClickUp. A los 5 se deja de reintentar sola.';

create unique index if not exists citas_clickup_task_uq on public.citas (clickup_task_id) where clickup_task_id is not null;
create index if not exists citas_clickup_pendiente_idx on public.citas (empresa_id) where clickup_pendiente;

-- Las citas anteriores a esta migración no se envían solas a ClickUp.
update public.citas set clickup_pendiente = false;

alter table public.clickup_config add column if not exists campos jsonb;
comment on column public.clickup_config.campos is 'IDs de los campos personalizados de la lista de esta empresa (datosCliente, kilometraje, numeroOt, observaciones, patente, tipoServicio y opcionesTipoServicio). null = los fijos de supabase/functions/_shared/clickup.ts.';

alter table public.integraciones_clickup_errores add column if not exists cita_id uuid references public.citas (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Un cambio relevante en la cita la vuelve a dejar pendiente de ClickUp.
-- Los UPDATE que hace la propia sincronización solo tocan columnas clickup_*,
-- así que no reactivan el trigger.
-- ---------------------------------------------------------------------------
create or replace function public.marcar_cita_pendiente_clickup()
returns trigger
language plpgsql
as $$
begin
  new.clickup_pendiente := true;
  new.clickup_intentos := 0;
  return new;
end;
$$;

drop trigger if exists trg_citas_pendiente_clickup on public.citas;
create trigger trg_citas_pendiente_clickup
  before update of estado, fecha, hora, duracion_estimada_minutos, descripcion, tipo_isla_id, cliente_id, vehiculo_id, catalogo_servicio_id
  on public.citas
  for each row
  when (
    old.estado is distinct from new.estado
    or old.fecha is distinct from new.fecha
    or old.hora is distinct from new.hora
    or old.duracion_estimada_minutos is distinct from new.duracion_estimada_minutos
    or old.descripcion is distinct from new.descripcion
    or old.tipo_isla_id is distinct from new.tipo_isla_id
    or old.cliente_id is distinct from new.cliente_id
    or old.vehiculo_id is distinct from new.vehiculo_id
    or old.catalogo_servicio_id is distinct from new.catalogo_servicio_id
  )
  execute function public.marcar_cita_pendiente_clickup();

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'citas' and column_name in ('clickup_task_id', 'clickup_pendiente', 'clickup_intentos', 'clickup_sincronizada_en')) as columnas_citas_esperado_4,
  (select count(*) from information_schema.columns where table_name = 'clickup_config' and column_name = 'campos') as campos_config_esperado_1,
  (select count(*) from information_schema.columns where table_name = 'integraciones_clickup_errores' and column_name = 'cita_id') as cita_id_errores_esperado_1,
  (select count(*) from pg_trigger where tgname = 'trg_citas_pendiente_clickup') as trigger_esperado_1,
  (select count(*) from public.citas where clickup_pendiente) as citas_pendientes_esperado_0;
