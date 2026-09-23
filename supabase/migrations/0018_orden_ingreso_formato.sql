-- =============================================================================
-- 0018_orden_ingreso_formato.sql
--
-- Qué resuelve:
--   El cliente compartió el formato real en papel de la "Orden de Trabajo"
--   (Dimasoft/CamScanner) y pidió que el comprobante de Nuevo Ingreso salga
--   con ese mismo formato. Comparado campo a campo contra lo que ya existe:
--   `vehiculos.color` y `vehiculos.vin` (chasis) ya estaban en el esquema
--   desde el Bloque 2 pero el formulario nunca los pedía; faltaban
--   "N° de puertas" y "Compañía aseguradora" por completo. El bloque
--   "Cliente Solicita" del papel no tiene equivalente -se decidió con el
--   cliente un campo dedicado, separado de "Observaciones" (que es para
--   notas del asesor, no el pedido del cliente)-. La pregunta "¿Eres dueño o
--   conductor?" se decidió como dato de ESTA visita (la persona que trae el
--   vehículo puede cambiar de una vez a otra), no como el atributo
--   permanente que ya existen en `clientes_vehiculos`
--   (es_propietario/es_conductor).
-- =============================================================================

alter table public.vehiculos
  add column if not exists puertas integer check (puertas is null or puertas > 0);

alter table public.vehiculos
  add column if not exists aseguradora text;

comment on column public.vehiculos.puertas is 'Cantidad de puertas. Solo para mostrar en la Orden de Trabajo impresa, sin uso en reglas de negocio.';
comment on column public.vehiculos.aseguradora is 'Compañía aseguradora del vehículo, si el cliente la informa. Solo para mostrar en la Orden de Trabajo impresa.';

alter table public.inspecciones_ingreso
  add column if not exists cliente_solicita text;

comment on column public.inspecciones_ingreso.cliente_solicita is 'Lo que el cliente pide revisar/reparar, tal como lo dice -distinto de "observaciones" (notas del asesor tras la inspección) y de las preguntas de descubrimiento (solo Tipo A).';

alter table public.inspecciones_ingreso
  add column if not exists rol_persona_presente text check (rol_persona_presente is null or rol_persona_presente in ('dueno', 'conductor'));

comment on column public.inspecciones_ingreso.rol_persona_presente is 'Si quien trae el vehículo HOY es el dueño o solo lo conduce -dato de esta visita puntual, no del vínculo permanente cliente-vehículo (clientes_vehiculos.es_propietario/es_conductor), porque puede cambiar de una visita a otra.';

alter table public.inspecciones_ingreso
  add column if not exists firmado_celular text;

comment on column public.inspecciones_ingreso.firmado_celular is 'Celular de quien firma la conformidad -puede no ser el teléfono registrado del cliente si firma otra persona (ej. un conductor distinto al dueño).';

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'vehiculos' and column_name in ('puertas', 'aseguradora')) as columnas_vehiculos_esperado_2,
  (select count(*) from information_schema.columns where table_name = 'inspecciones_ingreso' and column_name in ('cliente_solicita', 'rol_persona_presente', 'firmado_celular')) as columnas_inspecciones_esperado_3;
