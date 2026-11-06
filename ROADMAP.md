# VPAI → paridad con Automovity: análisis de brechas y roadmap

Fecha: 2026-11-06 · Rama: `claude/vpai-automovity-gap-analysis-pl7inh` · Solo análisis, no se implementó nada.

**Convención de evidencia**
- **[H]** Hecho: verificado en código del repo (archivo/ruta citados).
- **[U]** Dato aportado por ti (la lista de Automovity del encargo). **No verificado** por mí.
- **[S]** Suposición/inferencia mía, a confirmar.

---

## 0. Advertencias antes de leer (importante)

1. **No pude revisar la web de Automovity.** `automovity.com` no resuelve desde este entorno (el proxy devuelve 403 en el túnel y un subagente obtuvo `ENOTFOUND`), y una búsqueda web no devolvió ninguna página de Automovity. Por eso **no confirmé ni amplié** su lista de funciones, precios, FAQ ni integraciones. Toda la columna "Automovity" de este documento es **[U]**. Los precios de Starter/Premium, los límites de plan y los 7 rubros quedan sin verificar. Para cerrar esto necesito que permitas ese dominio en la red de la sesión (ver "Preguntas abiertas").
2. **El repo es una versión demo/portafolio**, no el producto de producción (`README.md`: "versión de demostración, adaptada de un proyecto en producción real"). El código de producción de Didial podría tener cosas que aquí no están (p. ej. el esquema dice que el tenant real "se siembra aparte", `0001_esquema_roles.sql`). Mi auditoría cubre **solo lo que hay en este repo**.
3. Revisé arquitectura, migraciones (74), Edge Functions (11), rutas, CI y componentes clave. **No ejecuté la app ni la base de datos**, así que nada aquí está probado en ejecución.

---

## 1. Resumen ejecutivo

**Qué es VPAI hoy [H]:** un CRM/OS multi-tenant para taller, con React 18 + Vite + Tailwind (PWA) sobre Supabase (Postgres + RLS + Auth + Storage + Edge Functions) (`package.json`, `vite.config.js`, `README.md`). ~13,7 mil líneas de páginas, 74 migraciones, 11 funciones edge. Tiene mucho más profundidad operativa que un SaaS "de entrada": checklist de 48 puntos (RADAR), escáner de inspección con cámara + análisis por visión de IA, Kanban + plano del taller, agenda por habilidades del personal, bandeja de WhatsApp con bot, bodega por movimientos, facturación DTE (solo sandbox), encuestas de postventa, informes de calidad, turnos/asistencia y un bloque de cumplimiento de datos personales (Ley 21.719) poco común.

**Dónde está lejos de Automovity [H vs U]:**
1. **No es vendible a terceros todavía**: no hay alta de talleres (self-service), ni planes, ni cobro de suscripción, ni onboarding; el login es un selector de rol con contraseña compartida de demo (`src/pages/LoginDemo.jsx`, `src/lib/demo.js`), y el primer usuario nuevo cae en "la primera empresa activa" (`0001_esquema_roles.sql`, trigger de alta).
2. **Cobro real inexistente**: no hay caja, medios de pago, Mercado Pago/TUU ni conciliación. Solo se registra "pagado/pendiente" y número de documento (`TrabajoDetalle.jsx:315,712`; `0013_punto_venta.sql` dice explícitamente "Sin manejo de pago real"). La factura/boleta SII existe pero solo con proveedor **sandbox** sin validez tributaria (`_shared/dte/sandbox.ts`, `README.md`).
3. **Sin superficie pública para el cliente final**: la única ruta pública útil es la encuesta (`/encuesta/:token`). No hay aprobación de cotización por link, ni espera en vivo, ni PDF del servidor (solo impresión del navegador).
4. **Comunicación saliente automática casi ausente**: WhatsApp es bandeja + bot entrante y envío manual; no hay avisos automáticos de "recibido/listo/recordatorio" (`whatsapp/index.ts` solo usa `type: 'text'`; sin plantillas). Además **la cuenta de Meta sigue sin aprobación** (comentario en `whatsapp/index.ts`: "nunca se ha probado contra un webhook real").
5. **Comisiones, gastos y caja**: faltan (no existen tablas de gastos/comisiones; las únicas métricas por persona son retrabajos).
6. **Dependencia de ClickUp** como motor del Kanban y estados, con IDs "DEMO_TEAM_ID" hardcodeados (`_shared/clickup.ts`): un freno de multi-tenant y de venta a terceros.

**Dónde VPAI ya gana [H]:** CRM de retorno/oportunidades, encuestas de postventa con alerta de nota negativa, IA de inspección, informes de calidad (retrabajos por técnico), agenda por habilidades, cumplimiento de datos personales, y RLS fino por rol con protección de precios por columna.

