-- =============================================================================
-- 0046_politicas_presupuesto.sql
--
-- Qué resuelve:
--   Las políticas (condiciones) que se imprimen al pie de cada presupuesto.
--   Hay tres casos, según los repuestos del trabajo:
--     sin_encargo  -> presupuesto simple, sin encargar repuestos.
--     encargo      -> repuestos por encargo (2 a 3 días hábiles, con abono).
--     importacion  -> repuestos por importación (30 a 40 días hábiles, con abono).
--   - politicas_presupuesto: el texto de cada caso, por empresa (multi-tenant:
--     validez, teléfono, horario y datos de transferencia son de cada taller,
--     nunca texto fijo en la app).
--   - presupuestos_taller.condiciones: qué caso aplica a cada presupuesto. Lo
--     elige la persona en el detalle del presupuesto; por defecto sin_encargo.
--   Reemplaza la línea fija "vigencia de 30 días" del presupuesto impreso.
--   El tenant demo lleva los mismos textos con datos bancarios ficticios.
-- =============================================================================

alter table public.presupuestos_taller
  add column if not exists condiciones text not null default 'sin_encargo'
  check (condiciones in ('sin_encargo', 'encargo', 'importacion'));

comment on column public.presupuestos_taller.condiciones is 'Caso de políticas que se imprime en el presupuesto (ver politicas_presupuesto).';

create table if not exists public.politicas_presupuesto (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  condicion text not null check (condicion in ('sin_encargo', 'encargo', 'importacion')),
  texto text not null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint uq_politicas_presupuesto unique (empresa_id, condicion)
);

comment on table public.politicas_presupuesto is 'Texto de políticas al pie del presupuesto, una fila por empresa y caso. Cada línea del texto es una línea impresa.';

drop trigger if exists trg_politicas_presupuesto_actualizado_en on public.politicas_presupuesto;
create trigger trg_politicas_presupuesto_actualizado_en
  before update on public.politicas_presupuesto
  for each row execute function public.actualizar_marca_de_tiempo();

alter table public.politicas_presupuesto enable row level security;

drop policy if exists politicas_presupuesto_select on public.politicas_presupuesto;
create policy politicas_presupuesto_select on public.politicas_presupuesto
  for select using (empresa_id = public.mi_empresa_id());

drop policy if exists politicas_presupuesto_insert on public.politicas_presupuesto;
create policy politicas_presupuesto_insert on public.politicas_presupuesto
  for insert with check (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'));

drop policy if exists politicas_presupuesto_update on public.politicas_presupuesto;
create policy politicas_presupuesto_update on public.politicas_presupuesto
  for update
  using (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'))
  with check (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'));

drop policy if exists politicas_presupuesto_delete on public.politicas_presupuesto;
create policy politicas_presupuesto_delete on public.politicas_presupuesto
  for delete using (empresa_id = public.mi_empresa_id() and public.auth_rol() in ('admin', 'socia'));

-- ---------------------------------------------------------------------------
-- Textos. Una fila por empresa y caso; se puede volver a correr.
-- ---------------------------------------------------------------------------
do $$
declare
  v_empresa record;
  v_validez constant text := E'IMPORTANTE:\n*PRESUPUESTO VALIDO POR 5 DIAS CORRIDOS DESDE LA FECHA DE EMISIÓN. VENCIDO ESE PLAZO, DEBERÁ SOLICITAR ACTUALIZACIÓN.';
  v_horario constant text := E'*HORARIO DE ATENCION: LUNES A JUEVES DE LAS 08:30 A 18:30 HRS /VIERNES DE 08:30 A 18:00 HRS/ SABADO: 09:30 A 13:30 HRS.';
  v_modificacion constant text := E'*PRESUPUESTO SUJETO A MODIFICACION EN LA MEDIDA DE QUE DESMONTEN Y SE EVALUEN LOS COMPONENTES LA CUAL SERA INFORMADO A LA BREVEDAD, EN CASO DE HABER DEFECTOS DE REQUERIMIENTO SE REALIZARÁ UN PRESUPUESTO ADICIONAL.';
  v_pago constant text := E'*FORMA DE PAGO: EFECTIVO, TRANSFERENCIA, LINK DE PAGO (DEBITO O CREDITO)';
  v_coordinar text;
  v_transferencia text;
begin
  for v_empresa in
    select * from (values
      -- Taller demo: mismos textos, con datos de contacto y bancarios ficticios.
      (
        'b0000000-0000-4000-8000-000000000001'::uuid,
        E'AL APROBAR EL PRESUPUESTO DEBE COORDINAR SU VISITA AL +569 00000000',
        E'*DATOS DE TRANSFERENCIA:\nTaller Demo Multimarca\n76.000.000-0\ncontacto@example.com\nCta corriente Banco Demo: 00 00 00 00\nENVIAR COMPROBANTE AL +569 00000000'
      )
    ) as e(empresa_id, coordinar, transferencia)
  loop
    if not exists (select 1 from public.empresas where id = v_empresa.empresa_id) then
      continue;
    end if;
    v_coordinar := v_empresa.coordinar;
    v_transferencia := v_empresa.transferencia;

    insert into public.politicas_presupuesto (empresa_id, condicion, texto)
    values
      (
        v_empresa.empresa_id, 'sin_encargo',
        v_validez || E'\n*' || v_coordinar || E'\n' || v_horario || E'\n' || v_modificacion || E'\n' || v_transferencia
      ),
      (
        v_empresa.empresa_id, 'encargo',
        v_validez || E'\n*REPUESTOS POR ENCARGO DE 2 A 3 DIAS HABILES, SE SOLICITA EL ABONO DEL VALOR DE LOS REPUESTOS.\n' || v_pago
          || E'\n' || v_coordinar || E'\n' || v_horario || E'\n' || v_modificacion || E'\n' || v_transferencia
      ),
      (
        v_empresa.empresa_id, 'importacion',
        v_validez || E'\n*REPUESTOS POR ENCARGO DE 30 A 40 DIAS HABILES, SE SOLICITA EL ABONO DEL VALOR DE LOS REPUESTOS.\n' || v_pago
          || E'\n' || v_coordinar || E'\n' || v_horario || E'\n' || v_modificacion || E'\n' || v_transferencia
      )
    on conflict (empresa_id, condicion) do update set texto = excluded.texto;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_name = 'presupuestos_taller' and column_name = 'condiciones') as columna_esperado_1,
  (select count(*) from pg_class where relname = 'politicas_presupuesto' and relrowsecurity) as rls_esperado_1,
  (select count(*) from pg_policies where tablename = 'politicas_presupuesto') as politicas_esperado_4,
  (select count(*) from public.politicas_presupuesto where empresa_id = 'b0000000-0000-4000-8000-000000000001') as textos_demo_esperado_3;
