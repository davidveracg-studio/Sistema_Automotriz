-- =============================================================================
-- 0032_whatsapp_recepcion.sql
--
-- Qué resuelve:
--   Bloque 8 (agenda/capacidad/WhatsApp) — la parte de WhatsApp había
--   quedado fuera a propósito hasta que el requisito de habilitación de
--   Meta (estatus "Tech Provider" para Coexistencia) estuviera resuelto por
--   el lado de negocio (ver 0009_agenda.sql). El cliente conecta sus dos
--   números reales de WhatsApp Business (ya activos hoy en la app del
--   celular) a la Cloud API vía Coexistencia, sin dejar de usar la app: el
--   panel de Recepción centraliza los mensajes, y cada conversación se
--   vincula a un cliente/vehículo del CRM y se clasifica con un estado de
--   atención (nuevo/en conversación/agendado/resuelto/sin interés).
--
--   Adaptado de un documento de preparación de base compartido por el
--   cliente (mismo diseño de otro proyecto de Recepción/WhatsApp), con dos
--   cambios respecto al original: (1) nombres de tabla en español completo,
--   consistente con el resto del proyecto, en vez de las abreviaturas
--   `wa_*` sugeridas; (2) `empresa_id` agregado en cada tabla -el documento
--   original no era multi-tenant-, mismo patrón que cualquier otra tabla
--   nueva de este proyecto.
--
--   Los identificadores de cuenta (WABA ID, phone_number_id, números
--   visibles) no son secretos -son datos de configuración de la cuenta de
--   WhatsApp Business, visibles en el propio panel de Meta-, así que se
--   siembran directo acá, mismo criterio que los IDs de ClickUp
--   hardcodeados en `_shared/clickup.ts`. El token de acceso (`WA_TOKEN`) sí
--   es un secreto real y va como variable de entorno de la Edge Function,
--   nunca en una migración.
-- =============================================================================

create table if not exists public.whatsapp_cuentas (
  phone_number_id text primary key,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  waba_id text not null,
  etiqueta text not null,
  telefono_visible text not null,
  es_coexistencia boolean not null default true,
  creado_en timestamptz not null default now()
);

comment on table public.whatsapp_cuentas is 'Los números de WhatsApp Business conectados vía Coexistencia. Catálogo por empresa.';

-- Versión de portafolio/demo: los números y WABA IDs reales del cliente
-- original no van acá -esta tabla se siembra con datos ficticios en
-- 0036_tenant_demo_vpai.sql en su lugar-.

-- ---------------------------------------------------------------------------
-- Contactos: una fila por (número de WhatsApp del cliente, cuenta a la que
-- escribió). Acá vive la categorización que pidió el cliente -estado de
-- atención- y el vínculo con el CRM (cliente_id/vehiculo_id), no en los
-- mensajes -un contacto se re-vincula sin tener que tocar su historial-.
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_contactos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  phone_number_id text not null references public.whatsapp_cuentas (phone_number_id) on delete cascade,
  wa_id text not null,
  nombre_whatsapp text,
  cliente_id uuid references public.clientes (id) on delete set null,
  vehiculo_id uuid references public.vehiculos (id) on delete set null,
  estado text not null default 'nuevo' check (estado in ('nuevo', 'en_conversacion', 'agendado', 'resuelto', 'sin_interes')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint uq_whatsapp_contactos unique (phone_number_id, wa_id)
);

comment on table public.whatsapp_contactos is 'Un contacto de WhatsApp por cuenta a la que escribió. estado es la categorización que hace Recepción; cliente_id/vehiculo_id el vínculo con el CRM (automático por teléfono si hay match, manual si no).';
comment on column public.whatsapp_contactos.vehiculo_id is 'Vínculo informativo con el vehículo del cliente -no determina desde qué cuenta se responde: eso siempre es la misma cuenta por la que llegó el mensaje-.';

create index if not exists whatsapp_contactos_empresa_idx on public.whatsapp_contactos (empresa_id, estado);
create index if not exists whatsapp_contactos_cliente_idx on public.whatsapp_contactos (cliente_id);

drop trigger if exists trg_whatsapp_contactos_actualizado_en on public.whatsapp_contactos;
create trigger trg_whatsapp_contactos_actualizado_en
  before update on public.whatsapp_contactos
  for each row execute function public.actualizar_marca_de_tiempo();