**Recomendación:** no perseguir paridad de vistosidad. Orden: (0) cerrar deuda que bloquea vender (tests, ClickUp, onboarding de tenants, auth real) → (1) lo que un taller usa a diario y hoy no puede hacer en VPAI (aprobación de cotización por link, cobro real, aviso "listo" por WhatsApp, firma/foto de ingreso en móvil, DTE real) → (2) diferenciarse con CRM/IA/finanzas → (3) planes, cobro de suscripción y escala.

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

| # | Funcionalidad (ref. Automovity [U]) | Estado en VPAI | Evidencia [H] | Esfuerzo | Impacto | Dependencias |
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
| 18 | Multirrubro (7) | **Falta** | Catálogo y roles acoplados a mecánica/DyP (`catalogo_servicios`, bot) | L | Bajo (corto plazo) | Configuración por tenant |
| 19 | Apps móviles | **Parcial** | PWA instalable | S–M | Medio | Responsive; evaluar nativo después |
| 20 | Planes + prueba gratis 14 d | **Falta** | Sin concepto de plan | M | **Alto** (para vender) | Onboarding, cobro suscripción |
| 21 | Alta self-service de taller | **Falta** | Trigger asigna "primera empresa activa" | M | **Alto** (para vender) | Auth real, plantillas de datos |

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

Orden dentro de cada fase = prioridad sugerida. Las estimaciones son [S].

### Fase 0 — Base técnica y deuda (≈4–6 semanas)
**Objetivo:** poder construir rápido sin romper y poder tener un segundo taller sin riesgo.

Entregables (en orden):
1. **Tests de aislamiento multi-tenant (RLS)**: dos empresas, intentar leer/escribir cruzado en cada tabla y bucket; en CI.
2. **Entorno staging + migraciones automatizadas** (reemplazar "SQL Editor a mano") y `verificar:edge` en CI.
3. **Autenticación real**: usuarios con correo propio, invitación, recuperación de clave; el selector de rol queda solo para `es_demo`. Quitar contraseña demo del bundle de producción.
4. **Desacoplar ClickUp**: tabla propia de estados/tablero (`ot_estado`) con ClickUp como sincronización opcional. Sin esto no existe "fila" propia ni espera en vivo.
5. **Alta de tenant** (script o endpoint admin): crea empresa, admin, horarios, catálogo base. Elimina "primera empresa activa" del trigger.
6. **Responsive móvil** del Menú y de ingreso/OT/técnico (drawer, tablas → tarjetas).
7. Partir `TrabajoDetalle`/`NuevoIngreso` en módulos; runbook de backup/restauración; revisar `.mcp.json` y secretos.

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
3. **DTE real** con un proveedor (la interfaz ya existe, solo falta adaptador + estado asíncrono); boleta/factura desde el cobro.
4. **Avisos automáticos por WhatsApp/correo**: recepción, "listo para retiro", recordatorio de cita; plantillas, cola con reintentos, opt-out. Requiere cerrar la aprobación de Meta (hoy pendiente).
5. **Fila propia + espera en vivo pública** (usa Fase 0.4): ruta pública por token con estado de la OT.
6. **Informes financieros base**: ingresos por día/semana/mes, ticket promedio, cobrado vs pendiente, por técnico.
7. **Gastos simples** y alerta de stock mínimo.

Criterios de aceptación:
- Un cliente aprueba una cotización desde el celular sin cuenta y el asesor ve el cambio en <1 min.
- El cierre de caja cuadra con la suma de pagos del día en datos de prueba.
- Una boleta emitida en el ambiente de certificación del SII del proveedor queda aceptada.
- Al pasar la OT a "listo", se envía un solo aviso (idempotente) y queda registrado.
- Ningún enlace público permite ver datos de otra OT (prueba automatizada).

### Fase 2 — Diferenciación (≈6–8 semanas)
**Objetivo:** que VPAI sea elegido por lo que Automovity [U] no lista: retención y datos.

Entregables:
1. **Comisiones por persona** (reglas por tipo de tarea/margen, sobre cobrado).
2. **CRM de retención**: oportunidades automáticas por kilometraje/fecha de mantención, campañas por WhatsApp segmentadas, reactivación.
3. **Encuestas → acciones**: NPS por técnico/servicio, alertas, reseña en Google tras nota alta.
4. **Análisis financiero**: margen por servicio/OT, costo de repuestos vs precio (aprovecha columnas protegidas), retrabajo con costo.
5. **IA**: cotización sugerida a partir de hallazgos RADAR + fotos; resumen de OT para el cliente; mensajes de WhatsApp asistidos.
6. Configuración multirrubro básica (catálogos y checklists por tipo de negocio) solo si hay demanda real.

Criterios de aceptación:
- Un administrador ve margen real por OT y por técnico del mes.
- Campaña de reactivación enviada a un segmento y atribuida a OT agendadas.
- La sugerencia de cotización de IA reduce el tiempo de armado (medirlo en 5 talleres/OTs piloto).

### Fase 3 — Escala y comercialización (≈6–8 semanas, en paralelo parcial)
**Objetivo:** vender sin intervención manual.

