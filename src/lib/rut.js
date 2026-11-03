// Validación del RUT chileno (dígito verificador, módulo 11). Es la misma regla
// que public.rut_valido en la base y rutValido en las Edge Functions: validarlo
// aquí permite avisar antes de guardar, en vez de recibir el rechazo del
// constraint chk_clientes_rut_valido al final del ingreso.
export function rutValido(rut) {
  const limpio = String(rut || '').replace(/[.\s]/g, '').toUpperCase()
  const partes = /^(\d{1,8})-?([0-9K])$/.exec(limpio)
  if (!partes) return false
  const [, cuerpo, dv] = partes
  let suma = 0
  let multiplicador = 2
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1
  }
  const resto = 11 - (suma % 11)
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)
  return dv === esperado
}
