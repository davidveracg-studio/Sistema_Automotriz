import { RESPONSABLE, marcador } from './datos'

// Contenido de la Política de Privacidad. Estructura exigida por el art. 14 ter
// de la Ley 19.628 tal como la reemplaza la Ley 21.719 (política con fecha y
// versión, responsable, contacto, categorías, finalidades y base de licitud,
// seguridad, derechos, reclamo ante la Agencia, transferencias, plazos, fuente,
// retiro del consentimiento y decisiones automatizadas).
//
// Lo que no se sabe va con marcador y se completa antes de publicar. Los hechos
// técnicos (qué datos se guardan, qué proveedores reciben datos) salen de la
// auditoría del código del 2026-11-03.

const POR_CONFIRMAR = '[POR CONFIRMAR]'

export const SECCIONES_PRIVACIDAD = [
  {
    id: 'quienes-somos',
    titulo: '1. Quiénes somos y a quién aplica esta política',
    parrafos: [
      `${RESPONSABLE.nombreComercial} es una plataforma de gestión para talleres automotrices (órdenes de trabajo, agenda, presupuestos, bodega, facturación, encuestas y turnos). Esta política explica cómo se tratan los datos personales dentro de la plataforma.`,
      'Los roles son distintos según de quién sean los datos:',
    ],
    items: [
      `Personas que prueban la demo y usuarios internos de la plataforma: el responsable de sus datos es ${RESPONSABLE.razonSocial} (RUT ${RESPONSABLE.rut}), con domicilio en ${RESPONSABLE.domicilio}. Representante legal: ${RESPONSABLE.representante}.`,
      'Clientes finales y trabajadores de cada taller: el responsable es el taller que usa la plataforma. VPAI trata esos datos por cuenta del taller y siguiendo sus instrucciones, como tercero mandatario o encargado.',
    ],
  },
  {
    id: 'datos',
    titulo: '2. Qué datos tratamos',
    items: [
      'Usuarios de la plataforma: nombre, correo, rol y registros de acceso y uso (fecha, pantalla visitada, tipo de dispositivo y navegador, dirección IP de la sesión, errores). Los intentos de ingreso rechazados se guardan solo si el dato escrito tiene forma de correo, y por un máximo de 90 días.',
      'Clientes del taller: nombre o razón social, RUT, teléfono, correo, dirección, datos del vehículo (patente, VIN, marca, modelo, kilometraje), historial de servicios, presupuestos, documentos tributarios, mensajes de WhatsApp y respuestas a encuestas.',
      'Fotos de inspección del vehículo. Pueden mostrar patentes, documentos u otras personas que aparezcan en la imagen.',
      'Trabajadores del taller: nombre, RUT, ficha del reloj control, grupo de turno, marcas de asistencia y justificativos de ausencia.',
    ],
    parrafos: [
      'Datos sensibles: la plataforma no está pensada para recoger datos sensibles, con una excepción: los justificativos de ausencia de los trabajadores pueden incluir licencias médicas, que son datos de salud. Se tratan solo con consentimiento expreso o cuando la ley lo permite, y solo pueden verlos los roles de administración y jefatura del taller.',
    ],
  },
  {
    id: 'origen',
    titulo: '3. De dónde obtenemos los datos',
    parrafos: [
      'Los datos los entrega directamente la persona (por ejemplo, al registrarse o responder una encuesta), los registra el taller en el curso de su trabajo, o se generan al usar la plataforma (registros de acceso). ' +
        marcador('indicar si se usan fuentes de acceso público'),
    ],
  },
  {
    id: 'finalidades',
    titulo: '4. Para qué usamos los datos y con qué base legal',
    tabla: {
      columnas: ['Finalidad', 'Base de licitud'],
      filas: [
        ['Prestar el servicio: agenda, órdenes de trabajo, presupuestos, bodega y cobranza', 'Ejecución de un contrato o medidas precontractuales'],
        ['Emitir documentos tributarios y cumplir obligaciones legales', 'Obligación legal'],
        ['Avisos operativos por correo o WhatsApp (cita, vehículo listo para entrega)', 'Ejecución de un contrato'],
        ['Encuestas de satisfacción posteriores al servicio', `Interés legítimo en mejorar el servicio ${POR_CONFIRMAR}`],
        ['Seguridad y monitoreo de la plataforma (registro de acceso y uso, prevención de abusos)', 'Interés legítimo en proteger la plataforma y a sus usuarios'],
        ['Análisis de fotos de inspección con inteligencia artificial, cuando el taller lo activa', `Aviso a la persona y base de licitud ${POR_CONFIRMAR}`],
        ['Control de turnos y asistencia de trabajadores', 'Relación laboral y obligaciones legales'],
        ['Formular, ejercer o defender derechos ante tribunales u órganos públicos', 'Defensa de derechos'],
      ],
    },
    parrafos: [
      'Cuando una finalidad se basa en el consentimiento, puedes retirarlo en cualquier momento y sin dar explicaciones, por los mismos medios en que lo diste. Retirarlo no afecta lo hecho antes. Cuando la base es el interés legítimo, puedes pedir que te informemos cuál es.',
    ],
  },
  {
    id: 'automatizadas',
    titulo: '5. Decisiones automatizadas e inteligencia artificial',
    parrafos: [
      'La plataforma no toma decisiones automatizadas que produzcan efectos jurídicos en las personas ni las afecten significativamente.',
      'El análisis de fotos con inteligencia artificial solo sugiere objetos del inventario y daños visibles. Una persona del taller revisa y acepta cada sugerencia antes de que quede registrada. Esta función está disponible solo para roles de administración y asesoría, y a la inteligencia artificial se le indica que no transcriba patentes ni datos personales visibles en la foto.',
    ],
  },
  {
    id: 'destinatarios',
    titulo: '6. Con quién compartimos datos',
    parrafos: [
      'No vendemos datos personales. Usamos proveedores que tratan datos por nuestra cuenta o por cuenta del taller, para lo estrictamente necesario:',
    ],
    tabla: {
      columnas: ['Proveedor', 'Para qué', 'Datos', 'País o región'],
      filas: [
        ['Supabase', 'Base de datos, autenticación y almacenamiento de archivos', 'Todos los datos de la plataforma', marcador('región del proyecto')],
        ['Vercel', 'Publicación del sitio web', 'Datos técnicos de conexión (como la dirección IP)', marcador('región')],
        ['Brevo', 'Envío de correos (encuestas y avisos)', 'Nombre, correo y contenido del mensaje', marcador('país')],
        ['Meta (WhatsApp Business)', 'Mensajes y bot de atención por WhatsApp', 'Teléfono, nombre de contacto y mensajes', marcador('país')],
        ['ClickUp', 'Seguimiento de tareas, solo si el taller lo activa', 'Datos de la orden de trabajo (por ejemplo, patente y nombre)', marcador('país')],
        ['Anthropic', 'Análisis de fotos con IA, solo si el taller lo activa', 'Fotos de inspección', marcador('país y condiciones de retención')],
        ['Proveedor de facturación electrónica y SII', 'Emisión de documentos tributarios', 'Datos tributarios del cliente y de la venta', marcador('proveedor y país')],
      ],
    },
  },
  {
    id: 'transferencias',
    titulo: '7. Transferencias internacionales',
    parrafos: [
      'Algunos de estos proveedores pueden tratar datos fuera de Chile. Cuando ocurre, lo hacemos solo hacia países que la Agencia de Protección de Datos Personales reconozca con nivel adecuado de protección, o con cláusulas contractuales u otras garantías adecuadas, o en los casos de excepción que la ley permite.',
      marcador('detallar para cada proveedor el país, si tiene nivel adecuado y qué garantías se aplican'),
    ],
  },
  {
    id: 'conservacion',
    titulo: '8. Cuánto tiempo conservamos los datos',
    parrafos: [
      'Conservamos los datos solo el tiempo necesario para cumplir la finalidad; después los eliminamos o anonimizamos, salvo que una ley exija conservarlos más tiempo o tengas dado tu consentimiento para ello.',
    ],
    tabla: {
      columnas: ['Categoría', 'Plazo'],
      filas: [
        ['Intentos de ingreso rechazados', '90 días'],
        ['Registros de acceso y uso', marcador('plazo')],
        ['Datos de clientes y vehículos', marcador('plazo; confirmar con asesoría legal')],
        ['Documentos tributarios', marcador('plazo legal; confirmar con asesoría tributaria')],
        ['Mensajes de WhatsApp', marcador('plazo')],
        ['Fotos de inspección', marcador('plazo')],
        ['Datos de trabajadores y asistencia', marcador('plazo; confirmar con asesoría laboral')],
      ],
    },
  },
  {
    id: 'seguridad',
    titulo: '9. Cómo protegemos los datos',
    items: [
      'Cada taller solo ve los datos de su propia empresa, y dentro del taller cada rol ve únicamente lo que necesita.',
      'Las conexiones a la plataforma son cifradas (HTTPS).',
      'Las fotos de inspección se guardan en almacenamiento privado, con acceso restringido por empresa.',
      'Registramos los accesos a la plataforma.',
    ],
    parrafos: [
      'Si ocurre una vulneración de seguridad que afecte tus datos y exista un riesgo razonable para tus derechos, la informaremos a la Agencia y, cuando se trate de datos sensibles, de menores de catorce años o de datos económicos, también a las personas afectadas, con un lenguaje claro.',
    ],
  },
  {
    id: 'derechos',
    titulo: '10. Tus derechos y cómo ejercerlos',
    parrafos: [
      'Tienes derecho a acceso, rectificación, supresión, oposición, portabilidad y bloqueo temporal de tus datos personales. Son personales, irrenunciables y, si falleces, pueden ejercerlos tus herederos salvo que lo hayas prohibido.',
      `Para ejercerlos escribe a ${RESPONSABLE.correoContacto} indicando quién eres, cómo contactarte y qué dato o tratamiento te interesa. Si los datos son de un taller, también puedes dirigirte directamente a él.`,
    ],
    items: [
      'Acusaremos recibo y responderemos en un máximo de 30 días corridos, prorrogables una sola vez por otros 30.',
      'Rectificación, supresión y oposición son siempre gratuitas. El acceso es gratuito al menos una vez por trimestre; después podemos cobrar solo los costos directos.',
      'Si rechazamos tu solicitud, lo haremos por escrito, explicando la causa. Tendrás 30 días hábiles para reclamar ante la Agencia.',
      'Mientras resolvemos una solicitud de rectificación, supresión u oposición puedes pedir el bloqueo temporal del tratamiento, y responderemos esa petición en 2 días hábiles.',
    ],
  },
  {
    id: 'reclamo',
    titulo: '11. Reclamos ante la Agencia',
    parrafos: [
      'Si no respondemos a tiempo o rechazamos tu solicitud, puedes reclamar ante la Agencia de Protección de Datos Personales.',
    ],
  },
  {
    id: 'menores',
    titulo: '12. Niños, niñas y adolescentes',
    parrafos: [
      'La plataforma no está dirigida a menores de edad. Si un taller registra datos de menores de catorce años, necesita el consentimiento de sus padres o representantes legales; lo mismo rige para los datos sensibles de menores de dieciséis años.',
    ],
  },
  {
    id: 'cookies',
    titulo: '13. Cookies y almacenamiento en tu navegador',
    parrafos: [
      'La plataforma usa el almacenamiento del navegador solo para mantener tu sesión y recordar preferencias de uso (tema claro u oscuro, vista de agenda, menú contraído). No usa cookies de publicidad ni herramientas de analítica de terceros, y la tipografía se carga desde la propia plataforma, no desde servicios externos.',
    ],
  },
  {
    id: 'cambios',
    titulo: '14. Cambios a esta política',
    parrafos: [
      'Cuando cambie esta política publicaremos la nueva versión en esta misma página, con su fecha y número de versión. Si el cambio es relevante para ti, te lo avisaremos por los medios que tengamos disponibles.',
    ],
  },
  {
    id: 'contacto',
    titulo: '15. Contacto',
    parrafos: [
      `Responsable: ${RESPONSABLE.razonSocial}, RUT ${RESPONSABLE.rut}. Domicilio: ${RESPONSABLE.domicilio}. Correo: ${RESPONSABLE.correoContacto}. ${RESPONSABLE.encargadoPrevencion}`,
    ],
  },
]
