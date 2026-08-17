import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Cliente de servidor. A service_role nunca sai daqui — não existe
// import deste módulo em componente de cliente (o 'server-only' acima
// transforma isso em erro de build).
export const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

export type Periodo = { de: string; ate: string }

export function periodo(dias = 30): Periodo {
  const ate = new Date()
  const de = new Date(ate)
  de.setDate(de.getDate() - (dias - 1))
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { de: iso(de), ate: iso(ate) }
}

export type DashComercial = {
  periodo: { de: string; ate: string }
  leads: number
  speed_to_lead_min: number
  qualificados: number
  tx_qualificacao: number
  agendamentos: number
  tx_agendamento: number
  reunioes_realizadas: number
  reunioes_no_show: number
  reunioes_pendentes: number
  show_rate: number
  propostas: number
  tx_reuniao_proposta: number
  vendas: number
  perdidos: number
  win_rate: number
  tx_lead_venda: number
  ticket_medio_mrr: number
  ticket_medio_contrato: number
  receita_fechada: number
  ciclo_venda_dias: number
  pipeline_bruto: number
  pipeline_ponderado: number
  deals_abertos: number
}

export async function dashComercial(p: Periodo): Promise<DashComercial> {
  const { data, error } = await db.rpc('fn_dash_comercial', {
    p_from: p.de,
    p_to: p.ate,
  })
  if (error) throw new Error(`fn_dash_comercial: ${error.message}`)
  return data as DashComercial
}

export async function funnelSeries(p: Periodo, grain: 'day' | 'week' | 'month' = 'week') {
  const { data, error } = await db.rpc('fn_funnel_series', {
    p_from: p.de,
    p_to: p.ate,
    p_grain: grain,
  })
  if (error) throw new Error(`fn_funnel_series: ${error.message}`)
  return (data ?? []) as {
    bucket: string
    leads: number
    qualificados: number
    agendados: number
    diagnosticos: number
    propostas: number
    vendas: number
    receita: number
  }[]
}
