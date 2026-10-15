-- =============================================================================
-- 0037_facturacion_electronica.sql
--
-- Qué resuelve:
--   Módulo de facturación electrónica (DTE del SII). Hasta hoy el taller emite
--   en un software externo y el CRM solo guarda el número (`trabajos_taller.
--   numero_documento_facturacion`, registrado a mano). Este bloque agrega el
--   modelo de datos para emitir desde el CRM: factura (33/34), boleta
--   (39/41), nota de crédito/débito (61/56) y guía de despacho (52).
--
--   Decisiones confirmadas con el cliente (2026-09-25):
--   - Integración vía un PROVEEDOR CERTIFICADO por el SII (no protocolo SII
--     propio): el proveedor firma, administra los folios (CAF) y habla con
--     el SII. Por eso acá NO existe ninguna tabla de CAF ni de certificado:
--     el taller no tiene certificado digital propio, y aunque lo tuviera, ese
--     archivo (.pfx) y su clave nunca deben vivir en la base ni en el repo.
--   - Capa intercambiable: `facturacion_config.proveedor`. Hoy solo existe
--     'sandbox' (simulación sin validez tributaria) hasta que se elija y
--     contrate el proveedor real.
--   - Los 4 tipos de documento desde la primera versión.
--
--   Reglas de diseño:
--   - Un documento emitido es INMUTABLE (trigger, aplica incluso a
--     service_role): un DTE aceptado por el SII no se edita ni se borra, se
--     corrige con una nota de crédito.
--   - Los montos SIEMPRE los calcula la base a partir de las líneas -nunca
--     confiar en los totales que mande el navegador-, con el mismo criterio
--     que ya usa Presupuesto: los precios de la OT incluyen IVA, así que
--     neto = round(total afecto / 1.19) e IVA = total afecto - neto.
--   - Las transiciones de estado están acotadas por trigger; un usuario
--     nunca cambia `estado` a mano (RLS lo impide): eso solo lo hace la
--     Edge Function `facturacion-emitir` con service role.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Datos del emisor. La tabla empresas no tiene policy de escritura desde la
-- app (ver 0001): se completan por SQL una sola vez, igual que logo_url.
-- Los proveedores reales los exigen; el sandbox no.
-- ---------------------------------------------------------------------------
alter table public.empresas add column if not exists rut text;
alter table public.empresas add column if not exists giro text;
alter table public.empresas add column if not exists codigo_actividad text;
alter table public.empresas add column if not exists comuna text;
alter table public.empresas add column if not exists ciudad text;

comment on column public.empresas.rut is 'RUT del emisor para documentos tributarios. Completar por SQL antes de activar un proveedor real.';

-- ---------------------------------------------------------------------------
-- Configuración por empresa. Sin policy de escritura desde la app a
-- propósito: cambiar de proveedor o de ambiente es una decisión de
-- administración que se hace por SQL, no un botón.
-- ---------------------------------------------------------------------------
create table if not exists public.facturacion_config (
  empresa_id uuid primary key references public.empresas (id) on delete cascade,
  proveedor text not null default 'sandbox' check (proveedor in ('sandbox')),
  ambiente text not null default 'certificacion' check (ambiente in ('certificacion', 'produccion')),
  activo boolean not null default false,
  creado_en timestamptz not null default now()
);

comment on table public.facturacion_config is 'Proveedor de DTE y ambiente por empresa. proveedor=sandbox emite documentos SIMULADOS sin validez tributaria. Al contratar un proveedor real se agrega su valor al CHECK y su adaptador en supabase/functions/_shared/dte/.';

insert into public.facturacion_config (empresa_id, proveedor, ambiente, activo)
select e.id, 'sandbox', 'certificacion', true
from public.empresas e
where e.id = 'b0000000-0000-4000-8000-000000000001'
  and not exists (select 1 from public.facturacion_config c where c.empresa_id = e.id);

