// Cliente mínimo de la API de Brevo (correo transaccional).
const BASE_URL = 'https://api.brevo.com/v3'

export class ErrorBrevo extends Error {
  status: number
  cuerpo: unknown

  constructor(mensaje: string, status: number, cuerpo: unknown) {
    super(mensaje)
    this.name = 'ErrorBrevo'
    this.status = status
    this.cuerpo = cuerpo
  }
}

export async function enviarCorreo(opciones: {
  destinatarioEmail: string
  destinatarioNombre?: string
  asunto: string
  html: string
}) {
  const apiKey = Deno.env.get('BREVO_API_KEY')
  const remitenteEmail = Deno.env.get('BREVO_REMITENTE_EMAIL') || 'contacto@vpai.dev'
  const remitenteNombre = Deno.env.get('BREVO_REMITENTE_NOMBRE') || 'VPAI CRM'

  if (!apiKey) {
    throw new Error('Falta el secreto BREVO_API_KEY en este Edge Function.')
  }

  const respuesta = await fetch(`${BASE_URL}/smtp/email`, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: remitenteEmail, name: remitenteNombre },
      to: [{ email: opciones.destinatarioEmail, name: opciones.destinatarioNombre }],
      subject: opciones.asunto,
      htmlContent: opciones.html,
    }),
  })

  const texto = await respuesta.text()
  const cuerpo = texto ? JSON.parse(texto) : null

  if (!respuesta.ok) {
    const mensaje = (cuerpo as { message?: string })?.message || `Brevo respondió ${respuesta.status}`
    throw new ErrorBrevo(mensaje, respuesta.status, cuerpo)
  }

  return cuerpo
}
