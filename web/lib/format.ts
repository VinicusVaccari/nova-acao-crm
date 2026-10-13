const n0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const n1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const num = (v: number | null | undefined) => n0.format(Number(v ?? 0))
export const pct = (v: number | null | undefined) => `${n1.format(Number(v ?? 0))}%`

export const brl = (v: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(Number(v ?? 0))

/** Valores grandes em formato curto: R$ 558,9 mil */
export const brlCurto = (v: number | null | undefined) => {
  const x = Number(v ?? 0)
  if (Math.abs(x) >= 1_000_000) return `R$ ${n1.format(x / 1_000_000)} mi`
  if (Math.abs(x) >= 1_000) return `R$ ${n1.format(x / 1_000)} mil`
  return brl(x)
}

/** Minutos -> "7 min" / "2h10" / "3 dias" */
export const dur = (min: number | null | undefined) => {
  const m = Number(min ?? 0)
  if (m < 60) return `${n0.format(m)} min`
  if (m < 60 * 24) {
    const h = Math.floor(m / 60)
    const r = Math.round(m % 60)
    return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`
  }
  return `${n1.format(m / 1440)} dias`
}

export const dias = (v: number | null | undefined) => `${n1.format(Number(v ?? 0))} dias`

/** '2026-07-27' -> '27/jul' */
export const dataCurta = (iso: string) => {
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''))
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short' }).replace('.', '')
}
