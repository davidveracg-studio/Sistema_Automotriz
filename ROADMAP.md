# VPAI → paridad con Automovity: análisis de brechas y roadmap

Fecha: 2026-11-06 · Rama: `claude/vpai-automovity-gap-analysis-pl7inh` · Solo análisis, no se implementó nada. Estado: **revisión completa** (código del repo, web, términos y privacidad, 7 rubros y panel de Automovity en modo lectura).

**Convención de evidencia**
- **[H]** Hecho: verificado en código del repo (archivo/ruta citados).
- **[W]** Lo que la web de Automovity afirma (leída vía Apify el 2026-11-06). No probado funcionalmente.
- **[A]** Observado dentro de la app de Automovity (sesión de prueba con tu cuenta, 2026-11-06, solo lectura).
- **[U]** Dato aportado por ti (lista del encargo); donde [W] lo confirma, se indica.
- **[S]** Suposición/inferencia mía, a confirmar.

---

## 0. Advertencias antes de leer (importante)

1. **Fuente de la web de Automovity [W].** Desde mi red directa `automovity.com` estaba bloqueado, así que la leí vía Apify (`apify/web-fetch`, 2026-11-06). **Páginas leídas:** home (incluye precios, FAQ y datos estructurados), las 7 páginas de rubro (`/para-talleres`, `-electricidad-automotriz`, `-lubricentros`, `-servitecas`, `-desabolladura`, `-car-wash`, `-instalaciones`) y `sitemap.xml`. También leí `app.automovity.com/terminos` y `/privacidad` (vigentes desde 2026-10-20). El enlace de tu mensaje (`app.automovity.com/panel`) redirige a un acceso por correo (`/entrar`). Con tu autorización entré con tu correo a una cuenta de prueba que ya existía y recorrí el panel en modo lectura (sección 1d, etiqueta [A]); no creé cuentas ni cambié datos. **No leí:** las páginas públicas de negocios clientes del sitemap ni las fichas de las tiendas de apps. **Prueba con datos (sección 1f):** con tu OK cargué un cliente, una OT, una cotización con link y un cobro en efectivo de prueba. **Sigue sin verse en uso:** avisos de WhatsApp, boleta electrónica, link de pago, tarjeta/TUU, comisiones, cotización con varios ítems u opcionales, y reportes con una OT finalizada. Lo que dice la web es lo que **Automovity afirma**; no probé que funcione. Perplexity no estaba disponible para búsqueda (solo ofrece importar dashboards).
2. **El repo es una versión demo/portafolio**, no el producto de producción (`README.md`: "versión de demostración, adaptada de un proyecto en producción real"). El código de producción de Didial podría tener cosas que aquí no están (p. ej. el esquema dice que el tenant real "se siembra aparte", `0001_esquema_roles.sql`). Mi auditoría cubre **solo lo que hay en este repo**.
3. Revisé arquitectura, migraciones (74), Edge Functions (11), rutas, CI y componentes clave. **No ejecuté la app ni la base de datos**, así que nada aquí está probado en ejecución.

---

## 1. Resumen ejecutivo

**Qué es VPAI hoy [H]:** un CRM/OS multi-tenant para taller, con React 18 + Vite + Tailwind (PWA) sobre Supabase (Postgres + RLS + Auth + Storage + Edge Functions) (`package.json`, `vite.config.js`, `README.md`). ~13,7 mil líneas de páginas, 74 migraciones, 11 funciones edge. Tiene mucho más profundidad operativa que un SaaS "de entrada": checklist de 48 puntos (RADAR), escáner de inspección con cámara + análisis por visión de IA, Kanban + plano del taller, agenda por habilidades del personal, bandeja de WhatsApp con bot, bodega por movimientos, facturación DTE (solo sandbox), encuestas de postventa, informes de calidad, turnos/asistencia y un bloque de cumplimiento de datos personales (Ley 21.719) poco común.

**Dónde está lejos de Automovity [H vs W/A]:**
1. **No es vendible a terceros todavía**: no hay alta de talleres (self-service), ni planes, ni cobro de suscripción, ni onboarding; el login es un selector de rol con contraseña compartida de demo (`src/pages/LoginDemo.jsx`, `src/lib/demo.js`), y el primer usuario nuevo cae en "la primera empresa activa" (`0001_esquema_roles.sql`, trigger de alta).
2. **Cobro real inexistente**: no hay caja, medios de pago, Mercado Pago/TUU ni conciliación. Solo se registra "pagado/pendiente" y número de documento (`TrabajoDetalle.jsx:315,712`; `0013_punto_venta.sql` dice explícitamente "Sin manejo de pago real"). La factura/boleta SII existe pero solo con proveedor **sandbox** sin validez tributaria (`_shared/dte/sandbox.ts`, `README.md`).
3. **Sin superficie pública para el cliente final**: la única ruta pública útil es la encuesta (`/encuesta/:token`). No hay aprobación de cotización por link, ni espera en vivo, ni PDF del servidor (solo impresión del navegador).
4. **Comunicación saliente automática casi ausente**: WhatsApp es bandeja + bot entrante y envío manual; no hay avisos automáticos de "recibido/listo/recordatorio" (`whatsapp/index.ts` solo usa `type: 'text'`; sin plantillas). Además **la cuenta de Meta sigue sin aprobación** (comentario en `whatsapp/index.ts`: "nunca se ha probado contra un webhook real").
5. **Comisiones, gastos y caja**: faltan (no existen tablas de gastos/comisiones; las únicas métricas por persona son retrabajos).
6. **Dependencia de ClickUp** como motor del Kanban y estados, con IDs "DEMO_TEAM_ID" hardcodeados (`_shared/clickup.ts`): un freno de multi-tenant y de venta a terceros.

**Dónde VPAI ya gana [H]:** CRM de retorno/oportunidades, encuestas de postventa con alerta de nota negativa, IA de inspección, informes de calidad (retrabajos por técnico), agenda por habilidades, cumplimiento de datos personales, y RLS fino por rol con protección de precios por columna.

**Veredicto tras revisar web, términos, 7 rubros y el panel:** Automovity es un motor único configurable por rubro, con precio plano ($49.900 / $99.900 + IVA) y venta casi autoservicio (prueba de 14 días, "Primeros pasos", catálogo precargado), apoyado en proveedores externos (boleta, pagos, WhatsApp). Su fortaleza es **cobro + avisos + móvil + onboarding**; la tuya es **profundidad operativa + calidad + cumplimiento + IA de inspección**. La brecha crítica no es de funciones sueltas sino de **producto vendible**: un motor configurable, un camino de alta y las rutas públicas para el cliente final. Cerrarla es alcanzable con la base que ya tienes (Supabase, RLS, interfaz de proveedor DTE).

**Recomendación:** no perseguir paridad de vistosidad. Orden: (0) cerrar deuda que bloquea vender (tests, ClickUp, onboarding de tenants, auth real) → (1) lo que un taller usa a diario y hoy no puede hacer en VPAI (aprobación de cotización por link, cobro real, aviso "listo" por WhatsApp, firma/foto de ingreso en móvil, DTE real) → (2) diferenciarse con CRM/IA/finanzas → (3) planes, cobro de suscripción y escala.

---

## 1b. Referencia verificada: qué afirma Automovity [W]

**Confirmado de tu lista [U→W]:** OT por patente con historial y aviso si el auto ya vino hoy; recepción con fotos, daños, firma; cotización por link aprobada ítem por ítem + PDF; caja con tarjeta/transferencia/efectivo; boleta/factura SII al cobrar; Mercado Pago y máquina TUU; comisiones; inventario; gastos; reportes día/semana/mes; agenda por persona/equipo; avisos WhatsApp; espera en vivo pública; 7 rubros; planes Starter/Premium y 14 días gratis.

**Ampliaciones que tu lista no traía (nuevas):**
- **Recepción**: kilometraje, combustible, objetos de valor, **video corto al recibir y al entregar**, y **firma del cliente en persona o por link**.
- **Cobro**: caja como punto de venta (carrito de productos y servicios), **anticipos en % o en pesos**, **arqueo** y movimientos, **link de pago** de la OT; en desabolladura, abono al aprobar y saldo al retirar.
- **Seguimientos automáticos**: aviso de recepción y de "listo" (con botón de pago), **recordatorios de visita y de mantención**, y **seguimiento de cotizaciones por vencer**.
- **Equipamiento**: bahías, elevadores, rampas, escáner con ocupación en vivo; un equipo ocupado no ofrece horas.
- **Página pública por negocio** con reservas y espera en vivo (el sitemap lista varias; `/pacifico-automotriz` resultó ser la página de tu propia cuenta de prueba [A] y las demás, p. ej. `/alfa-detailing`, son de otros negocios).
- **Aseguradoras/liquidadores**: estado "esperando liquidador" y respaldo de cada aprobación (quién y cuándo).
- **App Staff "Mi día"** (técnico/lavador ve sus trabajos, sube fotos, marca avances; no ve precios ni caja) y **apps en App Store y Google Play** (enlaces en la home).
- **Importación desde Excel**; **configuración y capacitación incluidas** en ambos planes; **estados por rubro** (mecánico: por recibir → diagnóstico → esperando aprobación → reparación → listo → entregado; DyP: peritaje, desabolladura, pintura, armado).
- Se presentan como **Meta Business Partner**, distribuidor TUU y con Mercado Pago. La política de seguridad del sitio permite formularios hacia `haulmer.com` [S: probable proveedor de boleta electrónica; no lo dice explícitamente].

**Precios [W]** (CLP + IVA/mes; fuera de Chile en USD):

| | Starter | Premium |
|---|---|---|
| Precio | $49.900 | $99.900 |
| Personas | 5 incluidas, +$10.000 c/u | Ilimitadas |
| WhatsApp | 200 avisos/mes | 500 avisos/mes |
| Correos | 1.000/mes | 3.000/mes |
| Resto de funciones | Idénticas (OT, caja, cotizaciones, agenda, página pública, inventario, comisiones, App Staff, SII) | Idénticas |
| Prueba | 14 días | 14 días |

**Lectura estratégica [S]:** la diferencia de plan es solo cantidad (personas y mensajes), no funciones. Un taller de 5 personas paga $49.900; con 10 serían $99.900 (= Premium). Referencia de precio para tu plan, no para copiarlo sin validar con clientes.

---

## 1c. Lo que revelan sus Términos y Política de Privacidad [W]

