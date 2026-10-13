export const FUSO_BRASIL = 'America/Sao_Paulo'

export function formatarNoHorarioBrasil(data: string | Date, opcoes: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('pt-BR', { ...opcoes, timeZone: FUSO_BRASIL }).format(new Date(data))
}

export function dataHoraBrasilParaIso(dataHora: string): string | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/.exec(dataHora)
  if (!partes) return null
  const [ano, mes, dia, hora, minuto, segundo, fracao] = partes.slice(1)
  const teste = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia), Number(hora), Number(minuto), Number(segundo ?? 0), Number((fracao ?? '.0').slice(1).padEnd(3, '0'))))
  if (
    teste.getUTCFullYear() !== Number(ano) || teste.getUTCMonth() !== Number(mes) - 1 ||
    teste.getUTCDate() !== Number(dia) || teste.getUTCHours() !== Number(hora) ||
    teste.getUTCMinutes() !== Number(minuto) || teste.getUTCSeconds() !== Number(segundo ?? 0)
  ) return null
  const data = new Date(`${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo ?? '00'}${fracao ?? ''}-03:00`)
  return Number.isNaN(data.getTime()) ? null : data.toISOString()
}

export function limitesDoDiaBrasil(agora: Date) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_BRASIL, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(agora)
  const campo = (tipo: string) => partes.find(p => p.type === tipo)!.value
  const ymd = `${campo('year')}-${campo('month')}-${campo('day')}`
  return {
    ymd,
    inicio: new Date(`${ymd}T00:00:00-03:00`),
    fim: new Date(`${ymd}T23:59:59.999-03:00`),
  }
}

export function eMesmoDiaBrasil(a: Date, b: Date) {
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_BRASIL, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return formato.format(a) === formato.format(b)
}
