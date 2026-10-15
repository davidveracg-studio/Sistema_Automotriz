-- =============================================================================
-- 0058_kanban_taller.sql
--
-- Qué resuelve:
--   Vista kanban del taller (Taller > Kanban), con tarjetas por estado de
--   ClickUp. La tarjeta muestra lo mismo que ClickUp, así que hay que traer
--   a la base lo que hoy solo vivía allá:
--   - trabajos_taller.clickup_prioridad: prioridad de la tarjeta principal
--     (urgent / high / normal / low, tal como la entrega la API; NULL = sin
--     prioridad).
--   - trabajos_taller.clickup_fecha_programada: fecha de vencimiento de la
--     tarjeta ("fecha y hora programada"). clickup_fecha_con_hora dice si la
--     persona le puso hora en ClickUp: si no, solo se muestra el día.
--   - trabajos_taller.clickup_detalle_en: cuándo se trajo por última vez este
--     detalle desde ClickUp (para no volver a pedirlo a cada apertura del
--     kanban: la API de ClickUp tiene tope de llamadas por minuto).
--   - tareas_taller.completada: la subtarea está en un estado terminal de
--     ClickUp (tipo "done"/"closed"). Es lo que usa ClickUp para su contador
--     de subtareas y lo que alimenta la barra de % de ejecución; no se puede
--     deducir del nombre del estado porque la lista puede renombrarlos.
--   El kanban NO crea estados ni reglas nuevas en la base: las columnas salen
--   de clickup_estados (que hasta hoy nadie poblaba -la llena la función
--   clickup-kanban al abrir el kanban-) y el puesto sigue siendo
--   plano_ocupacion, la misma tabla que usa el plano.
-- =============================================================================

alter table public.trabajos_taller
  add column if not exists clickup_prioridad text check (clickup_prioridad is null or clickup_prioridad in ('urgent', 'high', 'normal', 'low')),
  add column if not exists clickup_fecha_programada timestamptz,
  add column if not exists clickup_fecha_con_hora boolean not null default false,
  add column if not exists clickup_detalle_en timestamptz;

comment on column public.trabajos_taller.clickup_prioridad is 'Prioridad de la tarjeta en ClickUp (urgent/high/normal/low); NULL = sin prioridad.';
comment on column public.trabajos_taller.clickup_fecha_programada is 'Fecha de vencimiento de la tarjeta en ClickUp (la "fecha y hora programada" del kanban).';
comment on column public.trabajos_taller.clickup_fecha_con_hora is 'true si en ClickUp la fecha de vencimiento tiene hora; si no, solo cuenta el día.';
comment on column public.trabajos_taller.clickup_detalle_en is 'Última vez que se refrescaron prioridad/fecha/subtareas desde ClickUp (kanban).';

alter table public.tareas_taller
  add column if not exists completada boolean not null default false;

comment on column public.tareas_taller.completada is 'La subtarea está en un estado terminal de ClickUp (tipo done/closed). Alimenta el % de ejecución del kanban.';

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'trabajos_taller'
     and column_name in ('clickup_prioridad', 'clickup_fecha_programada', 'clickup_fecha_con_hora', 'clickup_detalle_en')) as columnas_trabajos_esperado_4,
  (select count(*) from information_schema.columns where table_name = 'tareas_taller' and column_name = 'completada') as columna_tareas_esperado_1;
