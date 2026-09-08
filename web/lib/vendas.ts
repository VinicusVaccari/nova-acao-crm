/** Valores comerciais, sem confundir uma venda com sua projeção de receita. */
export type Venda = {
  id: string
  ganho_at: string
  expected_value: number | string | null
  setup_value: number | string | null
  term_months: number | null
}

export const MESES_PROJECAO = 12
const dataBrasil = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function diaComercial(data: Date): string {
  const partes = dataBrasil.formatToParts(data)
  const parte = (tipo: string) => partes.find(p => p.type === tipo)!.value
  return `${parte('year')}-${parte('month')}-${parte('day')}`
}

/** Sem filtro, mês civil atual até hoje. Janelas móveis incluem o dia atual. */
export function periodoIndicadores(dias?: string, agora = new Date()) {
  const ate = diaComercial(agora)
  const n = Number(dias)
  const atual = dias && Number.isFinite(n) && n >= 1 ? Math.min(366, Math.floor(n)) : null
  const inicio = new Date(`${ate}T12:00:00Z`)
  if (atual !== null) inicio.setUTCDate(inicio.getUTCDate() - atual + 1)
  const de = atual === null ? `${ate.slice(0, 7)}-01` : inicio.toISOString().slice(0, 10)
  return { de, ate, atual }
}

const centavos = (valor: Venda['expected_value']) => Math.round(Number(valor ?? 0) * 100)

export type CohortVenda = {
  mes: string
  vendas: number
  unico: number
  mensal: number
  vendidos: number
  meses: number[]
  totalProjetado: number
}

export function resumirVendas(vendas: Venda[]) {
  // Soma em centavos para preservar precisão monetária ao agregar negócios.
  const grupos = new Map<string, CohortVenda>()
  for (const venda of vendas) {
    const mes = diaComercial(new Date(venda.ganho_at)).slice(0, 7)
    const grupo = grupos.get(mes) ?? {
      mes, vendas: 0, unico: 0, mensal: 0, vendidos: 0,
      meses: Array<number>(MESES_PROJECAO).fill(0), totalProjetado: 0,
    }
    const mensal = centavos(venda.expected_value)
    const unico = centavos(venda.setup_value)
    const prazo = Math.max(0, Math.floor(venda.term_months ?? 12))
    grupo.vendas++
    grupo.mensal += mensal
    grupo.unico += unico
    grupo.vendidos += mensal + unico
    for (let i = 0; i < MESES_PROJECAO; i++) {
      const valor = (i < prazo ? mensal : 0) + (i === 0 ? unico : 0)
      grupo.meses[i] += valor
      grupo.totalProjetado += valor
    }
    grupos.set(mes, grupo)
  }

  const cohorts = [...grupos.values()].sort((a, b) => b.mes.localeCompare(a.mes)).map(g => ({
    ...g, unico: g.unico / 100, mensal: g.mensal / 100, vendidos: g.vendidos / 100,
    meses: g.meses.map(v => v / 100), totalProjetado: g.totalProjetado / 100,
  }))
  const total = (campo: 'unico' | 'mensal' | 'vendidos' | 'totalProjetado') =>
    [...grupos.values()].reduce((s, g) => s + g[campo], 0) / 100

  return { cohorts, vendas: vendas.length, vendidos: total('vendidos'), unico: total('unico'), mensal: total('mensal') }
}

export const moedaVenda = (valor: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(valor)
