-- =============================================================================
-- 0065_demo_rebrand_vpai.sql
--
-- Qué resuelve:
--   La demo se muestra bajo marca propia "VPAI" (ver también LoginDemo.jsx y el
--   selector "Cambiar de rol" de la barra superior). Todo acotado a la empresa
--   demo:
--
--   1. Nombres ficticios para los 12 usuarios demo.
--   2. El rol 'socia' se fusiona con 'admin' en la demo: no se puede quitar
--      del sistema (las políticas RLS dependen de él), así que la cuenta
--      demo-socia@vpai.dev se reasigna a 'admin' y se desactiva como login
--      -el selector de rol de la demo ya no la ofrece, ver src/lib/demo.js-.
-- =============================================================================

do $$
declare
  v_empresa_id uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  update public.usuarios set nombre_completo = 'Carlos Mendoza' where empresa_id = v_empresa_id and correo = 'demo-admin@vpai.dev';
  update public.usuarios set nombre_completo = 'Patricia Soto' where empresa_id = v_empresa_id and correo = 'demo-socia@vpai.dev';
  update public.usuarios set nombre_completo = 'Marcelo Rojas' where empresa_id = v_empresa_id and correo = 'demo-asesor@vpai.dev';
  update public.usuarios set nombre_completo = 'Sergio Palacios' where empresa_id = v_empresa_id and correo = 'demo-jefe-taller@vpai.dev';
  update public.usuarios set nombre_completo = 'Rodrigo Fuentes' where empresa_id = v_empresa_id and correo = 'demo-presupuestos@vpai.dev';
  update public.usuarios set nombre_completo = 'Cristian Morales' where empresa_id = v_empresa_id and correo = 'demo-tecnico@vpai.dev';
  update public.usuarios set nombre_completo = 'Felipe Contreras' where empresa_id = v_empresa_id and correo = 'demo-detailer@vpai.dev';
  update public.usuarios set nombre_completo = 'Camila Torres' where empresa_id = v_empresa_id and correo = 'demo-recepcionista@vpai.dev';
  update public.usuarios set nombre_completo = 'Nicolás Herrera' where empresa_id = v_empresa_id and correo = 'demo-mecanico2@vpai.dev';
  update public.usuarios set nombre_completo = 'Matías Silva' where empresa_id = v_empresa_id and correo = 'demo-mecanico3@vpai.dev';
  update public.usuarios set nombre_completo = 'Joaquín Vergara' where empresa_id = v_empresa_id and correo = 'demo-lavador@vpai.dev';
  update public.usuarios set nombre_completo = 'Francisco Gómez' where empresa_id = v_empresa_id and correo = 'demo-alineador@vpai.dev';

  -- Fusión 'socia' -> 'admin': se retira como cuenta de login de la demo.
  update public.usuarios
  set rol = 'admin', activo = false
  where empresa_id = v_empresa_id and correo = 'demo-socia@vpai.dev';
end $$;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select correo, nombre_completo, rol, activo
from public.usuarios
where empresa_id = 'b0000000-0000-4000-8000-000000000001'
order by correo;
