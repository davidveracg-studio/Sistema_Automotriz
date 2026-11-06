-- =============================================================================
-- 0075_revocar_funciones_internas_expuestas.sql
--
-- Hallazgo de las pruebas de aislamiento (FASE0.md, WP0.2): funciones
-- SECURITY DEFINER pensadas solo para uso interno quedaron ejecutables por
-- cualquiera, porque Postgres da EXECUTE a PUBLIC por defecto y Supabase las
-- expone por RPC (/rest/v1/rpc/<función>):
--
--   1. whatsapp_buscar_cliente_por_telefono(p_telefono, p_empresa_id)
--      Sin verificar quién llama, devuelve el id de un cliente de CUALQUIER
--      empresa a partir de un teléfono. Lo puede llamar un visitante sin sesión
--      (anon) o un usuario de otra empresa.
--   2. whatsapp_registrar_contacto(p_empresa_id, p_phone_number_id, p_wa_id,
--      p_nombre_whatsapp)
--      Sin verificar quién llama, crea o actualiza un contacto de WhatsApp en
--      la empresa que se indique. Permite escribir en la bandeja de otra
--      empresa.
--   3. plataforma_empresa_ok(...) y plataforma_exigir()
--      Ayudantes internos del monitor de plataforma. No exponen datos de
--      negocio, pero no tienen por qué ser llamables por usuarios.
--
-- Quién las usa de verdad: 1 y 2, solo la Edge Function `whatsapp` con la clave
-- de service role (supabase/functions/whatsapp/index.ts: clienteServicio()). El
-- frontend no las llama (verificado con grep en src/). 3 solo se invocan desde
-- otras funciones SECURITY DEFINER, que se ejecutan con los permisos de su dueño
-- y no necesitan que el usuario tenga EXECUTE.
--
-- Qué hace: quita EXECUTE a public, anon y authenticated, y se lo deja solo a
-- service_role. No cambia el cuerpo de ninguna función.
--
-- Cómo deshacerlo:
--   grant execute on function public.whatsapp_buscar_cliente_por_telefono(text, uuid) to public;
--   grant execute on function public.whatsapp_registrar_contacto(uuid, text, text, text) to public;
-- (y lo mismo para las otras dos si hiciera falta).
-- =============================================================================

revoke execute on function public.whatsapp_buscar_cliente_por_telefono(text, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_buscar_cliente_por_telefono(text, uuid) to service_role;

revoke execute on function public.whatsapp_registrar_contacto(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_registrar_contacto(uuid, text, text, text) to service_role;

revoke execute on function public.plataforma_empresa_ok(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.plataforma_exigir() from public, anon, authenticated;
