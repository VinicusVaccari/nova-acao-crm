import { db } from './db'
import { userDatabase } from './security/user-db'
import { requireOpportunityAccess } from './security/authorization'
import { reconciliarReunioes } from './google'
import type { CardPipeline } from './estagios'
import { deveMostrarSeloFollowup } from './followup-status'
import { toqueExibidoSeloFollowup, totalSeloFollowup } from './followup-rodadas'

export { ESTAGIOS } from './estagios'
export type { EstagioId, CardPipeline } from './estagios'

/** Nome seguro para listas e ficha: não deixa dado incompleto derrubar a tela. */
export function rotuloLead(nome: unknown, telefone: unknown): string {
  if (typeof nome === 'string' && nome.trim()) return nome.trim()
  if (typeof telefone === 'string' && telefone.trim()) return telefone.trim()
  return 'Sem nome'
}

/** Pipeline inteiro em uma consulta, já com pessoa, empresa, dono e próxima reunião. */
export async function carregarPipeline(): Promise<CardPipeline[]> {
  const userDb = await userDatabase()
  const { data, error } = await userDb
    .from('opportunities')
    .select(`
      id, stage, stage_since, board_rank, expected_value, term_months, setup_value, score,
      qualificacao, title, product, source_channel, next_step, next_step_due,
      created_at, first_contact_at, lost_reason, lost_at, paused_at,
      people:person_id ( full_name, phone_primary ),
      companies:company_id ( trade_name ),
      profiles:owner_id ( full_name )
    `)
    .not('stage', 'in', '(nutricao)')      // inclui ganho e perdido para os filtros de status
    .order('board_rank', { ascending: true })
    .order('stage_since', { ascending: false })
    .limit(1000)

  if (error) throw new Error(`pipeline: ${error.message}`)

  // produtos por negócio (para filtrar por produto). Carrega todas as
  // associações de uma vez — usar .in() com centenas de UUIDs geraria uma
  // URL gigantesca e travava a consulta.
  const porProduto = new Map<string, { ids: number[]; nomes: string[] }>()
  {
    const { data: prods } = await userDb
      .from('opportunity_products')
      .select('opportunity_id, product_id, products(name)')
      .limit(5000)
    for (const p of prods ?? []) {
      const k = p.opportunity_id as string
      const cur = porProduto.get(k) ?? { ids: [], nomes: [] }
      cur.ids.push(p.product_id as number)
      const nome = (p.products as { name?: string } | null)?.name
      if (nome) cur.nomes.push(nome)
      porProduto.set(k, cur)
    }
  }

  // última interação por negócio (para o "parado há X dias")
  const paradoPorOpp = new Map<string, string>()
  {
    const { data: par } = await userDb.from('v_deal_parado').select('opportunity_id, ultima_interacao').limit(2000)
    for (const p of par ?? []) paradoPorOpp.set(p.opportunity_id as string, p.ultima_interacao as string)
  }

  type Bruto = Record<string, unknown> & {
    people?: { full_name?: string | null; phone_primary?: string | null } | null
    companies?: { trade_name?: string | null } | null
    profiles?: { full_name?: string | null } | null
  }

  /* Indicador de atendimento — MESMA fonte que a tela de Mensagens usa (a
     trava, não a coluna opportunities.atendimento, que está órfã). Busca
     SEMPRE por lote pequeno e por chave exata (telefone / opportunity_id),
     nunca por .in() com a lista inteira nem por "carregar tudo com um
     limite": o primeiro estoura a URL em carteira grande (mesmo modo de
     falha que o comentário do produto acima evita para UUIDs); o segundo
     ou vira varredura privilegiada global (regra da casa) ou pode cortar
     em silêncio um negócio aberto. Em lotes, cada requisição fica pequena
     E o resultado é exato — nada a truncar. Erro em qualquer lote estoura:
     virar "não travado" em silêncio esconderia lead que a Naia não devia tocar. */
  const LOTE = 150
  async function porLotes<C>(
    chaves: string[],
    buscar: (lote: string[]) => PromiseLike<{ data: C[] | null; error: { message: string } | null }>,
  ): Promise<C[]> {
    const lotes = Array.from({ length: Math.ceil(chaves.length / LOTE) }, (_, i) => chaves.slice(i * LOTE, (i + 1) * LOTE))
    const resultados = await Promise.all(lotes.map(buscar))
    const linhas: C[] = []
    for (const { data, error } of resultados) {
      if (error) throw new Error(`pipeline: não foi possível consultar o atendimento (${error.message})`)
      linhas.push(...(data ?? []))
    }
    return linhas
  }

  const telefones = [...new Set(
    (data ?? []).map(o => ((o as Bruto).people?.phone_primary ?? '').replace(/\D/g, '')).filter(Boolean),
  )]
  const travas = telefones.length
    ? await porLotes(telefones, lote => db.from('v_trava_atual').select('phone').eq('travado', true).in('phone', lote))
    : []
  const travados = new Set(travas.map(t => (t as { phone: string }).phone))

  const ids = (data ?? []).map(o => o.id as string)
  const conversas = ids.length
    ? await porLotes(ids, lote => userDb.from('v_conversas').select('opportunity_id, humano_respondeu').in('opportunity_id', lote))
    : []
  const humanoRespondeuPorOpp = new Map<string, boolean>()
  for (const c of conversas as { opportunity_id: string; humano_respondeu: boolean }[]) {
    humanoRespondeuPorOpp.set(c.opportunity_id, !!c.humano_respondeu)
  }

  // Cadência de follow-up: RLS de followup_disparos já enxerga exatamente
  // quem deveria (gestor, dono/sdr, ou vendedor vendo a fila da Naia) —
  // aqui basta ler por userDb, em lotes pela mesma razão do produto/trava.
  // status='enviado' SÓ: achado do teste real do coordenador (14/09/2026) —
  // sem este filtro, um toque 'reservado' (ainda nem chamou a Z-API) já
  // subia o selo "FUP 2/3" no card com uma mensagem só, a outra nem
  // tentada ainda. O selo é sobre o que SAIU de verdade, não sobre até
  // onde a cadência chegou de agendar.
  const disparos = ids.length
    ? await porLotes(ids, lote => userDb.from('followup_disparos').select('opportunity_id, toque, lote, toque_no_lote, enviado_em').eq('status', 'enviado').in('opportunity_id', lote))
    : []
  const ultimoDisparoFollowupPorOpp = new Map<string, { lote: number; toqueNoLote: number; enviadoEm: string }>()
  for (const d of disparos as { opportunity_id: string; lote: number; toque_no_lote: number; enviado_em: string }[]) {
    const anterior = ultimoDisparoFollowupPorOpp.get(d.opportunity_id)
    if (!anterior || d.enviado_em > anterior.enviadoEm) {
      ultimoDisparoFollowupPorOpp.set(d.opportunity_id, { lote: d.lote, toqueNoLote: d.toque_no_lote, enviadoEm: d.enviado_em })
    }
  }
  const inbounds = ids.length
    ? await porLotes(ids, lote => userDb.from('activities').select('opportunity_id, occurred_at').eq('direction', 'inbound').in('opportunity_id', lote))
    : []
  const ultimaInboundPorOpp = new Map<string, string>()
  for (const inbound of inbounds as { opportunity_id: string; occurred_at: string }[]) {
    const anterior = ultimaInboundPorOpp.get(inbound.opportunity_id)
    if (!anterior || inbound.occurred_at > anterior) ultimaInboundPorOpp.set(inbound.opportunity_id, inbound.occurred_at)
  }

  return (data ?? []).map(o => {
    const r = o as Bruto
    const stage = o.stage as string
    // Status é desacoplado da etapa: perdido/pausado MANTÊM a etapa real
    // (para sabermos onde perdemos). A etapa 'ganho' segue marcando vendido.
    const status = o.lost_at ? 'perdido' : o.paused_at ? 'pausado' : stage === 'ganho' ? 'vendido' : 'andamento'
    const prod = porProduto.get(o.id as string) ?? { ids: [], nomes: [] }
    const digits = (r.people?.phone_primary ?? '').replace(/\D/g, '')
    const atendimento: CardPipeline['atendimento'] = !digits
      ? null
      : !travados.has(digits)
        ? 'naia'
        : humanoRespondeuPorOpp.get(o.id as string) ? 'voce' : 'travado'
    return {
      ...(o as unknown as CardPipeline),
      status,
      contractValue: Number(o.expected_value ?? 0) * Number(o.term_months ?? 12) + Number(o.setup_value ?? 0),
      produtoIds: prod.ids,
      produtoNomes: prod.nomes,
      ultima_interacao: paradoPorOpp.get(o.id as string) ?? (o.stage_since as string) ?? (o.created_at as string),
      nome: rotuloLead(r.people?.full_name, r.people?.phone_primary),
      empresa: r.companies?.trade_name ?? null,
      dono: r.profiles?.full_name ?? null,
      proxima_reuniao: null,
      atendimento,
      followup: ultimoDisparoFollowupPorOpp.has(o.id as string)
        && deveMostrarSeloFollowup(
          ultimoDisparoFollowupPorOpp.get(o.id as string)?.enviadoEm,
          ultimaInboundPorOpp.get(o.id as string),
        )
        ? {
            toque: toqueExibidoSeloFollowup(
              ultimoDisparoFollowupPorOpp.get(o.id as string)?.lote as number,
              ultimoDisparoFollowupPorOpp.get(o.id as string)?.toqueNoLote as number,
            ),
            total: totalSeloFollowup(ultimoDisparoFollowupPorOpp.get(o.id as string)?.lote as number),
          }
        : null,
    }
  })
}

