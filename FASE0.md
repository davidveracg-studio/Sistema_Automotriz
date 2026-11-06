# Fase 0 — Base técnica de VPAI: plan de trabajo

Fecha: 2026-11-06 · Complementa a `ROADMAP.md` (sección 5) · Solo plan, no se implementó nada.

**Etiquetas:** **[H]** hecho verificado en el repo (archivo citado) · **[W]/[A]** referencia funcional observada en Automovity (solo nivel funcional, sin copiar textos ni diseño) · **[S]** suposición mía a confirmar.

---

## 1. Contexto y qué cambió en el diagnóstico

**Contexto nuevo (tu respuesta):** VPAI es tu **marca personal / plataforma**, no un producto de Didial; el repo de Didial es **otro**; trabajas en **otros rubros**. Consecuencias para la Fase 0 [S]:
- Este repo pasa a ser la **base de producto** que puedes ofrecer a distintos negocios. El núcleo debe ser **configurable por tenant y por rubro** desde el principio, no una app de taller con ajustes encima.
- Los datos y el código de Didial **no deben mezclarse** con este repo ni con su base. El README ya declara que los datos son ficticios; hay que poder demostrarlo (WP0.0).

**Correcciones a mi análisis anterior (las encontré al preparar este plan):**

| Lo que dije en `ROADMAP.md` | Lo que dice el código [H] | Efecto en el plan |
|---|---|---|
| Migraciones "a mano en el SQL Editor" | `deploy-vercel.yml` tiene un job `migrar` que ejecuta `scripts/migrar.sh` antes de publicar; lleva registro en `migraciones_aplicadas` y cada migración corre en su transacción (`LINEA_BASE=68`). El README está desactualizado | El trabajo ya no es "automatizar", sino **separar entornos**: hoy se migra **directo a producción** sin staging |
| Edge Functions desplegadas con CI | **No** hay despliegue de funciones en CI; solo `supabase functions deploy` manual (`README.md:61`). `verificar:edge` existe pero `ci.yml` no lo ejecuta | Agregar despliegue y verificación de funciones al pipeline |
| Dependencia fuerte de ClickUp | Existe **modo local** sin ClickUp: `0067_taller_sin_clickup.sql` y `_shared/taller.ts` ("null = modo local"); los estados locales usan ids `local-…` | El desacople está **a medias**: queda neutralizar nombres y modelo (columnas `clickup_*`, `lib/clickup.js`, constantes `DEMO_TEAM_ID`) |
| RLS por verificar | **67 de 67** tablas creadas en migraciones tienen RLS habilitado [H: análisis de `create table` vs `enable row level security`] | Falta **probarlo** (WP0.2), no activarlo |

**Sigue vigente [H]:** el trigger de alta asigna "la primera empresa activa" si falta `empresa_id` (`0001_esquema_roles.sql`, `manejar_usuario_nuevo`); el login es un selector de rol con contraseña compartida `VpaiDemo2026!` en el bundle (`src/lib/demo.js`, `LoginDemo.jsx`); solo hay 3 archivos de prueba (todos en Edge); el menú lateral no tiene breakpoints (`Menu.jsx`); no hay backups documentados, monitoreo de errores ni staging; el repo guarda el `project_ref` de Supabase en `.mcp.json` y la URL en `scripts/crear-demo-vpai.mjs`.

---

## 2. Objetivo, alcance y principios

**Objetivo.** Dejar una base sobre la que puedas **dar de alta un segundo negocio de otro rubro sin tocar SQL a mano, sin ClickUp y sin riesgo de que vea datos ajenos**, y seguir construyendo funciones (Fase 1) con confianza.

**Dentro de la Fase 0:** entornos separados, pruebas de aislamiento, autenticación y alta de tenants, núcleo configurable por rubro, estados de OT propios, móvil, calidad y CI, operación (backups, errores, secretos), soporte auditado.

**Fuera de la Fase 0 (va a Fase 1+):** caja y pagos, DTE real, cotización por link, WhatsApp automático, reportes financieros, IA nueva, planes y cobro de suscripción.

**Principios:** (1) nada nuevo sin prueba que lo proteja; (2) cambios de esquema **aditivos** con migración y vuelta atrás, sin renombrar masivamente a la vez; (3) el modo demo no debe afectar a producción; (4) cada paquete se puede fusionar por separado.

