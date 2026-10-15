-- =============================================================================
-- 0039_datos_demo_ampliados.sql
--
-- Qué resuelve:
--   Amplía el tenant demo (0036) para que cada pantalla de la app
--   tenga datos que mostrar: clientes recurrentes y vehículos, ~30 OT en todos
--   los estados y a lo largo de 6 meses (con presupuestos, rechazos,
--   postergados que alimentan Oportunidades, facturas vencidas, retrabajos,
--   encuestas de distinta calificación y RADAR con checklist), bodega con
--   stock bajo, punto de venta, una agenda densa (pasado y próximos días),
--   conversaciones de WhatsApp en distintos pasos del bot y el plano del
--   taller dibujado con vehículos en sus puestos.
--
--   Todo es ficticio y queda dentro de la empresa demo (empresa_id fijo de
--   0036): no toca ningún otro tenant. Los triggers reales generan las
--   notificaciones (cita nueva, repuesto pendiente) y las encuestas.
--
--   NO es re-ejecutable: si ya corrió, aborta con un mensaje claro en vez de
--   duplicar datos. Para repetirla hay que borrar antes esos datos (ver
--   scripts de limpieza que se entregan aparte).
--
--   REQUIERE 0036 y 0038 ya ejecutadas.
-- =============================================================================

do $$
declare
  emp uuid := 'b0000000-0000-4000-8000-000000000001';
  v_cuenta text := '00000demo0001';

  v_usr_asesor uuid := 'a0000000-0000-4000-8000-000000000003';
  v_usr_jefe uuid := 'a0000000-0000-4000-8000-000000000004';
  v_usr_tecnico uuid := 'a0000000-0000-4000-8000-000000000006';
  v_usr_detailer uuid := 'a0000000-0000-4000-8000-000000000007';
  v_usr_recepcion uuid := 'a0000000-0000-4000-8000-000000000008';

  r record;
  i integer;
  v_c uuid;
  v_v uuid;
  v_clis uuid[];
  v_vehs uuid[];
  v_n integer;
  v_hist uuid[] := array[]::uuid[];
  v_dias date[] := array[]::date[];
  v_pas date[] := array[]::date[];
  v_d date;

  v_k integer;
  v_cli uuid;
  v_veh uuid;
  v_cat text;
  v_tipo text;
  v_ingreso timestamptz;
  v_orig uuid;
  v_ot uuid;
  v_tarea uuid;
  v_det uuid;
  v_pres uuid;
  v_desc text;
  v_precio numeric;
  v_tec uuid;
  v_prod uuid;
  v_hall_area text;
  v_doc text;
  v_pago text;
  v_venc date;
  v_num text;
  v_nombre_cli text;
  v_a integer; v_b integer; v_cc integer; v_dd integer;
  v_areas text[];
  v_clasif text;
  v_parcial boolean;
  v_radar uuid;
  v_venta uuid;
