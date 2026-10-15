-- =============================================================================
-- 0054_observaciones_asesor.sql
--
-- Qué resuelve:
--   Bitácora de notas del asesor durante toda la vida de la OT (a diferencia
--   de observaciones_postventa, que solo se puede agregar una vez entregada).
--   Ej.: "cliente insiste en que no toquen la radio", "pidió el presupuesto
--   por WhatsApp", "prefiere que lo llamen después de las 18:00". Mismo
--   patrón que observaciones_postventa (0026): bitácora de solo agregar, sin
--   editar ni borrar, visible para cualquiera de la empresa.
--   Se puede seguir agregando aunque la OT ya esté bloqueada (entregada): son
--   notas, no datos estructurales de la OT -misma excepción que postventa.
-- =============================================================================

create table if not exists public.observaciones_asesor (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references public.trabajos_taller (id) on delete cascade,
  autor_id uuid references public.usuarios (id),
  texto text not null,
  creado_en timestamptz not null default now()
);

comment on table public.observaciones_asesor is 'Bitácora de notas del asesor sobre la OT (preferencias del cliente, acuerdos, seguimiento), agregable en cualquier momento de su vida -incluida ya entregada-.';

create index if not exists observaciones_asesor_trabajo_idx on public.observaciones_asesor (trabajo_id);

alter table public.observaciones_asesor enable row level security;

drop policy if exists observaciones_asesor_select on public.observaciones_asesor;
create policy observaciones_asesor_select on public.observaciones_asesor
  for select using (exists (
    select 1 from public.trabajos_taller t
    where t.id = observaciones_asesor.trabajo_id and t.empresa_id = public.mi_empresa_id()
  ));

drop policy if exists observaciones_asesor_insert on public.observaciones_asesor;
create policy observaciones_asesor_insert on public.observaciones_asesor
  for insert with check (
    public.auth_rol() is not null
    and exists (
      select 1 from public.trabajos_taller t
      where t.id = observaciones_asesor.trabajo_id and t.empresa_id = public.mi_empresa_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_name = 'observaciones_asesor') as tabla_esperado_1,
  (select relrowsecurity from pg_class where relname = 'observaciones_asesor') as rls_esperado_true,
  (select count(*) from pg_policies where tablename = 'observaciones_asesor') as politicas_esperado_2;