---

## 3. Decisiones que necesito de ti antes de empezar (ADR)

| # | Decisión | Opciones | Cuándo se necesita | Mi recomendación [S] |
|---|---|---|---|---|
| D1 | **¿Qué son "otros rubros"?** | (a) otros rubros automotrices (electricidad, lubricentro, serviteca, car wash…); (b) **industrias no automotrices** (donde "vehículo" no existe) | Antes de WP0.4 | Si es (b), el modelo debe hablar de **"activo"** (vehículo u otro) y no de patente. Eso es un rediseño de nombres que conviene decidir **ahora**, aunque se implemente por etapas |
| D2 | **Nombre y alcance de la marca** en el producto: ¿"VPAI" genérico con perfil por rubro, o marcas por rubro? | Una marca / varias | WP0.0 | Una marca, perfiles de rubro |
| D3 | **Plan de Supabase y staging**: proyecto aparte o *branching* | Proyecto staging / branch / mismo proyecto con esquemas | WP0.1 | Proyecto de staging aparte (más simple de aislar) |
| D4 | **Método de acceso real** | Correo + contraseña con recuperación / **código al correo** (sin contraseña) / ambos | WP0.3 | Código al correo para clientes finales, contraseña opcional para ti como administrador de plataforma |
| D5 | Dónde vive **Didial**: ¿se queda en su repo/proyecto o migrará como un tenant más? | Separado / tenant | WP0.0 | Separado hasta que haya base multi-tenant probada |

---

## 4. Paquetes de trabajo

Estimaciones en **días-persona** para una persona que conoce el código [S]. Las tareas están numeradas para convertirlas en tickets.

### WP0.0 — Identidad, alcance y limpieza (2–3 días)
**Por qué:** separar tu marca de Didial y no dejar rastros de infraestructura real en el repo.
- [ ] T0.0.1 Confirmar D1, D2, D5 y escribirlos como ADR en `docs/adr/`.
- [ ] T0.0.2 Buscar secretos en todo el historial (escaneo de secretos del repo) y rotar lo que aparezca.
- [ ] T0.0.3 Sacar el `project_ref` de `.mcp.json` y la URL fija de `scripts/crear-demo-vpai.mjs` a variables de entorno.
- [ ] T0.0.4 Revisar que ninguna migración de demo (`0036`, `0039`, `0050`, `0057`, `0066`) contenga datos reales de Didial.
- [ ] T0.0.5 Actualizar el `README.md` (migraciones y funciones) a la realidad del pipeline.

**Aceptación:** ADR D1/D2/D5 firmados; escaneo de secretos sin hallazgos abiertos; `README` correcto; ninguna referencia a Didial real en datos.

### WP0.1 — Entornos y despliegue (4–6 días) · depende de D3
**Por qué:** hoy cada `merge` a `main` migra la base de producción y publica; no hay dónde probar [H: `deploy-vercel.yml`].
- [ ] T0.1.1 Crear el proyecto Supabase de **staging** y su secreto `SUPABASE_DB_URL_STAGING`.
- [ ] T0.1.2 En CI: aplicar migraciones a staging en cada PR (con `migrar.sh`), y a producción solo al fusionar a `main`.
- [ ] T0.1.3 Desplegar las Edge Functions desde CI (staging en PR, producción en `main`) y ejecutar `verificar:edge` (`deno check` y `deno lint`).
- [ ] T0.1.4 Variables de Vercel por entorno (preview → staging, producción → producción).
- [ ] T0.1.5 Definir **plan de vuelta atrás** por migración (script inverso o respaldo previo) y documentarlo; hoy `migrar.sh` revierte solo la migración que falla, no una que salió mal.
- [ ] T0.1.6 Separar **demo** de **producción**: la demo vive en staging o en un tenant marcado `es_demo` con límites (existe `empresas.es_demo`).

**Aceptación:** un cambio de esquema se prueba en staging antes de tocar producción; las funciones se despliegan por pipeline; existe un procedimiento escrito de vuelta atrás probado una vez.

