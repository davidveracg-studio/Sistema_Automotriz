import PaginaLegal from '../components/PaginaLegal'
import { SECCIONES_TERMINOS } from '../lib/legal/terminos'

function Terminos() {
  return (
    <PaginaLegal
      titulo="Términos y Condiciones"
      secciones={SECCIONES_TERMINOS}
      otroDocumento={{ to: '/privacidad', etiqueta: 'Política de Privacidad' }}
    />
  )
}

export default Terminos
