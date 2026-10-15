-- =============================================================================
-- 0040_demo_correos_de_prueba.sql
--
-- Qué resuelve:
--   Al probar la demo, la persona ingresa un correo "de cliente" y un correo
--   "de asesor" (pueden ser el mismo) para recibir de verdad los correos del
--   sistema, sin que la demo le escriba jamás a un cliente real ni a las
--   direcciones ficticias de los datos de ejemplo.
--
--   - empresas.es_demo marca el tenant de demostración.
--   - empresas.demo_correo_cliente / demo_correo_asesor guardan los correos
--     de prueba. NO se toca usuarios.correo (es único y cruza con ClickUp) ni
--     clientes.email: las Edge Functions de correo redirigen a estos campos
--     cuando la empresa es demo.
--   - demo_guardar_correos() los escribe. Solo funciona dentro de un tenant
--     demo: en una empresa real levanta un error.
--
--   Los datos del tenant son compartidos entre quienes prueban: el último en
--   guardar sus correos es quien los recibe.
-- =============================================================================

alter table public.empresas add column if not exists es_demo boolean not null default false;
alter table public.empresas add column if not exists demo_correo_cliente text;
alter table public.empresas add column if not exists demo_correo_asesor text;

comment on column public.empresas.es_demo is 'true = tenant de demostración: los correos salen hacia los correos de prueba en vez de a clientes/usuarios.';
comment on column public.empresas.demo_correo_cliente is 'Solo demo: destino de los correos que en producción irían al cliente (ej. la encuesta de postventa).';
comment on column public.empresas.demo_correo_asesor is 'Solo demo: destino de los avisos internos que en producción irían al asesor/administración (ej. encuesta negativa).';

update public.empresas set es_demo = true where id = 'b0000000-0000-4000-8000-000000000001';

create or replace function public.demo_guardar_correos(p_correo_cliente text, p_correo_asesor text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid := public.mi_empresa_id();
  v_cliente text := lower(trim(coalesce(p_correo_cliente, '')));
  v_asesor text := lower(trim(coalesce(p_correo_asesor, '')));
begin
  if v_empresa is null or not exists (select 1 from public.empresas where id = v_empresa and es_demo) then
    raise exception 'Esta función solo está disponible en el tenant de demostración.';
  end if;

  if v_cliente !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_cliente) > 254 then
    raise exception 'El correo del cliente no es válido.';
  end if;
  if v_asesor !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_asesor) > 254 then
    raise exception 'El correo del asesor no es válido.';
  end if;

  update public.empresas
  set demo_correo_cliente = v_cliente, demo_correo_asesor = v_asesor
  where id = v_empresa;
end;
$$;

revoke all on function public.demo_guardar_correos(text, text) from public;
grant execute on function public.demo_guardar_correos(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'empresas' and column_name in ('es_demo', 'demo_correo_cliente', 'demo_correo_asesor')) as columnas_esperado_3,
  (select count(*) from pg_proc where proname = 'demo_guardar_correos') as funcion_esperado_1,
  (select count(*) from public.empresas where es_demo) as empresas_demo_esperado_1,
  (select count(*) from public.empresas where es_demo and id <> 'b0000000-0000-4000-8000-000000000001') as empresas_demo_ajenas_esperado_0;
