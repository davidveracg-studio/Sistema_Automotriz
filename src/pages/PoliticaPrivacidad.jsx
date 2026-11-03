import PaginaLegal from '../components/PaginaLegal'
import { SECCIONES_PRIVACIDAD } from '../lib/legal/politicaPrivacidad'

function PoliticaPrivacidad() {
  return (
    <PaginaLegal
      titulo="Política de Privacidad"
      secciones={SECCIONES_PRIVACIDAD}
      otroDocumento={{ to: '/terminos', etiqueta: 'Términos y Condiciones' }}
    />
  )
}

export default PoliticaPrivacidad