/** A ficha completa: tudo que se sabe sobre um negócio, em uma tela. */
const ATIVIDADES_FICHA = 200

export async function carregarFicha(oppId: string) {
  await requireOpportunityAccess(oppId)
  const { data: opp, error } = await db
    .from('opportunities')
    .select(`
      *,
      people:person_id ( * ),
      companies:company_id ( * ),
      profiles:owner_id ( full_name, email )
    `)
    .eq('id', oppId)
    .single()

  if (error || !opp) return null

  const personId = opp.person_id as string

  const toqueAtribuidoReq = opp.last_touchpoint_id
    ? db.from('touchpoints').select('*').eq('id', opp.last_touchpoint_id).maybeSingle()
    : Promise.resolve({ data: null })

  const [atividades, reunioes, propostas, historico, toques, objecoes, notas, tarefas, produtos, catalogo, arquivos, followups, toqueAtribuido] =
    await Promise.all([
      db.from('activities').select('*').eq('opportunity_id', oppId).order('occurred_at', { ascending: false }).limit(ATIVIDADES_FICHA + 1),
      db.from('meetings').select('*').eq('opportunity_id', oppId).order('scheduled_at', { ascending: false }),
      db.from('proposals').select('*').eq('opportunity_id', oppId).order('version', { ascending: false }),
      db.from('stage_history').select('*, autor:changed_by(full_name)').eq('opportunity_id', oppId).order('changed_at', { ascending: true }),
      db.from('touchpoints').select('*').eq('person_id', personId).order('occurred_at', { ascending: true }),
      db.from('objection_occurrences').select('*, objections(label, code)').eq('opportunity_id', oppId),
      db.from('notes').select('*').eq('opportunity_id', oppId).order('created_at', { ascending: false }),
      db.from('tasks').select('*').eq('opportunity_id', oppId).order('due_at', { ascending: true, nullsFirst: false }),
      db.from('opportunity_products').select('*, products(name, code, description)').eq('opportunity_id', oppId),
      db.from('products').select('id, code, name, description, default_price, recurrence').eq('active', true).order('sort_order'),
      db.from('deal_files').select('*').eq('opportunity_id', oppId).order('created_at', { ascending: false }),
      // Cadência de follow-up — o diário dos disparos, NÃO em notes.
      db.from('followup_disparos').select('*').eq('opportunity_id', oppId).order('reservado_em', { ascending: false }),
      toqueAtribuidoReq,
    ])

  // URLs assinadas (1h) para baixar arquivos e documentos de proposta
  const assinar = async (p: string) =>
    (await db.storage.from('deal-files').createSignedUrl(p, 3600)).data?.signedUrl ?? null

  const comUrl = await Promise.all(
    (arquivos.data ?? []).map(async f => ({ ...f, url: await assinar(f.path as string) }))
  )
  const propostasUrl = await Promise.all(
    (propostas.data ?? []).map(async p => ({ ...p, url: p.file_path ? await assinar(p.file_path as string) : null }))
  )

  // O histórico da ficha é a linha do tempo do negócio, não o chat: quando
  // passa do teto, a tela avisa e manda pra Mensagens em vez de cortar calada.
  const linhasAtividade = atividades.data ?? []

  return {
    opp,
    atividades: linhasAtividade.slice(0, ATIVIDADES_FICHA),
    atividadesTruncadas: linhasAtividade.length > ATIVIDADES_FICHA,
    // sentido Google → sistema: se o evento foi apagado/remarcado no
    // Google, a reunião do deal reflete isso ao abrir a ficha.
    reunioes: await reconciliarReunioes(reunioes.data ?? []),
    propostas: propostasUrl,
    historico: historico.data ?? [],
    toques: toques.data ?? [],
    toqueAtribuido: toqueAtribuido.data ?? null,
    objecoes: objecoes.data ?? [],
    notas: notas.data ?? [],
    tarefas: tarefas.data ?? [],
    produtos: produtos.data ?? [],
    catalogo: catalogo.data ?? [],
    arquivos: comUrl,
    followups: followups.data ?? [],
  }
}