-- ---------------------------------------------------------------------------
-- Mensajes: une los tres campos de webhook que traen contenido de
-- conversación (`messages`, `smb_message_echoes`, `history`). `wamid` es el
-- id real que asigna WhatsApp a cada mensaje -clave primaria, no una
-- restricción de unicidad aparte-: un reintento de Meta (mismo mensaje, dos
-- veces) se resuelve solo con upsert, sin duplicar filas.
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_mensajes (
  wamid text primary key,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  phone_number_id text not null references public.whatsapp_cuentas (phone_number_id) on delete cascade,
  wa_id text not null,
  direccion text not null check (direccion in ('entrante', 'saliente')),
  origen text not null check (origen in ('cloud_api', 'app_celular', 'historial')),
  tipo_mensaje text not null,
  contenido jsonb not null,
  estado_entrega text,
  fase_historial integer,
  wa_timestamp timestamptz not null,
  payload_original jsonb,
  creado_en timestamptz not null default now()
);

comment on table public.whatsapp_mensajes is 'Mensajes entrantes (Cloud API), salientes desde la app del celular (echo) y del historial pre-conexión (hasta 180 días). payload_original guarda el payload crudo de Meta -si algún día se detecta un campo mal parseado, se puede reprocesar sin haber perdido el dato-.';
comment on column public.whatsapp_mensajes.origen is 'cloud_api = llegó por la API (incluye lo que el CRM envía); app_celular = lo mandó el equipo desde el teléfono (smb_message_echoes); historial = carga única de conversación previa a la conexión.';

create index if not exists whatsapp_mensajes_hilo_idx on public.whatsapp_mensajes (phone_number_id, wa_id, wa_timestamp);

-- ---------------------------------------------------------------------------
-- Sincronizaciones: control de las cargas de contactos/historial que solo
-- se pueden pedir una vez por conexión (ventana de 24 horas, ver notas del
-- documento original). No es operación de rutina del panel -se usa el día
-- que se conecta cada número-, pero queda para poder ver si una carga
-- quedó a medias o fue rechazada por el cliente desde la app.
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_sincronizaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  phone_number_id text not null references public.whatsapp_cuentas (phone_number_id) on delete cascade,
  tipo text not null check (tipo in ('contactos', 'historial')),
  request_id text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_progreso', 'completo', 'rechazado', 'error')),
  fase integer,
  progreso integer,
  iniciado_en timestamptz not null default now(),
  completado_en timestamptz
);

comment on table public.whatsapp_sincronizaciones is 'Una fila por solicitud de sincronización (POST .../smb_app_data) hecha al conectar un número. estado se actualiza desde los webhooks history/smb_app_state_sync a medida que llegan los chunks.';

-- ---------------------------------------------------------------------------
-- Eventos de cuenta: para detectar una desconexión sin depender de que
-- alguien revise WhatsApp Manager -PARTNER_REMOVED especialmente, porque
-- implica que hay que repetir la conexión desde cero dentro de otra
-- ventana de 24 horas-.
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_eventos_cuenta (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas (id) on delete cascade,
  waba_id text not null,
  phone_number_id text,
  evento text not null,
  motivo text,
  iniciado_por text,
  recibido_en timestamptz not null default now(),
  payload_original jsonb
);

comment on table public.whatsapp_eventos_cuenta is 'PARTNER_REMOVED (número desconectado de la API), ACCOUNT_OFFBOARDED, ACCOUNT_RECONNECTED. empresa_id puede quedar NULL si el waba_id no coincide con ninguna cuenta conocida -igual queda registrado el evento crudo para revisar a mano-.';

