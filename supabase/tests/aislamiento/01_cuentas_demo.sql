-- Las migraciones de la demo (0036, 0050, …) exigen que estas 12 cuentas ya
-- existan en auth.users: en producción las crea scripts/crear-demo-vpai.mjs
-- ANTES de correr el SQL (ver README.md, "Puesta en marcha de la demo").
-- Aquí se crean directamente, sin contraseña, solo para poder aplicar las
-- migraciones sobre la base de pruebas. Mismos ids y correos que el script.
insert into auth.users (id, email, email_confirmed_at) values
  ('a0000000-0000-4000-8000-000000000001', 'demo-admin@vpai.dev', now()),
  ('a0000000-0000-4000-8000-000000000002', 'demo-socia@vpai.dev', now()),
  ('a0000000-0000-4000-8000-000000000003', 'demo-asesor@vpai.dev', now()),
  ('a0000000-0000-4000-8000-000000000004', 'demo-jefe-taller@vpai.dev', now()),
  ('a0000000-0000-4000-8000-000000000005', 'demo-presupuestos@vpai.dev', now()),
  ('a0000000-0000-4000-8000-000000000006', 'demo-tecnico@vpai.dev', now()),
  ('a0000000-0000-4000-8000-000000000007', 'demo-detailer@vpai.dev', now()),
  ('a0000000-0000-4000-8000-000000000008', 'demo-recepcionista@vpai.dev', now()),
  ('a0000000-0000-4000-8000-000000000009', 'demo-mecanico2@vpai.dev', now()),
  ('a0000000-0000-4000-8000-00000000000a', 'demo-mecanico3@vpai.dev', now()),
  ('a0000000-0000-4000-8000-00000000000b', 'demo-lavador@vpai.dev', now()),
  ('a0000000-0000-4000-8000-00000000000c', 'demo-alineador@vpai.dev', now())
on conflict (id) do nothing;