-- ---------------------------------------------------------------------------
-- Documento tributario (cabecera).
-- ---------------------------------------------------------------------------
create table if not exists public.documentos_tributarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  tipo_dte integer not null check (tipo_dte in (33, 34, 39, 41, 52, 56, 61)),
  estado text not null default 'borrador' check (estado in ('borrador', 'emitiendo', 'aceptado', 'rechazado', 'error', 'anulado')),
  folio integer,
  simulado boolean not null default false,
  fecha_emision date not null default current_date,

  receptor_rut text,
  receptor_razon_social text,
  receptor_giro text,
  receptor_direccion text,
  receptor_comuna text,
  receptor_ciudad text,
  receptor_correo text,

  cliente_id uuid references public.clientes (id) on delete set null,
  trabajo_id uuid references public.trabajos_taller (id) on delete set null,
  venta_id uuid references public.ventas_directas (id) on delete set null,

  monto_neto integer not null default 0,
  monto_exento integer not null default 0,
  monto_iva integer not null default 0,
  monto_total integer not null default 0,

  referencia_documento_id uuid references public.documentos_tributarios (id) on delete restrict,
  referencia_codigo integer check (referencia_codigo is null or referencia_codigo in (1, 2, 3)),
  referencia_razon text,
  guia_indicador_traslado integer check (guia_indicador_traslado is null or guia_indicador_traslado between 1 and 8),

  proveedor text,
  proveedor_ref text,
  url_pdf text,
  url_xml text,
  error_detalle text,

  creado_por uuid references public.usuarios (id),
  creado_en timestamptz not null default now(),
  emitido_en timestamptz,
  actualizado_en timestamptz not null default now(),

  -- NC/ND siempre referencian el documento que corrigen (y solo ellas).
  constraint chk_dte_referencia check ((tipo_dte in (56, 61)) = (referencia_documento_id is not null)),
  constraint chk_dte_referencia_codigo check ((tipo_dte in (56, 61)) = (referencia_codigo is not null)),
  constraint chk_dte_guia_traslado check ((tipo_dte = 52) = (guia_indicador_traslado is not null))
);

comment on table public.documentos_tributarios is 'DTE emitido o por emitir. Inmutable una vez fuera de borrador. simulado=true = emitido por el adaptador sandbox: SIN validez tributaria.';
comment on column public.documentos_tributarios.referencia_codigo is 'Solo NC/ND (SII, CodRef): 1 = anula el documento referenciado, 2 = corrige texto, 3 = corrige montos.';
comment on column public.documentos_tributarios.guia_indicador_traslado is 'Solo guía de despacho (SII, IndTraslado): 1 = operación constituye venta ... 8 = otros.';

-- Un folio no se repite por empresa + tipo (dentro del mismo carácter real/simulado).
create unique index if not exists uq_dte_folio on public.documentos_tributarios (empresa_id, tipo_dte, folio, simulado) where folio is not null;
create index if not exists documentos_tributarios_empresa_idx on public.documentos_tributarios (empresa_id, creado_en desc);
create index if not exists documentos_tributarios_trabajo_idx on public.documentos_tributarios (trabajo_id);
create index if not exists documentos_tributarios_referencia_idx on public.documentos_tributarios (referencia_documento_id);

-- ---------------------------------------------------------------------------
-- Líneas de detalle. monto_linea generado por la base (mismo criterio que
-- ot_detalle.total_linea): el documento no puede quedar descuadrado.
-- ---------------------------------------------------------------------------
create table if not exists public.documento_tributario_lineas (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos_tributarios (id) on delete cascade,
  numero_linea integer not null check (numero_linea > 0),
  nombre text not null,
  descripcion text,
  cantidad numeric(12, 2) not null default 1 check (cantidad > 0),
  unidad text,
  precio_unitario integer not null check (precio_unitario >= 0),
  exento boolean not null default false,
  monto_linea integer generated always as (round(cantidad * precio_unitario)::integer) stored,
  constraint uq_dte_linea unique (documento_id, numero_linea)
);

comment on column public.documento_tributario_lineas.precio_unitario is 'Precio con IVA incluido (mismo criterio que ot_detalle y Presupuesto). El desglose neto/IVA lo calcula documento_tributario_recalcular().';

