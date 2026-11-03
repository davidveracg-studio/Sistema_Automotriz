-- =============================================================================
-- 0071_accesos_fallidos_retencion.sql
--
-- Qué resuelve (hallazgo H-14 de la auditoría de protección de datos
-- 2026-11-03):
--   `registrar_acceso_fallido` (0056) guarda el correo tal como lo tipeó la
--   persona, y a veces lo que se tipea en ese campo no es un correo sino una
--   clave. Además la tabla `uso_accesos_fallidos` crecía sin límite.
--
-- Qué hace:
--   1. Solo se guarda el valor si tiene forma de correo; si no, se guarda el
--      texto fijo '(formato no válido)'. El correo se guarda en minúsculas.
--   2. Cada vez que se registra un intento se borran los de más de 90 días.
--      Se hace aquí y no con pg_cron para no depender de una extensión que, si
--      no estuviera habilitada, haría fallar esta migración y detendría el
--      despliegue. Hay índice por creado_en, así que el borrado es barato.
--   3. Se mantiene el tope de 300 intentos por hora contra abuso.
--
-- La firma de la función no cambia (el frontend la llama igual).
-- Idempotente.
-- =============================================================================

create or replace function public.registrar_acceso_fallido(p_correo text, p_dispositivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Retención: nada de más de 90 días.
  delete from public.uso_accesos_fallidos f where f.creado_en < now() - interval '90 days';

  -- Lo puede llamar cualquiera sin sesión: tope por hora para que no se pueda inflar la tabla.
  if (select count(*) from public.uso_accesos_fallidos f where f.creado_en > now() - interval '1 hour') >= 300 then
    return;
  end if;

  insert into public.uso_accesos_fallidos (correo, dispositivo)
  values (
    case
      when p_correo ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then left(lower(p_correo), 200)
      else '(formato no válido)'
    end,
    left(p_dispositivo, 120)
  );
end;
$$;

comment on function public.registrar_acceso_fallido(text, text) is 'Registra un intento de ingreso rechazado. Solo guarda el valor si parece un correo (si no, un texto fijo, porque a veces se tipea la clave en ese campo), borra intentos de más de 90 días y limita a 300 por hora.';

-- ---------------------------------------------------------------------------
-- Verificación:
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'registrar_acceso_fallido') as funcion_esperado_1,
  ('MiClave123' ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') as clave_parece_correo_esperado_false,
  ('Persona@Taller.cl' ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') as correo_valido_esperado_true;