-- ---------------------------------------------------------------------------
-- RPC: busca un cliente existente por teléfono, reutilizando la MISMA
-- normalización ya usada por `clientes.telefono_norm` (Bloque 2) -nunca
-- reimplementar la normalización de teléfono en el Edge Function, se
-- desincroniza en silencio si alguna vez cambia una sola de las dos copias-.
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_buscar_cliente_por_telefono(p_telefono text, p_empresa_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.clientes
  where empresa_id = p_empresa_id
    and telefono_norm = public.normalizar_telefono(p_telefono)
    and eliminado_en is null
  order by creado_en asc
  limit 1;
$$;

comment on function public.whatsapp_buscar_cliente_por_telefono is 'Match automático de un wa_id contra clientes.telefono_norm -mismo criterio "avisa/sugiere, no bloquea" del resto del proyecto-: Recepción confirma o corrige el vínculo a mano si no hay match o está mal.';

-- ---------------------------------------------------------------------------
-- RPC: da de alta o actualiza un contacto y, solo si todavía no tiene
-- cliente_id, intenta el match automático por teléfono -atómico y en una
-- sola llamada desde la Edge Function, en vez de un upsert más un update
-- condicional separados (evita una carrera entre dos webhooks casi
-- simultáneos del mismo contacto). Nunca pisa estado/cliente_id/vehiculo_id
-- ya cargados: son la categorización manual de Recepción.
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_registrar_contacto(
  p_empresa_id uuid,
  p_phone_number_id text,
  p_wa_id text,
  p_nombre_whatsapp text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.whatsapp_contactos (empresa_id, phone_number_id, wa_id, nombre_whatsapp)
  values (p_empresa_id, p_phone_number_id, p_wa_id, p_nombre_whatsapp)
  on conflict (phone_number_id, wa_id) do update
    set nombre_whatsapp = coalesce(excluded.nombre_whatsapp, whatsapp_contactos.nombre_whatsapp);

  update public.whatsapp_contactos
  set cliente_id = public.whatsapp_buscar_cliente_por_telefono(p_wa_id, p_empresa_id)
  where phone_number_id = p_phone_number_id and wa_id = p_wa_id and cliente_id is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Se agrega un tipo nuevo a `notificaciones` (0031_notificaciones.sql):
-- PARTNER_REMOVED (WhatsApp desconectado de la API) es exactamente el tipo
-- de evento urgente que admin/socia necesita ver en el panel de inicio, no
-- solo en una tabla que nadie revisa por su cuenta.
-- ---------------------------------------------------------------------------
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'presupuesto_pendiente', 'encuesta_negativa', 'cita_nueva',
  'listo_para_entrega', 'compra_reptos_pendiente', 'whatsapp_desconectado'
));

-- ---------------------------------------------------------------------------
-- RLS. Lectura abierta a cualquiera activo de la empresa (Recepción no es
-- un rol propio en el CHECK de usuarios -el spec de Didial usa
-- "recepcionista"-, pero conviene que asesor/jefe_taller también puedan ver
-- la bandeja). Solo whatsapp_contactos tiene policy de escritura para la
-- app -es lo único que triage humano edita a mano-; el resto se escribe
-- únicamente desde la Edge Function (service role, bypassea RLS).
-- ---------------------------------------------------------------------------
alter table public.whatsapp_cuentas enable row level security;
alter table public.whatsapp_contactos enable row level security;
alter table public.whatsapp_mensajes enable row level security;
alter table public.whatsapp_sincronizaciones enable row level security;
alter table public.whatsapp_eventos_cuenta enable row level security;

drop policy if exists whatsapp_cuentas_select on public.whatsapp_cuentas;
create policy whatsapp_cuentas_select on public.whatsapp_cuentas
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists whatsapp_contactos_select on public.whatsapp_contactos;
create policy whatsapp_contactos_select on public.whatsapp_contactos
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists whatsapp_contactos_update on public.whatsapp_contactos;
create policy whatsapp_contactos_update on public.whatsapp_contactos
  for update
  using (
    empresa_id = public.mi_empresa_id()
    and (public.es_asesor() or public.es_recepcionista() or public.es_jefe_taller() or public.es_admin() or public.es_socia())
  )
  with check (empresa_id = public.mi_empresa_id());

drop policy if exists whatsapp_mensajes_select on public.whatsapp_mensajes;
create policy whatsapp_mensajes_select on public.whatsapp_mensajes
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists whatsapp_sincronizaciones_select on public.whatsapp_sincronizaciones;
create policy whatsapp_sincronizaciones_select on public.whatsapp_sincronizaciones
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists whatsapp_eventos_cuenta_select on public.whatsapp_eventos_cuenta;
create policy whatsapp_eventos_cuenta_select on public.whatsapp_eventos_cuenta
  for select using (empresa_id = public.mi_empresa_id());

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_name in (
    'whatsapp_cuentas', 'whatsapp_contactos', 'whatsapp_mensajes', 'whatsapp_sincronizaciones', 'whatsapp_eventos_cuenta'
  )) as tablas_esperado_5,
  (select count(*) from public.whatsapp_cuentas w join public.empresas e on e.id = w.empresa_id where e.nombre = 'Servicio Automotriz Didial Ltda.') as cuentas_didial_esperado_2,
  (select relrowsecurity from pg_class where relname = 'whatsapp_mensajes') as rls_mensajes_esperado_true,
  (select count(*) from pg_proc where proname in ('whatsapp_buscar_cliente_por_telefono', 'whatsapp_registrar_contacto')) as funciones_esperado_2;
