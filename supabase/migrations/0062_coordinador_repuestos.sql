-- =============================================================================
-- 0062_coordinador_repuestos.sql
--
-- Qué resuelve:
--   Los ítems que se agregan a las listas de control de Repuestos y
--   Lubricantes e insumos (desde el Kanban, función clickup-item) se asignan
--   solos al coordinador de repuestos, para que prepare
--   todo antes de la reparación y/o compre lo que falte. Servicios externos
--   no lleva asignación automática -son terceros, no bodega-.
--
--   Se guarda en clickup_config (no hardcodeado en el código ni por nombre):
--   si el día de mañana cambia quién coordina repuestos, se actualiza con un
--   UPDATE, sin tocar ninguna función.
-- =============================================================================

alter table public.clickup_config
  add column if not exists responsable_repuestos_id uuid references public.usuarios (id) on delete set null;

comment on column public.clickup_config.responsable_repuestos_id is 'A quién se le asignan solos los ítems nuevos de Repuestos y Lubricantes e insumos (coordinador de repuestos). NULL = no se asigna nadie automáticamente.';

-- En la demo, el coordinador de repuestos es la cuenta de encargado de
-- presupuestos/bodega. Solo si la demo ya tiene lista de ClickUp (0043); si se
-- configura después, volver a correr esta migración.
update public.clickup_config
set responsable_repuestos_id = 'a0000000-0000-4000-8000-000000000005'
where empresa_id = 'b0000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'clickup_config' and column_name = 'responsable_repuestos_id') as columna_esperado_1,
  (select u.nombre_completo from public.clickup_config cc join public.usuarios u on u.id = cc.responsable_repuestos_id
     where cc.empresa_id = 'b0000000-0000-4000-8000-000000000001') as coordinador_demo_esperado_rodrigo_fuentes;
