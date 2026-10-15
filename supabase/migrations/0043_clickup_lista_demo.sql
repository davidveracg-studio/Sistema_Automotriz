-- =============================================================================
-- 0043_clickup_lista_demo.sql
--
-- Qué resuelve:
--   El tenant de demostración se sincroniza con su PROPIA lista de ClickUp
--   (Kanban del taller, citas de la Agenda, sincronización al crear un
--   ingreso). Los IDs de la lista no van en este repo público: se pegan abajo
--   en v_lista antes de correr la migración.
--
--   Mientras v_lista quede en null, la migración no hace nada (solo avisa) y
--   las funciones de ClickUp responden "Esta empresa no tiene configurada una
--   lista de ClickUp"; el resto del CRM funciona igual.
--
--   Para los eventos de vuelta (ClickUp hacia el CRM), la lista necesita su
--   propio webhook y su secreto (CLICKUP_WEBHOOK_SECRET_DEMO), ver
--   scripts/clickup-demo.mjs. El token (CLICKUP_API_TOKEN) y los secretos de
--   webhook viven solo en los secretos de las Edge Functions.
--
--   Si la lista tiene campos personalizados con IDs propios, guardarlos en
--   clickup_config.campos (0044; "node scripts/clickup-demo.mjs verificar"
--   imprime el UPDATE). Después de configurar la lista, volver a correr 0062
--   para asignar el coordinador de repuestos.
-- =============================================================================

do $$
declare
  v_lista text := null; -- <- ID de la lista "Vehículos en taller" de la demo en ClickUp
begin
  if v_lista is null then
    raise notice 'Sin lista de ClickUp para la demo: no se configura nada (ver cabecera).';
    return;
  end if;

  insert into public.clickup_config (empresa_id, lista_trabajos_id, lista_radar_id)
  values ('b0000000-0000-4000-8000-000000000001', v_lista, null)
  on conflict (empresa_id) do update set lista_trabajos_id = excluded.lista_trabajos_id, lista_radar_id = null, activo = true;
end $$;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select cc.lista_trabajos_id from public.clickup_config cc
   where cc.empresa_id = 'b0000000-0000-4000-8000-000000000001') as lista_demo_null_si_no_se_configuro;