### WP0.2 — Pruebas de aislamiento multi-tenant (6–8 días) · depende de WP0.1
**Por qué:** es el mayor riesgo de un SaaS y hoy no hay ninguna prueba de RLS [H: 3 archivos de prueba, todos de Edge].
- [ ] T0.2.1 Crear **dos empresas** y usuarios de cada rol en un esquema de prueba (semillas de prueba, no demo).
- [ ] T0.2.2 Generar la matriz **tabla × operación (select/insert/update/delete) × rol** para las 67 tablas y comprobar que un usuario de la empresa A no ve ni cambia filas de B.
- [ ] T0.2.3 Probar **columnas protegidas** (precios y costos con `REVOKE` de columna): un técnico no los lee.
- [ ] T0.2.4 Probar **Storage**: buckets `radar-fotos`, `inspeccion-fotos`, `logos-empresa` (ruta con `empresa_id`).
- [ ] T0.2.5 Probar **funciones y RPC** accesibles por `anon` (`encuesta_obtener_por_token`, `keepalive`, y toda función `security definer`): que no filtren datos entre empresas ni permitan enumerar tokens.
- [ ] T0.2.6 Probar las **Edge Functions** con ids de otra empresa (`whatsapp`, `analizar-inspeccion`, `facturacion-emitir`, `clickup-*`).
- [ ] T0.2.7 Ejecutar todo en CI (job nuevo) y que **bloquee** el merge si falla.

**Aceptación:** CI falla si alguna tabla, bucket o función permite acceso cruzado; informe con la matriz completa y los hallazgos corregidos.

#### Estado y resultados de WP0.2 (2026-11-06)

**Hecho:** el arnés está en `supabase/tests/aislamiento/` (ver su `README.md`). Aplica las 73 migraciones sobre un Postgres desechable con una emulación mínima de Supabase y ataca desde 8 roles de una empresa y desde `anon`. Hay un job nuevo `aislamiento` en `.github/workflows/ci.yml`.

