-- =============================================================================
-- 0036_tenant_demo_vpai.sql
--
-- Qué resuelve:
--   Tenant de demostración para mostrar el proyecto en el repositorio
--   público (portafolio), separado por completo del tenant real de Didial
--   -mismo aislamiento multi-tenant por empresa_id/RLS que ya protege a
--   cualquier cliente real del resto-. Sin datos de negocio reales: nombres,
--   patentes, teléfonos y conversaciones de WhatsApp son todos ficticios.
--
--   REQUIERE haber corrido antes `scripts/crear-demo-vpai.mjs`
--   (SUPABASE_SERVICE_ROLE_KEY=... node scripts/crear-demo-vpai.mjs), que
--   crea los 8 usuarios de Auth (uno por rol) y sube el logo al bucket
--   público -esta migración solo puede completar la fila de `usuarios` de
--   alguien que ya existe en `auth.users`, la FK 1:1 lo exige-.
--
--   Los ids de empresa/usuarios son fijos a propósito (no gen_random_uuid())
--   para que el script de Node y esta migración se puedan escribir y
--   revisar por separado sin depender de que uno le pase el resultado al
--   otro a mano.
-- =============================================================================

do $$
declare
  v_empresa_id uuid := 'b0000000-0000-4000-8000-000000000001';

  v_usr_admin uuid := 'a0000000-0000-4000-8000-000000000001';
  v_usr_socia uuid := 'a0000000-0000-4000-8000-000000000002';
  v_usr_asesor uuid := 'a0000000-0000-4000-8000-000000000003';
  v_usr_jefe uuid := 'a0000000-0000-4000-8000-000000000004';
  v_usr_presu uuid := 'a0000000-0000-4000-8000-000000000005';
  v_usr_tecnico uuid := 'a0000000-0000-4000-8000-000000000006';
  v_usr_detailer uuid := 'a0000000-0000-4000-8000-000000000007';
  v_usr_recepcion uuid := 'a0000000-0000-4000-8000-000000000008';

  v_isla_taller uuid;
  v_isla_rapido uuid;
  v_isla_alineacion uuid;
  v_isla_pintura uuid;
  v_isla_lavado uuid;

  v_serv_pastillas uuid;
  v_serv_correa uuid;
  v_serv_amortiguador uuid;
  v_serv_aceite uuid;
  v_serv_alineacion uuid;
  v_serv_lavado uuid;
  v_serv_pintura uuid;
  v_rep_pastillas uuid;
  v_rep_correa uuid;
  v_rep_amortiguador uuid;
  v_rep_filtro uuid;

  v_cli1 uuid; v_veh1 uuid;
  v_cli2 uuid; v_veh2 uuid;
  v_cli3 uuid; v_veh3 uuid;
  v_cli4 uuid; v_veh4 uuid;
  v_cli5 uuid; v_veh5a uuid; v_veh5b uuid;
  v_cli6 uuid; v_veh6 uuid;
  v_cli7 uuid; v_veh7 uuid;
  v_cli8 uuid; v_veh8 uuid;
  v_cli9 uuid; v_veh9 uuid;
  v_cli10 uuid; v_veh10 uuid;
  v_cli11 uuid; v_veh11 uuid;
  v_cli12 uuid; v_veh12 uuid;

  v_ot1 uuid; v_ot2 uuid; v_ot3 uuid; v_ot4 uuid; v_ot5 uuid;
  v_ot6 uuid; v_ot7 uuid; v_ot8 uuid; v_ot9 uuid; v_ot10 uuid;

  v_radar1 uuid; v_radar2 uuid; v_radar3 uuid;
  v_tarea_id uuid;
  v_presu1 uuid; v_presu2 uuid; v_presu3 uuid;
  v_enc1_id uuid; v_enc2_id uuid; v_enc3_id uuid;

  v_wa_cuenta text := '00000demo0001';
  v_wa_contacto1 uuid; v_wa_contacto2 uuid; v_wa_contacto3 uuid;
