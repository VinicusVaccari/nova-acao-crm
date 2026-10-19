import { db } from './db'
import { userDatabase } from './security/user-db'

/* Conversas do inbox. A lista vem de v_conversas — um resumo por negócio,
   agregado sobre o histórico inteiro. O fio de mensagens é carregado à
   parte, paginado, só para a conversa aberta na tela. */

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
  ultimaAt: string
  ultima: string
  atendimento: 'naia' | 'humano'   // trava: 'humano' = travado, Naia não responde
  humanoRespondeu: boolean          // o time já respondeu por aqui?
  responsavelHumano: boolean        // negócio de LP nova: já nasce com o Rodrigues
  naoLidas: number                  // mensagens do lead desde a última leitura do time
}

export const MENSAGENS_POR_PAGINA = 50

export async function carregarConversas(): Promise<Conversa[]> {
  const userDb = await userDatabase()
  const { data, error } = await userDb
    .from('v_conversas')
    .select('opportunity_id, nome, empresa, telefone, ultima_at, ultima, humano_respondeu, nao_lidas')
    .order('ultima_at', { ascending: false })

  if (error) throw new Error(`mensagens: ${error.message}`)

  const conversas: Conversa[] = (data ?? []).map(r => ({
    oppId: r.opportunity_id as string,
    nome: (r.nome as string) || 'Sem nome',
    empresa: (r.empresa as string) ?? null,
    telefone: (r.telefone as string) ?? null,
    ultimaAt: r.ultima_at as string,
    ultima: (r.ultima as string) ?? '',
    atendimento: 'naia', // ajustado abaixo pela trava (v_trava_atual) e pelo negócio
    humanoRespondeu: !!r.humano_respondeu,
    responsavelHumano: false,
    naoLidas: Number(r.nao_lidas ?? 0),
  }))

  // Negócio de LP nova (opportunities.atendimento = 'humano'): nenhum agente
  // entra e o Rodrigues já é o dono, com ou sem trava no telefone. Em lotes
  // pequenos, pelo mesmo motivo do pipeline: .in() com centenas de UUIDs
  // estoura a URL.
  const ids = conversas.map(c => c.oppId)
  const humanos = new Set<string>()
  for (let i = 0; i < ids.length; i += 150) {
    const { data: negocios, error: negocioErro } = await userDb.from('opportunities')
      .select('id').eq('atendimento', 'humano').in('id', ids.slice(i, i + 150))
    if (negocioErro) throw new Error('mensagens: não foi possível consultar o atendimento')
    for (const n of negocios ?? []) humanos.add(n.id as string)
  }
  for (const c of conversas) {
    if (humanos.has(c.oppId)) { c.atendimento = 'humano'; c.responsavelHumano = true }
  }

  // Consulta só os telefones visíveis. O cadastro tem milhares de travas;
  // buscar tudo a cada atualização era caro e podia truncar o resultado.
  const telefones = [...new Set(conversas.map(c => (c.telefone ?? '').replace(/\D/g, '')).filter(Boolean))]
  if (!telefones.length) return conversas
  const { data: travas, error: travaErro } = await db.from('v_trava_atual')
    .select('phone').eq('travado', true).in('phone', telefones)
  if (travaErro) throw new Error('mensagens: não foi possível consultar o atendimento')
  const travados = new Set((travas ?? []).map(t => t.phone as string))
  for (const c of conversas) {
    if (travados.has((c.telefone ?? '').replace(/\D/g, ''))) c.atendimento = 'humano'
  }
  return conversas
}

/* O cursor volta do navegador. Aceita só o formato de timestamp do Postgres,
   com a precisão original preservada — reserializar por Date perderia os
   microssegundos e o corte da página sairia do lugar. */
const CURSOR = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}:?\d{2}|Z)?$/

/** Fio de uma conversa, do mais antigo para o mais novo. `antesDe` é o
    `at` da mensagem mais antiga já na tela — pagina para trás. */