Entregables:
1. **Planes y límites** (Starter/Premium propios) + **prueba de 14 días** + cobro de suscripción.
2. **Autoservicio de alta** con asistente (datos del taller, importar clientes/catálogo desde Excel, invitar equipo).
3. Marca por tenant (logo ya existe: `0024`), dominio/subdominio, portal público con marca del taller.
4. Mercado Pago / TUU para cobro en caja y links de pago.
5. Observabilidad, monitor por tenant (ya hay base: `0056`), soporte y límites de uso de IA/WhatsApp.
6. Evaluar app nativa solo si el PWA limita (notificaciones, cámara).

Criterios de aceptación:
- Un taller se registra, importa datos y emite su primera OT en <30 min sin ayuda.
- Un tenant en prueba queda limitado al vencer el trial.
- Costo de IA/WhatsApp por tenant medible y acotado.

---

## 6. Dónde VPAI ya supera a Automovity [H vs U]

*(Comparo contra la lista [U]; si Automovity tiene estos módulos, no los conozco.)*

| Ventaja | Evidencia | Cómo convertirla en ventaja competitiva |
|---|---|---|
| **CRM y retención** | `Oportunidades.jsx`, informe "Clientes que vuelven" (`0011`: 65,9 % de vehículos vienen una sola vez, dato del taller original) | Posicionar "no solo ordena el taller, trae clientes de vuelta". Automatizar recordatorios por km/fecha y reportar ingresos recuperados |
| **Encuestas de postventa** | `encuestas`, envío al día siguiente, alerta de nota negativa | Mostrar NPS por técnico, cerrar el ciclo con acción del asesor, pedir reseña en Google a promotores |
| **IA de inspección** | `analizar-inspeccion` (Claude visión), escáner por video, aceptación humana | Vender "inspección en 2 minutos, sin tipear"; llevarlo a cotización sugerida. Cuidar costo por OT |
| **Análisis de calidad/financiero** | Retrabajos por técnico, captura de datos, presupuestos por decisión. *Análisis financiero propiamente dicho aún no existe* (ver F2.4) | Completar con margen por OT. Hoy la ventaja es de calidad, no de finanzas |
| **Agenda por habilidades** | `0048` | Evita sobreagendar; mostrar ocupación real vs capacidad |
| **Cumplimiento Ley 21.719** | `0073`, `0074`, políticas legales | Argumento comercial de confianza para talleres/flotas; "listo para auditoría de datos" |
| **Seguridad de precios** | RLS + REVOKE de columna | Rol técnico sin ver costos; atractivo para dueños con personal rotativo |

---

## 7. Los 5 primeros pasos concretos

1. **Desbloquear la investigación de Automovity** (1 día): permitir `automovity.com` en la red, o pegarme precios/FAQ/capturas; con eso reviso la matriz #5–#9, #16–#21 y ajusto prioridades. Sin eso, la Fase 1 descansa en tu lista.
2. **Definir con Didial cuál es el repo/producto real** (1 día): confirmar qué de lo demo falta o difiere en producción (ver preguntas). Evita planificar sobre código distinto.
3. **Escribir los tests de aislamiento RLS entre dos empresas y meterlos en CI** (3–5 días). Es lo que protege al negocio de todo lo demás.
4. **Desacoplar el estado de la OT de ClickUp** (2–3 semanas): nueva tabla de estados/tablero propio; ClickUp pasa a sincronización opcional. Habilita fila, espera en vivo y venta a talleres sin ClickUp.
5. **Prototipo de cotización por link + aprobación** (1–2 semanas): ruta pública `/c/:token`, RPC con acceso anónimo acotado a esa cotización, aceptación por ítem. Es el mayor valor rápido para un taller real y valida el patrón de rutas públicas que usarán espera en vivo y pagos.

---

## 8. Preguntas abiertas (necesito tu respuesta antes de asumir)

1. ¿Puedes permitir `automovity.com` en la red del entorno, o prefieres pegarme su contenido? Hoy no está verificado.
2. ¿El **repo de producción de Didial** es otro? ¿Tiene cobro/caja, DTE real (el código menciona "Dimasoft" como facturador externo, `0013`) o WhatsApp aprobado que no están aquí?
3. ¿VPAI es solo para Didial, o el objetivo es **vender a otros talleres** desde ya? Cambia el peso de la Fase 0.5 y la Fase 3.
4. ¿Qué rubros además de mecánica/DyP interesan (Automovity [U] cita 7)? Si ninguno, descarto multirrubro por ahora.
5. ¿Hay presupuesto/preferencia de **proveedor DTE** y de pasarela (Mercado Pago/TUU/Transbank)? Afecta F1.3 y F3.4.
6. ¿Aprobó Meta la cuenta WhatsApp ("Tech Provider")? Condiciona F1.4.
7. ¿Cuántos usuarios simultáneos y cuántos talleres esperas el primer año? Para decidir plan de Supabase, backups y rendimiento.
