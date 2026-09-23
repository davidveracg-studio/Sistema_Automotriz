-- =============================================================================
-- 0022_diagrama_danos.sql
--
-- Qué resuelve:
--   El cliente compartió tres diagramas de referencia (sedán, furgón, pick
--   up, cada uno con 5 vistas: superior/frontal/lateral izq/lateral der/
--   posterior) y pidió poder marcar sobre el dibujo dónde tiene daños o
--   detalles el vehículo al momento del ingreso -el equivalente digital al
--   "diagrama de daños" que se marca a mano en el papel-.
--
--   Decisiones tomadas con el cliente antes de construir:
--   - Cada click en el dibujo agrega un punto numerado con una nota corta
--     propia (no un campo de texto libre aparte).
--   - Las 5 vistas del papel de referencia, no solo la superior.
--   - Solo en la Orden de Ingreso por ahora, no en la de Egreso.
--
--   `vehiculos.tipo_carroceria` decide qué set de 5 dibujos usar (sedán,
--   furgón o pick up) -atributo del vehículo, no de la OT, se pregunta una
--   vez y queda guardado igual que color/vin/puertas/aseguradora del bloque
--   anterior-. `inspecciones_ingreso.diagrama_danos` guarda los puntos
--   marcados como jsonb (mismo patrón ya usado por
--   `preguntas_descubrimiento` en este mismo bloque): un array de
--   {vista, x, y, nota}, con x/y como fracción 0-1 del recuadro de esa
--   vista para que renderice bien sin importar el tamaño de pantalla.
-- =============================================================================

alter table public.vehiculos
  add column if not exists tipo_carroceria text check (tipo_carroceria is null or tipo_carroceria in ('sedan', 'furgon', 'pickup'));

comment on column public.vehiculos.tipo_carroceria is 'Qué set de 5 dibujos (superior/frontal/lateral izq/lateral der/posterior) usar para marcar daños en el ingreso. NULL = todavía no se preguntó.';

alter table public.inspecciones_ingreso
  add column if not exists diagrama_danos jsonb;

comment on column public.inspecciones_ingreso.diagrama_danos is 'Puntos marcados sobre el diagrama del vehículo: array de {vista, x, y, nota}. x/y son fracción 0-1 del recuadro de esa vista (superior/frontal/lateral_izq/lateral_der/posterior).';

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'vehiculos' and column_name = 'tipo_carroceria') as columna_vehiculos_esperado_1,
  (select count(*) from information_schema.columns where table_name = 'inspecciones_ingreso' and column_name = 'diagrama_danos') as columna_inspecciones_esperado_1;