begin
  -- ---------------------------------------------------------------------
  -- Guardas: 0036 ya corrió y esta migración no corrió antes.
  -- ---------------------------------------------------------------------
  if not exists (select 1 from public.empresas where id = emp) then
    raise exception '0039 requiere 0036 (tenant demo). Corre 0036 primero.';
  end if;
  if exists (select 1 from public.vehiculos where empresa_id = emp and patente = 'VPAI20') then
    raise exception '0039 ya fue ejecutada en el tenant demo (existe la patente VPAI20). No se repite para no duplicar datos.';
  end if;

  -- Los precios y costos los protege un trigger; se abre el bypass durante
  -- toda la carga (es local a esta transacción).
  perform set_config('app.bypass_precio_protegido', 'true', true);

  -- ---------------------------------------------------------------------
  -- Técnicos por isla (tabla usuarios_islas, aún usada por la Agenda/ClickUp).
  -- ---------------------------------------------------------------------
  insert into public.usuarios_islas (empresa_id, usuario_id, tipo_isla_id)
  select emp, x.usuario, ti.id
  from (values
    (v_usr_tecnico, 'Taller mecánico'), (v_usr_tecnico, 'Servicio rápido'), (v_usr_tecnico, 'Alineación'),
    (v_usr_jefe, 'Taller mecánico'), (v_usr_detailer, 'Pintura'), (v_usr_detailer, 'Lavado')
  ) as x(usuario, isla)
  join public.tipos_isla ti on ti.empresa_id = emp and ti.nombre = x.isla
  on conflict (usuario_id, tipo_isla_id) do nothing;

  -- ---------------------------------------------------------------------
  -- Clientes y vehículos nuevos (patentes VPAI20 a VPAI29).
  -- ---------------------------------------------------------------------
  select array_agg(cv.cliente_id order by v.patente), array_agg(v.id order by v.patente)
  into v_clis, v_vehs
  from public.vehiculos v
  join public.clientes_vehiculos cv on cv.vehiculo_id = v.id
  where v.empresa_id = emp
    and v.patente in ('VPAI01','VPAI02','VPAI03','VPAI04','VPAI05','VPAI06','VPAI07','VPAI08','VPAI09','VPAI10','VPAI11','VPAI12','VPAI13');

  for r in
    select * from (values
      (1, 'persona', 'Sebastián', 'Muñoz Tapia', null::text, '17456321', 'Chevrolet', 'Sail', 2019, 'Gris', 52000, 'bencina', 'sedan'),
      (2, 'persona', 'Daniela', 'Paredes Oyarzún', null, '18234567', 'Kia', 'Rio 4', 2020, 'Rojo', 38000, 'bencina', 'hatchback'),
      (3, 'empresa', 'Rodolfo Aravena (contacto)', null, 'Comercial Pacífico SpA', '76123456', 'Hyundai', 'Porter', 2018, 'Blanco', 87000, 'diesel', 'furgon'),
      (4, 'persona', 'Patricia', 'Lagos Ibáñez', null, '16987654', 'Nissan', 'Kicks', 2021, 'Naranja', 21000, 'bencina', 'suv'),
      (5, 'persona', 'Ricardo', 'Salinas Campos', null, '14567890', 'Toyota', 'Hilux', 2016, 'Blanco', 118000, 'diesel', 'pickup'),
      (6, 'empresa', 'Natalia Cortés (contacto)', null, 'Inmobiliaria Horizonte Ltda', '77234567', 'Toyota', 'Rush', 2021, 'Azul', 30000, 'bencina', 'suv'),
      (7, 'persona', 'Felipe', 'Araya Núñez', null, '15678901', 'Mazda', 'CX-5', 2019, 'Gris', 72000, 'bencina', 'suv'),
      (8, 'persona', 'Isidora', 'Bravo Sáez', null, '19345678', 'Peugeot', '208', 2022, 'Blanco', 12000, 'bencina', 'hatchback'),
      (9, 'persona', 'Héctor', 'Miranda Leiva', null, '13456789', 'Ford', 'Ranger', 2015, 'Negro', 135000, 'diesel', 'pickup'),
      (10, 'persona', 'Constanza', 'Vidal Pino', null, '18765432', 'Honda', 'CR-V', 2020, 'Plata', 45000, 'bencina', 'suv')
    ) as t(n, tipo, nombre, apellido, razon, cuerpo, marca, modelo, anio, color, km, comb, carro)
  loop
    insert into public.clientes (empresa_id, tipo, nombre, apellido, razon_social, rut, telefono, email)
    values (
      emp, r.tipo, r.nombre, r.apellido, r.razon,
      case when r.n in (3, 6, 9) then null else r.cuerpo || '-' || public.rut_dv_calculado(r.cuerpo) end,
      '+569123450' || lpad((20 + r.n)::text, 2, '0'),
      'cliente' || r.n || '@example.com'
    ) returning id into v_c;
    insert into public.vehiculos (empresa_id, patente, marca, modelo, anio, color, kilometraje, tipo_combustible, tipo_carroceria)
    values (emp, 'VPAI' || (19 + r.n), r.marca, r.modelo, r.anio, r.color, r.km, r.comb, r.carro)
    returning id into v_v;
    insert into public.clientes_vehiculos (cliente_id, vehiculo_id) values (v_c, v_v);
    v_clis := v_clis || v_c;
    v_vehs := v_vehs || v_v;
  end loop;
  v_n := array_length(v_clis, 1);

  -- RUT para varios clientes ya existentes (Informes mide la captura de datos).
  update public.clientes c set rut = x.cuerpo || '-' || public.rut_dv_calculado(x.cuerpo)
  from (values
    ('carla.reyes@example.com', '15234567'), ('francisco.soto@example.com', '16345678'),
    ('mj.contreras@example.com', '17456780'), ('rodrigo.fuentes@example.com', '14678901'),
    ('javiera.morales@example.com', '18901234'), ('andres.vergara@example.com', '13789012')
  ) as x(correo, cuerpo)
  where c.empresa_id = emp and c.email = x.correo and c.rut is null;

  -- ---------------------------------------------------------------------
  -- Bodega: más proveedores y productos, compras con fecha pasada, un ajuste
  -- y una devolución. Varios productos quedan bajo su stock mínimo.
  -- ---------------------------------------------------------------------
  insert into public.proveedores (empresa_id, nombre, contacto, telefono, email) values
    (emp, 'Neumáticos del Pacífico SpA', 'Camila Rivas', '+56222110022', 'ventas@neumaticos.example.com'),
    (emp, 'Frenos y Suspensión Chile', 'Pablo Núñez', '+56222664411', 'contacto@frenos.example.com');

  insert into public.productos (empresa_id, codigo, nombre, categoria, unidad_medida, stock_minimo) values
    (emp, 'REP-007', 'Filtro de aire', 'Motor', 'unidad', 6),
    (emp, 'REP-008', 'Batería 12V 60Ah', 'Eléctrico', 'unidad', 3),
    (emp, 'REP-009', 'Líquido de frenos DOT4', 'Lubricantes', 'litro', 8),
    (emp, 'REP-010', 'Neumático 205/55 R16', 'Neumáticos', 'unidad', 8),
    (emp, 'REP-011', 'Bujías (juego)', 'Motor', 'juego', 4),
    (emp, 'REP-012', 'Aceite 15W-40 diésel', 'Lubricantes', 'litro', 20);

  insert into public.movimientos_stock (empresa_id, producto_id, cantidad, costo_unitario, motivo, proveedor_id, referencia, creado_en)
  select emp, p.id, x.cantidad, x.costo, 'compra', pr.id, x.ref, now() - make_interval(days => x.dias)
  from (values
    ('REP-002', 40, 3200, 'Lubricantes del Sur Ltda', 'Factura 8830', 60),
    ('REP-004', 10, 46000, 'Frenos y Suspensión Chile', 'Factura 3391', 55),
    ('REP-005', 8, 38000, 'Frenos y Suspensión Chile', 'Factura 3392', 55),
    ('REP-006', 3, 17000, 'Repuestos Central SpA', 'Factura 8841', 50),
    ('REP-007', 10, 6500, 'Repuestos Central SpA', 'Factura 8842', 50),
    ('REP-008', 2, 78000, 'Repuestos Central SpA', 'Factura 8843', 45),
    ('REP-009', 5, 5200, 'Lubricantes del Sur Ltda', 'Factura 8850', 40),
    ('REP-010', 6, 52000, 'Neumáticos del Pacífico SpA', 'Factura 7714', 35),
    ('REP-011', 12, 14000, 'Repuestos Central SpA', 'Factura 8861', 30),
    ('REP-012', 60, 3800, 'Lubricantes del Sur Ltda', 'Factura 8862', 30)
  ) as x(codigo, cantidad, costo, proveedor, ref, dias)
  join public.productos p on p.empresa_id = emp and p.codigo = x.codigo
  join public.proveedores pr on pr.empresa_id = emp and pr.nombre = x.proveedor;

  insert into public.movimientos_stock (empresa_id, producto_id, cantidad, motivo, referencia, creado_por, creado_en)
  select emp, p.id, x.cantidad, x.motivo, x.ref, v_usr_jefe, now() - make_interval(days => x.dias)
  from (values
    ('REP-011', -1, 'ajuste', 'Ajuste por conteo físico', 20),
    ('REP-005', 1, 'devolucion', 'Devolución de cliente, repuesto sin usar', 15)
  ) as x(codigo, cantidad, motivo, ref, dias)
  join public.productos p on p.empresa_id = emp and p.codigo = x.codigo;

  -- ---------------------------------------------------------------------
  -- Historial: 24 OT entregadas en los últimos ~6 meses.
  -- ---------------------------------------------------------------------
  for i in 1..24 loop
    v_k := case when i % 3 = 0 then ((i / 3) % 4) + 1 else ((i * 7) % v_n) + 1 end;
    v_cli := v_clis[v_k];
    v_veh := v_vehs[v_k];
    v_cat := (array['taller_mecanico', 'servicio_rapido', 'dyp'])[(i % 3) + 1];
    v_tipo := case when i % 2 = 0 then 'diagnostico' else 'servicio_agendado' end;
    v_ingreso := now() - make_interval(days => 175 - i * 7);
    v_orig := case when i in (14, 21) then v_hist[i - 6] else null end;
    v_prod := null;

    if v_cat = 'taller_mecanico' then
      v_desc := (array['Cambio de pastillas de freno', 'Cambio de correa de distribución', 'Cambio de amortiguadores delanteros', 'Revisión de suspensión y dirección', 'Cambio de kit de embrague'])[((i / 3) % 5) + 1];
      v_precio := (array[45000, 120000, 95000, 38000, 150000])[((i / 3) % 5) + 1];
      v_tec := v_usr_tecnico;
      v_hall_area := 'repuestos';
      select id into v_prod from public.productos
      where empresa_id = emp and codigo = (array['REP-001', 'REP-004', 'REP-005', null, null])[((i / 3) % 5) + 1];
    elsif v_cat = 'servicio_rapido' then
      v_desc := (array['Cambio de aceite y filtro', 'Alineación y balanceo', 'Cambio de filtro de aire'])[((i / 3) % 3) + 1];
      v_precio := (array[25000, 18000, 12000])[((i / 3) % 3) + 1];
      v_tec := v_usr_tecnico;
      v_hall_area := 'mano_obra';
    else
      v_desc := (array['Pulido y pintura de parachoques', 'Lavado y encerado completo', 'Reparación de abolladura en puerta'])[((i / 3) % 3) + 1];
      v_precio := (array[85000, 15000, 60000])[((i / 3) % 3) + 1];
      v_tec := v_usr_detailer;
      v_hall_area := 'mano_obra';
    end if;

    insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso, trabajo_original_id)
    values (emp, v_cli, v_veh, v_tipo, v_cat, 'ingresado', v_usr_asesor, 20000 + i * 3100, (array['1/4', '1/2', '3/4', 'lleno'])[(i % 4) + 1], v_ingreso, v_orig)
    returning id into v_ot;
    v_hist := v_hist || v_ot;

    -- RADAR de los diagnósticos.
    if v_tipo = 'diagnostico' then
      insert into public.radar_inspecciones (trabajo_id, origen, realizado_por, iniciado_en, finalizado_en)
      values (v_ot, 'radar_tecnico', v_usr_tecnico, v_ingreso + interval '30 minutes', v_ingreso + interval '50 minutes')
      returning id into v_radar;
      insert into public.radar_hallazgos (radar_inspeccion_id, detalle, area, precio_referencial, urgencia)
      values (v_radar, v_desc, v_hall_area, v_precio, (array['alta', 'media', 'baja'])[(i % 3) + 1]);
    end if;

    -- Mano de obra principal (y una segunda tarea en algunas OT).
    insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id) values (v_ot, v_desc, v_tec) returning id into v_tarea;
    update public.ot_detalle set precio_unitario = v_precio where tarea_taller_id = v_tarea;
    if i % 4 = 1 then
      insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id) values (v_ot, 'Revisión general y scanner computarizado', v_tec) returning id into v_tarea;
      update public.ot_detalle set precio_unitario = 20000 where tarea_taller_id = v_tarea;
    end if;

    -- Repuesto de catálogo (taller mecánico) o filtro + aceite (servicio rápido).
    if v_prod is not null then
      insert into public.ot_detalle (trabajo_id, area, detalle, cantidad, costo_unitario, precio_unitario, producto_id)
      select v_ot, 'repuestos', p.nombre, 1, p.costo_promedio, round(p.costo_promedio * 1.6), p.id from public.productos p where p.id = v_prod;
    end if;
    if v_cat = 'servicio_rapido' and (i / 3) % 3 = 0 then
      insert into public.ot_detalle (trabajo_id, area, detalle, cantidad, costo_unitario, precio_unitario, producto_id)
      select v_ot, 'repuestos', p.nombre, 1, p.costo_promedio, 9500, p.id from public.productos p where p.empresa_id = emp and p.codigo = 'REP-002';
      insert into public.ot_detalle (trabajo_id, area, detalle, cantidad, costo_unitario, precio_unitario, producto_id)
      select v_ot, 'lubricantes_insumos', p.nombre, 4, p.costo_promedio, 7500, p.id from public.productos p where p.empresa_id = emp and p.codigo = 'REP-003';
    end if;
    -- Lo comprado/entregado por bodega se marca verificado: descuenta stock.
    update public.ot_detalle set verificado = true where trabajo_id = v_ot and producto_id is not null;

    -- Ítem rechazado por el cliente (cada 5 OT) y postergado con fecha (cada 4).
    v_parcial := false;
    if i % 5 = 0 then
      insert into public.ot_detalle (trabajo_id, area, detalle, cantidad, precio_unitario)
      values (v_ot, 'repuestos', 'Juego de neumáticos nuevos', 1, 220000) returning id into v_det;
      update public.ot_detalle set decision = 'rechazado', motivo_rechazo = 'Lo compra por su cuenta en otro lugar' where id = v_det;
      v_parcial := true;
    end if;
    if i % 4 = 2 then
      insert into public.ot_detalle (trabajo_id, area, detalle, cantidad, precio_unitario)
      values (v_ot, 'repuestos', 'Cambio de neumáticos traseros', 1, 180000) returning id into v_det;
      update public.ot_detalle set decision = 'postergado', fecha_postergado = current_date + ((i * 3) % 60) + 5 where id = v_det;
      v_parcial := true;
    end if;
    update public.ot_detalle set decision = 'aceptado' where trabajo_id = v_ot and decision = 'pendiente';

    if v_tipo = 'diagnostico' then
      insert into public.presupuestos_taller (trabajo_id, estado, creado_por, fecha_envio, fecha_respuesta)
      values (v_ot, case when v_parcial then 'parcial' else 'aceptado' end, v_usr_asesor, v_ingreso + interval '3 hours', v_ingreso + interval '1 day')
      returning id into v_pres;
      update public.ot_detalle set presupuesto_id = v_pres where trabajo_id = v_ot;
    end if;

    -- Entrega, documento y pago (las 3 últimas facturas quedan pendientes).
    v_doc := case when i % 3 = 0 then 'factura' else 'boleta' end;
    v_pago := case when v_doc = 'factura' and i >= 18 then 'pendiente' else 'pagado' end;
    v_venc := case when v_pago = 'pendiente' then current_date + (case i when 18 then -12 when 21 then -4 else 12 end) else null end;
    v_num := case when v_doc = 'boleta' then 'B-' || lpad((4830 + i)::text, 7, '0') else 'F-' || lpad((1180 + i)::text, 7, '0') end;
    update public.trabajos_taller
    set estado = 'entregado', fecha_entrega = v_ingreso + interval '2 days', tipo_documento = v_doc,
        estado_pago = v_pago, fecha_vencimiento_pago = v_venc, numero_documento_facturacion = v_num
    where id = v_ot;

    select coalesce(nullif(trim(nombre || ' ' || coalesce(apellido, '')), ''), razon_social) into v_nombre_cli from public.clientes where id = v_cli;
    insert into public.egresos_vehiculo (trabajo_id, retirado_por_nombre, comentario, kilometraje_egreso)
    values (v_ot, v_nombre_cli, case when i % 4 = 0 then 'Cliente pidió revisar la garantía en 30 días' else 'Retiro sin observaciones' end, 20000 + i * 3100 + 40);

    -- Encuesta respondida (las 4 más recientes quedan pendientes de responder).
    if i <= 20 then
      v_a := 3 + (i % 3); v_b := 3 + ((i + 1) % 3); v_cc := 4 + (i % 2); v_dd := 3 + ((i + 2) % 3);
      if i in (5, 13) then v_a := 2; v_b := 1; v_dd := 2; end if;
      v_areas := array[]::text[];
      if v_a <= 2 then v_areas := array_append(v_areas, 'entrega_tiempo'::text); end if;
      if v_b <= 2 then v_areas := array_append(v_areas, 'atencion_cliente'::text); end if;
      if v_cc <= 2 then v_areas := array_append(v_areas, 'servicio_mecanico'::text); end if;
      if v_dd <= 2 then v_areas := array_append(v_areas, 'recomendaria'::text); end if;
      v_clasif := case
        when coalesce(array_length(v_areas, 1), 0) > 0 then 'negativo'
        when (v_a + v_b + v_cc + v_dd) / 4.0 >= 4.5 then 'excelente'
        else 'positivo' end;
      update public.encuestas set
        calificacion_entrega_tiempo = v_a, calificacion_atencion_cliente = v_b, calificacion_servicio_mecanico = v_cc, calificacion_recomendaria = v_dd,
        como_conocio = (array['redes_sociales', 'recomendacion', 'google', 'publicidad', 'pase_por_el_lugar', 'cliente_anterior', 'otro'])[(i % 7) + 1],
        sugerencia = case when v_clasif = 'negativo' then 'Demoraron más de lo prometido y costó conseguir información.'
                          when i % 4 = 0 then 'Muy buen trato, volvería sin dudar.' else null end,
        clasificacion = v_clasif, areas_bajas = v_areas,
        enviado_en = v_ingreso + interval '3 days', respondido_en = v_ingreso + interval '3 days 4 hours'
      where trabajo_id = v_ot;
    end if;

    if i % 5 = 2 then
      insert into public.observaciones_postventa (trabajo_id, autor_id, texto, creado_en)
      values (v_ot, v_usr_asesor, 'Se llamó al cliente para confirmar que el vehículo quedó funcionando bien.', v_ingreso + interval '4 days');
    end if;
  end loop;

  -- Oportunidades: algunas ya gestionadas, el resto pendientes.
  update public.oportunidades set estado = 'contactado', notas = 'Se le escribió por WhatsApp, quedó de confirmar fecha.'
  where id in (select o.id from public.oportunidades o join public.trabajos_taller t on t.id = o.trabajo_id
               where t.empresa_id = emp order by o.creado_en limit 1);
  update public.oportunidades set estado = 'convertido', notas = 'Agendó y se hizo el cambio.'
  where id in (select o.id from public.oportunidades o join public.trabajos_taller t on t.id = o.trabajo_id
               where t.empresa_id = emp and o.estado = 'pendiente' order by o.creado_en limit 1);
  update public.oportunidades set estado = 'descartado', notas = 'Vendió el vehículo.'
  where id in (select o.id from public.oportunidades o join public.trabajos_taller t on t.id = o.trabajo_id
               where t.empresa_id = emp and o.estado = 'pendiente' order by o.creado_en desc limit 1);

  -- ---------------------------------------------------------------------
  -- OT activas nuevas (las que se ven en el plano del taller).
  -- ---------------------------------------------------------------------
  -- N1: lavado en curso.
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (emp, v_clis[17], v_vehs[17], 'servicio_agendado', 'dyp', 'en_ejecucion', v_usr_asesor, 21000, '1/2', now() - interval '50 minutes') returning id into v_ot;
  insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id) values (v_ot, 'Lavado y encerado completo', v_usr_detailer) returning id into v_tarea;
  update public.ot_detalle set precio_unitario = 15000 where tarea_taller_id = v_tarea;

  -- N2: pintura en curso.
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (emp, v_clis[20], v_vehs[20], 'servicio_agendado', 'dyp', 'en_ejecucion', v_usr_asesor, 72000, '1/4', now() - interval '1 day') returning id into v_ot;
  insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id) values (v_ot, 'Pulido y pintura de parachoques', v_usr_detailer) returning id into v_tarea;
  update public.ot_detalle set precio_unitario = 85000 where tarea_taller_id = v_tarea;

  -- N3: servicio rápido en curso, con filtro de bodega todavía sin verificar.
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (emp, v_clis[15], v_vehs[15], 'servicio_agendado', 'servicio_rapido', 'en_ejecucion', v_usr_asesor, 38000, '3/4', now() - interval '25 minutes') returning id into v_ot;
  insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id) values (v_ot, 'Cambio de aceite y filtro', v_usr_tecnico) returning id into v_tarea;
  update public.ot_detalle set precio_unitario = 25000 where tarea_taller_id = v_tarea;
  insert into public.ot_detalle (trabajo_id, area, detalle, cantidad, costo_unitario, precio_unitario, producto_id)
  select v_ot, 'repuestos', p.nombre, 1, p.costo_promedio, 9500, p.id from public.productos p where p.empresa_id = emp and p.codigo = 'REP-002';

  -- N4: diagnóstico con RADAR en curso, sobre el pozo.
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (emp, v_clis[22], v_vehs[22], 'diagnostico', 'taller_mecanico', 'en_deteccion', v_usr_asesor, 135000, 'lleno', now() - interval '2 hours') returning id into v_ot;
  insert into public.radar_inspecciones (trabajo_id, origen, realizado_por, iniciado_en) values (v_ot, 'radar_tecnico', v_usr_tecnico, now() - interval '15 minutes');

  -- N5: valorizado con un repuesto SIN precio: el trigger real notifica al
  -- encargado de presupuestos. Queda sin puesto asignado.
  insert into public.trabajos_taller (empresa_id, cliente_id, vehiculo_id, tipo_ingreso, categoria_servicio, estado, asesor_id, kilometraje_ingreso, nivel_combustible, fecha_ingreso)
  values (emp, v_clis[23], v_vehs[23], 'diagnostico', 'taller_mecanico', 'valorizado', v_usr_asesor, 45000, '1/2', now() - interval '3 hours') returning id into v_ot;
  insert into public.tareas_taller (trabajo_id, descripcion, tecnico_id) values (v_ot, 'Cambio de kit de embrague', v_usr_tecnico) returning id into v_tarea;
  update public.ot_detalle set precio_unitario = 150000 where tarea_taller_id = v_tarea;
  insert into public.ot_detalle (trabajo_id, area, detalle, cantidad) values (v_ot, 'repuestos', 'Kit de embrague completo', 1);

  -- Estado de ClickUp de todas las OT activas y, en un UPDATE aparte, el tiempo
  -- que llevan en él: el trigger marcar_cambio_estado_trabajo (0017) reinicia
  -- estado_cambiado_en cada vez que cambia clickup_estado_actual, así que si se
  -- cambian ambos en el mismo UPDATE el tiempo siempre queda en "0 min".
  update public.trabajos_taller t
  set clickup_estado_actual = x.estado
  from (values
    ('VPAI03', 'en reparación', 95), ('VPAI04', 'espera reptos (cliente)', 300), ('VPAI05', 'compra reptos (victor)', 1500), ('VPAI07', 'alineacion', 45), ('VPAI09', 'por designar', 20), ('VPAI10', 'por designar', 30), ('VPAI23', 'lavado', 50), ('VPAI26', 'pintura/desabolladura', 1400), ('VPAI21', 'en reparación', 25), ('VPAI28', 'prueba en ruta', 15), ('VPAI29', 'espera reptos (cliente)', 170)
  ) as x(patente, estado, mins)
  where t.empresa_id = emp and t.estado not in ('entregado', 'anulado')
    and t.vehiculo_id = (select id from public.vehiculos where empresa_id = emp and patente = x.patente);

  update public.trabajos_taller t
  set estado_cambiado_en = now() - make_interval(mins => x.mins)
  from (values
    ('VPAI03', 'en reparación', 95), ('VPAI04', 'espera reptos (cliente)', 300), ('VPAI05', 'compra reptos (victor)', 1500), ('VPAI07', 'alineacion', 45), ('VPAI09', 'por designar', 20), ('VPAI10', 'por designar', 30), ('VPAI23', 'lavado', 50), ('VPAI26', 'pintura/desabolladura', 1400), ('VPAI21', 'en reparación', 25), ('VPAI28', 'prueba en ruta', 15), ('VPAI29', 'espera reptos (cliente)', 170)
  ) as x(patente, estado, mins)
  where t.empresa_id = emp and t.estado not in ('entregado', 'anulado')
    and t.vehiculo_id = (select id from public.vehiculos where empresa_id = emp and patente = x.patente);

  -- ---------------------------------------------------------------------
  -- RADAR: checklist guiado para todas las inspecciones ya finalizadas.
  -- ---------------------------------------------------------------------
  insert into public.radar_checklist_respuestas (radar_inspeccion_id, checklist_item_id, estado, nota)
  select ri.id, it.id,
    case when it.orden % 4 = 0 then 'atencion' when it.orden = 10 then 'no_aplica' else 'bien' end,
    case when it.orden % 4 = 0 then 'Revisar en la próxima visita' else null end
  from public.radar_inspecciones ri
  join public.trabajos_taller t on t.id = ri.trabajo_id and t.empresa_id = emp
  join public.radar_checklist_items it on it.empresa_id = emp
  where ri.finalizado_en is not null
  on conflict (radar_inspeccion_id, checklist_item_id) do nothing;

  -- ---------------------------------------------------------------------
  -- Punto de venta: 5 ventas cerradas y 1 abierta (descuentan stock solas).
  -- ---------------------------------------------------------------------
  for r in
    select * from (values
      (1, 14, 30, 'B-0005101'),
      (2, 0, 22, 'B-0005102'),
      (3, 3, 14, 'B-0005103'),
      (4, 7, 9, 'B-0005104'),
      (5, 0, 4, 'B-0005105')
    ) as t(n, cli, dias, doc)
  loop
    insert into public.ventas_directas (empresa_id, cliente_id, estado, creado_por, creado_en)
    values (emp, case when r.cli = 0 then null else v_clis[r.cli] end, 'abierta', v_usr_asesor, now() - make_interval(days => r.dias))
    returning id into v_venta;
    if r.n = 1 then
      insert into public.ventas_directas_detalle (venta_id, tipo, producto_id, detalle, cantidad, precio_unitario)
      select v_venta, 'producto', p.id, p.nombre, 4, 6900 from public.productos p where p.empresa_id = emp and p.codigo = 'REP-003';
      insert into public.ventas_directas_detalle (venta_id, tipo, detalle, cantidad, precio_unitario) values (v_venta, 'servicio', 'Mano de obra cambio de aceite', 1, 15000);
    elsif r.n = 2 then
      insert into public.ventas_directas_detalle (venta_id, tipo, producto_id, detalle, cantidad, precio_unitario)
      select v_venta, 'producto', p.id, p.nombre, 1, 9500 from public.productos p where p.empresa_id = emp and p.codigo = 'REP-009';
    elsif r.n = 3 then
      insert into public.ventas_directas_detalle (venta_id, tipo, producto_id, detalle, cantidad, precio_unitario)
      select v_venta, 'producto', p.id, p.nombre, 1, 129000 from public.productos p where p.empresa_id = emp and p.codigo = 'REP-008';
      insert into public.ventas_directas_detalle (venta_id, tipo, detalle, cantidad, precio_unitario) values (v_venta, 'servicio', 'Instalación de batería', 1, 8000);
    elsif r.n = 4 then
      insert into public.ventas_directas_detalle (venta_id, tipo, producto_id, detalle, cantidad, precio_unitario)
      select v_venta, 'producto', p.id, p.nombre, 1, 26000 from public.productos p where p.empresa_id = emp and p.codigo = 'REP-011';
      insert into public.ventas_directas_detalle (venta_id, tipo, detalle, cantidad, precio_unitario) values (v_venta, 'servicio', 'Cambio de bujías', 1, 25000);
    else
      insert into public.ventas_directas_detalle (venta_id, tipo, producto_id, detalle, cantidad, precio_unitario)
      select v_venta, 'producto', p.id, p.nombre, 2, 11000 from public.productos p where p.empresa_id = emp and p.codigo = 'REP-007';
    end if;
    update public.ventas_directas
    set estado = 'cerrada', numero_documento_facturacion = r.doc, cerrada_en = creado_en + interval '20 minutes'
    where id = v_venta;
  end loop;

  insert into public.ventas_directas (empresa_id, cliente_id, estado, creado_por) values (emp, v_clis[19], 'abierta', v_usr_asesor) returning id into v_venta;
  insert into public.ventas_directas_detalle (venta_id, tipo, producto_id, detalle, cantidad, precio_unitario)
  select v_venta, 'producto', p.id, p.nombre, 2, 89000 from public.productos p where p.empresa_id = emp and p.codigo = 'REP-010';
  insert into public.ventas_directas_detalle (venta_id, tipo, detalle, cantidad, precio_unitario) values (v_venta, 'servicio', 'Montaje y balanceo', 2, 6000);

  -- ---------------------------------------------------------------------
  -- Agenda: próximos 7 días hábiles y últimos 3 (domingo cerrado). Respeta
  -- la capacidad de cada isla; el corte 13:00-15:00 solo lo usa servicio rápido.
  -- ---------------------------------------------------------------------
  v_d := current_date + 1;
  while coalesce(array_length(v_dias, 1), 0) < 7 loop
    if extract(dow from v_d) <> 0 then v_dias := v_dias || v_d; end if;
    v_d := v_d + 1;
  end loop;
  v_d := current_date - 1;
  while coalesce(array_length(v_pas, 1), 0) < 3 loop
    if extract(dow from v_d) <> 0 then v_pas := v_pas || v_d; end if;
    v_d := v_d - 1;
  end loop;

  for r in
    select * from (values
      (2, '09:00', 'Servicio rápido', 14, 'Cambio de aceite y filtro', 'confirmada', 'manual', 60, 'Cambio de aceite y filtro'),
      (2, '09:00', 'Servicio rápido', 15, 'Cambio de aceite y filtro', 'agendada', 'manual', 60, 'Cambio de aceite y filtro'),
      (2, '10:00', 'Taller mecánico', 16, 'Cambio de pastillas delanteras', 'agendada', 'bot_whatsapp', 60, 'Cambio de pastillas delanteras'),
      (2, '10:00', 'Taller mecánico', 18, 'Ruido en la suspensión, requiere diagnóstico', 'agendada', 'manual', 120, null),
      (2, '11:30', 'Alineación', 19, 'Alineación y balanceo', 'agendada', 'manual', 60, 'Alineación y balanceo'),
      (3, '09:30', 'Taller mecánico', 1, 'Cambio de correa de distribución', 'confirmada', 'manual', 180, 'Cambio de correa de distribución'),
      (3, '14:00', 'Servicio rápido', 8, 'Cambio de aceite y filtro', 'agendada', 'manual', 60, 'Cambio de aceite y filtro'),
      (4, '09:00', 'Pintura', 20, 'Pulido y pintura de parachoques', 'agendada', 'manual', 240, 'Pulido y pintura de parachoques'),
      (4, '10:00', 'Lavado', 21, 'Lavado y encerado completo', 'agendada', 'bot_whatsapp', 60, 'Lavado y encerado completo'),
      (4, '15:30', 'Taller mecánico', 12, 'Revisión pre-viaje', 'agendada', 'manual', 60, null),
      (5, '09:00', 'Alineación', 11, 'Alineación y balanceo', 'agendada', 'manual', 60, 'Alineación y balanceo'),
      (5, '11:00', 'Taller mecánico', 4, 'Cambio de amortiguadores delanteros', 'confirmada', 'manual', 120, 'Cambio de amortiguadores delanteros'),
      (6, '09:30', 'Servicio rápido', 9, 'Cambio de aceite y filtro', 'agendada', 'bot_whatsapp', 60, 'Cambio de aceite y filtro'),
      (7, '10:00', 'Taller mecánico', 13, 'Mantención de 60.000 km', 'agendada', 'manual', 180, null),
      (-1, '10:00', 'Taller mecánico', 2, 'Cambio de correa de distribución', 'completada', 'manual', 180, 'Cambio de correa de distribución'),
      (-1, '11:00', 'Servicio rápido', 17, 'Cambio de aceite y filtro', 'no_asistio', 'manual', 60, 'Cambio de aceite y filtro'),
      (-2, '09:30', 'Alineación', 7, 'Alineación y balanceo', 'completada', 'manual', 60, 'Alineación y balanceo'),
      (-2, '15:30', 'Taller mecánico', 10, 'Revisión de frenos', 'cancelada', 'manual', 60, null),
      (-3, '10:00', 'Lavado', 5, 'Lavado y encerado completo', 'completada', 'bot_whatsapp', 60, 'Lavado y encerado completo')
    ) as t(dia, hora, isla, cli, descr, est, org, dur, serv)
  loop
    insert into public.citas (empresa_id, tipo_isla_id, cliente_id, vehiculo_id, fecha, hora, descripcion, estado, creado_por, catalogo_servicio_id, origen, duracion_estimada_minutos)
    values (
      emp,
      (select id from public.tipos_isla where empresa_id = emp and nombre = r.isla),
      v_clis[r.cli], v_vehs[r.cli],
      case when r.dia > 0 then v_dias[r.dia] else v_pas[-r.dia] end,
      r.hora::time, r.descr, r.est,
      case when r.org = 'bot_whatsapp' then null else v_usr_recepcion end,
      (select id from public.catalogo_servicios where empresa_id = emp and servicio = r.serv),
      r.org, r.dur
    );
  end loop;

  -- El trigger de "cita nueva" avisa en cualquier INSERT, incluso de citas ya
  -- terminadas: se limpian las de estado terminal (mismo criterio que 0036).
  delete from public.notificaciones
  where empresa_id = emp and tipo = 'cita_nueva'
    and cita_id in (select id from public.citas where empresa_id = emp and estado in ('completada', 'cancelada', 'no_asistio'));

  -- Un par de notificaciones ya leídas por el asesor.
  insert into public.notificaciones_lecturas (notificacion_id, usuario_id)
  select n.id, v_usr_asesor from public.notificaciones n
  where n.empresa_id = emp and n.tipo = 'cita_nueva'
  order by n.creado_en limit 2
  on conflict (notificacion_id, usuario_id) do nothing;

  -- ---------------------------------------------------------------------
  -- WhatsApp: conversaciones en distintos pasos del bot y estados de Recepción.
  -- ---------------------------------------------------------------------
  insert into public.whatsapp_contactos (empresa_id, phone_number_id, wa_id, nombre_whatsapp, cliente_id, vehiculo_id, estado, bot_estado, bot_contexto, bot_pausado)
  values
    (emp, v_cuenta, '56912345021', 'Sebastián M.', v_clis[14], v_vehs[14], 'en_conversacion', 'elige_horario', '{"segmento": "Servicio Rápido", "categoria": "Mantención", "servicio": "Cambio de aceite y filtro"}', false),
    (emp, v_cuenta, '56912345022', 'Dani Paredes', v_clis[15], v_vehs[15], 'en_conversacion', 'elige_categoria', '{"segmento": "Taller Mecánico"}', false),
    (emp, v_cuenta, '56912345023', 'Comercial Pacífico', v_clis[16], v_vehs[16], 'agendado', null, null, false),
    (emp, v_cuenta, '56912345024', 'Patricia L.', v_clis[17], v_vehs[17], 'en_conversacion', null, null, true),
    (emp, v_cuenta, '56912345025', 'Ricardo S.', v_clis[18], v_vehs[18], 'sin_interes', null, null, false),
    (emp, v_cuenta, '56999111222', 'Contacto nuevo', null, null, 'nuevo', 'saludo', null, false),
    (emp, v_cuenta, '56912345026', 'Inmobiliaria Horizonte', v_clis[19], v_vehs[19], 'resuelto', null, null, false);

  insert into public.whatsapp_mensajes (wamid, empresa_id, phone_number_id, wa_id, direccion, origen, tipo_mensaje, contenido, wa_timestamp)
  select x.wamid, emp, v_cuenta, x.wa, x.dir, x.org, 'text', jsonb_build_object('text', jsonb_build_object('body', x.texto)), now() - make_interval(mins => x.mins)
  from (values
    -- Sebastián: bot llegó a ofrecer horarios.
    ('demo-wamid-1001', '56912345021', 'entrante', 'cloud_api', 'Hola, quiero cambiar el aceite de mi auto', 46),
    ('demo-wamid-1002', '56912345021', 'saliente', 'cloud_api', E'Hola! Soy el asistente del taller. Que tipo de servicio necesitas?\n1. Taller mecánico\n2. Servicio rápido\n3. Desabolladura y pintura\n(escribe "menu" para volver al inicio)', 46),
    ('demo-wamid-1003', '56912345021', 'entrante', 'cloud_api', '2', 45),
    ('demo-wamid-1004', '56912345021', 'saliente', 'cloud_api', E'Servicio rápido. Elige una categoría:\n1. Mantención\n2. Alineación', 45),
    ('demo-wamid-1005', '56912345021', 'entrante', 'cloud_api', '1', 44),
    ('demo-wamid-1006', '56912345021', 'saliente', 'cloud_api', E'Mantención. Elige el servicio:\n1. Cambio de aceite y filtro', 44),
    ('demo-wamid-1007', '56912345021', 'entrante', 'cloud_api', '1', 43),
    ('demo-wamid-1008', '56912345021', 'saliente', 'cloud_api', E'Estos son los próximos horarios disponibles:\n1. Mañana 09:00\n2. Mañana 10:00\n3. Mañana 11:00\nResponde con el número que prefieras.', 43),
    -- Dani: eligiendo categoría.
    ('demo-wamid-1011', '56912345022', 'entrante', 'cloud_api', 'Buenas, necesito revisar los frenos', 12),
    ('demo-wamid-1012', '56912345022', 'saliente', 'cloud_api', E'Hola! Soy el asistente del taller. Que tipo de servicio necesitas?\n1. Taller mecánico\n2. Servicio rápido\n3. Desabolladura y pintura', 12),
    ('demo-wamid-1013', '56912345022', 'entrante', 'cloud_api', '1', 11),
    ('demo-wamid-1014', '56912345022', 'saliente', 'cloud_api', E'Taller mecánico. Elige una categoría:\n1. Frenos\n2. Motor\n3. Suspensión', 11),
    -- Comercial Pacífico: agendado por el bot.
    ('demo-wamid-1021', '56912345023', 'entrante', 'cloud_api', 'Necesito hora para el cambio de amortiguadores de la camioneta', 1500),
    ('demo-wamid-1022', '56912345023', 'saliente', 'cloud_api', E'Listo! Tu hora quedó agendada para el jueves a las 10:00 en Taller mecánico. Te esperamos.', 1490),
    ('demo-wamid-1023', '56912345023', 'entrante', 'cloud_api', 'Perfecto, muchas gracias', 1485),
    -- Patricia: un humano tomó la conversación (bot en pausa).
    ('demo-wamid-1031', '56912345024', 'entrante', 'cloud_api', 'Hola, mi auto hace un ruido raro al doblar', 300),
    ('demo-wamid-1032', '56912345024', 'saliente', 'app_celular', 'Hola Patricia, soy Rocío de Recepción. Puedes traerlo hoy y lo revisamos sin costo.', 290),
    ('demo-wamid-1033', '56912345024', 'entrante', 'cloud_api', 'Genial, voy en la tarde', 280),
    -- Ricardo: sin interés.
    ('demo-wamid-1041', '56912345025', 'entrante', 'cloud_api', 'Cuanto cuesta el cambio de embrague de una Hilux?', 4300),
    ('demo-wamid-1042', '56912345025', 'saliente', 'app_celular', 'Hola Ricardo, depende del diagnóstico; el valor referencial parte en 150.000 mano de obra.', 4290),
    ('demo-wamid-1043', '56912345025', 'entrante', 'cloud_api', 'Uf, es más de lo que esperaba. Lo voy a pensar, gracias', 4280),
    -- Contacto nuevo sin cliente.
    ('demo-wamid-1051', '56999111222', 'entrante', 'cloud_api', 'Buenas tardes, trabajan con seguros?', 8),
    -- Inmobiliaria: resuelto.
    ('demo-wamid-1061', '56912345026', 'entrante', 'cloud_api', 'Hola, ya está listo el vehículo?', 2900),
    ('demo-wamid-1062', '56912345026', 'saliente', 'app_celular', 'Hola! Sí, ya está listo. Te enviamos el detalle del cobro por correo.', 2890),
    ('demo-wamid-1063', '56912345026', 'entrante', 'cloud_api', 'Recibido, pasamos mañana a retirarlo', 2880)
  ) as x(wamid, wa, dir, org, texto, mins);

  -- ---------------------------------------------------------------------
  -- Plano del taller (0038): mismo dibujo que el plano de ejemplo de la app.
  -- La capacidad de cada isla coincide con la de 0036, así que la Agenda no cambia.
  -- ---------------------------------------------------------------------
  insert into public.plano_elementos (empresa_id, tipo, nombre, x, y, ancho, alto, capacidad_vehiculos, tipo_isla_id, tecnico_id)
  select emp, x.tipo, x.nombre, x.px, x.py, x.ancho, x.alto, x.cap, ti.id, x.tecnico
  from (values
    ('oficina', 'Recepción', 0, 0, 6, 4, 1, null::text, null::uuid),
    ('oficina', 'Jefe de taller', 6, 0, 5, 4, 1, null, null),
    ('oficina', 'Bodega y repuestos', 11, 0, 6, 4, 1, null, null),
    ('isla_elevador', 'Elevador 1', 0, 6, 3, 5, 1, 'Taller mecánico', v_usr_tecnico),
    ('isla_elevador', 'Elevador 2', 4, 6, 3, 5, 1, 'Taller mecánico', v_usr_tecnico),
    ('isla_elevador', 'Elevador 3', 8, 6, 3, 5, 1, 'Taller mecánico', null),
    ('isla_pozo', 'Pozo 1', 12, 6, 3, 5, 1, 'Taller mecánico', v_usr_jefe),
    ('alineadora', 'Alineadora', 16, 6, 3, 6, 1, 'Alineación', v_usr_tecnico),
    ('vulcanizacion', 'Vulcanización', 20, 6, 3, 4, 1, null, null),
    ('isla_simple', 'Servicio rápido 1', 24, 6, 3, 5, 1, 'Servicio rápido', null),
    ('isla_simple', 'Servicio rápido 2', 28, 6, 3, 5, 1, 'Servicio rápido', null),
    ('desabolladura_pintura', 'Pintura', 0, 14, 4, 6, 1, 'Pintura', v_usr_detailer),
    ('lavado', 'Lavado', 5, 14, 3, 5, 1, 'Lavado', v_usr_detailer),
    ('pulmon', 'Pulmón', 9, 14, 6, 5, 4, null, null)
  ) as x(tipo, nombre, px, py, ancho, alto, cap, isla, tecnico)
  left join public.tipos_isla ti on ti.empresa_id = emp and ti.nombre = x.isla;

  insert into public.plano_ocupacion (empresa_id, elemento_id, trabajo_id, desde)
  select emp, pe.id, t.id, now() - make_interval(mins => x.mins)
  from (values
    ('VPAI03', 'Servicio rápido 1', 95), ('VPAI04', 'Elevador 1', 300), ('VPAI05', 'Elevador 2', 1500),
    ('VPAI09', 'Elevador 3', 20), ('VPAI07', 'Alineadora', 45), ('VPAI10', 'Pulmón', 30),
    ('VPAI23', 'Lavado', 50), ('VPAI26', 'Pintura', 1400), ('VPAI21', 'Servicio rápido 2', 25), ('VPAI28', 'Pozo 1', 15)
  ) as x(patente, puesto, mins)
  join public.plano_elementos pe on pe.empresa_id = emp and pe.nombre = x.puesto
  join public.vehiculos vh on vh.empresa_id = emp and vh.patente = x.patente
  join lateral (
    select tt.id from public.trabajos_taller tt
    where tt.vehiculo_id = vh.id and tt.estado not in ('entregado', 'anulado')
    order by tt.creado_en desc limit 1
  ) t on true;

  perform set_config('app.bypass_precio_protegido', 'false', true);
