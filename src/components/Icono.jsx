import { ICONOS } from '../lib/navegacion'

function Icono({ nombre, className = 'h-[18px] w-[18px]' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={ICONOS[nombre]} />
    </svg>
  )
}

export default Icono
