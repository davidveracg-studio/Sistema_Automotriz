-- =============================================================================
-- 0042_perfil_propio.sql
--
-- Qué resuelve:
--   La pantalla "Editar perfil" (menú "Mi cuenta" de la barra superior) deja
--   que cada persona cambie su propio nombre. La policy usuarios_update solo
--   permite editar a un admin, así que un técnico o un asesor no podría
--   escribir su fila. Esta función cubre exactamente eso y nada más: solo
--   nombre_completo, solo la fila de quien llama (auth.uid()). No toca el
--   correo (es único y cruza con ClickUp) ni el rol ni la empresa.
-- =============================================================================

create or replace function public.perfil_actualizar_nombre(p_nombre text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;
  if length(v_nombre) < 2 or length(v_nombre) > 100 then
    raise exception 'El nombre debe tener entre 2 y 100 caracteres.';
  end if;

  update public.usuarios set nombre_completo = v_nombre where id = auth.uid();
end;
$$;

comment on function public.perfil_actualizar_nombre is 'Cambia solo el nombre_completo del usuario autenticado (auth.uid()). Alcance mínimo a propósito: no cambia correo, rol ni empresa.';

revoke all on function public.perfil_actualizar_nombre(text) from public;
grant execute on function public.perfil_actualizar_nombre(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'perfil_actualizar_nombre') as funcion_esperado_1,
  (select prosecdef from pg_proc where proname = 'perfil_actualizar_nombre') as security_definer_esperado_true;