| Tarea | Estado |
|---|---|
| T0.2.1 Dos empresas con un usuario por rol | Hecho |
| T0.2.2 Matriz tabla × operación × rol | Hecho: 67 tablas, 62 con filas ajenas probadas (2.232 pruebas) y 5 sin cubrir (`documento_tributario_lineas`, `documentos_tributarios`, `personal_horarios`, `plataforma_admins`, `politicas_retencion`); 25 `INSERT` quedan inconclusos por reglas de negocio que los rechazan antes de RLS |
| T0.2.3 Columnas protegidas | Hecho: **hallazgo H1** |
| T0.2.4 Storage | Hecho: 3 buckets, 36 pruebas, 0 fugas (`logos-empresa` es público por diseño) |
| T0.2.5 Funciones y RPC | Hecho: 24 pruebas de explotación e inventario de 61 funciones `SECURITY DEFINER`; **hallazgos H2 y H3** |
| T0.2.6 Edge Functions con ids de otra empresa | **Pendiente**: requiere ejecutar las funciones (Deno) contra un entorno; el arnés no las cubre |
| T0.2.7 Ejecutar en CI y bloquear el merge | **Ejecutado en GitHub Actions** (CI #52, 2026-11-06): el job `aislamiento` corrió las pruebas reales y pasó. **Falta** hacerlo check obligatorio de `main`: hoy el flujo `pr-automatico.yml` fusiona cuando el CI de la rama pasa, pero el CI del evento `pull_request` falló sin jobs en #51 y #53 (ya fallaba antes de este job) y no se investigó |

**Resultado sobre las empresas:** **0 fugas entre empresas** en las 2.232 pruebas de tablas, 9 de escalada de privilegios y 36 de storage. Eso es lo que prueba este arnés; no prueba la capa HTTP de PostgREST ni las Edge Functions.

**La prueba sabe detectar fugas:** se introdujeron a propósito políticas rotas (un `SELECT` abierto en una tabla con `empresa_id`, otro en una tabla hija, un `INSERT` sin `with check`, y `SELECT` + `UPDATE` abiertos) y en cada caso falló. Un `UPDATE` abierto sin `SELECT` abierto no se marca porque en Postgres no es explotable.

| # | Hallazgo | Gravedad [S] | Estado |
|---|---|---|---|
| **H1** | `ot_detalle`: el `REVOKE` de columna de `0006` (costo, precio y total) **no tiene efecto**, porque `authenticated` conserva `SELECT` a nivel de tabla. Un técnico lee costos y precios por la API aunque la interfaz use la vista `ot_detalle_con_permiso`. Reproducido con el técnico de la demo. Es una fuga entre **roles** de la misma empresa, no entre empresas | Media–alta | **Corrección lista, sin fusionar:** migración `0076` en la rama `h1-ot-detalle-columnas` (ver "Corrección de H1" más abajo). En `main` sigue abierto |
| **H2** | `whatsapp_buscar_cliente_por_telefono` y `whatsapp_registrar_contacto` son `SECURITY DEFINER`, no verifican quién llama y eran ejecutables por `anon`: cualquiera podía obtener el id de un cliente de **otra empresa** por su teléfono y **escribir contactos en la bandeja de WhatsApp de otra empresa** | **Alta** | Corregido en la migración `0075` (quita `EXECUTE` a `public/anon/authenticated`; solo la Edge Function con service role las usa, verificado en `supabase/functions/whatsapp/index.ts` y por búsqueda en `src/`). Con `0075` aplicada la prueba pasa; sin ella reporta 5 fugas |
| **H3** | `plataforma_empresa_ok` y `plataforma_exigir`: ayudantes internos del monitor, ejecutables por usuarios. Solo revelan si un uuid de empresa es demo | Baja | Incluido en `0075` |
| **H4** | 6 funciones de agenda sin guarda visible, ejecutables por `anon`, que reciben ids y devuelven disponibilidad: `agenda_cupos_bloque`, `catalogo_horas_servicio`, `catalogo_isla_para_servicio`, `citas_buscar_horarios`, `citas_cupos_disponibles`, `personal_disponible_en` | Baja | Abierto: requieren revisión. Quedan como "SIN REVISAR" en la línea base |
| **H5** | `registrar_acceso_fallido` es ejecutable por `anon` y no limita la tasa | Baja–media | Aceptada con seguimiento en WP0.3 |
| **H6** | La dependencia `xlsx` se descarga desde `cdn.sheetjs.com`; con un host bloqueado `npm install` del proyecto falla | Media (cadena de suministro) | Ya previsto en T0.7.4. Por eso el arnés tiene su propio `package.json` |

#### Corrección de H1 (rama `h1-ot-detalle-columnas`, migración `0076`, **sin fusionar**)

La rama tiene un nombre que **no** activa el flujo automático (`claude/**` y `ccr-*`), así que nada llega a producción hasta que alguien abra el PR y lo fusione.

**Diseño.** Un `REVOKE` de columna no sirve si queda el `SELECT` de tabla, así que la migración: (1) crea la vista `ot_detalle_montos_v`, única vía de lectura de costo, precio y total, que se acota sola a la empresa de quien consulta y redacta cada monto según su permiso (los permisos se evalúan **una vez por consulta**); (2) hace que `ot_detalle_con_permiso` lea los montos de esa vista, con las mismas columnas, nombres, tipos y orden y conservando `security_invoker`; (3) quita el `SELECT` de tabla a `authenticated` y le concede solo las columnas no protegidas, calculadas del catálogo. Las escrituras no cambian y el disparador que impide cargar precios sin permiso sigue activo.

**Por qué esta forma y no otra.** Una función `SECURITY DEFINER` por fila (primer intento) dio el mismo resultado pero con 5.064 líneas la vista pasó de ~4 ms a ~890 ms; se descartó. La vista con permisos del dueño mide ~6 ms frente a ~6,7 ms del original en la misma prueba.

**Qué se verificó** (sobre una base reconstruida desde las migraciones, no sobre producción):
- **Equivalencia:** sobre la misma base, la salida de `ot_detalle_con_permiso` antes y después de `0076` es **idéntica byte a byte** para los 8 roles de la demo (64 líneas; valores y tipos incluidos).
- **Protección:** 70 pruebas nuevas en el arnés. Un técnico y un admin ya no leen `costo_unitario`, `precio_unitario` ni `total_linea` directo ni con `select *`; por la vista cada rol ve exactamente lo que le corresponde (costos: socia, admin, encargado de presupuestos y jefe de taller; precios y totales: esos más el asesor; nada: técnico, detailer y recepcionista); otra empresa y `anon` no ven nada. Sin `0076`, esas pruebas dan **33 fallos**.
- **Sin regresión de escritura:** marcar verificado, insertar líneas y cargar precios (con permiso) siguen funcionando; quien no tiene permiso sigue sin poder cargar precios.
- **Uso en el código:** `src/` lee `ot_detalle` solo con columnas no protegidas o por la vista; las Edge Functions usan la clave de service role o columnas no protegidas; ningún disparador ni función `INVOKER` toca las columnas protegidas.
- **Columna nueva olvidada:** una prueba falla si una columna agregada a `ot_detalle` queda sin `grant select (col)`.

**Riesgos y lo que no se pudo verificar**
1. **La base real puede diferir de la reconstruida.** Antes de fusionar, confirmar en producción que `has_column_privilege('authenticated','public.ot_detalle','costo_unitario','select')` da `true` (si da `false`, el problema no existe allí y `0076` es innecesaria).
2. **Cualquier cliente que lea `ot_detalle` con una sesión de usuario pidiendo columnas protegidas dejará de funcionar** (un panel de BI, un script, otra app). En este repo no hay ninguno; fuera de él no lo sé.
3. **No hay staging**: la migración se aplicaría directo a producción al fusionar. Es reversible (instrucciones en el encabezado de `0076`), pero conviene fusionar en un horario de poco uso y probar enseguida las pantallas de presupuesto, cobros, facturación, egreso y detalle de OT con un usuario de cada rol.
4. Se cambia la definición de una vista en uso por todas esas pantallas; PostgREST recarga su caché al detectar el cambio de esquema.

**Qué falta para cerrar WP0.2**
1. **Verificar H1 y H2 en producción** con consultas de solo lectura (el arnés trabaja sobre una base reconstruida a partir de las migraciones, que puede diferir de producción):
   ```sql
   select has_function_privilege('anon', 'public.whatsapp_registrar_contacto(uuid,text,text,text)', 'execute');
   select has_function_privilege('anon', 'public.whatsapp_buscar_cliente_por_telefono(text,uuid)', 'execute');
   select has_column_privilege('authenticated', 'public.ot_detalle', 'costo_unitario', 'select');
   ```
   Si devuelven `true`, el hallazgo existe en producción.
2. **`0075` ya está aplicada en producción.** El flujo `pr-automatico.yml` abre y fusiona a `main` cada push a una rama `claude/**` cuando el CI pasa, y `deploy-vercel.yml` aplicó entonces las migraciones (PR #31, despliegue #28, 2026-11-06 21:09 UTC, job `migrar` en verde). Es una revocación reversible (se deshace con `grant execute … to public`) y no cambia el código de ninguna función. **Falta la comprobación que se había previsto antes de fusionar:** enviar un mensaje de WhatsApp de prueba y confirmar que la Edge Function sigue registrando contactos. Si falla, revertir con las sentencias de `0075`.
3. Hacer del job `aislamiento` un check obligatorio de `main` e investigar por qué el CI del evento `pull_request` falla sin jobs.
4. Decidir el diseño de H1 y revisar las 6 funciones de H4.
5. T0.2.6: pruebas de las Edge Functions.

### WP0.3 — Autenticación real y alta de tenants (8–10 días) · depende de WP0.2 y D4
**Por qué:** hoy no se puede entrar con cuenta propia ni crear un negocio sin SQL [H: `LoginDemo.jsx`, `demo.js`, trigger de `0001`].
- [ ] T0.3.1 **Quitar el fallback** "primera empresa activa" del trigger: sin `empresa_id` explícito, el alta no crea perfil activo.
- [ ] T0.3.2 Edge Function **`crear-empresa`** (solo administradores de plataforma, ya existe `plataforma_admins`, `0056`): crea empresa, administrador inicial y configuración base.
- [ ] T0.3.3 Edge Function **`invitar-usuario`**: la empresa invita por correo y el rol viaja en la invitación.
- [ ] T0.3.4 Pantalla de **entrada real** (D4) con recuperación de acceso y límite de intentos (hay `uso_accesos_fallidos`, `0071`, como base).
- [ ] T0.3.5 Aislar la demo: `LoginDemo` y `CONTRASENA_DEMO` solo con `VITE_MODO_DEMO=1`; el bundle de producción no debe contener la contraseña.
- [ ] T0.3.6 Revisar `debe_cambiar_clave` y `RutaProtegida`: un usuario inactivo o de otra empresa no accede por URL directa.
- [ ] T0.3.7 Plantilla de **permisos por rol** documentada en un solo lugar (hoy están repetidos en rutas, RLS y funciones Edge) y una prueba que compare los tres.

**Aceptación:** un administrador de plataforma crea una empresa nueva y su primer administrador entra con su correo, sin SQL; el bundle de producción no incluye credenciales demo; no existe ningún camino para unirse a una empresa sin invitación.

### WP0.4 — Núcleo configurable por rubro (8–10 días) · depende de D1 y WP0.3
**Por qué:** si trabajas en varios rubros, no puedes tener un solo flujo codificado. Referencia funcional [W]: un mismo motor con **etapas, checklist, catálogo y recordatorios** distintos por rubro.
- [ ] T0.4.1 Redactar el **ADR del modelo de dominio**: cliente, **activo** (vehículo u otro), orden de trabajo, ítems, catálogo, etapas. Decidir cómo convivir con `vehiculos`/`patente` actuales sin renombrar todo de golpe.
- [ ] T0.4.2 Tabla **`empresa_config`** (versionada, por empresa) y tabla de **perfiles de rubro** con: etapas de la OT, checklists de entrada y de salida, tipos de vehículo/activo, catálogo semilla, textos de firma con versión.
- [ ] T0.4.3 Función **`aplicar_perfil(empresa, perfil)`** que siembra la configuración al crear la empresa (se usa en `crear-empresa`).
- [ ] T0.4.4 Dos perfiles de partida: **mecánica y pintura** (lo que ya existe) y **un segundo rubro** que tú elijas, para comprobar que el marco no está atado a mecánica.
- [ ] T0.4.5 Mover los datos fijos (los 3 segmentos del bot en `whatsapp/index.ts`, `catalogo_servicios`, RADAR de 48 puntos) a configuración por empresa **sin cambiar su comportamiento actual**.

**Aceptación:** crear una empresa con el perfil B muestra etapas, checklists y catálogo propios, sin cambios de código; el perfil de mecánica se comporta igual que hoy (prueba de no regresión).

### WP0.5 — Estados de OT propios y ClickUp opcional (8–12 días) · depende de WP0.4
**Por qué:** el modo local ya existe, pero el modelo sigue nombrado y pensado alrededor de ClickUp [H: columnas `clickup_*` en 29 usos de `clickup_estado_actual`, 12 archivos de `src` que mencionan ClickUp, `CLICKUP_TEAM_ID = 'DEMO_TEAM_ID'` en `_shared/clickup.ts`].
- [ ] T0.5.1 Tabla **`estados_ot`** por empresa (código, nombre, orden, tipo, color) alimentada por el perfil (T0.4.2), y columna neutral en la OT (`estado_id`). Migración **aditiva** que copia desde `clickup_estados` local.
- [ ] T0.5.2 Tabla **`ot_eventos`** (historial de cada cambio: quién, cuándo, de qué etapa a cuál). Sirve de base a reportes de tiempo por etapa y puntualidad en Fase 1 [A].
- [ ] T0.5.3 Mover la lógica a un módulo neutral (`lib/estadosOt.js`) y dejar `lib/clickup.js` como **adaptador opcional**.
- [ ] T0.5.4 Pasar la configuración de ClickUp (equipo, listas, campos) a `clickup_config` por empresa; eliminar constantes fijas.
- [ ] T0.5.5 Renombrar las funciones Edge `clickup-*` a un espacio `integraciones/clickup` o dejar alias; el Kanban y el detalle de OT hablan con la capa neutral.
- [ ] T0.5.6 Prueba de no regresión del Kanban, el plano del taller (`tallerReglas.js`) y las notificaciones.

**Aceptación:** una empresa nueva opera ingreso → OT → entrega sin ClickUp; ClickUp se puede activar luego por empresa; ninguna pantalla central muestra el texto "ClickUp"; cada cambio de etapa queda en `ot_eventos`.

### WP0.6 — Móvil (8–10 días) · en paralelo desde WP0.3
**Por qué:** el menú lateral es fijo y casi no hay breakpoints [H: `Menu.jsx`; `TrabajoDetalle.jsx` y `NuevoIngreso.jsx` con 2 usos de `sm:/md:/lg:`]. Referencia funcional [A]: barra inferior con pocos destinos y acción principal de ingreso a mano.
- [ ] T0.6.1 Auditoría con capturas automáticas (Playwright, 360/390/768 px) de las 10 pantallas principales y lista de defectos.
- [ ] T0.6.2 **Navegación móvil**: barra inferior con 4–5 destinos por rol y botón de "Nuevo ingreso"; el menú lateral pasa a *drawer* en pantallas chicas. Diseño propio.
- [ ] T0.6.3 Adaptar **Ingreso, OT, Trabajos, Agenda, Taller y Bodega** (tablas → tarjetas, formularios en una columna, objetivos táctiles ≥ 44 px).
- [ ] T0.6.4 PWA: íconos de 192 y 512 px reales (hoy el mismo archivo para ambos, `vite.config.js`), pantalla de instalación y comportamiento sin conexión del *shell*.
- [ ] T0.6.5 Prueba de humo móvil en CI (capturas comparadas con tolerancia).

**Aceptación:** el flujo ingreso → OT → entrega se completa en un teléfono de 360 px sin scroll horizontal y sin controles inaccesibles; la app se instala como PWA con sus íconos.

### WP0.7 — Calidad y CI (8–10 días) · en paralelo
**Por qué:** 13,7 mil líneas de páginas con 3 archivos de prueba y archivos muy grandes (`TrabajoDetalle` 1.676, `NuevoIngreso` 1.244, `Agenda` 1.227, `Taller` 1.109 líneas) [H].
- [ ] T0.7.1 **Prueba de humo e2e** (Playwright) del recorrido principal: entrar → ingreso → OT → presupuesto → entrega, sobre staging.
- [ ] T0.7.2 Agregar a `ci.yml`: `verificar:edge`, pruebas Edge (`deno test`), RLS (WP0.2), e2e y auditoría de dependencias.
- [ ] T0.7.3 Pruebas de **caracterización** sobre `TrabajoDetalle` y `NuevoIngreso` **antes** de partirlos; luego dividir en componentes por responsabilidad (sin cambiar comportamiento).
- [ ] T0.7.4 Revisar la dependencia `xlsx` descargada de un CDN (`package.json`): fijar versión y verificar integridad, o reemplazarla.
- [ ] T0.7.5 Cobertura mínima acordada para código nuevo y regla de revisión de PR.

**Aceptación:** CI ejecuta lint, esquema, Edge, RLS y e2e; los dos archivos más grandes quedan bajo ~600 líneas por módulo con las pruebas de caracterización en verde.

### WP0.8 — Operación: backups, errores y secretos (5–7 días) · depende de WP0.1
**Por qué:** no hay backups documentados ni monitoreo, y existe un workflow *keepalive* (`supabase-keepalive.yml`), señal de plan gratuito [H/S].
- [ ] T0.8.1 Decidir plan de Supabase (D3) y activar **respaldos con recuperación a un punto en el tiempo** si el plan lo permite.
- [ ] T0.8.2 **Respaldo de Storage** (fotos, firmas, logos) y **runbook de restauración**; ejecutar una restauración de prueba en staging.
- [ ] T0.8.3 **Monitoreo de errores** en frontend y Edge, **sin datos personales** (limpieza antes de enviar), y alertas.
- [ ] T0.8.4 Chequeo de disponibilidad externo y página de estado interna.
- [ ] T0.8.5 Inventario de **secretos** (Vercel, Supabase, ClickUp, Meta, Brevo, Anthropic) con dueño, rotación y dónde se usan.
- [ ] T0.8.6 Revisar límites y costo de las funciones de IA (`analizar-inspeccion`) para poder medirlos por tenant en Fase 3.

**Aceptación:** una restauración probada en staging con tiempos anotados; un error forzado en producción llega a la alerta; inventario de secretos completo.

### WP0.9 — Soporte auditado y bitácora (3–4 días) · depende de WP0.3
**Por qué:** vender SaaS exige poder ayudar a un cliente sin comprometer sus datos. Referencia [W]: acceso de soporte registrado y bitácora no editable.
- [ ] T0.9.1 Tabla **`accesos_soporte`** (quién, a qué empresa, por qué, cuándo) y aviso visible dentro de la sesión de soporte.
- [ ] T0.9.2 **Bitácora inmutable** de cambios críticos (precios, roles, cierre de OT, reaperturas): ya existe reapertura auditada (`0026`); generalizar.
- [ ] T0.9.3 Vincular con las solicitudes de titulares y la retención que ya tienes (`0073`, `0074`).

**Aceptación:** todo acceso de plataforma a datos de una empresa queda registrado y la empresa puede verlo; los cambios críticos no se pueden borrar desde la aplicación.

---

## 5. Orden sugerido y calendario

Una persona hace los paquetes en este orden; con dos personas, las líneas A y B corren en paralelo.

| Semana | Línea A (plataforma) | Línea B (producto/frontend) |
|---|---|---|
| 1 | WP0.0 · inicio WP0.1 (D1–D5 decididas) | Auditoría móvil (T0.6.1) |
| 2 | WP0.1 (staging, CI de migraciones y funciones) | WP0.7 e2e de humo (T0.7.1) |
| 3–4 | **WP0.2** pruebas de aislamiento (bloquea el resto) | WP0.6 navegación móvil (T0.6.2) |
| 4–5 | WP0.3 autenticación y alta de tenants | WP0.6 pantallas principales |
| 5–7 | WP0.4 núcleo configurable · WP0.5 estados propios | WP0.7 caracterización y división de archivos grandes |
| 7–8 | WP0.8 operación · WP0.9 soporte auditado | WP0.6 PWA y prueba móvil en CI |
| 8–9 | Cierre, correcciones y puerta a Fase 1 | |

**Duración total estimada:** unos **60–80 días-persona**, es decir **7–9 semanas con dos personas** o **12–16 semanas con una** [S]. Es más que mi estimación inicial (4–6 semanas) porque ahora incluye un núcleo configurable por rubro y separación de entornos.

**Ruta crítica:** D1–D5 → WP0.1 → **WP0.2** → WP0.3 → WP0.4 → WP0.5. Móvil, calidad y operación se pueden mover sin afectarla.

---

## 6. Riesgos

| Riesgo | Probabilidad / impacto [S] | Mitigación |
|---|---|---|
| Descubrir fugas entre empresas en WP0.2 | Media / **Muy alto** | Es el propósito del paquete; corregir antes de todo lo demás y congelar nuevas funciones hasta cerrarlo |
| Migración de estados (WP0.5) rompe el Kanban o el plano | Media / Alto | Migración aditiva, pruebas de caracterización previas y *feature flag* por empresa |
| Decisión D1 tardía obliga a renombrar el modelo | Media / Alto | Decidir D1 en la semana 1; dejar el renombrado de columnas para después y exponer nombres neutros en la capa de acceso |
| Alcance crece (todos los rubros) | Alta / Medio | Dos perfiles en Fase 0; el resto en Fase 1–2 según demanda real |
| Costo de staging y respaldos | Baja / Bajo | Decidir D3 pronto; plan Pro de Supabase y proyecto de staging pequeño |
| Una sola persona para todo | Media / Medio | Priorizar WP0.2 y WP0.3; dejar WP0.6 y WP0.7 por tramos |

---

## 7. Puerta de salida de la Fase 0 (definición de terminado)

Se pasa a la Fase 1 cuando **todo** esto es verdad:
1. CI bloquea cualquier cambio que permita acceso entre empresas (WP0.2 en verde).
2. Un administrador de plataforma crea una empresa nueva, con perfil de rubro, y su dueño entra con su correo, **sin SQL ni ClickUp**.
3. El bundle de producción no contiene credenciales de demo y la demo está aislada.
4. Los cambios de esquema pasan por staging y las funciones se despliegan por pipeline.
5. El recorrido ingreso → OT → entrega se completa en un teléfono de 360 px.
6. Existe una restauración probada, monitoreo de errores y un inventario de secretos.
7. Cada cambio de etapa de una OT queda en `ot_eventos`.

---

## 8. Qué NO cambia con este plan

Las funciones de Fase 1 siguen igual: cotización por link, caja y cobro, DTE real, avisos automáticos con consentimiento, flujo guiado de la OT y reportes operativos (ver `ROADMAP.md`, secciones 1f–1g y 5). La Fase 0 solo deja la base lista para construirlas sin rehacerlas.
