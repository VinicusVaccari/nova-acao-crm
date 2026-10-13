/** Converte a entrada livre do campo de horas sem aceitar coerção silenciosa. */
export function paraNumeroHora(valor: string): number | null {
  const normalizado = valor.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return null
  const numero = Number(normalizado)
  return Number.isFinite(numero) && numero >= 0 ? numero : null
}

export function descreverHoras(horas: number): string {
  const minutosTotais = Math.round(horas * 60)
  const dias = Math.floor(minutosTotais / 1440)
  const horasRestantes = Math.floor((minutosTotais % 1440) / 60)
  const minutos = minutosTotais % 60
  const partes: string[] = []
  if (dias) partes.push(`${dias} ${dias === 1 ? 'dia' : 'dias'}`)
  if (horasRestantes) partes.push(`${horasRestantes} ${horasRestantes === 1 ? 'hora' : 'horas'}`)
  if (minutos || !partes.length) partes.push(`${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`)
  return partes.join(' e ')
}

export function conversaoHoraDigitada(valor: string): string | null {
  const horas = paraNumeroHora(valor)
  if (horas === null) return null
  return `${valor.trim()} h = ${descreverHoras(horas)}`
}
