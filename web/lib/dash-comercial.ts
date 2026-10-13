export type MotivoPerda = {
  rotulo: string
  quantidade: number
  percentual: number
}

export type DashPerdas = {
  total_perdidos: number
  motivos: MotivoPerda[]
  automaticas: number
  vendedor: number
  nao_identificado: number
}

export type DashFollowup = {
  leads_coorte: number
  toques_enviados: number
  responderam: number
  qualificados: number
  qualificados_venderam: number
  qualificados_perderam: number
  qualificados_em_andamento: number
  perdidos_sumiu: number
  tx_resposta: number
  tx_qualificacao: number
  tx_venda: number
  custo_coorte_usd: number
  custo_hoje_usd: number
  teto_custo_dia_usd: number
}

const numero = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Normaliza o JSON dos painéis para a tela continuar segura sem movimento. */
export function normalizarDashPerdas(valor: unknown): DashPerdas {
  const bruto = valor && typeof valor === 'object' ? valor as Record<string, unknown> : {}
  const total = numero(bruto.total_perdidos)
  const motivos = Array.isArray(bruto.motivos) ? bruto.motivos.map(item => {
    const motivo = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const quantidade = numero(motivo.quantidade)
    return {
      rotulo: typeof motivo.rotulo === 'string' && motivo.rotulo.trim() ? motivo.rotulo : 'Não identificado',
      quantidade,
      percentual: total > 0 ? Math.round((quantidade / total) * 1000) / 10 : 0,
    }
  }) : []
  return {
    total_perdidos: total,
    motivos,
    automaticas: numero(bruto.automaticas),
    vendedor: numero(bruto.vendedor),
    nao_identificado: numero(bruto.nao_identificado),
  }
}

export function normalizarDashFollowup(valor: unknown): DashFollowup {
  const bruto = valor && typeof valor === 'object' ? valor as Record<string, unknown> : {}
  const leads = numero(bruto.leads_coorte)
  const qualificados = numero(bruto.qualificados)
  const vendido = numero(bruto.qualificados_venderam)
  return {
    leads_coorte: leads,
    toques_enviados: numero(bruto.toques_enviados),
    responderam: numero(bruto.responderam),
    qualificados,
    qualificados_venderam: vendido,
    qualificados_perderam: numero(bruto.qualificados_perderam),
    qualificados_em_andamento: numero(bruto.qualificados_em_andamento),
    perdidos_sumiu: numero(bruto.perdidos_sumiu),
    tx_resposta: leads ? Math.round((numero(bruto.responderam) / leads) * 1000) / 10 : 0,
    tx_qualificacao: leads ? Math.round((qualificados / leads) * 1000) / 10 : 0,
    tx_venda: qualificados ? Math.round((vendido / qualificados) * 1000) / 10 : 0,
    custo_coorte_usd: numero(bruto.custo_coorte_usd),
    custo_hoje_usd: numero(bruto.custo_hoje_usd),
    teto_custo_dia_usd: numero(bruto.teto_custo_dia_usd),
  }
}
