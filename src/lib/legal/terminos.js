import { RESPONSABLE, marcador } from './datos'

// Términos y Condiciones de uso. La Ley 21.719 no regula los términos
// comerciales, pero las partes que tocan datos personales (roles de responsable
// y encargado, confidencialidad, seguridad, devolución o supresión al terminar)
// siguen sus reglas (art. 14 bis, 15 bis y 14 quinquies).

export const SECCIONES_TERMINOS = [
  {
    id: 'aceptacion',
    titulo: '1. Aceptación y objeto',
    parrafos: [
      `Estos términos regulan el uso de la plataforma ${RESPONSABLE.nombreComercial}, ofrecida por ${RESPONSABLE.razonSocial} (RUT ${RESPONSABLE.rut}). Al crear una cuenta o usar la plataforma aceptas estos términos y la Política de Privacidad.`,
      'La versión de demostración se ofrece solo para probar el sistema: sus datos son ficticios, se comparten entre quienes la prueban y no deben ingresarse datos reales de personas.',
    ],
  },
  {
    id: 'cuentas',
    titulo: '2. Cuentas y roles',
    items: [
      'Cada persona usa su propia cuenta y es responsable de mantener su clave en reserva. Si sospechas que otra persona la conoce, cámbiala y avísanos.',
      'El administrador del taller define qué rol tiene cada persona. Cada rol accede solo a las funciones y datos que necesita.',
      'Debes entregar información veraz y mantenerla actualizada.',
    ],
  },
  {
    id: 'uso',
    titulo: '3. Uso aceptable',
    parrafos: ['Está prohibido:'],
    items: [
      'Acceder a datos de otras empresas o intentar saltarse los controles de acceso.',
      'Ingresar datos personales de terceros sin tener derecho a hacerlo.',
      'Interferir con el funcionamiento de la plataforma, probar vulnerabilidades sin autorización o usarla para fines ilícitos.',
      'Revender el acceso o permitir que personas no autorizadas usen tu cuenta.',
    ],
  },
  {
    id: 'datos',
    titulo: '4. Datos personales y roles de cada parte',
    parrafos: [
      'El taller que usa la plataforma es el responsable de los datos de sus clientes y de sus trabajadores: decide con qué fin y de qué manera se tratan. VPAI los trata por cuenta del taller y solo según sus instrucciones, como encargado.',
      'El taller declara que tiene base legal para ingresar esos datos y que informó a las personas afectadas. VPAI no usará esos datos para fines propios ni los cederá a terceros, salvo a los proveedores necesarios para prestar el servicio, listados en la Política de Privacidad.',
      'VPAI mantendrá la confidencialidad de los datos, aplicará medidas de seguridad adecuadas al riesgo, avisará al taller sin demora si detecta una vulneración de seguridad, y al terminar el servicio devolverá o suprimirá los datos según indique el taller.',
      `Las condiciones detalladas de este encargo (objeto, duración, finalidad, tipo de datos, categorías de titulares y subencargados autorizados) constarán en un acuerdo de tratamiento de datos con cada taller. ${marcador('anexar el acuerdo de tratamiento de datos')}`,
    ],
  },
  {
    id: 'planes',
    titulo: '5. Planes, precios y pago',
    parrafos: [
      marcador('planes, precios en pesos chilenos, forma y fecha de facturación, renovación y reajustes'),
    ],
  },
  {
    id: 'propiedad',
    titulo: '6. Propiedad intelectual y licencia de datos',
    parrafos: [
      'La plataforma, su diseño y su código pertenecen a VPAI. Se otorga al taller un derecho de uso no exclusivo y no transferible mientras dure el servicio.',
      'Los datos que el taller ingresa siguen siendo suyos. Nos autoriza a tratarlos únicamente para prestar el servicio.',
    ],
  },
  {
    id: 'disponibilidad',
    titulo: '7. Disponibilidad y soporte',
    parrafos: [
      `Trabajamos para mantener la plataforma disponible, pero pueden existir interrupciones por mantención o por causas ajenas a nuestro control. ${marcador('horario de soporte y tiempos de respuesta')}`,
    ],
  },
  {
    id: 'responsabilidad',
    titulo: '8. Limitación de responsabilidad',
    parrafos: [
      'En la medida que la ley lo permita, VPAI no responde por daños indirectos ni por pérdidas derivadas de un uso contrario a estos términos o de decisiones tomadas sin revisar la información. Nada de lo dispuesto aquí limita las responsabilidades que la ley chilena no permite excluir, ni los derechos irrenunciables que la ley reconoce a los consumidores.',
      marcador('tope de responsabilidad, si se acuerda'),
    ],
  },
  {
    id: 'termino',
    titulo: '9. Suspensión y término',
    parrafos: [
      'Podemos suspender una cuenta que incumpla estos términos o ponga en riesgo la seguridad de la plataforma. El taller puede terminar el servicio en cualquier momento. Al terminar, el taller puede pedir una copia de sus datos y su eliminación, salvo los que deban conservarse por obligación legal.',
    ],
  },
  {
    id: 'cambios',
    titulo: '10. Cambios a estos términos',
    parrafos: [
      'Podemos modificar estos términos. Publicaremos la nueva versión con su fecha y, si el cambio es relevante, lo avisaremos con anticipación.',
    ],
  },
  {
    id: 'ley',
    titulo: '11. Ley aplicable y tribunales',
    parrafos: [
      `Estos términos se rigen por las leyes de Chile. Las controversias se someterán a los tribunales ordinarios de ${marcador('ciudad')}, sin perjuicio de los derechos que la ley otorgue al consumidor.`,
    ],
  },
  {
    id: 'contacto',
    titulo: '12. Contacto',
    parrafos: [`${RESPONSABLE.razonSocial} · ${RESPONSABLE.domicilio} · ${RESPONSABLE.correoContacto}`],
  },
]