-- ---------------------------------------------------------------------------
-- Contador de folios SOLO para el adaptador sandbox. Con un proveedor real
-- el folio lo asigna el proveedor (dueño del CAF), esta tabla no se usa.
-- ---------------------------------------------------------------------------
create table if not exists public.facturacion_folios_sandbox (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  tipo_dte integer not null,
  siguiente integer not null default 1,
  primary key (empresa_id, tipo_dte)
);

create or replace function public.facturacion_sandbox_siguiente_folio(p_empresa_id uuid, p_tipo_dte integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folio integer;
begin
  insert into public.facturacion_folios_sandbox (empresa_id, tipo_dte, siguiente)
  values (p_empresa_id, p_tipo_dte, 2)
  on conflict (empresa_id, tipo_dte) do update
    set siguiente = public.facturacion_folios_sandbox.siguiente + 1
  returning siguiente - 1 into v_folio;
  return v_folio;
end;
$$;

-- Solo service_role (la Edge Function): un usuario no debe poder quemar folios.
revoke all on function public.facturacion_sandbox_siguiente_folio(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cálculo de montos: fuente única de verdad, en la base.
-- Tipos exentos (34, 41): todas las líneas se tratan como exentas.
-- ---------------------------------------------------------------------------
create or replace function public.documento_tributario_recalcular(p_documento_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo integer;
  v_afecto integer;
  v_exento integer;
  v_neto integer;
begin
  select tipo_dte into v_tipo from public.documentos_tributarios where id = p_documento_id;
  if v_tipo is null then
    return;
  end if;

  select
    coalesce(sum(monto_linea) filter (where not exento), 0),
    coalesce(sum(monto_linea) filter (where exento), 0)
  into v_afecto, v_exento
  from public.documento_tributario_lineas
  where documento_id = p_documento_id;

  if v_tipo in (34, 41) then
    v_exento := v_exento + v_afecto;
    v_afecto := 0;
  end if;

  v_neto := round(v_afecto / 1.19)::integer;

  update public.documentos_tributarios
  set monto_neto = v_neto,
      monto_iva = v_afecto - v_neto,
      monto_exento = v_exento,
      monto_total = v_afecto + v_exento
  where id = p_documento_id;
end;
$$;

revoke all on function public.documento_tributario_recalcular(uuid) from public, anon, authenticated;

create or replace function public.trg_dte_lineas_recalcular()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.documento_tributario_recalcular(old.documento_id);
  else
    perform public.documento_tributario_recalcular(new.documento_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_dte_lineas_recalcular on public.documento_tributario_lineas;
create trigger trg_dte_lineas_recalcular
  after insert or update or delete on public.documento_tributario_lineas
  for each row execute function public.trg_dte_lineas_recalcular();

-- Cambiar tipo_dte de un borrador cambia el tratamiento del IVA (34/41 =
-- exentos): hay que recalcular también en ese caso.
create or replace function public.trg_dte_tipo_recalcular()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tipo_dte is distinct from old.tipo_dte then
    perform public.documento_tributario_recalcular(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_dte_tipo_recalcular on public.documentos_tributarios;
create trigger trg_dte_tipo_recalcular
  after update of tipo_dte on public.documentos_tributarios
  for each row execute function public.trg_dte_tipo_recalcular();

-- ---------------------------------------------------------------------------
-- Inmutabilidad y máquina de estados.
--
-- Transiciones permitidas:
--   borrador  -> emitiendo
--   emitiendo -> aceptado | rechazado | error
--   error     -> emitiendo            (reintento; el proveedor recibe el id
--                                       del documento como clave de
--                                       idempotencia, un reintento tras un
--                                       timeout no duplica el DTE)
--   aceptado  -> anulado              (solo al aceptarse una NC código 1)
-- 'rechazado' y 'anulado' son finales.
--
-- Fuera de 'borrador', el contenido (tipo, receptor, montos, referencias,
-- vínculos) no se puede modificar por NADIE -ni service_role-: si la Edge
-- Function tuviera un bug, la base igual protege el documento.
-- ---------------------------------------------------------------------------
create or replace function public.trg_dte_proteger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then
      raise exception 'Un documento tributario emitido no se puede eliminar. Corrígelo con una nota de crédito.';
    end if;
    return old;
  end if;

  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'borrador' and new.estado = 'emitiendo')
      or (old.estado = 'emitiendo' and new.estado in ('aceptado', 'rechazado', 'error'))
      or (old.estado = 'error' and new.estado = 'emitiendo')
      or (old.estado = 'aceptado' and new.estado = 'anulado')
    ) then
      raise exception 'Transición de estado no permitida: % -> %.', old.estado, new.estado;
    end if;
  end if;

  if old.estado <> 'borrador' and (
    new.empresa_id is distinct from old.empresa_id
    or new.tipo_dte is distinct from old.tipo_dte
    or new.fecha_emision is distinct from old.fecha_emision
    or new.receptor_rut is distinct from old.receptor_rut
    or new.receptor_razon_social is distinct from old.receptor_razon_social
    or new.receptor_giro is distinct from old.receptor_giro
    or new.receptor_direccion is distinct from old.receptor_direccion
    or new.receptor_comuna is distinct from old.receptor_comuna
    or new.receptor_ciudad is distinct from old.receptor_ciudad
    or new.receptor_correo is distinct from old.receptor_correo
    or new.cliente_id is distinct from old.cliente_id
    or new.trabajo_id is distinct from old.trabajo_id
    or new.venta_id is distinct from old.venta_id
    or new.monto_neto is distinct from old.monto_neto
    or new.monto_exento is distinct from old.monto_exento
    or new.monto_iva is distinct from old.monto_iva
    or new.monto_total is distinct from old.monto_total
    or new.referencia_documento_id is distinct from old.referencia_documento_id
    or new.referencia_codigo is distinct from old.referencia_codigo
    or new.referencia_razon is distinct from old.referencia_razon
    or new.guia_indicador_traslado is distinct from old.guia_indicador_traslado
  ) then
    raise exception 'Un documento tributario emitido no se puede modificar.';
  end if;

  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists trg_dte_proteger on public.documentos_tributarios;
create trigger trg_dte_proteger
  before update or delete on public.documentos_tributarios
  for each row execute function public.trg_dte_proteger();

create or replace function public.trg_dte_lineas_proteger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  select estado into v_estado
  from public.documentos_tributarios
  where id = case when tg_op = 'DELETE' then old.documento_id else new.documento_id end;

  -- Si el documento ya no existe (borrado en cascada de un borrador), nada que proteger.
  if v_estado is not null and v_estado <> 'borrador' then
    raise exception 'Las líneas de un documento tributario emitido no se pueden modificar.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_dte_lineas_proteger on public.documento_tributario_lineas;
create trigger trg_dte_lineas_proteger
  before insert or update or delete on public.documento_tributario_lineas
  for each row execute function public.trg_dte_lineas_proteger();

-- ---------------------------------------------------------------------------
-- RLS.
-- Lectura: quienes ya ven Cuentas por Cobrar (admin, socia,
-- encargado_presupuestos, jefe_taller, asesor). Escritura de BORRADORES y
-- emisión: un grupo más chico, sin jefe_taller -un documento tributario
-- compromete a la empresa ante el SII-. `estado`, folio, proveedor y
-- `simulado` los fija únicamente la Edge Function (service role): el WITH
-- CHECK obliga a que un usuario solo pueda dejar filas en borrador limpio.
-- ---------------------------------------------------------------------------
alter table public.facturacion_config enable row level security;
alter table public.documentos_tributarios enable row level security;
alter table public.documento_tributario_lineas enable row level security;
alter table public.facturacion_folios_sandbox enable row level security;

drop policy if exists facturacion_config_select on public.facturacion_config;
create policy facturacion_config_select on public.facturacion_config
  for select using (
    empresa_id = public.mi_empresa_id()
    and (public.es_admin() or public.es_socia() or public.es_encargado_presupuestos() or public.es_asesor() or public.es_jefe_taller())
  );

drop policy if exists documentos_tributarios_select on public.documentos_tributarios;
create policy documentos_tributarios_select on public.documentos_tributarios
  for select using (
    empresa_id = public.mi_empresa_id()
    and (public.es_admin() or public.es_socia() or public.es_encargado_presupuestos() or public.es_asesor() or public.es_jefe_taller())
  );

drop policy if exists documentos_tributarios_insert on public.documentos_tributarios;
create policy documentos_tributarios_insert on public.documentos_tributarios
  for insert with check (
    empresa_id = public.mi_empresa_id()
    and (public.es_admin() or public.es_socia() or public.es_encargado_presupuestos() or public.es_asesor())
    and estado = 'borrador' and folio is null and simulado = false and proveedor is null
    and proveedor_ref is null and url_pdf is null and url_xml is null and error_detalle is null
    and emitido_en is null and creado_por = auth.uid()
  );

drop policy if exists documentos_tributarios_update on public.documentos_tributarios;
create policy documentos_tributarios_update on public.documentos_tributarios
  for update
  using (
    empresa_id = public.mi_empresa_id() and estado = 'borrador'
    and (public.es_admin() or public.es_socia() or public.es_encargado_presupuestos() or public.es_asesor())
  )
  with check (
    empresa_id = public.mi_empresa_id()
    and estado = 'borrador' and folio is null and simulado = false and proveedor is null
    and proveedor_ref is null and url_pdf is null and url_xml is null and error_detalle is null
    and emitido_en is null
  );

drop policy if exists documentos_tributarios_delete on public.documentos_tributarios;
create policy documentos_tributarios_delete on public.documentos_tributarios
  for delete using (
    empresa_id = public.mi_empresa_id() and estado = 'borrador'
    and (public.es_admin() or public.es_socia() or public.es_encargado_presupuestos() or public.es_asesor())
  );

drop policy if exists dte_lineas_select on public.documento_tributario_lineas;
create policy dte_lineas_select on public.documento_tributario_lineas
  for select using (exists (
    select 1 from public.documentos_tributarios d
    where d.id = documento_id and d.empresa_id = public.mi_empresa_id()
      and (public.es_admin() or public.es_socia() or public.es_encargado_presupuestos() or public.es_asesor() or public.es_jefe_taller())
  ));

drop policy if exists dte_lineas_write on public.documento_tributario_lineas;
create policy dte_lineas_write on public.documento_tributario_lineas
  for all
  using (exists (
    select 1 from public.documentos_tributarios d
    where d.id = documento_id and d.empresa_id = public.mi_empresa_id() and d.estado = 'borrador'
      and (public.es_admin() or public.es_socia() or public.es_encargado_presupuestos() or public.es_asesor())
  ))
  with check (exists (
    select 1 from public.documentos_tributarios d
    where d.id = documento_id and d.empresa_id = public.mi_empresa_id() and d.estado = 'borrador'
      and (public.es_admin() or public.es_socia() or public.es_encargado_presupuestos() or public.es_asesor())
  ));

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_name in ('facturacion_config', 'documentos_tributarios', 'documento_tributario_lineas', 'facturacion_folios_sandbox')) as tablas_esperado_4,
  (select count(*) from pg_class where relname in ('facturacion_config', 'documentos_tributarios', 'documento_tributario_lineas', 'facturacion_folios_sandbox') and relrowsecurity) as tablas_con_rls_esperado_4,
  (select count(*) from pg_trigger where tgname in ('trg_dte_proteger', 'trg_dte_lineas_proteger', 'trg_dte_lineas_recalcular', 'trg_dte_tipo_recalcular')) as triggers_esperado_4,
  (select count(*) from public.facturacion_config c join public.empresas e on e.id = c.empresa_id where e.id = 'b0000000-0000-4000-8000-000000000001') as config_demo_esperado_1;
