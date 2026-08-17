import { db } from './db'

/* Conversas do inbox. Hoje lê as atividades de WhatsApp (o que a Naia e
   o time registram) agrupadas por negócio. A lógica de envio e de
   resposta automática entra na próxima etapa. */

export type Mensagem = {
  id: number
  at: string
  direction: 'inbound' | 'outbound'
  automatizada: boolean
  body: string | null
  outcome: string | null
  kind: string
  audioUrl: string | null
}

export type Conversa = {
  oppId: string
  nome: string
  empresa: string | null
  telefone: string | null
  stage: string
  ultimaAt: string
  ultima: string
  quemAtende: 'lead' | 'naia' | 'humano'
  atendimento: 'naia' | 'humano'   // trava: 'humano' = travado, Naia não responde
  humanoRespondeu: boolean          // o time já respondeu por aqui?
  mensagens: Mensagem[]
}

export async function carregarConversas(): Promise<Conversa[]> {
  const { data, error } = await db
    .from('activities')
    .select(`
      id, occurred_at, direction, is_automated, body, outcome, kind, meta, opportunity_id,
      people:person_id ( full_name, phone_primary ),
      opportunities:opportunity_id ( stage, atendimento, companies:company_id ( trade_name ) )
    `)
    .in('kind', ['whatsapp', 'audio'])
    .order('occurred_at', { ascending: false })
    .limit(1000)

  if (error) throw new Error(`mensagens: ${error.message}`)

  type Row = Record<string, unknown> & {
    people?: { full_name?: string; phone_primary?: string } | null
    opportunities?: { stage?: string; atendimento?: string; companies?: { trade_name?: string } | null } | null
  }

  const porOpp = new Map<string, Conversa>()

  for (const rraw of data ?? []) {
    const r = rraw as Row
    const oppId = r.opportunity_id as string
    if (!oppId) continue

    let c = porOpp.get(oppId)
    if (!c) {
      c = {
        oppId,
        nome: r.people?.full_name ?? 'Sem nome',
        empresa: r.opportunities?.companies?.trade_name ?? null,
        telefone: r.people?.phone_primary ?? null,
        stage: r.opportunities?.stage ?? 'novo',
        ultimaAt: r.occurred_at as string,
        ultima: (r.body as string) ?? '',
        quemAtende: 'lead',
        atendimento: 'naia', // ajustado abaixo pela trava (v_trava_atual)
        humanoRespondeu: false,
        mensagens: [],
      }
      porOpp.set(oppId, c)
    }
    const meta = (r.meta as { audioUrl?: string } | null) ?? null
    c.mensagens.push({
      id: r.id as number,
      at: r.occurred_at as string,
      direction: r.direction as 'inbound' | 'outbound',
      automatizada: !!r.is_automated,
      body: (r.body as string) ?? null,
      outcome: (r.outcome as string) ?? null,
      kind: (r.kind as string) ?? 'whatsapp',
      audioUrl: meta?.audioUrl ?? null,
    })
  }

  const conversas = [...porOpp.values()]
  for (const c of conversas) {
    // mensagens em ordem cronológica (a query veio desc)
    c.mensagens.sort((a, b) => a.at.localeCompare(b.at))
    const ultima = c.mensagens[c.mensagens.length - 1]
    c.ultimaAt = ultima.at
    c.ultima = ultima.body ?? ''
    c.quemAtende = ultima.direction === 'inbound' ? 'lead' : ultima.automatizada ? 'naia' : 'humano'
    c.humanoRespondeu = c.mensagens.some(m => m.direction === 'outbound' && !m.automatizada)
  }
  // conversa mais recente no topo
  conversas.sort((a, b) => b.ultimaAt.localeCompare(a.ultimaAt))
  const top = conversas.slice(0, 60)

  // estado da trava por telefone (controlada pelo n8n na tabela de cadastro)
  const fones = [...new Set(top.map(c => (c.telefone ?? '').replace(/\D/g, '')).filter(Boolean))]
  if (fones.length) {
    const { data: travas } = await db.from('v_trava_atual').select('phone, travado').in('phone', fones)
    const travados = new Set((travas ?? []).filter(t => t.travado).map(t => t.phone as string))
    for (const c of top) {
      if (travados.has((c.telefone ?? '').replace(/\D/g, ''))) c.atendimento = 'humano'
    }
  }
  return top
}