export async function carregarMensagens(
  oppId: string, antesDe?: string,
): Promise<{ mensagens: Mensagem[]; temMais: boolean }> {
  const userDb = await userDatabase()
  let consulta = userDb
    .from('activities')
    .select('id, occurred_at, direction, is_automated, body, outcome, kind, meta')
    .eq('opportunity_id', oppId)
    .in('kind', ['whatsapp', 'audio'])
    .order('occurred_at', { ascending: false })
    .limit(MENSAGENS_POR_PAGINA + 1)

  if (antesDe) {
    if (!CURSOR.test(antesDe)) throw new Error('mensagens: cursor inválido')
    consulta = consulta.lt('occurred_at', antesDe)
  }

  const { data, error } = await consulta
  if (error) throw new Error(`mensagens: ${error.message}`)

  const linhas = data ?? []
  const temMais = linhas.length > MENSAGENS_POR_PAGINA

  const mensagens: Mensagem[] = linhas.slice(0, MENSAGENS_POR_PAGINA).map(r => {
    const meta = (r.meta as { audioUrl?: string } | null) ?? null
    return {
      id: r.id as number,
      at: r.occurred_at as string,
      direction: r.direction as 'inbound' | 'outbound',
      automatizada: !!r.is_automated,
      body: (r.body as string) ?? null,
      outcome: (r.outcome as string) ?? null,
      kind: (r.kind as string) ?? 'whatsapp',
      audioUrl: meta?.audioUrl ?? null,
    }
  }).reverse()

  await assinarAudios(mensagens)
  return { mensagens, temMais }
}

/* Total para o aviso do menu lateral. Só as conversas com algo pendente
   voltam do banco — a lista inteira não interessa aqui. */
export async function contarNaoLidas(): Promise<number> {
  const userDb = await userDatabase()
  const { data, error } = await userDb.from('v_conversas').select('nao_lidas').gt('nao_lidas', 0)
  if (error) throw new Error(`mensagens: ${error.message}`)
  return (data ?? []).reduce((total, r) => total + Number(r.nao_lidas ?? 0), 0)
}

/* A leitura é do time, não de cada pessoa: uma linha por negócio. Marca até
   `agora` em vez do horário da última mensagem, senão o que chegar enquanto
   a conversa está aberta na tela voltaria a contar como não lido. */
export async function marcarConversaLida(oppId: string, profileId: string): Promise<void> {
  const userDb = await userDatabase()
  const { error } = await userDb
    .from('inbox_leituras')
    .upsert(
      { opportunity_id: oppId, lida_ate: new Date().toISOString(), lida_por: profileId, lida_em: new Date().toISOString() },
      { onConflict: 'opportunity_id' },
    )
  if (error) throw new Error(`mensagens: ${error.message}`)
}

/** Troca a referência interna do áudio por uma URL assinada. Só chega aqui
    o que o RLS já autorizou acima. Uma chamada por bucket, não por áudio. */
async function assinarAudios(mensagens: Mensagem[]): Promise<void> {
  const lotes = new Map<string, Map<string, Mensagem[]>>()

  for (const mensagem of mensagens) {
    const valor = mensagem.audioUrl
    mensagem.audioUrl = null
    if (!valor) continue

    let bucket = 'wa-audio'
    let caminho: string
    if (valor.startsWith('wa-audio:')) caminho = valor.slice('wa-audio:'.length)
    else {
      try {
        const url = new URL(valor)
        if (url.origin !== new URL(process.env.SUPABASE_URL!).origin
          || !url.pathname.startsWith('/storage/v1/object/public/wa-media/')) continue
        caminho = decodeURIComponent(url.pathname.slice('/storage/v1/object/public/wa-media/'.length))
        bucket = 'wa-media'
      } catch { continue }
    }
    if (!caminho || caminho.includes('..') || caminho.startsWith('/')) continue

    let lote = lotes.get(bucket)
    if (!lote) { lote = new Map(); lotes.set(bucket, lote) }
    lote.set(caminho, [...(lote.get(caminho) ?? []), mensagem])
  }

  await Promise.all([...lotes].map(async ([bucket, lote]) => {
    const { data } = await db.storage.from(bucket).createSignedUrls([...lote.keys()], 3600)
    for (const assinado of data ?? []) {
      if (!assinado.path || assinado.error) continue
      for (const mensagem of lote.get(assinado.path) ?? []) mensagem.audioUrl = assinado.signedUrl ?? null
    }
  }))
}