Estos documentos muestran **cómo opera** Automovity, no solo qué funciones vende. Es la parte más útil para decidir tu modelo de negocio.

| Tema | Qué dicen (paráfrasis) | Implicancia para VPAI |
|---|---|---|
| Empresa | La opera MercadoProveedor SpA (Las Condes). Apps iOS/Android más navegador | Es un competidor con empresa formal y soporte; no es un proyecto casero |
| **WhatsApp** | Los avisos salen **desde un número único de Automovity**, con el nombre del negocio en el mensaje, usando **plantillas aprobadas por Meta**; solo a quien aceptó (queda registrado fecha, canal y quién lo tomó); el cliente corta respondiendo BAJA; no es para publicidad | **Hallazgo clave.** Tu modelo (un número por taller, modo Coexistencia, `whatsapp/index.ts`) exige que cada taller conecte su cuenta y que tú pases la aprobación de Meta, hoy pendiente. Un número central con plantillas del negocio evita esa fricción en el onboarding. Tu código no tiene registro de consentimiento ni baja (revisé `whatsapp/index.ts` y migraciones `0032`/`0034`) |
| **Facturación** | Boleta/factura/NC con **OpenFactura (Haulmer)** usando la cuenta del propio negocio; el negocio responde por lo emitido | Responde tu pregunta de proveedor DTE con un ejemplo real del mercado: integrar el proveedor con la cuenta de cada taller. Tu interfaz `_shared/dte/proveedor.ts` ya está diseñada para eso |
| **Cobros y monetización** | Pagos vía MercadoPago, Haulmer o máquina TUU, **a las cuentas del negocio** (no custodian dinero). En MercadoPago cobran **1,29 % + $85 + IVA por pago**; en TUU/Haulmer/efectivo/transferencia, sin comisión | Además de la suscripción, tienen ingreso por comisión de pagos online. Es una palanca de negocio a evaluar en Fase 3 |
| **Planes** | Prueba 14 días; cobro mensual con renovación automática (MercadoPago en Chile, Stripe fuera); si no pagan, la cuenta pasa a **solo lectura**; créditos de WhatsApp, correo e IA con **bolsas adicionales**; si se acaba un canal, solo ese canal se detiene (OT, caja, boletas siguen) | Define reglas listas para copiar en concepto (no en texto): límites por canal, degradación a solo lectura, bolsas de créditos |
| **Acceso** | Login **sin contraseña**, con código al correo | Opción simple para tu Fase 0 de autenticación (hoy tienes contraseña compartida demo). Contra: depende de la seguridad del correo |
| **Firma** | Firma electrónica simple (Ley 19.799) con registro de quién, cuándo, **versión del documento y huella** | Tu firma guarda la imagen (`firma_png`); no vi huella ni versión del texto firmado (`0003`, `0020`). Agregarlo da valor probatorio |
| **IA** | Lee fotos (**patente, padrón, kilometraje, lista de precios**), **dicta notas** a la OT y **responde preguntas sobre el negocio**; propone y la persona confirma; proveedores Google (Gemini) y Anthropic; el lector de patente corre en el teléfono | **Corrige mi análisis previo:** Automovity sí tiene IA, pero de otro tipo (captura de datos y consultas), distinta de tu detección de daños e inventario. No tienes OCR de patente/padrón ni dictado (grep sin resultados) |
| **Soporte y auditoría** | El equipo puede ver la cuenta de un negocio para dar soporte y cada acceso queda registrado; registro de cambios no editable | Tu monitor (`0056`) es de uso, no de acceso de soporte. Falta un "acceso de soporte auditado" para vender SaaS |
| **Datos** | Lo sensible de una OT (objetos dejados) se borra a los 7 días de entregada; IP y navegador del registro de cambios a 180 días; documentos tributarios 6 años; baja de cuenta con borrado de datos a los 30 días; eliminación autoservicio | Tu retención (`0074`) es configurable y más detallada, pero nace inactiva; considera plazos por defecto sensatos para vender |
| **Infra** | Render (app), Supabase (BD/auth/archivos), Cloudflare, Postmark (correo), Sentry (errores sin datos personales), FCM/APNs (push) | Misma base que tú (Supabase). Tu correo usa Brevo, no Postmark; no tienes Sentry ni push nativo [H: grep del repo] |
| Cumplimiento | Citan Ley 19.628 "y sus modificaciones"; no nombran la Ley 21.719 en el texto | Tu trabajo de derechos de titulares y retención (`0073`/`0074`) es más explícito; es argumento de confianza, no una brecha |

> No copies sus textos legales: redacta los tuyos con asesoría. Esto es un mapa de qué temas cubrir.

---

## 1d. Lo observado dentro de la app de Automovity [A]

**Alcance.** Entré con tu correo (código de un solo uso) a una cuenta que ya existía: negocio "PA", rubro taller mecánico, prueba gratis que **termina el 20 nov 2026**. Recorrí 35 pantallas en modo lectura, en formato móvil (390 px), sin pulsar acciones ni cambiar datos. **La cuenta estaba vacía** (0 OT, 0 clientes, 0 cotizaciones, 0 inventario) cuando recorrí estas pantallas, así que lo que sigue es estructura y configuración. El comportamiento con datos (OT, cotización por link, aprobación, caja) está en la sección 1f.