begin

  -- ---------------------------------------------------------------------
  -- Empresa + horario/corte + islas.
  -- ---------------------------------------------------------------------
  insert into public.empresas (id, nombre, direccion, telefono, correo, logo_url, siguiente_numero_ot, siguiente_numero_presupuesto, corte_mediodia_inicio, corte_mediodia_fin)
  values (
    v_empresa_id, 'VPAI Demo — Taller Multimarca', 'Av. Providencia 1234, Santiago', '+56 2 2345 6789', 'contacto@vpai.dev',
    'https://bshgazaczzfcdfuguvsh.supabase.co/storage/v1/object/public/logos-empresa/b0000000-0000-4000-8000-000000000001/logo-vpai.png',
    5000, 1, '13:00', '15:00'
  )
  on conflict (id) do update set
    nombre = excluded.nombre, direccion = excluded.direccion, telefono = excluded.telefono, correo = excluded.correo,
    logo_url = excluded.logo_url, corte_mediodia_inicio = excluded.corte_mediodia_inicio, corte_mediodia_fin = excluded.corte_mediodia_fin;

  insert into public.horario_atencion (empresa_id, dia_semana, hora_apertura, hora_cierre)
  values
    (v_empresa_id, 1, '09:00', '18:00'), (v_empresa_id, 2, '09:00', '18:00'), (v_empresa_id, 3, '09:00', '18:00'),
    (v_empresa_id, 4, '09:00', '18:00'), (v_empresa_id, 5, '09:00', '17:30'), (v_empresa_id, 6, '09:00', '17:30')
  on conflict (empresa_id, dia_semana) do nothing;

  insert into public.tipos_isla (empresa_id, nombre, capacidad, orden, opera_en_corte) values
    (v_empresa_id, 'Taller mecánico', 4, 1, false),
    (v_empresa_id, 'Servicio rápido', 2, 2, true),
    (v_empresa_id, 'Alineación', 1, 3, false),
    (v_empresa_id, 'Pintura', 1, 4, false),
    (v_empresa_id, 'Lavado', 1, 5, false)
  on conflict (empresa_id, nombre) do nothing;

  select id into v_isla_taller from public.tipos_isla where empresa_id = v_empresa_id and nombre = 'Taller mecánico';
  select id into v_isla_rapido from public.tipos_isla where empresa_id = v_empresa_id and nombre = 'Servicio rápido';
  select id into v_isla_alineacion from public.tipos_isla where empresa_id = v_empresa_id and nombre = 'Alineación';
  select id into v_isla_pintura from public.tipos_isla where empresa_id = v_empresa_id and nombre = 'Pintura';
  select id into v_isla_lavado from public.tipos_isla where empresa_id = v_empresa_id and nombre = 'Lavado';

  -- ---------------------------------------------------------------------
  -- Usuarios (los 8 auth.users ya deben existir, ver crear-demo-vpai.mjs).
  -- ---------------------------------------------------------------------
  insert into public.usuarios (id, empresa_id, nombre_completo, correo, rol, activo) values
    (v_usr_admin, v_empresa_id, 'Ana Administradora', 'demo-admin@vpai.dev', 'admin', true),
    (v_usr_socia, v_empresa_id, 'Sofía Socia', 'demo-socia@vpai.dev', 'socia', true),
    (v_usr_asesor, v_empresa_id, 'Andrés Asesor', 'demo-asesor@vpai.dev', 'asesor', true),
    (v_usr_jefe, v_empresa_id, 'Jorge Jefe de Taller', 'demo-jefe-taller@vpai.dev', 'jefe_taller', true),
    (v_usr_presu, v_empresa_id, 'Paula Presupuestos', 'demo-presupuestos@vpai.dev', 'encargado_presupuestos', true),
    (v_usr_tecnico, v_empresa_id, 'Tomás Técnico', 'demo-tecnico@vpai.dev', 'tecnico', true),
    (v_usr_detailer, v_empresa_id, 'Daniela Detailer', 'demo-detailer@vpai.dev', 'detailer', true),
    (v_usr_recepcion, v_empresa_id, 'Rocío Recepción', 'demo-recepcionista@vpai.dev', 'recepcionista', true)
  on conflict (id) do update set
    empresa_id = excluded.empresa_id, nombre_completo = excluded.nombre_completo, correo = excluded.correo,
    rol = excluded.rol, activo = excluded.activo;

  -- ---------------------------------------------------------------------
  -- Catálogo de servicios (pequeño y representativo, no el completo).
  -- ---------------------------------------------------------------------
  insert into public.catalogo_servicios (empresa_id, segmento, categoria, servicio) values
    (v_empresa_id, 'Taller Mecánico', 'Frenos', 'Cambio de pastillas delanteras') returning id into v_serv_pastillas;
  insert into public.catalogo_servicios (empresa_id, segmento, categoria, servicio) values
    (v_empresa_id, 'Taller Mecánico', 'Motor', 'Cambio de correa de distribución') returning id into v_serv_correa;
  insert into public.catalogo_servicios (empresa_id, segmento, categoria, servicio) values
    (v_empresa_id, 'Taller Mecánico', 'Suspensión', 'Cambio de amortiguadores delanteros') returning id into v_serv_amortiguador;
  insert into public.catalogo_servicios (empresa_id, segmento, categoria, servicio) values
    (v_empresa_id, 'Servicio Rápido', 'Mantención', 'Cambio de aceite y filtro') returning id into v_serv_aceite;
  insert into public.catalogo_servicios (empresa_id, segmento, categoria, servicio) values
    (v_empresa_id, 'Servicio Rápido', 'Alineación', 'Alineación y balanceo') returning id into v_serv_alineacion;
  insert into public.catalogo_servicios (empresa_id, segmento, categoria, servicio) values
    (v_empresa_id, 'DyP', 'Limpieza', 'Lavado y encerado completo') returning id into v_serv_lavado;
  insert into public.catalogo_servicios (empresa_id, segmento, categoria, servicio) values
    (v_empresa_id, 'DyP', 'Desabolladura y Pintura', 'Pulido y pintura de parachoques') returning id into v_serv_pintura;

  insert into public.catalogo_servicio_precios (servicio_id, valor_mo, horas_mo) values (v_serv_pastillas, 45000, 1);
  insert into public.catalogo_servicio_precios (servicio_id, valor_mo, horas_mo) values (v_serv_correa, 120000, 3);
  insert into public.catalogo_servicio_precios (servicio_id, valor_mo, horas_mo) values (v_serv_amortiguador, 95000, 2);
  insert into public.catalogo_servicio_precios (servicio_id, tipo_vehiculo, combustible, valor_mo, horas_mo, insumos_clp) values (v_serv_aceite, null, 'bencina', 25000, 1, 20000);
  insert into public.catalogo_servicio_precios (servicio_id, tipo_vehiculo, combustible, valor_mo, horas_mo, insumos_clp) values (v_serv_aceite, null, 'diesel', 32000, 1, 28000);
  insert into public.catalogo_servicio_precios (servicio_id, valor_mo, horas_mo) values (v_serv_alineacion, 18000, 1);
  insert into public.catalogo_servicio_precios (servicio_id, valor_mo, horas_mo) values (v_serv_lavado, 15000, 1);
  insert into public.catalogo_servicio_precios (servicio_id, valor_mo, horas_mo) values (v_serv_pintura, 85000, 4);

  insert into public.catalogo_repuestos (empresa_id, nombre) values (v_empresa_id, 'Pastillas de freno delanteras') returning id into v_rep_pastillas;
  insert into public.catalogo_repuestos (empresa_id, nombre) values (v_empresa_id, 'Correa de distribución') returning id into v_rep_correa;
  insert into public.catalogo_repuestos (empresa_id, nombre) values (v_empresa_id, 'Amortiguador delantero') returning id into v_rep_amortiguador;
  insert into public.catalogo_repuestos (empresa_id, nombre) values (v_empresa_id, 'Filtro de aceite') returning id into v_rep_filtro;

  insert into public.catalogo_servicio_repuestos (servicio_id, repuesto_id) values
    (v_serv_pastillas, v_rep_pastillas), (v_serv_correa, v_rep_correa),
    (v_serv_amortiguador, v_rep_amortiguador), (v_serv_aceite, v_rep_filtro);

  insert into public.radar_checklist_items (empresa_id, area, item, orden) values
    (v_empresa_id, 'Tren delantero', 'Estado de neumáticos delanteros', 1),
    (v_empresa_id, 'Tren delantero', 'Amortiguadores delanteros', 2),
    (v_empresa_id, 'Tren delantero', 'Discos y pastillas de freno', 3),
    (v_empresa_id, 'Tren trasero', 'Estado de neumáticos traseros', 4),
    (v_empresa_id, 'Tren trasero', 'Amortiguadores traseros', 5),
    (v_empresa_id, 'Luces', 'Luces delanteras', 6),
    (v_empresa_id, 'Luces', 'Luces traseras y freno', 7),
    (v_empresa_id, 'Interior', 'Aire acondicionado', 8),
    (v_empresa_id, 'Compartimiento motor', 'Nivel de aceite motor', 9),
    (v_empresa_id, 'Compartimiento motor', 'Correas y mangueras', 10);

  -- ---------------------------------------------------------------------
  -- Clientes y vehículos (ficticios).
  -- ---------------------------------------------------------------------
  insert into public.clientes (empresa_id, tipo, nombre, apellido, telefono, email) values (v_empresa_id, 'persona', 'Carla', 'Reyes Muñoz', '+56912345001', 'carla.reyes@example.com') returning id into v_cli1;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI01', 'Toyota', 'Yaris', 2019, 'Blanco', 48000, 'bencina', 'sedan') returning id into v_veh1;
  insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_cli1, v_veh1);

  insert into public.clientes (empresa_id, tipo, nombre, apellido, telefono, email) values (v_empresa_id, 'persona', 'Francisco', 'Soto Vidal', '+56912345002', 'francisco.soto@example.com') returning id into v_cli2;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI02', 'Toyota', 'Hilux', 2021, 'Gris', 32000, 'diesel', 'pickup') returning id into v_veh2;
  insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_cli2, v_veh2);

  insert into public.clientes (empresa_id, tipo, nombre, apellido, telefono, email) values (v_empresa_id, 'persona', 'María José', 'Contreras Paz', '+56912345003', 'mj.contreras@example.com') returning id into v_cli3;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI03', 'Chevrolet', 'Spark', 2018, 'Rojo', 61000, 'bencina', 'hatchback') returning id into v_veh3;
  insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_cli3, v_veh3);

  insert into public.clientes (empresa_id, tipo, nombre, apellido, telefono, email) values (v_empresa_id, 'persona', 'Rodrigo', 'Fuentes Álvarez', '+56912345004', 'rodrigo.fuentes@example.com') returning id into v_cli4;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI04', 'Nissan', 'Navara', 2020, 'Negro', 41000, 'diesel', 'pickup') returning id into v_veh4;
  insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_cli4, v_veh4);

  insert into public.clientes (empresa_id, tipo, nombre, razon_social, telefono, email) values (v_empresa_id, 'empresa', 'Marcelo Ortiz (contacto)', 'Transportes Litoral SpA', '+56912345005', 'contacto@translitoral.example.com') returning id into v_cli5;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI05', 'Hyundai', 'H1', 2017, 'Blanco', 98000, 'diesel', 'furgon') returning id into v_veh5a;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI06', 'Kia', 'Bongo', 2016, 'Blanco', 112000, 'diesel', 'furgon') returning id into v_veh5b;
  insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_cli5, v_veh5a), (v_cli5, v_veh5b);

  insert into public.clientes (empresa_id, tipo, nombre, apellido, telefono, email) values (v_empresa_id, 'persona', 'Javiera', 'Morales Pino', '+56912345006', 'javiera.morales@example.com') returning id into v_cli6;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI07', 'Suzuki', 'Swift', 2020, 'Azul', 25000, 'bencina', 'hatchback') returning id into v_veh6;
  insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_cli6, v_veh6);

  insert into public.clientes (empresa_id, tipo, nombre, razon_social, telefono, email) values (v_empresa_id, 'empresa', 'Ignacio Prat (contacto)', 'Constructora Andes Ltda', '+56912345007', 'contacto@andesconstructora.example.com') returning id into v_cli7;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI08', 'Toyota', 'Hilux', 2019, 'Blanco', 67000, 'diesel', 'pickup') returning id into v_veh7;
  insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_cli7, v_veh7);

  insert into public.clientes (empresa_id, tipo, nombre, apellido, telefono, email) values (v_empresa_id, 'persona', 'Andrés', 'Vergara León', '+56912345008', 'andres.vergara@example.com') returning id into v_cli8;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI09', 'Toyota', 'RAV4', 2022, 'Plata', 15000, 'bencina', 'suv') returning id into v_veh8;
  insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_cli8, v_veh8);

  insert into public.clientes (empresa_id, tipo, nombre, apellido, telefono, email) values (v_empresa_id, 'persona', 'Camila', 'Espinoza Toro', '+56912345009', 'camila.espinoza@example.com') returning id into v_cli9;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI10', 'Mazda', '3', 2021, 'Rojo', 22000, 'bencina', 'sedan') returning id into v_veh9;
  insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_cli9, v_veh9);

  insert into public.clientes (empresa_id, tipo, nombre, apellido, telefono, email) values (v_empresa_id, 'persona', 'Pedro', 'Navarro Bravo', '+56912345010', 'pedro.navarro@example.com') returning id into v_cli10;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI11', 'Ford', 'Ranger', 2018, 'Gris', 78000, 'diesel', 'pickup') returning id into v_veh10;
  insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_cli10, v_veh10);

  insert into public.clientes (empresa_id, tipo, nombre, apellido, telefono, email) values (v_empresa_id, 'persona', 'Valentina', 'Rojas Díaz', '+56912345011', 'valentina.rojas@example.com') returning id into v_cli11;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI12', 'Suzuki', 'Vitara', 2020, 'Blanco', 34000, 'bencina', 'suv') returning id into v_veh11;
  insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_cli11, v_veh11);

  insert into public.clientes (empresa_id, tipo, nombre, apellido, telefono, email) values (v_empresa_id, 'persona', 'Gonzalo', 'Herrera Campos', '+56912345012', 'gonzalo.herrera@example.com') returning id into v_cli12;
  insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria) values (v_empresa_id, 'VPAI13', 'Toyota', 'Corolla', 2017, 'Negro', 89000, 'bencina', 'sedan') returning id into v_veh12;
  insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_cli12, v_veh12);

  -- ---------------------------------------------------------------------
  -- OTs a lo largo de todo el ciclo de vida.
  -- ---------------------------------------------------------------------

  -- OT1: diagnóstico entregado, boleta, encuesta excelente.
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso, fecha_entrega, tipo_documento)
  values (v_empresa_id, v_cli1, v_veh1, 'diagnostico', 'taller_mecanico', 'ingresado', v_usr_asesor, 48000, '1/2', now() - interval '12 days', null, null)
  returning id into v_ot1;
  insert into public.inspecciones_ingreso (trabajo_id, danos_visibles, observaciones) values (v_ot1, 'Rayón leve puerta trasera derecha', 'Cliente reporta ruido al frenar');
  insert into public.radar_inspecciones (trabajo_id, origen, realizado_por, iniciado_en, finalizado_en) values (v_ot1, 'radar_tecnico', v_usr_tecnico, now() - interval '12 days', now() - interval '12 days' + interval '15 minutes') returning id into v_radar1;
  insert into public.radar_hallazgos (radar_inspeccion_id, detalle, area, precio_referencial, urgencia) values (v_radar1, 'Pastillas de freno delanteras al límite', 'repuestos', 45000, 'alta');
  insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id) values (v_ot1, 'Cambio de pastillas de freno delanteras', v_usr_tecnico) returning id into v_tarea_id;
  perform set_config('app.bypass_precio_protegido', 'true', true);
  update public.ot_detalle set precio_unitario = 45000 where tarea_taller_id = v_tarea_id;
  perform set_config('app.bypass_precio_protegido', 'false', true);
  insert into public.presupuestos_taller (trabajo_id, estado, creado_por, fecha_envio, fecha_respuesta) values (v_ot1, 'aceptado', v_usr_asesor, now() - interval '12 days', now() - interval '11 days') returning id into v_presu1;
  update public.ot_detalle set decision = 'aceptado', presupuesto_id = v_presu1 where trabajo_id = v_ot1 and area = 'mano_obra';
  update public.trabajos_taller set estado = 'entregado', fecha_entrega = now() - interval '10 days', tipo_documento = 'boleta', estado_pago = 'pagado', numero_documento_facturacion = 'B-0004821' where id = v_ot1;
  insert into public.egresos_vehiculo (trabajo_id, retirado_por_nombre, comentario, kilometraje_egreso) values (v_ot1, 'Carla Reyes Muñoz', 'Cliente conforme con el trabajo', 48050);
  update public.encuestas set
    calificacion_entrega_tiempo = 5, calificacion_atencion_cliente = 5, calificacion_servicio_mecanico = 5, calificacion_recomendaria = 5,
    como_conocio = 'recomendacion', sugerencia = 'Excelente atención, muy rápidos.', clasificacion = 'excelente', areas_bajas = '{}', respondido_en = now() - interval '9 days'
  where trabajo_id = v_ot1 returning id into v_enc1_id;

  -- OT2: diagnóstico entregado, factura pendiente y VENCIDA (Cuentas por Cobrar), encuesta negativa.
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (v_empresa_id, v_cli2, v_veh2, 'diagnostico', 'taller_mecanico', 'ingresado', v_usr_asesor, 32000, '1/4', now() - interval '20 days')
  returning id into v_ot2;
  insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id) values (v_ot2, 'Cambio de correa de distribución', v_usr_tecnico) returning id into v_tarea_id;
  perform set_config('app.bypass_precio_protegido', 'true', true);
  update public.ot_detalle set precio_unitario = 120000 where tarea_taller_id = v_tarea_id;
  perform set_config('app.bypass_precio_protegido', 'false', true);
  update public.ot_detalle set decision = 'aceptado' where trabajo_id = v_ot2 and area = 'mano_obra';
  update public.trabajos_taller set estado = 'entregado', fecha_entrega = now() - interval '18 days', tipo_documento = 'factura', estado_pago = 'pendiente', fecha_vencimiento_pago = current_date - 3, numero_documento_facturacion = 'F-0001190' where id = v_ot2;
  insert into public.egresos_vehiculo (trabajo_id, retirado_por_nombre, comentario, kilometraje_egreso) values (v_ot2, 'Francisco Soto Vidal', 'Retiro sin observaciones', 32120);
  update public.encuestas set
    calificacion_entrega_tiempo = 3, calificacion_atencion_cliente = 1, calificacion_servicio_mecanico = 4, calificacion_recomendaria = 2,
    como_conocio = 'google', sugerencia = 'El asesor no me devolvió los llamados a tiempo.', clasificacion = 'negativo', areas_bajas = '{atencion_cliente}', respondido_en = now() - interval '16 days', notificado_en = now() - interval '16 days'
  where trabajo_id = v_ot2 returning id into v_enc2_id;
  insert into public.notificaciones (empresa_id, tipo, trabajo_id, encuesta_id, titulo, mensaje, creado_en)
  values (v_empresa_id, 'encuesta_negativa', v_ot2, v_enc2_id, 'Encuesta con calificación negativa', 'Un cliente calificó mal en: atención del asesor.', now() - interval '16 days');

  -- OT3: servicio agendado en ejecución, con un repuesto SIN precio -deja la
  -- notificación real de "repuesto pendiente" para el encargado de
  -- presupuestos, disparada por el trigger de 0033, no insertada a mano.
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (v_empresa_id, v_cli3, v_veh3, 'servicio_agendado', 'servicio_rapido', 'en_ejecucion', v_usr_asesor, 61000, '3/4', now() - interval '2 days')
  returning id into v_ot3;
  insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id) values (v_ot3, 'Cambio de aceite y filtro', v_usr_tecnico) returning id into v_tarea_id;
  perform set_config('app.bypass_precio_protegido', 'true', true);
  update public.ot_detalle set precio_unitario = 25000 where tarea_taller_id = v_tarea_id;
  perform set_config('app.bypass_precio_protegido', 'false', true);
  insert into public.ot_detalle (trabajo_id, area, detalle, cantidad) values (v_ot3, 'repuestos', 'Rótula de dirección izquierda', 1);

  -- OT4: diagnóstico valorizado, presupuesto ENVIADO (dispara notificación real).
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (v_empresa_id, v_cli4, v_veh4, 'diagnostico', 'taller_mecanico', 'valorizado', v_usr_asesor, 41000, '1/2', now() - interval '1 day')
  returning id into v_ot4;
  insert into public.radar_inspecciones (trabajo_id, origen, realizado_por, iniciado_en, finalizado_en) values (v_ot4, 'radar_tecnico', v_usr_tecnico, now() - interval '1 day', now() - interval '1 day' + interval '12 minutes') returning id into v_radar2;
  insert into public.radar_hallazgos (radar_inspeccion_id, detalle, area, precio_referencial, urgencia) values (v_radar2, 'Amortiguadores delanteros con fuga de aceite', 'repuestos', 95000, 'media');
  insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id) values (v_ot4, 'Cambio de amortiguadores delanteros', v_usr_tecnico) returning id into v_tarea_id;
  perform set_config('app.bypass_precio_protegido', 'true', true);
  update public.ot_detalle set precio_unitario = 95000 where tarea_taller_id = v_tarea_id;
  perform set_config('app.bypass_precio_protegido', 'false', true);
  insert into public.presupuestos_taller (trabajo_id, estado, creado_por, fecha_envio) values (v_ot4, 'enviado', v_usr_asesor, now()) returning id into v_presu2;

  -- OT5: (Transportes Litoral) servicio agendado negociado, presupuesto parcial.
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (v_empresa_id, v_cli5, v_veh5a, 'servicio_agendado', 'taller_mecanico', 'negociado', v_usr_asesor, 98000, 'lleno', now() - interval '5 days')
  returning id into v_ot5;
  insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id) values (v_ot5, 'Revisión general de frenos', v_usr_tecnico) returning id into v_tarea_id;
  perform set_config('app.bypass_precio_protegido', 'true', true);
  update public.ot_detalle set precio_unitario = 60000 where tarea_taller_id = v_tarea_id;
  perform set_config('app.bypass_precio_protegido', 'false', true);
  insert into public.presupuestos_taller (trabajo_id, estado, creado_por, fecha_envio, fecha_respuesta, notas) values (v_ot5, 'parcial', v_usr_asesor, now() - interval '4 days', now() - interval '3 days', 'Cliente aprobó solo la revisión de frenos por ahora.') returning id into v_presu3;
  update public.ot_detalle set decision = 'aceptado', presupuesto_id = v_presu3 where trabajo_id = v_ot5 and area = 'mano_obra';

  -- OT6: diagnóstico presentado (RADAR hecho, presupuesto todavía no).
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (v_empresa_id, v_cli6, v_veh6, 'diagnostico', 'servicio_rapido', 'presentado', v_usr_asesor, 25000, '1/2', now())
  returning id into v_ot6;
  insert into public.radar_inspecciones (trabajo_id, origen, realizado_por, iniciado_en, finalizado_en) values (v_ot6, 'radar_tecnico', v_usr_tecnico, now() - interval '2 hours', now() - interval '1 hour') returning id into v_radar3;
  insert into public.radar_hallazgos (radar_inspeccion_id, detalle, area, precio_referencial, urgencia) values
    (v_radar3, 'Alineación desviada, desgaste irregular de neumáticos', 'mano_obra', 18000, 'media'),
    (v_radar3, 'Filtro de aire con exceso de suciedad', 'repuestos', 8000, 'baja');

  -- OT7: (Constructora Andes) servicio agendado entregado, factura pagada.
  -- Mismo motivo que OT10: nace no terminal para que el UPDATE a
  -- "entregado" dispare de verdad los triggers de bloqueo/encuesta.
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (v_empresa_id, v_cli7, v_veh7, 'servicio_agendado', 'taller_mecanico', 'ingresado', v_usr_asesor, 67000, 'lleno', now() - interval '25 days')
  returning id into v_ot7;
  update public.trabajos_taller set estado = 'entregado', fecha_entrega = now() - interval '23 days', tipo_documento = 'factura', estado_pago = 'pagado', numero_documento_facturacion = 'F-0001175' where id = v_ot7;
  insert into public.egresos_vehiculo (trabajo_id, retirado_por_nombre, comentario, kilometraje_egreso) values (v_ot7, 'Ignacio Prat', 'Vehículo de flota, sin observaciones', 67300);

  -- OT8: diagnóstico recién en detección (RADAR en curso, sin hallazgos aún).
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (v_empresa_id, v_cli8, v_veh8, 'diagnostico', 'taller_mecanico', 'en_deteccion', v_usr_asesor, 15000, '3/4', now() - interval '3 hours')
  returning id into v_ot8;
  insert into public.radar_inspecciones (trabajo_id, origen, realizado_por, iniciado_en) values (v_ot8, 'radar_tecnico', v_usr_tecnico, now() - interval '20 minutes');

  -- OT9: servicio agendado recién ingresado, sin nada más todavía.
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (v_empresa_id, v_cli9, v_veh9, 'servicio_agendado', 'servicio_rapido', 'ingresado', v_usr_asesor, 22000, '1/2', now() - interval '30 minutes')
  returning id into v_ot9;

  -- OT10: (Distribuidora, vehículo 12) diagnóstico entregado hace tiempo -para
  -- historial/informes. Nace en un estado no terminal a propósito: el
  -- trigger que agenda la encuesta y el que bloquea la OT solo disparan en
  -- la TRANSICIÓN a "entregado" (AFTER/BEFORE UPDATE), no en un INSERT
  -- directo con ese estado -mismo motivo por el que las OT1/OT2 de arriba
  -- tampoco nacen ya "entregadas"-.
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (v_empresa_id, v_cli12, v_veh12, 'diagnostico', 'dyp', 'ingresado', v_usr_asesor, 89000, 'lleno', now() - interval '40 days')
  returning id into v_ot10;
  insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id) values (v_ot10, 'Pulido y pintura de parachoques', v_usr_detailer) returning id into v_tarea_id;
  perform set_config('app.bypass_precio_protegido', 'true', true);
  update public.ot_detalle set precio_unitario = 85000 where tarea_taller_id = v_tarea_id;
  perform set_config('app.bypass_precio_protegido', 'false', true);
  update public.ot_detalle set decision = 'aceptado' where trabajo_id = v_ot10 and area = 'mano_obra';
  update public.trabajos_taller set estado = 'entregado', fecha_entrega = now() - interval '38 days', tipo_documento = 'boleta', estado_pago = 'pagado', numero_documento_facturacion = 'B-0004790' where id = v_ot10;
  insert into public.egresos_vehiculo (trabajo_id, retirado_por_nombre, kilometraje_egreso) values (v_ot10, 'Gonzalo Herrera Campos', 89060);
  update public.encuestas set
    calificacion_entrega_tiempo = 4, calificacion_atencion_cliente = 4, calificacion_servicio_mecanico = 5, calificacion_recomendaria = 4,
    como_conocio = 'redes_sociales', clasificacion = 'positivo', areas_bajas = '{}', respondido_en = now() - interval '36 days'
  where trabajo_id = v_ot10 returning id into v_enc3_id;

  -- ---------------------------------------------------------------------
  -- Citas de agenda (algunas manuales, una marcada como si viniera del bot).
  -- ---------------------------------------------------------------------
  insert into public.citas (empresa_id, tipo_isla_id, cliente_id, vehiculo_id, fecha, hora, descripcion, estado, creado_por, catalogo_servicio_id, origen)
  values (v_empresa_id, v_isla_rapido, v_cli11, v_veh11, current_date + 1, '10:00', 'Cambio de aceite y filtro', 'agendada', v_usr_recepcion, v_serv_aceite, 'manual');
  insert into public.citas (empresa_id, tipo_isla_id, cliente_id, fecha, hora, descripcion, estado, creado_por, origen)
  values (v_empresa_id, v_isla_taller, v_cli10, current_date + 2, '11:30', 'Revisión de dirección, cliente reporta vibración', 'agendada', null, 'bot_whatsapp');
  insert into public.citas (empresa_id, tipo_isla_id, cliente_id, vehiculo_id, fecha, hora, descripcion, estado, creado_por)
  values (v_empresa_id, v_isla_alineacion, v_cli6, v_veh6, current_date + 1, '09:30', 'Alineación y balanceo', 'confirmada', v_usr_recepcion);
  insert into public.citas (empresa_id, tipo_isla_id, cliente_id, vehiculo_id, fecha, hora, descripcion, estado, creado_por, trabajo_id)
  values (v_empresa_id, v_isla_taller, v_cli9, v_veh9, current_date - 1, '15:00', 'Ingreso agendado', 'completada', v_usr_recepcion, v_ot9);
  insert into public.citas (empresa_id, tipo_isla_id, cliente_id, fecha, hora, descripcion, estado, creado_por)
  values (v_empresa_id, v_isla_pintura, v_cli3, current_date - 2, '16:00', 'Consulta por pintura de techo', 'cancelada', v_usr_recepcion);

  -- ---------------------------------------------------------------------
  -- Bodega: proveedores, productos y algunos movimientos de stock.
  -- ---------------------------------------------------------------------
  insert into public.proveedores (empresa_id, nombre, contacto, telefono) values
    (v_empresa_id, 'Repuestos Central SpA', 'Luis Bravo', '+56222334455'),
    (v_empresa_id, 'Lubricantes del Sur Ltda', 'Marta Soto', '+56222998877');

  insert into public.productos (empresa_id, codigo, nombre, categoria, unidad_medida, stock_minimo) values
    (v_empresa_id, 'REP-001', 'Pastillas de freno delanteras', 'Frenos', 'juego', 4),
    (v_empresa_id, 'REP-002', 'Filtro de aceite', 'Motor', 'unidad', 10),
    (v_empresa_id, 'REP-003', 'Aceite motor 5W-30', 'Lubricantes', 'litro', 20),
    (v_empresa_id, 'REP-004', 'Correa de distribución', 'Motor', 'unidad', 3),
    (v_empresa_id, 'REP-005', 'Amortiguador delantero', 'Suspensión', 'unidad', 2),
    (v_empresa_id, 'REP-006', 'Rótula de dirección', 'Dirección', 'unidad', 4);

  insert into public.movimientos_stock (empresa_id, producto_id, cantidad, costo_unitario, motivo, proveedor_id, referencia)
  select v_empresa_id, p.id, 20, 12000, 'compra', pr.id, 'Factura 8821'
  from public.productos p, public.proveedores pr
  where p.empresa_id = v_empresa_id and p.codigo = 'REP-001' and pr.nombre = 'Repuestos Central SpA';

  insert into public.movimientos_stock (empresa_id, producto_id, cantidad, costo_unitario, motivo, proveedor_id, referencia)
  select v_empresa_id, p.id, 100, 3500, 'compra', pr.id, 'Factura 8822'
  from public.productos p, public.proveedores pr
  where p.empresa_id = v_empresa_id and p.codigo = 'REP-003' and pr.nombre = 'Lubricantes del Sur Ltda';

  insert into public.movimientos_stock (empresa_id, producto_id, cantidad, motivo)
  select v_empresa_id, p.id, -2, 'uso_ot'
  from public.productos p where p.empresa_id = v_empresa_id and p.codigo = 'REP-001';

  -- ---------------------------------------------------------------------
  -- WhatsApp de demostración (cuenta y conversaciones ficticias, sin
  -- conexión real a Meta — solo para que el panel /mensajes se vea usado).
  -- ---------------------------------------------------------------------
  insert into public.whatsapp_cuentas (phone_number_id, empresa_id, waba_id, etiqueta, telefono_visible, es_coexistencia)
  values (v_wa_cuenta, v_empresa_id, '00000demo0waba', 'Recepción', '+56 9 0000 0001', false)
  on conflict (phone_number_id) do nothing;

  insert into public.whatsapp_contactos (empresa_id, phone_number_id, wa_id, nombre_whatsapp, cliente_id, vehiculo_id, estado)
  values (v_empresa_id, v_wa_cuenta, '56912345001', 'Carla Reyes', v_cli1, v_veh1, 'resuelto') returning id into v_wa_contacto1;
  insert into public.whatsapp_contactos (empresa_id, phone_number_id, wa_id, nombre_whatsapp, cliente_id, estado)
  values (v_empresa_id, v_wa_cuenta, '56912345010', 'Pedro Navarro', v_cli10, 'agendado') returning id into v_wa_contacto2;
  insert into public.whatsapp_contactos (empresa_id, phone_number_id, wa_id, nombre_whatsapp, estado)
  values (v_empresa_id, v_wa_cuenta, '56999888777', 'Nuevo contacto', 'nuevo') returning id into v_wa_contacto3;

  insert into public.whatsapp_mensajes (wamid, empresa_id, phone_number_id, wa_id, direccion, origen, tipo_mensaje, contenido, wa_timestamp) values
    ('demo-wamid-0001', v_empresa_id, v_wa_cuenta, '56912345001', 'entrante', 'cloud_api', 'text', '{"text":{"body":"Hola, ¿ya está listo mi auto?"}}', now() - interval '9 days'),
    ('demo-wamid-0002', v_empresa_id, v_wa_cuenta, '56912345001', 'saliente', 'cloud_api', 'text', '{"text":{"body":"Hola Carla, sí, ya está listo. Puedes pasar a retirarlo cuando quieras."}}', now() - interval '9 days' + interval '5 minutes'),
    ('demo-wamid-0003', v_empresa_id, v_wa_cuenta, '56912345001', 'entrante', 'cloud_api', 'text', '{"text":{"body":"Perfecto, paso en la tarde. Gracias!"}}', now() - interval '9 days' + interval '8 minutes'),
    ('demo-wamid-0004', v_empresa_id, v_wa_cuenta, '56912345010', 'entrante', 'cloud_api', 'text', '{"text":{"body":"Buenas, mi camioneta está vibrando al frenar, ¿tienen hora esta semana?"}}', now() - interval '2 hours'),
    ('demo-wamid-0005', v_empresa_id, v_wa_cuenta, '56912345010', 'saliente', 'app_celular', 'text', '{"text":{"body":"Hola Pedro, te puedo agendar para el jueves a las 11:30, ¿te sirve?"}}', now() - interval '1 hour 40 minutes'),
    ('demo-wamid-0006', v_empresa_id, v_wa_cuenta, '56912345010', 'entrante', 'cloud_api', 'text', '{"text":{"body":"Sí, perfecto, gracias"}}', now() - interval '1 hour 30 minutes'),
    ('demo-wamid-0007', v_empresa_id, v_wa_cuenta, '56999888777', 'entrante', 'cloud_api', 'text', '{"text":{"body":"Hola, ¿hacen mantenciones a domicilio?"}}', now() - interval '25 minutes')
  on conflict (wamid) do nothing;

  -- ---------------------------------------------------------------------
  -- Notificaciones adicionales, solo para mostrar los tipos que no salen
  -- solos de los datos de arriba (listo para entrega, compra de
  -- repuestos, desconexión de WhatsApp).
  -- ---------------------------------------------------------------------
  insert into public.notificaciones (empresa_id, tipo, trabajo_id, usuario_destino_id, titulo, mensaje, creado_en) values
    (v_empresa_id, 'listo_para_entrega', v_ot5, v_usr_asesor, 'Vehículo listo para entrega', 'VPAI06 · OT correspondiente quedó listo para entrega. Contacta al cliente y registra el cobro.', now() - interval '2 hours');

  insert into public.notificaciones (empresa_id, tipo, trabajo_id, roles_destino, titulo, mensaje, creado_en) values
    (v_empresa_id, 'compra_reptos_pendiente', v_ot3, array['jefe_taller', 'encargado_presupuestos'], 'Repuestos pendientes de compra', 'VPAI03 quedó en "Compra reptos": faltan repuestos por comprar.', now() - interval '5 hours');

  insert into public.notificaciones (empresa_id, tipo, titulo, mensaje, creado_en) values
    (v_empresa_id, 'whatsapp_desconectado', 'WhatsApp desconectado', 'El número quedó desconectado de la API (demo). Hay que repetir la conexión desde Embedded Signup dentro de las próximas 24 horas.', now() - interval '1 day');

  -- Dos de las citas de arriba nacen ya en un estado terminal (completada/
  -- cancelada) directo en el INSERT -el trigger real trg_notificar_cita_nueva
  -- no distingue eso (dispara en cualquier INSERT, sin WHEN), y el trigger
  -- que la resolvería es de UPDATE, así que nunca corre para estas dos-.
  -- Se limpia acá a mano lo que en producción se resuelve solo con el
  -- tiempo (la próxima vez que alguien actualice esa cita).
  delete from public.notificaciones
  where tipo = 'cita_nueva'
    and cita_id in (select id from public.citas where empresa_id = v_empresa_id and estado in ('completada', 'cancelada', 'no_asistio'));

end $$;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.usuarios where empresa_id = 'b0000000-0000-4000-8000-000000000001') as usuarios_esperado_8,
  (select count(*) from public.clientes where empresa_id = 'b0000000-0000-4000-8000-000000000001') as clientes_esperado_12,
  (select count(*) from public.vehiculos where empresa_id = 'b0000000-0000-4000-8000-000000000001') as vehiculos_esperado_14,
  (select count(*) from public.trabajos_taller where empresa_id = 'b0000000-0000-4000-8000-000000000001') as ot_esperado_10,
  (select count(*) from public.notificaciones where empresa_id = 'b0000000-0000-4000-8000-000000000001') as notificaciones_esperado_mayor_a_0,
  (select count(*) from public.whatsapp_mensajes where empresa_id = 'b0000000-0000-4000-8000-000000000001') as mensajes_wa_esperado_7;