end $$;

-- ---------------------------------------------------------------------------
-- Verificación.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.clientes where empresa_id = 'b0000000-0000-4000-8000-000000000001') as clientes_esperado_22,
  (select count(*) from public.vehiculos where empresa_id = 'b0000000-0000-4000-8000-000000000001') as vehiculos_esperado_23,
  (select count(*) from public.trabajos_taller where empresa_id = 'b0000000-0000-4000-8000-000000000001') as ot_esperado_39,
  (select count(*) from public.trabajos_taller where empresa_id = 'b0000000-0000-4000-8000-000000000001' and estado = 'entregado') as ot_entregadas_esperado_28,
  (select count(*) from public.encuestas e join public.trabajos_taller t on t.id = e.trabajo_id where t.empresa_id = 'b0000000-0000-4000-8000-000000000001' and e.respondido_en is not null) as encuestas_respondidas_esperado_23,
  (select count(*) from public.oportunidades o join public.trabajos_taller t on t.id = o.trabajo_id where t.empresa_id = 'b0000000-0000-4000-8000-000000000001') as oportunidades_esperado_6,
  (select count(*) from public.productos where empresa_id = 'b0000000-0000-4000-8000-000000000001') as productos_esperado_12,
  (select count(*) from public.productos where empresa_id = 'b0000000-0000-4000-8000-000000000001' and stock_actual < stock_minimo) as productos_bajo_minimo_esperado_mayor_a_0,
  (select count(*) from public.ventas_directas where empresa_id = 'b0000000-0000-4000-8000-000000000001') as ventas_esperado_6,
  (select count(*) from public.citas where empresa_id = 'b0000000-0000-4000-8000-000000000001') as citas_esperado_24,
  (select count(*) from public.whatsapp_contactos where empresa_id = 'b0000000-0000-4000-8000-000000000001') as contactos_wa_esperado_10,
  (select count(*) from public.plano_elementos where empresa_id = 'b0000000-0000-4000-8000-000000000001') as plano_esperado_14,
  (select count(*) from public.plano_ocupacion where empresa_id = 'b0000000-0000-4000-8000-000000000001') as ocupacion_esperado_10;