| Área | Qué vi [A] | Implicancia para VPAI |
|---|---|---|
| **Navegación móvil** | Barra inferior fija: Resumen · Trabajos · Chat · Caja · Más, con botón central "+" (ingreso) y campana de avisos; buscador arriba. Diseñada para teléfono | Es el mayor contraste de UX: el menú de VPAI no tiene breakpoints (`Menu.jsx`). Un técnico o asesor en el taller usa el celular |
| **Resumen** | Vendido hoy, vehículos, ticket promedio, "en carpeta", contadores (por recibir, en reparación, listo, atrasadas), "para atender", staff ahora (libre/ocupado), más vendidos; filtros hoy/semana/mes/fecha | Tu `Inicio.jsx` muestra OT abiertas, citas, notificaciones y facturas vencidas, pero no ventas ni ticket promedio |
| **Trabajos** | Tablero de 8 columnas (Por recibir, Diagnóstico, Esperando aprobación, Aprobado, En reparación, Esperando repuesto, Listo, Entregado) y vista lista con filtros de etapa y período. Etapas internas: entrada, cotización, aprobado, ejecución, bloqueado, terminado | Estados propios, sin depender de una herramienta externa (tu Kanban depende de ClickUp) |
| **Caja** | Abrir/cerrar caja; servicios del catálogo como botones; monto libre; carrito; "Cobrar"; búsqueda por patente, OT, producto o servicio | Tu POS (`PuntoVenta.jsx`) no maneja pago ni caja |
| **Catálogo** | Por tipo de vehículo (Auto / SUV y camioneta), categorías, duración y precio o "A cotizar"; **viene precargado con servicios típicos del rubro** | Tu catálogo existe (`0027`, `0057`) pero se siembra por migración, no al crear el taller |
| **Agenda y reservas** | Vista por día y próximos días con horas comprometidas y días cerrados. Reservas configurables: por día u hora, ver por staff o equipamiento, capacidad por horas del staff o cupos, tolerancia de atraso, anticipación mínima y máxima, plazo para cambiar/anular, qué hacer si no confirma (nada, avisar, **liberar la hora**) y anticipo fijo o en % | Tu agenda es más fina por habilidades, pero no tiene política de reservas online ni liberación automática |
| **Equipamiento** | Elevador con ocupación por hora, %, vehículos hoy y "esperan lugar" | Parcial en VPAI (plano del taller) |
| **Clientes** | Filtros **Todos · Frecuentes · No vuelven**; vehículos aparte | Automovity ya tiene un CRM de retención básico: tu ventaja ahí es el flujo de oportunidades y la encuesta, no la idea |
| **Reportes** | Pestañas Ventas · Mecánicos · Operación · Caja; hoy/semana/mes; comparación con ayer; exportar CSV | Tus informes son de calidad, no financieros (ver brecha #14) |
| **Staff** | "Agrega a tu primer mecánico: le asignas OT y ves cuánto vende y cuánto gana" | Confirma comisiones por persona |
| **Primeros pasos** | Lista de 8 tareas con avance "0 de 8": datos del negocio, revisar catálogo, horario, compartir página de reservas, invitar equipo, primera OT, primer cobro, elegir plan. Horario y catálogo **vienen preconfigurados** (L–V 9–19, S 9–15) | Onboarding guiado que tú no tienes; es la base de "probar en 30 min" |
| **Mi página** | Publicada y visible en Google, con portada, descripción, opción de mostrar precios y reservas online | Brecha #26 |
| **Configuración** | Rubro del negocio (7 + otro) y "otros rubros"; local o domicilio; checklist de entrada y de salida; interruptor "los mecánicos ven los precios"; tipos de vehículo; **textos de recepción y entrega editables**; **campos obligatorios por cliente, vehículo y OT** y hasta 10 campos propios | Tu esquema es fijo por taller; configurar por tenant es parte de la Fase 0/3 |
| **Cobros** | Link de pago y QR y **Boletas electrónicas: "Pide activarlo"** (activación asistida, no inmediata); TUU: se instala "Automovity" desde las apps de la máquina y cobra a nombre de quien la vincula | El DTE y los pagos online no son autoservicio ni siquiera para ellos: hay un paso de activación con el proveedor. Planifica lo mismo |
| **Plan** | Prueba hasta el 20 nov, 10 personas incluidas en la prueba; Starter $49.900 y Premium $99.900 + IVA (con IVA: $59.381 y $118.881) | Confirma precios [W] |
| **Créditos** | Incluidos: WhatsApp 200, correo 1.000, **IA 200** por mes. Bolsas que no vencen, cada una a **$5.950 con IVA**: 50 de WhatsApp, 500 de correo o 200 de IA | Por unidad: WhatsApp ≈ $119, IA ≈ $30, correo ≈ $12 (con IVA, cálculo mío). La IA es un producto medido; tu costo por llamada a visión debe medirse igual |
| **Chat y soporte** | Bandeja de WhatsApp con "sin responder / todas / todo respondido" y chat de soporte con el equipo | Similar a tu `Mensajes.jsx`; falta el soporte integrado |

> La sesión de prueba quedó guardada solo en el directorio temporal de esta sesión y no modifiqué datos de la cuenta. Si prefieres, cierra sesiones activas desde "Mi cuenta" de Automovity.

---

## 1e. Los 7 rubros de Automovity y cobertura de VPAI [W]

Leí las 7 páginas de rubro. Hallazgo central: **no son 7 productos; es un solo motor configurado por rubro**. Todos comparten OT por patente, recepción con fotos y firma, cotización por link, caja con boleta, WhatsApp y stock, y el mismo precio ($49.900 / $99.900). Lo que cambia por rubro es: las **etapas** de la OT, el **checklist de recepción**, el **catálogo de precios** (por tamaño o aro) y algún **recordatorio** propio.

| Rubro | Etapas de la OT [W] | Particularidades [W] | Cobertura VPAI hoy | Brecha principal |
|---|---|---|---|---|
| **Taller mecánico** | Por recibir → Diagnóstico → Esperando aprobación → En reparación → Listo → Entregado | Recepción con km, combustible, daños, firma y PDF; mano de obra y repuestos en la misma OT; avisa si espera repuesto | **Alta** (RADAR, presupuestos, bodega, hoja de ingreso/egreso) | Cotización por link, cobro, móvil |
| **Electricidad automotriz** | Mismas 6 | Checklist eléctrico (luces del tablero, batería, alzavidrios, radio); diagnóstico con escáner cobrado aparte; **baterías con stock**; opcionales que el cliente marca; escáner como equipo con ocupación | **Media** (RADAR es mecánico y fijo, 48 puntos) | Checklist configurable por rubro |
| **Lubricentro** | Recepción → Aprobado en mesón → En servicio → Listo → Entregado | Historial por patente con último cambio, aceite y km; **recordatorio del próximo cambio por km o fecha**; revisión técnica y permiso de circulación a la vista; fila rápida; aviso de stock bajo; **flotas y empresas**; hallazgos aprobados por link; importa historial desde Excel | **Baja–media**: hay historial y bodega (`stock_minimo` existe en `0012`, no verifiqué alerta) y flota (`clientes_vehiculos`, `0002`); no hay próximo cambio ni fila rápida | Recordatorio de mantención, fila rápida |
| **Serviteca y vulcanización** | Mismas 5 que lubricentro | **Precio por aro/medida** y por tamaño de vehículo; adicionales (p. ej. inflado con nitrógeno); stock de neumáticos por medida y marca; fila del día con rampa y tiempo restante; estado de llantas en recepción; neumáticos cotizados por link y PDF; lista de precios desde Excel | **Baja** (catálogo por tipo de vehículo, `0027`/`0057`; sin aro ni medida, sin stock por medida) | Precio por aro, stock por medida |
| **Desabolladura y pintura** | Recepción → Peritaje y presupuesto → Esperando aprobación o liquidador → Desabolladura → Pintura → Armado y pulido → Listo | Presupuesto por pieza, respaldo de cada aprobación (quién y cuándo), abono al aprobar y saldo al retirar, fotos de avance al cliente | **Media** (diagrama de daños por carrocería `0022`/`0023`, fotos, escáner con IA) | Liquidadores, abonos, avance al cliente |
| **Car wash y detailing** | En cola → Lavando → Listo → Entregado | Ingreso por patente directo a la fila; **precio por tamaño** (auto, SUV, camioneta, moto), paquetes, extras y descuentos; cotizaciones de detailing con fotos y opción de pedir hora; **pago a lavadores** por día/semana/mes; caja con cierre por medio de pago; espera en vivo y reservas por bahía | **Muy baja** (orientado a mecánica; `tipo_carroceria` sin moto, `0023`) | Fila rápida, precios por tamaño, comisión por lavador |
| **Instalaciones** (polarizado, láminas, alarmas, audio, GPS) | Recepción → Cotización → Aprobado → Instalando → Listo → Entregado | Precio y duración por tipo de vehículo; paquetes; fotos obligatorias y checklist previo (vidrios, lámina anterior, paneles, radio, luces); **horas por bahía**; **garantía con vencimiento en la ficha del vehículo** | **Baja** (la garantía aparece solo como texto del egreso, `0020`; sin vencimiento) | Garantía con vencimiento, horas por bahía |

**Qué significa para VPAI [S]:**
- La inversión correcta es un **"perfil de rubro"** (etapas, checklist de recepción, tipos de vehículo, catálogo semilla y recordatorios), no 7 desarrollos. Es además lo que hace posible el onboarding con catálogo precargado de la sección 1d.
- Orden sugerido de rubros, por cercanía a lo que ya tienes: **mecánico y DyP** (hoy) → **electricidad** (casi solo un checklist y stock de baterías) → **lubricentro y serviteca** (fila rápida, recordatorio de mantención, precio por aro) → **instalaciones** (garantía con vencimiento) → **car wash** (el más distinto: volumen alto, ticket bajo, fila y comisión por lavador).
- Decidir con datos: confirma con talleres reales qué rubro quieres vender primero antes de construir los siguientes.

---

## 1f. Recorrido con datos de prueba en Automovity [A]

**Qué hice (con tu autorización, 2026-11-06, en tu cuenta de prueba):** creé un cliente ficticio sin teléfono ("Cliente Prueba VPAI", patente VPAI01) para que ningún aviso pudiera llegar a una persona real; una OT (OT-1, "Diagnóstico con scanner", $25.000); una cotización suelta (COT-1); la aprobé desde el link público como lo haría un cliente; abrí la caja y cobré $25.000 en efectivo. **No usé** "Enviar por WhatsApp", boleta ni link de pago.

| Paso | Qué vi [A] | Lección para VPAI |
|---|---|---|
| **Cliente** | Formulario mínimo: nombre, teléfono y patente (el resto bajo "Más datos": correo, RUT, dirección, comuna, cumpleaños, notas). Crea cliente y vehículo a la vez. La ficha ofrece "Nueva OT", "Cotizar" e "Invitar a la app" (app del cliente) | Tu alta de cliente/vehículo/ingreso es mucho más larga (`NuevoIngreso.jsx`, 1.244 líneas). Meta medible: cliente + vehículo + OT en menos de un minuto |
| **OT** | "Nueva recepción" en una sola pantalla: patente (reconoce al cliente y al vehículo), tipo de vehículo, servicio del catálogo con precio y duración por tipo, mecánico y fecha de entrega. Al crear, entra directo al checklist | Un solo formulario corto, con el catálogo como botones. Ver tu flujo de dos ingresos (diagnóstico/agendado) como candidato a simplificar |
| **Checklist de entrada** | 6 pasos: fotos (4 mínimas de 7 ángulos), estado visual (sin daños/con daños), revisión de 7 ítems Bien/Mal con "Todo bien", combustible y km, objetos de valor, resumen. Se puede saltar cualquier paso; el resumen avisa qué falta y ofrece un **checklist liviano**; la firma queda en la OT | Tu RADAR de 48 puntos es más profundo; el valor para vender es una versión corta por defecto y la profunda opcional |
| **OT (detalle)** | Barra de etapas (Por recibir → Esperando aprobación → Aprobado → En reparación → Listo → Entregado), servicios con avance "0 de 1 hecho", fotos, historial con autor y hora, notas, "por cobrar" | Etapas visibles y propias; hoy las tuyas vienen de ClickUp |
| **Cotización** | Se crea "suelta con la patente" (borrador, válida 30 días desde que se envía). Agrega trabajos del catálogo, mensaje al cliente y nota interna; neto e IVA calculados con IVA incluido en los precios ($21.008 + $3.992 = $25.000). Acciones: copiar link, PDF, vista previa, **enviar por WhatsApp**, **PDF con QR para impresora de 80 mm**, **"Respondió en el local"** (registra una aprobación presencial) y **cobrar anticipo**. Copiar el link la marca "Enviada" sin mandar ningún mensaje | La aprobación presencial y el anticipo son casos reales que tu `PresupuestoDetalle.jsx` hoy resuelve solo con "Marcar aceptado" |
| **Link público** (`/cotizacion/<token largo>`) | Página móvil con el nombre del taller, los servicios, total con neto e IVA, un campo "Tu nombre" y el botón "Aprobar · $25.000". Sin login. No tiene casillas por ítem porque la cotización tenía un solo ítem; **no probé opcionales ni aprobación parcial** | Es el patrón de la ruta pública (token) del paso 5 de este roadmap. El token tiene 43 caracteres; no probé caducidad ni límites de intentos |
| **Aprobación** | Pantalla de confirmación con número y hora; en el taller, la cotización pasa a "Aprobada" con "Respondió *nombre* por el link" y se muestra Propuesto vs Aprobado; llega un aviso en la campana | Registrar quién y cuándo aprobó da respaldo; tu esquema tiene estados pero no esa traza |
| **Efecto en la OT** | Aprobar la cotización suelta **no movió** la OT-1 (siguió "Por recibir") ni la vinculó. En Caja, OT-1 y COT-1 aparecieron como dos "por cobrar" separados de $25.000 | Riesgo de doble conteo si cotización y OT no se enlazan. Diseña desde el inicio el vínculo cotización ↔ OT ↔ cobro. No probé crear la cotización desde la ficha de la OT, que es el camino pensado |
| **Caja** | Abrir caja con efectivo inicial; lista "Por cobrar" (OT y cotizaciones aprobadas) y catálogo como botones; cobro por efectivo, transferencia o tarjeta, descuento, **cobro parcial** ("otro monto") y, en efectivo, **monto recibido y vuelto**; al terminar: comprobante de 80 mm o carta. **Cierre con arqueo**: "debería haber" frente a "efectivo contado". Sin boleta porque no está activada | Es el módulo que tú no tienes (`0013`: "sin manejo de pago real"). Estos son los casos mínimos: apertura, métodos, parcial, vuelto, comprobante, arqueo |
| **Reportes y resumen** | Con el cobro hecho, "Vendido hoy" siguió en $0 y Reportes dijo "nada en este período": la OT seguía en "Por recibir". El texto del reporte habla de "lo que quedó listo y lo que se vendió en la caja" [S: las ventas parecen reconocerse al terminar la OT, no al cobrar]. El resumen del mecánico muestra "Mi cola" con sus OT | Decide pronto qué es una "venta" en VPAI (cobro vs OT entregada); afecta reportes, comisiones y caja |

**Límites de esta primera prueba:** un solo ítem y un solo cobro en efectivo; sin WhatsApp, boleta, link de pago, tarjeta/TUU ni comisiones. Las pruebas posteriores (varios ítems, opcionales, ciclo completo de la OT, inventario, reportes) están en la sección 1g.

---

## 1g. Revisión de las opciones restantes de Automovity [A]

Continué el recorrido en tu cuenta de prueba (2026-11-06) hasta cerrar el ciclo de una OT. **Evité** lo que envía mensajes o correos a terceros (WhatsApp, "Enviar para firmar", invitar staff, "Pide activarlo", compras de créditos). El sistema de permisos también bloqueó, con razón, completar una **reserva pública** (es una transacción real que puede generar avisos); vi solo sus primeros pasos: elegir servicio y luego la patente (con la opción "No sé la patente").

**1. Ciclo de vida de la OT: un botón principal por etapa.** Checklist de entrada completo → pasa solo a **Diagnóstico** → **Aprobar** (aprobación presencial) → **Empezar** (En reparación) → **Marcar lista** → **Cobrar** → **Entregar**. Cada paso queda en un historial con autor y hora ("Aprobado", "En reparación", "Listo · checklist de salida: 5 puntos", "Dio por hecho lo pendiente al marcarla lista: 2 trabajos"). La OT muestra una hora estimada de término ("aprox. 17:49") calculada con la duración de los servicios. **Marcar lista** abre un checklist de salida de 5 puntos (con atajo "Todo bien"). **Entregar** abre una pantalla "así llegó y así sale" (fotos de llegada y de salida por cada lado), repite el checklist de salida, pide firma de conformidad, quién retira y permite "retira con observaciones". **Entrega completada después** (ver más abajo): el botón "Entregar" solo actúa tras firmar o marcar "No firmó".

**2. Checklist de entrada configurable y con trazabilidad.**
- Ajustes: hacerlo al ingresar, exigirlo antes de empezar, fotos obligatorias, kilometraje obligatorio, firma al recibir, video al recibir, y puntos de revisión editables con "Obligatorio" por punto y "Agregar punto".
- Fotos por lado (frente, derecha, atrás, izquierda, más tablero e interior). **Detecta fotos repetidas**: "Esa misma foto ya está en la OT. Saca una nueva".
- Hay versión completa y **liviana** (5 pasos); el asistente retoma en el primer paso incompleto. El kilometraje bloquea el cierre si falta.
- **Firma:** texto de consentimiento editable con número de versión; al firmar queda "Firmó en persona el 6 nov, 17:03 · texto versión 1 · código de integridad" (16 caracteres). También existe "Enviar para firmar" (por link), que no probé.

**3. Inventario con reserva y consumo.** Un producto tiene nombre, categoría, precio, costo, stock mínimo, "se vende en caja", marca, SKU, código de barras e IVA. Se registra con "Recibir compra" (cantidad, costo, proveedor) o "Contar/Ajustar". Muestra el margen ("Ganas $5.000"), disponible, en mano y reservado, filtros "sin stock" y "stock bajo", y "alcanza para N días". **Al agregarlo a una OT queda reservado; al marcar la OT lista se consume** ("Gastado en OT-1"), con movimientos de entradas, salidas y ajustes.

**4. Catálogo y comisiones.** El servicio se define con categoría, "se puede reservar", precio y tiempo **por tamaño de vehículo o único**, y **comisión del mecánico en %** (las comisiones se fijan por servicio). Equipamiento: 13 tipos (elevador, scanner, compresor, alineadora, foso, balanceadora, desmontadora, bahía, box de lavado, cabina de pintura, hidrolavadora, unidad móvil, otro), con capacidad "a la vez" y servicios que lo usan. Staff se agrega con nombre, teléfono y correo (invitación; no la envié).

**5. Cotización con opcionales.** Cada ítem tiene cantidad y un selector **Incluido / Opcional**; se pueden agregar trabajos fuera del catálogo (qué es + precio), título, mensaje, nota interna y validez. El total del taller muestra "Opcionales $12.000 si los aprueba" aparte. **En el link del cliente**, cada ítem es un interruptor (incluidos activados, opcionales desactivados, con "Recomendado"); al activar un opcional el total cambió de $62.000 a $74.000. Esto confirma la aprobación **ítem por ítem** con opcionales. No aprobé COT-2.

**6. Reportes con datos (la OT cuenta como venta al marcarla lista, no al cobrar).**
- **Ventas:** vendido con IVA, número de ventas, promedio, por hora y detalle.
- **Mecánicos:** vehículos listos, monto, tiempo promedio, vehículos por hora, detalle por persona y **"Repasos"** (retrabajos).
- **Operación:** tiempo de llegada a lista, de lista a retirada, **tiempo promedio por etapa**, reabiertas, atrasadas y **"listas después de lo comprometido"** (puntualidad).
- **Caja:** cobrado, por medio de pago, anulado o devuelto, cobrado por hora y movimientos.
- **Resumen:** "para atender" (OT lista para entregar), staff ahora con su monto y "más vendidos" con porcentaje.

**7. Otras pantallas.** Página pública del negocio ("Abierto ahora", precios por tamaño, horario, "Reservar hora"); Agenda con vistas Día y Próximos días y botón "Reservar"; Chat con filtros; "Mi cuenta"; menú "Más" con Agenda, Cotizaciones, Clientes, Vehículos, Catálogo, Inventario, Equipamiento, Reportes, Staff, Ajustes, Ayuda y soporte.

**8. Cierre del ciclo (con tu autorización, 17:2x).**
- **Cierre de caja:** pide el efectivo contado y lo compara con lo que "debería haber" ($37.000 = $37.000). Al cerrar, la caja vuelve a "Abrir caja". **COT-1 siguió apareciendo como "por cobrar" ($25.000)** aunque la OT ya estaba pagada: confirma el riesgo de doble conteo si no se enlazan cotización, OT y cobro.
- **Entrega:** firmé en persona la conformidad (de nuevo con versión del texto y código de integridad) y pulsé "Entregar": la OT pasó a **Entregado a las 17:23** con "Retiró *nombre*". Permitió entregar aunque las fotos de salida no estaban tomadas ("Sin foto"); no las exige.
- **Ficha del cliente:** tras guardar el teléfono muestra gasto total, visitas, ticket promedio, última visita, cliente desde, **pendientes** ("Cotización sin respuesta · COT-2") e historial filtrable (OT / Cotizaciones).
- **Estados de la cotización:** Borrador → Enviada → **Vista** (cuando el cliente abre el link) → Aprobada.
- **Envío:** la hoja "Enviar cotización" ofrece WhatsApp, Correo o "Crear el link". En este negocio de prueba **WhatsApp aparece "apagado en tu negocio"** y el correo "Sin correo"; no encontré cómo activarlo desde Ajustes ni desde Chat, así que **no se envió ningún mensaje**. Es coherente con "Pide activarlo" en boleta y pagos: los canales parecen activarse con el equipo de Automovity.

**Sigue sin probar:** WhatsApp (apagado), correo, "Enviar para firmar", reserva pública completa, boleta, link de pago, tarjeta/TUU, anticipo, importación desde Excel, pago de comisiones calculado y "Invitar a la app" del cliente.

**Datos de prueba que quedan en tu cuenta de Automovity:** cliente "Cliente Prueba VPAI" (VPAI01, con tu teléfono +56 9 3462 5746), OT-1 entregada y cobrada ($37.000 en efectivo), caja cerrada, COT-1 aprobada, COT-2 enviada y vista (con ítems repetidos por mis pruebas), COT-3 en borrador, producto "Aceite 5W30 (prueba)" con 9 unidades y 5 fotos de prueba.

---

## 2. Auditoría del código (evidencia)

### 2.1 Módulos existentes
Rutas en `src/App.jsx` (todas protegidas excepto las 4 públicas):

| Módulo | Ruta / archivo | Notas [H] |
|---|---|---|
| Ingreso de vehículo | `/ingresos/nuevo` → `pages/NuevoIngreso.jsx` (1244 l.) | Dos flujos: diagnóstico o servicio agendado; firma (`FirmaCanvas.jsx`), diagrama de daños (`DiagramaVehiculo.jsx`, 5 carrocerías) |
| OT | `/trabajos`, `/trabajos/:id` (`TrabajoDetalle.jsx`, 1676 l.) | Archivo muy grande; cierre con bloqueo y reapertura auditada (`0026`) |
| Orden de ingreso/egreso imprimible | `/trabajos/:id/ingreso`, `/egreso` | Impresión del navegador (`print:hidden` en Menu); firma de cliente en egreso |
| Checklist RADAR | `/trabajos/:id/radar` (`RadarSesion.jsx`) | 48 puntos, hallazgos con foto (`0007`, `0029`) |
| Escáner de inspección | `/trabajos/:id/escaner` + `lib/escaner/*` | Video procesado en el dispositivo, solo fotos suben (`0068`); IA: `analizar-inspeccion` (Claude visión), sugiere inventario/daños, requiere aceptación humana |
| Presupuestos | `/presupuestos[/:id]` | Estados borrador/enviado/aceptado/parcial/rechazado/anulado (`0006`); **la aceptación la marca el staff** (`PresupuestoDetalle.jsx:244` "Marcar aceptado"); protección de costos con RLS + REVOKE de columna |
| Agenda | `/agenda` (+ vistas día/semana/mes/año) | Capacidad por habilidad del personal (`0048`), horario de atención, bot (`0034`) |
| Taller | `/taller` (`Taller.jsx`) | Kanban + plano 33×65 m; estados vienen de ClickUp |
| Mensajes | `/mensajes` | Bandeja WhatsApp Cloud API (modo Coexistencia), bot por menú numerado, sin IA |
| Bodega / POS | `/bodega`, `/punto-venta` (`0012`, `0013`) | Stock por movimientos; venta de mostrador |
| Facturación | `/facturacion[/:id]`, `/cuentas-por-cobrar` | DTE 33/34/39/41/52/56/61 con interfaz de proveedor; **solo sandbox** (`facturacion-emitir`, `_shared/dte/*`) |
| CRM | `/clientes`, `/oportunidades` | Clientes con RUT normalizado/validado, vehículos, oportunidades de retorno |
| Encuestas | `/encuestas`, `/encuesta/:token` | Encuesta pública por token, envío por Brevo, alerta por nota negativa (`notificar-encuesta-negativa`) |
| Informes | `/informes` | 4 tarjetas: retorno de clientes, captura de datos, presupuestos por decisión, retrabajos por técnico (`0011`). **Todas orientadas a calidad, ninguna financiera** |
| RRHH | `/turnos` | Importa reloj control (xlsx) y clasifica asistencia (`0055`) |
| Cumplimiento | `/solicitudes-titulares`, `/retencion`, `/privacidad`, `/terminos` | Derechos de titulares, purga programada (`0073`, `0074`, `retencion-purga.yml`) |
| Plataforma | Monitor de uso (`0056`, `lib/uso.js`) | Eventos por empresa y accesos fallidos |

### 2.2 Modelo de datos
~70 tablas (todas con `empresa_id` + RLS; 68 habilitaciones de RLS en migraciones). Núcleo: `empresas`, `usuarios`, `clientes`, `vehiculos`, `trabajos_taller`, `tareas_taller`, `presupuestos_taller`, `ot_detalle`, `citas`, `personal_*`, `productos`/`movimientos_stock`, `documentos_tributarios`, `whatsapp_*`, `encuestas`, `oportunidades`, `radar_*`, `inspeccion_*`.
**No existen** [H, por listado de `create table`]: pagos/caja, gastos, comisiones, planes/suscripciones, ítems de cotización versionados con link público, plantillas de mensajes, notificaciones salientes programadas, ni un modelo de "fila/cola" propio (la fila se infiere del estado de ClickUp, `lib/tallerReglas.js`).

### 2.3 Integraciones
| Integración | Estado [H] |
|---|---|
| Supabase (Auth/DB/Storage/Edge) | Núcleo |
| ClickUp | Acoplada: Kanban, estados, tareas, citas, webhook (`clickup-*` ×6 funciones, `_shared/clickup.ts` con IDs placeholder) |
| WhatsApp Cloud API (Meta) | Implementada, **sin aprobar ni probada en real**; firma HMAC del webhook ✔ |
| Brevo (correo) | Encuestas y avisos |
| Anthropic (visión) | `analizar-inspeccion`, modelo `claude-haiku-5-5` por defecto |
| DTE/SII | Interfaz de proveedor + sandbox; **sin proveedor real** |
| Mercado Pago / TUU / Webpay | **Ninguna** (grep sin resultados) |
| Patente → datos del vehículo | Solo formato/normalización (`lib/patente.js`); sin consulta externa |

### 2.4 Multi-tenant
Fuerte en datos: `mi_empresa_id()` SECURITY DEFINER usado en RLS (`0001`), buckets con `empresa_id` como primer segmento de ruta (`0068`), `revoke select from anon` global (`0072`). **Débil en producto**: `empresas` solo trae nombre/dirección/logo; no hay subdominio, ajustes por tenant más allá de horarios/políticas, ni alta de empresas. El rol está pensado para Didial: el propio `0001` admite que la taxonomía "todavía no cubre" otros talleres y difiere la decisión "cuando haya un segundo tenant". `socia` y `admin` están fusionados en demo (`0065`) pero ambos se siguen verificando en ~95 sitios.

### 2.5 Autenticación y permisos
- Roles [H]: `admin`, `socia`, `asesor`, `jefe_taller`, `tecnico`, `recepcionista`, `encargado_presupuestos` (+ coordinador de repuestos, `0062`). Permisos duplicados en tres lugares: `RutaProtegida`/`App.jsx`, RLS, y chequeo de rol dentro de Edge Functions (`ROLES_PUEDEN_ENVIAR` etc.). Riesgo de divergencia [S].
- Login actual = demo sin contraseña por usuario; contraseña compartida en el bundle (`src/lib/demo.js`) [H]. Hay `debe_cambiar_clave` (`0016`) y `/cambiar-clave`, o sea hay base para auth real. No vi recuperación de contraseña, invitación de usuarios ni MFA [S: no los busqué en `AuthContext` línea por línea].

### 2.6 UX móvil
- PWA instalable (`vite.config.js`), escáner pensado para cámara de teléfono y firma en canvas: buena base [H].
- **Sin breakpoints responsivos en el menú** (`Menu.jsx`: 0 ocurrencias de `sm:/md:/lg:`; `sticky h-screen shrink-0`) y escasos en páginas (`NuevoIngreso` 2, `TrabajoDetalle` 2, `Trabajos` 0) [H]. Inferencia [S]: el menú lateral ocupa ancho fijo en pantallas chicas; hay que probarlo en un teléfono real.
- No hay app nativa; PWA con `autoUpdate` y sin estrategia offline más allá del precache de Workbox [H].

### 2.7 Planes
No existe ningún concepto de plan, límite, trial ni facturación de suscripción [H: grep de plan/suscrip/stripe/flow/tuu no encuentra nada relevante]. `empresas.es_demo` es lo único cercano.

### 2.8 Calidad, CI, tests
- CI (`ci.yml`): lint con `--max-warnings 0`, 3 verificadores de esquema propios (columnas, catálogos como texto, índices SQL), prueba del escáner, build. Verifica numeración de migraciones [H]. Buena disciplina.
- Tests: solo 3 archivos `.test.ts` en funciones edge (seguridad, inspección, DTE) y un script de pruebas del escáner. **Sin tests de UI, sin tests de RLS, sin e2e**; `verificar:edge` (deno check) no está en CI [H].
- Migraciones: se aplican "a mano en el SQL Editor, en orden" (`README.md`); existe `scripts/migrar.sh`. Sin rollback ni entorno staging documentado [H/S].
- Archivos gigantes (`TrabajoDetalle` 1676, `NuevoIngreso` 1244, `Agenda` 1227, `Taller` 1109) → coste de cambio alto [H].

---

## 3. Matriz de brechas

Esfuerzo: S (≤1 semana), M (1–4 semanas), L (>1 mes) — estimación mía para 1–2 devs [S]. Impacto para un taller real.

| # | Funcionalidad (ref. Automovity: [U] tu lista, [W] web, [A] app) | Estado en VPAI | Evidencia [H] | Esfuerzo | Impacto | Dependencias |
|---|---|---|---|---|---|---|
| 1 | OT con ingreso por patente | **Parcial** | Ingreso y búsqueda por `patente_norm` existen (`NuevoIngreso`, `lib/patente.js`); falta autocompletar por patente externa y flujo de 1 tap | S | Alto | — |
| 2 | Fila/cola de vehículos | **Parcial** | Kanban + plano, pero el estado vive en ClickUp (`tallerReglas.js`) | M | Alto | Desacoplar ClickUp (F0) |
| 3 | Historial del cliente | **Existe** | `ClienteDetalle`, `clientes_vehiculos`, informe de retorno | — | Medio | — |
| 4 | Checklist de entrada con fotos, daños, firma | **Existe** (más profundo) | `DiagramaVehiculo`, `FirmaCanvas`, `inspeccion_fotos`, RADAR 48 pts | S (pulir móvil) | Alto | Responsive móvil |
| 5 | Cotización con link de aprobación del cliente | **Falta** (aprobación solo por staff) | `PresupuestoDetalle.jsx:244`; sin rutas públicas de presupuesto | M | **Alto** | Token público + RLS anon acotado; PDF; (WhatsApp) |
| 6 | PDF de cotización/orden | **Parcial** | Solo `window.print` | S–M | Medio | Generación servidor o CSS print cuidado |
| 7 | Caja y cobros (tarjeta/transferencia/efectivo) | **Falta** | Solo `estado_pago` (`TrabajoDetalle:315`); POS "sin manejo de pago real" (`0013`) | M | **Alto** | Modelo `pagos`, cierre de caja |
| 8 | Boleta/factura SII reales | **Parcial** | DTE completo pero solo sandbox (`_shared/dte/sandbox.ts`) | M | **Alto** | Elegir proveedor (certificado/CAF del proveedor); polling de estado |
| 9 | Mercado Pago / TUU | **Falta** | Sin código | M | Medio | #7; cuentas comerciales |
| 10 | Avance por persona | **Parcial** | `tareas_taller.tecnico_id`, asignación por tarea (`0061`); retrabajos por técnico | S | Medio | — |
| 11 | Comisiones | **Falta** | Sin tablas ni UI | M | Medio | #10, #7 (base de cálculo cobrada) |
| 12 | Inventario | **Existe** | `productos`, `movimientos_stock`, `Bodega` | S (alertas de mínimo) | Medio | — |
| 13 | Gastos | **Falta** | Sin tabla | S–M | Medio | #7 (caja) |
| 14 | Reportes día/semana/mes | **Parcial** | `Informes` solo de calidad; no ingresos/ticket/por técnico | M | Alto | #7, #13 |
| 15 | Agenda por persona/bahía conectada a la fila | **Existe (distinto)** | Agenda por habilidades/isla (`0048`, `0017`), ingreso desde cita (`0014`) | S | Medio | — |
| 16 | Avisos automáticos WhatsApp (recepción, listo, recordatorio) | **Parcial** | Bandeja y bot ✔; sin plantillas ni disparadores; Meta sin aprobar | M | **Alto** | Aprobación Meta/plantillas; cola de envío |
| 17 | Espera en vivo pública | **Falta** | No hay ruta pública de estado | S–M | Medio | Token por OT; #2 |
| 18 | Multirrubro (7 rubros confirmados [W]) | **Parcial** | Cubre mecánica y DyP (`catalogo_servicios`: Taller Mecánico, Servicio Rápido, DyP); faltan etapas/checklists por rubro (car wash, lubricentro, serviteca, instalaciones, electricidad). Detalle por rubro en la sección 1e | L (se desglosa en #47–#54) | Medio (según mercado objetivo) | Configuración por tenant |
| 19 | Apps móviles (iOS/Android en tiendas [W]) | **Parcial** | PWA instalable, sin app en tiendas | S–M (PWA pulida) / L (nativa) | Medio | Responsive; decidir envoltorio (Capacitor) o nativo |
| 20 | Planes + prueba gratis 14 d | **Falta** | Sin concepto de plan | M | **Alto** (para vender) | Onboarding, cobro suscripción |
| 21 | Alta self-service de taller | **Falta** | Trigger asigna "primera empresa activa" | M | **Alto** (para vender) | Auth real, plantillas de datos |
| 22 | Recepción: video corto al recibir/entregar y firma por link [W] | **Parcial** | Firma presencial en canvas (`FirmaCanvas.jsx`); el video del escáner se procesa en el dispositivo y **no se guarda** (`0068`); no hay firma remota | M | Medio | Almacenamiento de video, ruta pública con token |
| 23 | Anticipos/abonos, arqueo de caja, link de pago [W] | **Falta** | Ver #7 | M | Alto | #7, #9 |
| 24 | Seguimiento automático de cotizaciones por vencer y recordatorio de mantención [W] | **Falta** | Hay `oportunidades` manuales y encuestas; sin recordatorios programados | M | Alto | #16, #5 |
| 25 | Equipamiento: bahías/elevadores con ocupación; equipo ocupado no ofrece horas [W] | **Parcial** | Plano con puestos/ocupación (`0038`, `0045`, `plano_ocupacion`) y agenda por habilidades (`0048`); no hay recursos físicos que bloqueen horas | M | Medio | #2 |
| 26 | Página pública del negocio con reservas [W] | **Falta** | Sin ruta pública de reservas (hay bot por WhatsApp, `0034`) | M | Medio | Fase 0 (rutas públicas), #15 |
| 27 | Aseguradoras/liquidadores: estado y respaldo de aprobación [W] | **Falta** | No hay entidad aseguradora/liquidador | S–M | Medio (alto si apuntas a DyP) | #5 |
| 28 | App Staff sin precios ni caja [W] | **Existe** (vía rol) | Rol `tecnico` ve OT/RADAR; precios protegidos con RLS + REVOKE de columna (`README.md`) | S | Medio | Pulir móvil |
| 29 | Importación desde Excel de clientes/vehículos [W] | **Falta** | Hay lectura de xlsx solo para reloj control (`Turnos.jsx`) | S–M | Alto (onboarding) | #21 |
| 30 | Configuración y capacitación incluidas [W] | **Falta** (proceso, no código) | Puesta en marcha manual | — | Medio | Definir servicio de implantación |
| 31 | Consentimiento y baja (BAJA) de avisos WhatsApp, con registro [W] | **Falta** | Sin tabla ni lógica de opt-in/opt-out (grep en `whatsapp/index.ts`, `0032`, `0034`) | S | **Alto** (prerrequisito legal y de Meta para #16) | — |
| 32 | WhatsApp con número central y plantillas (sin que cada taller conecte Meta) [W] | **Falta** (VPAI usa 1 número por taller, Coexistencia) | `whatsapp/index.ts`, `0032` | M | **Alto** (onboarding) | Decisión de modelo (ver 1c); #16 |
| 33 | IA de captura: leer patente/padrón/km, dictar notas, consultas al negocio [W] | **Falta** (IA existe solo en inspección) | `analizar-inspeccion` es el único uso de IA | M | Medio–Alto | Costo por uso (#20) |
| 34 | Firma con huella y versión del documento [W] | **Parcial** | Firma como PNG (`firma_png`, `FirmaCanvas.jsx`); sin huella ni versión de texto | S | Medio | — |
| 35 | Planes con degradación a solo lectura y bolsas de créditos [W] | **Falta** | Sin concepto de plan (#20) | M | Medio | #20 |
| 36 | Comisión por pagos online (modelo de ingreso) [W] | **Falta** | Sin pasarela (#9) | M | Medio | #9 |
| 37 | Acceso de soporte auditado [W] | **Parcial** | Monitor de uso (`0056`), sin acceso de soporte registrado | S–M | Medio | Fase 0 |
| 38 | Push nativo y monitoreo de errores [W] | **Falta** | Sin Sentry ni FCM/APNs en el repo | S–M | Medio | #19 |
| 39 | Navegación móvil con barra inferior y botón "+" de ingreso [A] | **Falta** | `Menu.jsx` sin breakpoints; menú lateral `sticky h-screen` | S–M | **Alto** (uso diario en taller) | Responsive (Fase 0) |
| 40 | Onboarding guiado "Primeros pasos" con catálogo y horario precargados por rubro [A] | **Falta** | Puesta en marcha manual (`README.md`); catálogo sembrado por migración (`0027`, `0057`) | M | **Alto** | #21 |
| 41 | Política de reservas online: por día/hora, plazos, anticipo, liberar hora si no confirma [A] | **Parcial** | Agenda con horario de atención y bot (`0034`, `0035`); sin plazos ni anticipo | M | Medio | #26, #23 |
| 42 | Campos obligatorios y campos propios configurables por negocio [A] | **Falta** | Esquema de `clientes`/`vehiculos`/`trabajos_taller` fijo (`0002`, `0003`) | M | Medio | Fase 0 |
| 43 | Textos de recepción/entrega y checklists editables por negocio [A] | **Parcial** | Checklists RADAR/tareas editables en el taller (`README.md`); textos legales fijos en código (`lib/legal/*`) para privacidad y términos | S–M | Medio | — |
| 44 | Filtros de cartera "Frecuentes / No vuelven" [A] | **Existe (distinto)** | Informe "Clientes que vuelven" y `oportunidades` (`0011`, `Oportunidades.jsx`) | S | Medio | — |
| 45 | Instalar la app en la máquina TUU y cobrar con boleta en un paso [A] | **Falta** | Sin integración TUU | M–L | Medio | #9; acuerdo con TUU |
| 46 | Activación asistida de boleta y link de pago [A] | **Falta** (proceso) | DTE solo sandbox | S | Medio | #8, #9 |
| 47 | Perfil de rubro: etapas, checklist de recepción, tipos de vehículo y catálogo semilla [W] | **Falta** | Estados dependen de ClickUp (`tallerReglas.js`); RADAR de 48 puntos fijo (`0029`) | M (marco) + S–M por rubro | **Alto** (habilita #40) | Desacoplar ClickUp (#2) |
| 48 | Precio por aro/medida, por tamaño (incl. moto), paquetes, extras [W] | **Parcial** | Catálogo por tipo de vehículo (`0027`, `0057`, `catalogo_servicio_precios`); `tipo_carroceria` sin moto (`0023`); sin aro | M | Medio (alto en serviteca y car wash) | #47 |
| 49 | Stock con alerta de mínimo y por medida/marca (neumáticos, aceites, baterías) [W] | **Parcial** | `stock_minimo` existe (`0012`); no verifiqué alerta en pantalla ni atributos de medida | S–M | Medio | — |
| 50 | Fila rápida de mesón con etapas cortas, rampa/bahía y tiempo restante [W] | **Falta** | Sin estados cortos por rubro; plano del taller por puesto (`0038`) | M | Alto (lubricentro, serviteca, car wash) | #2, #47 |
| 51 | Garantía con vencimiento en la ficha del vehículo [W] | **Falta** | Garantía solo como texto en el egreso (`0020`) | S | Medio (instalaciones) | — |
| 52 | Opcionales que el cliente marca en la cotización [W] | **Falta** | Aceptación parcial ítem por ítem solo por el personal (`PresupuestoDetalle.jsx`) | S | Medio | #5 |
| 53 | Importar lista de precios e historial desde Excel [W] | **Falta** | Excel solo para reloj control (`Turnos.jsx`) | S–M | Alto (onboarding) | #29 |
| 54 | Flotas y empresas: varios vehículos por cliente con factura [W] | **Existe** | `clientes_vehiculos` para "flota de una empresa" (`0002`), razón social y RUT | S (pulir) | Medio | — |
| 55 | Estado documental del vehículo (revisión técnica, permiso de circulación) [W] | **Falta** | Sin campos en `vehiculos` (grep sin resultados) | S | Bajo–medio (lubricentro) | — |
| 56 | Aprobación presencial de cotización ("respondió en el local") y registro de quién/cuándo aprobó [A] | **Parcial** | Solo "Marcar aceptado" por el personal (`PresupuestoDetalle.jsx:244`), sin autor de la respuesta | S | Medio | #5 |
| 57 | Caja con apertura, arqueo (debería haber vs contado), cobro parcial, vuelto y comprobante 80 mm/carta [A] | **Falta** | Ver #7; `0013` | M | **Alto** | #7 |
| 58 | Vínculo cotización ↔ OT ↔ cobro sin doble conteo [A] | **Parcial** | Presupuestos ligados a OT (`presupuestos_taller`, `trabajos_taller`); sin cobro (#7) | M | Alto | #5, #7 |
| 59 | Ingreso rápido: cliente + vehículo + OT en una pantalla corta [A] | **Parcial** | `NuevoIngreso.jsx` (1.244 líneas) con dos flujos y muchos campos | M | **Alto** | #1, #47 |
| 60 | Checklist de entrada corto por defecto, con versión profunda opcional [A] | **Parcial** | RADAR 48 puntos (`0029`) y escáner (`0068`); sin versión liviana | S–M | Medio | #47 |
| 61 | Anticipo/abono al aprobar la cotización [A] | **Falta** | Sin pagos (#7) | S–M | Medio | #57 |
| 62 | Flujo guiado de la OT: un botón principal por etapa (Aprobar → Empezar → Marcar lista → Cobrar → Entregar) con historial de autor y hora [A] | **Parcial** | Kanban y detalle (`Taller.jsx`, `DetalleOt.jsx`), estados desde ClickUp; cierre con bloqueo (`0026`) | M | **Alto** | #2, #47 |
| 63 | Checklist de salida y pantalla de entrega "así llegó y así sale" (fotos de llegada vs salida) [A] | **Parcial** | Orden de egreso con firma (`OrdenEgreso.jsx`, `0020`) y fotos de inspección (`0068`); sin comparación de fotos llegada/salida | M | Medio–Alto | #4 |
| 64 | Detección de foto duplicada en la OT [A] | **Falta** | `inspeccion_fotos` sin huella de imagen (`0068`) | S | Medio (anti-fraude) | — |
| 65 | Inventario con reserva al agregar a la OT y consumo al marcarla lista; "alcanza para N días" [A] | **Parcial** | Stock por movimientos con `uso_ot` (`0012`); sin reserva ni proyección | S–M | Medio | #49 |
| 66 | Reportes operativos: tiempo por etapa, puntualidad vs hora comprometida, reabiertas, repasos, vehículos por hora [A] | **Parcial** | Retrabajos por técnico (`0011`); sin tiempos por etapa ni puntualidad (`Informes.jsx`) | M | Alto | #62 |
| 67 | Cotización con ítems incluidos/opcionales y total dinámico para el cliente [A] | **Falta** | Aceptación parcial solo por el personal | S–M | Alto | #5 |
| 68 | Comisión del mecánico como % por servicio en el catálogo [A] | **Falta** | Sin comisiones (#11) | S | Medio | #11 |
| 69 | Hora estimada de término de la OT según duración de los servicios [A] | **Falta** | `duracion` existe en agenda (`0010`); sin cálculo en la OT | S | Medio | — |
| 70 | Checklist de entrada configurable (puntos obligatorios, fotos/km/firma/video exigibles) con modo liviano [A] | **Parcial** | Checklists editables en el taller (`README.md`); RADAR fijo (`0029`) | M | Medio | #47, #60 |
| 71 | Textos de firma con versión y código de integridad [A] | **Falta** | Firma PNG sin versión (`0003`, `0020`, `FirmaCanvas.jsx`); ver #34 | S | Medio | — |
| 72 | Estados de cotización con seguimiento de lectura: Enviada → Vista → Aprobada [A] | **Falta** | Estados `borrador/enviado/aceptado/parcial/rechazado/anulado` (`0006`), sin "visto" | S | Medio | #5 |
| 73 | Ficha de cliente con métricas (gasto, visitas, ticket, última visita) y pendientes (cotización sin respuesta) [A] | **Parcial** | `ClienteDetalle.jsx` con historial; sin métricas ni pendientes (no verificado en detalle) | S–M | Medio | #44 |
| 74 | Envío por canal elegible (WhatsApp / correo / link) con canales activables por negocio [A] | **Falta** | WhatsApp solo bandeja/bot por número de taller (`whatsapp/index.ts`); correo solo encuestas (`brevo.ts`) | M | Alto | #31, #32 |

Fila extra, para no olvidar lo no listado: **notificaciones de repuestos, bloqueo de OT cerrada, descuentos con tope, turnos/RRHH, cumplimiento de datos** existen y no tienen equivalente en la lista [U].

---

## 4. Evaluación no funcional

| Área | Estado | Evidencia / comentario |
|---|---|---|
| **Onboarding** | Débil | Sin alta de taller, sin importación de clientes/catálogo, sin asistente. Puesta en marcha manual (README: crear cuentas con script de service role, correr SQL a mano, desplegar funciones, configurar ClickUp) |
| **Rendimiento** | Desconocido [S] | Sin mediciones. Riesgos: páginas de 1000+ líneas, consultas `select` anchas con joins (`TrabajoDetalle:348`), sin paginación verificada, chequeos de RLS vía función por fila (`mi_empresa_id()`) — revisar índices (`verificar-indices-sql` ayuda). Hay un workflow keepalive de Supabase, señal de plan gratuito [H: `supabase-keepalive.yml`] |
| **Seguridad** | Buena base, con huecos | ✔ RLS en todo, REVOKE de columna para costos, `revoke select anon` (`0072`), HMAC en webhook WhatsApp, errores sanitizados (`_shared/seguridad.ts`), CORS compartido, purga de datos. ✘ Contraseña demo compartida en el bundle; `.mcp.json` en el repo apunta a un `project_ref` real de Supabase; sin MFA/recuperación verificados; no hay revisión de dependencias (`xlsx` desde CDN de SheetJS); auditoría/bitácora solo en algunas acciones |
| **Permisos por rol** | Granular pero acoplado a Didial | 8 roles fijos; sin roles personalizables por tenant; triple fuente de verdad (UI/RLS/Edge). Falta rol "técnico móvil" acotado y "contador" |
| **Backups** | No documentado | Nada en el repo. Depende del plan de Supabase (PITR solo en planes de pago) [S]. Falta runbook de restauración y backup de Storage |
| **Tests** | Bajo | 3 tests unitarios edge + prueba del escáner; sin tests de RLS entre tenants (el riesgo más caro de un SaaS multi-tenant), sin e2e |
| **Facilidad de vender a terceros** | Baja hoy | Faltan #20, #21, ClickUp desacoplado, DTE real, branding/rebrand por tenant (el rebrand a VPAI fue por migración, `0065`), términos y privacidad ya existen ✔ |

---

## 5. Roadmap por fases

### 5.0 Ruta crítica y atajos de valor rápido

**Ruta crítica (cada paso habilita el siguiente) [S]:**
1. Tests RLS entre empresas + autenticación real → 2. Alta de tenant sin SQL manual → 3. Estados de OT propios (sin ClickUp) → 4. **Rutas públicas con token** (cotización por link) → 5. Pagos y caja → 6. DTE real → 7. Avisos WhatsApp (con consentimiento y plantillas) → 8. Perfiles de rubro → 9. Planes, créditos y cobro de suscripción.

El paso 4 es el patrón que reutilizan la espera en vivo, el link de pago, la firma remota y la página pública del negocio: construirlo bien una vez evita rehacerlo cuatro veces.

**Quick wins (≤ 1–2 semanas cada uno, valor inmediato para un taller real) [S]:**

| Quick win | Fila de la matriz | Por qué primero |
|---|---|---|
| Registro de consentimiento y baja de WhatsApp | #31 | Prerrequisito legal y de Meta para cualquier aviso automático |
| Barra inferior móvil y botón de ingreso | #39 | El personal usa el celular en el taller; hoy el menú no se adapta |
| PDF de cotización y orden | #6 | Lo piden los clientes por WhatsApp; hoy solo hay impresión del navegador |
| Alerta de stock mínimo en pantalla | #49 | El campo ya existe (`0012`); cuesta poco |
| Firma con huella y versión del documento | #34 | Valor probatorio con poco cambio de esquema |
| Garantía con vencimiento y documentos del vehículo | #51, #55 | Dos campos con alto valor percibido en instalaciones y lubricentros |
| Filtros de cartera "Frecuentes / No vuelven" | #44 | Reutiliza el informe de retorno que ya tienes |

**Apuestas grandes (conviene planificar bien):** desacoplar ClickUp (#2/#47), cobro y caja (#7/#23), DTE real (#8), perfiles de rubro (#47), planes y alta autoservicio (#20/#21).

---

Orden dentro de cada fase = prioridad sugerida. Las estimaciones son [S].

### Fase 0 — Base técnica y deuda (≈4–6 semanas)
**Objetivo:** poder construir rápido sin romper y poder tener un segundo taller sin riesgo.

Entregables (en orden):
1. **Tests de aislamiento multi-tenant (RLS)**: dos empresas, intentar leer/escribir cruzado en cada tabla y bucket; en CI.
2. **Entorno staging + migraciones automatizadas** (reemplazar "SQL Editor a mano") y `verificar:edge` en CI.
3. **Autenticación real**: usuarios con correo propio, invitación, recuperación de clave; el selector de rol queda solo para `es_demo`. Quitar contraseña demo del bundle de producción.
4. **Desacoplar ClickUp**: tabla propia de estados/tablero (`ot_estado`) con ClickUp como sincronización opcional. Sin esto no existe "fila" propia ni espera en vivo.
5. **Alta de tenant** (script o endpoint admin): crea empresa, admin, horarios, catálogo base. Elimina "primera empresa activa" del trigger.
6. **Responsive móvil** del Menú y de ingreso/OT/técnico (drawer, tablas → tarjetas). Patrón observado en Automovity [A] como referencia funcional (no de diseño): barra inferior con 4–5 destinos y una acción primaria "ingreso" siempre a mano.
7. Partir `TrabajoDetalle`/`NuevoIngreso` en módulos; runbook de backup/restauración; revisar `.mcp.json` y secretos.
8. **Acceso de soporte auditado**, monitoreo de errores (p. ej. Sentry, sin datos personales) y, al elegir auth, evaluar acceso por código al correo como alternativa a contraseñas [W: lo usa Automovity].

Criterios de aceptación:
- CI falla si un usuario de empresa A puede ver cualquier fila/archivo de empresa B.
- Un taller nuevo se crea sin tocar SQL a mano y sin ClickUp, y todo el flujo ingreso→OT→entrega funciona.
- Un técnico completa su flujo en un teléfono de 360 px sin scroll horizontal.
- Restauración de backup probada una vez y documentada.

### Fase 1 — Paridad en lo esencial (≈8–10 semanas)
**Objetivo:** que un taller real pueda operar el día completo sin salir de VPAI: cotizar, cobrar, emitir, avisar.

Entregables (en orden):
1. **Cotización por link** (token público, vista móvil, aceptar/rechazar por ítem, registro de IP/fecha) + **PDF**. Reutiliza la aceptación parcial ya existente.
2. **Pagos y caja**: tabla `pagos` (efectivo/transferencia/tarjeta, parciales, vínculo a OT/venta POS), cierre diario. Reemplaza `estado_pago` booleano.
3. **DTE real** con un proveedor (la interfaz ya existe, solo falta adaptador + estado asíncrono); boleta/factura desde el cobro. Candidato con precedente en el mercado [W]: OpenFactura (Haulmer) con la cuenta de cada taller; validar costos y API antes de decidir.
4. **Avisos automáticos por WhatsApp/correo**: recepción, "listo para retiro", recordatorio de cita; plantillas, cola con reintentos. **Primero**, registro de consentimiento y BAJA (#31). **Decisión de modelo** (#32): número central de VPAI con plantillas por taller [W: así lo hace Automovity], frente a un número por taller (tu diseño actual, con aprobación de Meta pendiente). El número central simplifica el onboarding pero te hace responsable ante Meta de la calidad de todos los talleres.
5. **Fila propia + espera en vivo pública** (usa Fase 0.4): ruta pública por token con estado de la OT.
6. **Informes financieros base**: ingresos por día/semana/mes, ticket promedio, cobrado vs pendiente, por técnico.
7. **Gastos simples** y alerta de stock mínimo.
8. **Anticipos/abonos y arqueo** (parte de la caja) y **seguimiento automático** de cotizaciones por vencer (usa la cola de avisos del punto 4).
9. **Importación desde Excel** de clientes y vehículos (necesaria para onboarding en Fase 3; puede adelantarse si hay un segundo taller).
10. **Flujo guiado de la OT** (#62): un botón principal por etapa con historial, estados propios y hora estimada de término (#69), más checklist de salida y pantalla de entrega con fotos llegada/salida (#63).
11. **Cotización con opcionales** (#67) en el link público y **reserva/consumo de stock** ligados a la OT (#65), incluidos desde el diseño del vínculo cotización ↔ OT ↔ cobro.
12. **Reportes operativos** (#66): ventas, por mecánico, tiempo por etapa y puntualidad, sobre las marcas de tiempo del flujo guiado.

Criterios de aceptación:
- Un cliente aprueba una cotización desde el celular sin cuenta y el asesor ve el cambio en <1 min.
- El cierre de caja cuadra con la suma de pagos del día en datos de prueba.
- Una boleta emitida en el ambiente de certificación del SII del proveedor queda aceptada.
- Al pasar la OT a "listo", se envía un solo aviso (idempotente) y queda registrado.
- Ningún enlace público permite ver datos de otra OT (prueba automatizada).
- Metas de uso inspiradas en el recorrido de la sección 1f [S, a validar con talleres]: crear cliente + vehículo + OT en menos de 1 minuto desde el celular; enviar una cotización con link en 3 toques o menos desde la OT; cobrar y comprobar en menos de 30 segundos.
- Cotización, OT y cobro quedan enlazados: aprobar una cotización actualiza la OT y el cobro no se cuenta dos veces (prueba automatizada).

### Fase 2 — Diferenciación (≈6–8 semanas)
**Objetivo:** que VPAI sea elegido por lo que Automovity no muestra en su web ni en su panel [W/A]: retención accionable, calidad, inspección con IA y cumplimiento de datos.

Entregables:
1. **Comisiones por persona** (reglas por tipo de tarea/margen, sobre cobrado).
2. **CRM de retención**: oportunidades automáticas por kilometraje/fecha de mantención, campañas por WhatsApp segmentadas, reactivación.
3. **Encuestas → acciones**: NPS por técnico/servicio, alertas, reseña en Google tras nota alta.
4. **Análisis financiero**: margen por servicio/OT, costo de repuestos vs precio (aprovecha columnas protegidas), retrabajo con costo.
5. **IA**: cotización sugerida a partir de hallazgos RADAR + fotos; resumen de OT para el cliente; mensajes de WhatsApp asistidos.
6. **Perfiles de rubro** (#47): marco configurable (etapas, checklist de recepción, tipos de vehículo, catálogo semilla) y, en este orden, electricidad → lubricentro/serviteca (fila rápida #50, precio por aro #48, recordatorio de mantención #24) → instalaciones (garantía #51) → car wash. Solo los rubros que confirmes con talleres reales (pregunta 4).
7. **Aseguradoras/liquidadores** (estado "esperando liquidador", PDF con fotos, respaldo de aprobación): refuerza DyP, donde ya tienes diagrama de daños y fotos.
8. **Página pública del negocio con reservas** y recursos físicos (bahías/elevadores) que bloquean horas.
9. Video corto de recepción/entrega y firma por link (evaluar costo de almacenamiento); firma con huella y versión del documento (#34).
10. **IA de captura**: leer patente/padrón/kilometraje por foto y dictar notas a la OT (#33), con confirmación humana como ya haces en la inspección.

Criterios de aceptación:
- Un administrador ve margen real por OT y por técnico del mes.
- Campaña de reactivación enviada a un segmento y atribuida a OT agendadas.
- La sugerencia de cotización de IA reduce el tiempo de armado (medirlo en 5 talleres/OTs piloto).

### Fase 3 — Escala y comercialización (≈6–8 semanas, en paralelo parcial)
**Objetivo:** vender sin intervención manual.

Entregables:
1. **Planes y límites** (Starter/Premium propios) + **prueba de 14 días** + cobro de suscripción. Referencia [W]: Automovity limita por personas y por cantidad de WhatsApp/correos, no por funciones; el consumo de WhatsApp tiene costo real para ti, así que medirlo por tenant es obligatorio. Definir además si la configuración/capacitación será servicio incluido o de pago.
2. **Autoservicio de alta** con asistente (datos del taller, importar clientes/catálogo desde Excel, invitar equipo). Referencia [A]: lista de "Primeros pasos" de 8 tareas con avance, catálogo y horario precargados según el rubro elegido, y activación asistida de boletas y pagos online (no inmediata). Planifica ese paso manual con el proveedor.
3. Marca por tenant (logo ya existe: `0024`), dominio/subdominio, portal público con marca del taller.
4. Mercado Pago / TUU para cobro en caja y links de pago.
5. Observabilidad, monitor por tenant (ya hay base: `0056`), soporte y límites de uso de IA/WhatsApp.
6. Evaluar app nativa solo si el PWA limita (notificaciones, cámara).

Criterios de aceptación:
- Un taller se registra, importa datos y emite su primera OT en <30 min sin ayuda.
- Un tenant en prueba queda limitado al vencer el trial.
- Costo de IA/WhatsApp por tenant medible y acotado.

---

## 6. Dónde VPAI ya supera a Automovity [H vs W/A]

*(Comparo contra lo que Automovity afirma [W] y lo que vi en su app [A]. No vi encuestas de postventa, IA de inspección con detección de daños ni cumplimiento de datos personales con solicitudes de titulares. **Sí vi "Repasos" (retrabajos) por mecánico, reabiertas, tiempo por etapa y puntualidad**, así que tu informe de retrabajos ya no es un diferencial por sí solo. No vi WhatsApp, boleta ni encuestas en uso, y "no lo vi" no prueba que no exista. Ojo: sí ofrecen recordatorios de mantención y seguimiento de cotizaciones, que acercan su "retención" a la tuya.)*

| Ventaja | Evidencia | Cómo convertirla en ventaja competitiva |
|---|---|---|
| **CRM y retención** (ventaja moderada: Automovity también filtra clientes "Frecuentes / No vuelven" [A]) | `Oportunidades.jsx`, informe "Clientes que vuelven" (`0011`: 65,9 % de vehículos vienen una sola vez, dato del taller original) | Posicionar "no solo ordena el taller, trae clientes de vuelta". Automatizar recordatorios por km/fecha y reportar ingresos recuperados |
| **Encuestas de postventa** | `encuestas`, envío al día siguiente, alerta de nota negativa | Mostrar NPS por técnico, cerrar el ciclo con acción del asesor, pedir reseña en Google a promotores |
| **IA de inspección** (ventaja parcial) | `analizar-inspeccion` (Claude visión), escáner por video, aceptación humana. **Automovity también tiene IA [W]**, pero de captura de datos (patente, padrón, km, dictado, consultas), no de detección de daños/inventario que yo haya visto | Tu diferencial es el daño y el inventario sugeridos con aceptación humana. Súmale la captura (OCR patente/padrón, dictado) para igualar, y la cotización sugerida para superar. Cuidar costo por OT |
| **Análisis de calidad/financiero** (ventaja débil: Automovity ya mide repasos, reabiertas, tiempo por etapa y puntualidad [A]) | Retrabajos por técnico, captura de datos, presupuestos por decisión. *Análisis financiero propiamente dicho aún no existe* (ver F2.4) | Para diferenciarte, ve más allá de lo que vi: **margen por OT** (tienes columnas de costo protegidas), costo de los retrabajos y calidad de captura de datos. Automovity muestra monto y tiempo, no margen [A] |
| **Agenda por habilidades** | `0048` | Evita sobreagendar; mostrar ocupación real vs capacidad |
| **Cumplimiento Ley 21.719** | `0073`, `0074`, políticas legales | Argumento comercial de confianza para talleres/flotas; "listo para auditoría de datos" |
| **Seguridad de precios** | RLS + REVOKE de columna | Rol técnico sin ver costos; atractivo para dueños con personal rotativo |

---

## 7. Los 5 primeros pasos concretos

1. **Definir el modelo cotización ↔ OT ↔ cobro de VPAI** (2–3 días, con la sección 1f como referencia funcional): qué es una "venta" (cobro u OT entregada), cómo se enlazan y qué estados tiene cada una. Es la decisión que más condiciona caja, reportes y comisiones. Aún no vi en Automovity los varios ítems, los opcionales, WhatsApp, boleta ni tarjeta; si quieres, los pruebo antes de que termine tu prueba el 20 nov 2026. Es solo para entender el nivel funcional: no copies textos ni diseño.
2. **Definir con Didial cuál es el repo/producto real** (1 día): confirmar qué de lo demo falta o difiere en producción (ver preguntas). Evita planificar sobre código distinto.
3. **Escribir los tests de aislamiento RLS entre dos empresas y meterlos en CI** (3–5 días). Es lo que protege al negocio de todo lo demás.
4. **Desacoplar el estado de la OT de ClickUp** (2–3 semanas): nueva tabla de estados/tablero propio; ClickUp pasa a sincronización opcional. Habilita fila, espera en vivo y venta a talleres sin ClickUp.
5. **Prototipo de cotización por link + aprobación** (1–2 semanas): ruta pública `/c/:token`, RPC con acceso anónimo acotado a esa cotización, aceptación por ítem. Es el mayor valor rápido para un taller real y valida el patrón de rutas públicas que usarán espera en vivo y pagos.

---

## 8. Preguntas abiertas (necesito tu respuesta antes de asumir)

1. En tu cuenta de Automovity quedaron datos de prueba (lista en la sección 1g). ¿Los dejo o prefieres que cierre la caja y complete la entrega de la OT-1? Para probar WhatsApp, "enviar para firmar", la reserva pública o la boleta necesito un número de teléfono de prueba tuyo, porque envían mensajes reales.
2. ¿El **repo de producción de Didial** es otro? ¿Tiene cobro/caja, DTE real (el código menciona "Dimasoft" como facturador externo, `0013`) o WhatsApp aprobado que no están aquí?
3. ¿VPAI es solo para Didial, o el objetivo es **vender a otros talleres** desde ya? Cambia el peso de la Fase 0.5 y la Fase 3.
4. ¿Qué rubros además de mecánica/DyP quieres vender primero (sección 1e)? Sugiero electricidad y lubricentro/serviteca como siguientes. Si ninguno, dejo multirrubro fuera de las Fases 1 y 2.
5. ¿Hay presupuesto/preferencia de **proveedor DTE** (¿OpenFactura/Haulmer u otro?) y de pasarela (Mercado Pago/TUU/Transbank)? Afecta F1.3 y F3.4. ¿Te interesa cobrar comisión por pagos online como Automovity [W]?
6. ¿Aprobó Meta la cuenta WhatsApp ("Tech Provider")? ¿Prefieres **número central de VPAI** o **un número por taller**? Condiciona F1.4.
7. ¿Cuántos usuarios simultáneos y cuántos talleres esperas el primer año? Para decidir plan de Supabase, backups y rendimiento.
