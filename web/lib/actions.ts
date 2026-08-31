'use server'

import { revalidatePath } from 'next/cache'
import { db } from './db'
import { usuarioAtual } from './supabase/server'
import { cancelarEvento, criarEvento, desconectar } from './google'
import { carregarConversas, type Conversa } from './mensagens'
import { enviarWhatsapp } from './whatsapp'

/** Conversas do inbox — usada pelo polling do inbox (atualiza sozinho). */
export async function listarConversas(): Promise<Conversa[]> {
  return carregarConversas()
}

/** Base URL do app (para montar links dentro de eventos/descrições). */
function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3210'
}

/* -----------------------------------------------------------------
   Toda mutação passa por aqui. Mudança de estágio NUNCA é um UPDATE
   direto: é sempre fn_move_stage, que valida a transição, grava o
   histórico, emite o evento e enfileira a conversão offline na mesma
   transação.
   ----------------------------------------------------------------- */

export type Resultado = { ok: true } | { ok: false; erro: string }

function recarregar(oppId?: string) {
  revalidatePath('/')
  revalidatePath('/pipeline')
  revalidatePath('/comercial')
  if (oppId) revalidatePath(`/lead/${oppId}`)
}

export async function moverEstagio(
  oppId: string,
  estagio: string,
  motivo?: string
): Promise<Resultado> {
  const { error } = await db.rpc('fn_move_stage', {
    p_opportunity_id: oppId,
    p_to_stage: estagio,
    p_actor: null,
    p_actor_type: 'user',
    p_reason: motivo ?? null,
    p_meta: {},
  })
  if (error) return { ok: false, erro: error.message }

  // A virada para cliente (conta + onboarding) volta quando construirmos o CS.
  recarregar(oppId)
  return { ok: true }
}

/**
 * Reposiciona um card no kanban: grava o board_rank (ordem dentro da
 * coluna) e, se o estágio mudou, move o estágio pela fn_move_stage —
 * que valida a transição, grava histórico e enfileira a conversão.
 */
export async function reordenarCard(
  oppId: string,
  estagioDestino: string,
  novoRank: number,
  estagioMudou: boolean
): Promise<Resultado> {
  if (estagioMudou) {
    const { error } = await db.rpc('fn_move_stage', {
      p_opportunity_id: oppId,
      p_to_stage: estagioDestino,
      p_actor: null,
      p_actor_type: 'user',
      p_reason: null,
      p_meta: {},
    })
    if (error) return { ok: false, erro: error.message }
  }

  const { error } = await db
    .from('opportunities')
    .update({ board_rank: novoRank })
    .eq('id', oppId)
  if (error) return { ok: false, erro: error.message }

  recarregar(oppId)
  return { ok: true }
}

/* ---- Status da negociação (perdido/pausado) — MANTÉM a etapa ----
   Perdido/pausado deixaram de ser etapa (que tirava o card do lugar) e
   viraram status: a etapa real é preservada, então sabemos ONDE perdemos. */

/** Marca a negociação como PERDIDA sem mexer na etapa. Motivo obrigatório
    (alimenta o mapa de objeções). */
export async function marcarPerdido(oppId: string, motivo: string): Promise<Resultado> {
  if (!motivo) return { ok: false, erro: 'Motivo da perda é obrigatório.' }
  const { error } = await db.from('opportunities')
    .update({ lost_at: new Date().toISOString(), lost_reason: motivo, paused_at: null })
    .eq('id', oppId)
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

/** Cria um motivo de perda na lista gerenciada (para o fluxo "escolher ou
    criar" ao marcar perda). Não duplica; devolve o code. */
export async function criarMotivoPerda(label: string): Promise<{ ok: true; code: string; label: string } | { ok: false; erro: string }> {
  const u = await usuarioAtual()
  if (!u) return { ok: false, erro: 'Sem sessão.' }
  const l = (label ?? '').trim()
  if (!l) return { ok: false, erro: 'Informe o motivo.' }
  const code = l.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'motivo'
  const { data: existe } = await db.from('lost_reasons').select('code, label').eq('code', code).maybeSingle()
  if (existe) return { ok: true, code: existe.code as string, label: existe.label as string }
  const { error } = await db.from('lost_reasons').insert({ code, label: l, active: true })
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/configuracoes/motivos-perda')
  return { ok: true, code, label: l }
}

/** Retoma uma negociação perdida ou pausada: volta a Em andamento na mesma
    etapa em que estava. */
export async function retomarNegociacao(oppId: string): Promise<Resultado> {
  const { error } = await db.from('opportunities')
    .update({ lost_at: null, lost_reason: null, paused_at: null })
    .eq('id', oppId)
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

/** Pausa a negociação (só se não estiver perdida). Mantém a etapa. */
export async function pausarNegociacao(oppId: string): Promise<Resultado> {
  const { data: o } = await db.from('opportunities').select('lost_at').eq('id', oppId).maybeSingle()
  if (o?.lost_at) return { ok: false, erro: 'Negócio perdido não pode ser pausado — retome antes.' }
  const { error } = await db.from('opportunities')
    .update({ paused_at: new Date().toISOString() })
    .eq('id', oppId)
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

/** Apaga a negociação de vez. Os filhos (notas, tarefas, reuniões, produtos,
    histórico, etc.) caem por ON DELETE CASCADE. Irreversível. */
export async function excluirNegociacao(oppId: string): Promise<Resultado> {
  const { error } = await db.from('opportunities').delete().eq('id', oppId)
  if (error) return { ok: false, erro: error.message }
  recarregar()
  return { ok: true }
}

/** Duplica a negociação: copia os campos do deal e os produtos, num card novo
    "(cópia)" na mesma etapa, Em andamento. */
export async function duplicarNegociacao(oppId: string): Promise<Resultado> {
  const { data: o, error } = await db.from('opportunities').select('*').eq('id', oppId).single()
  if (error || !o) return { ok: false, erro: error?.message ?? 'Negócio não encontrado.' }

  const copia: Record<string, unknown> = { ...o }
  for (const k of ['id', 'created_at', 'updated_at', 'lost_at', 'lost_reason', 'paused_at',
                    'first_contact_at', 'next_step', 'next_step_due']) delete copia[k]
  copia.title = `${(o.title as string) ?? 'Negócio'} (cópia)`
  copia.stage_since = new Date().toISOString()

  const { data: nova, error: e2 } = await db.from('opportunities').insert(copia).select('id').single()
  if (e2 || !nova) return { ok: false, erro: e2?.message ?? 'Falha ao duplicar.' }

  // copia os produtos do deal
  const { data: prods } = await db.from('opportunity_products').select('*').eq('opportunity_id', oppId)
  if (prods && prods.length) {
    const linhas = prods.map(p => {
      const l: Record<string, unknown> = { ...p }
      delete l.id; delete l.created_at
      l.opportunity_id = nova.id
      return l
    })
    await db.from('opportunity_products').insert(linhas)
  }
  recarregar(nova.id as string)
  return { ok: true }
}

const ROTULO_REUNIAO: Record<string, string> = {
  entendimento: 'Entendimento',
  apresentacao_proposta: 'Apresentação de Proposta',
  followup: 'Follow-up',
  briefing: 'Briefing',
  // legado (linhas antigas)
  diagnostico: 'Diagnóstico',
  fechamento: 'Fechamento',
}
const DURACAO_PADRAO_MIN = 60

/** Insere a reunião no deal, cria o evento no Google (best-effort),
    guarda o vínculo e, se pedido, move o estágio. Base compartilhada
    entre agendar pela ficha e criar pela página da Agenda. */
async function inserirReuniaoNoDeal(
  oppId: string,
  p: { kind: string; inicio: Date; duracaoMin: number; summary: string; descricao?: string; convidados?: string[]; comMeet?: boolean; moverEstagio?: boolean }
): Promise<Resultado> {
  const { data: m, error } = await db
    .from('meetings')
    .insert({ opportunity_id: oppId, kind: p.kind, scheduled_at: p.inicio.toISOString(), status: 'agendada', duration_minutes: p.duracaoMin })
    .select('id')
    .single()
  if (error) return { ok: false, erro: error.message }

  try {
    const fim = new Date(p.inicio.getTime() + p.duracaoMin * 60_000)
    const ev = await criarEvento({
      summary: p.summary,
      description: p.descricao,
      inicioISO: p.inicio.toISOString(),
      fimISO: fim.toISOString(),
      convidados: p.convidados,
      comMeet: p.comMeet,
    })
    if (ev) await db.from('meetings').update({ external_event_id: ev.eventId, meeting_url: ev.meetUrl }).eq('id', m.id)
  } catch (e) {
    console.error('inserirReuniaoNoDeal → calendar:', e)
  }

  if (p.moverEstagio) {
    const { data: opp } = await db.from('opportunities').select('stage').eq('id', oppId).single()
    if (opp && ['novo', 'em_atendimento', 'qualificado'].includes(opp.stage as string)) {
      await db.rpc('fn_move_stage', { p_opportunity_id: oppId, p_to_stage: 'reuniao_agendada', p_actor: null, p_actor_type: 'user', p_reason: null, p_meta: {} })
    }
  }
  return { ok: true }
}

export async function agendarReuniao(
  oppId: string,
  dados: { kind: string; quando: string }
): Promise<Resultado> {
  const inicio = new Date(dados.quando)
  const { data: opp } = await db
    .from('opportunities')
    .select('title, people:person_id ( full_name, email_primary ), companies:company_id ( trade_name )')
    .eq('id', oppId)
    .single()
  const pessoa = (opp?.people as { full_name?: string; email_primary?: string } | null) ?? null
  const empresa = (opp?.companies as { trade_name?: string } | null)?.trade_name
  const nome = pessoa?.full_name ?? (opp?.title as string) ?? 'Lead'
  const rotulo = ROTULO_REUNIAO[dados.kind] ?? 'Reunião'

  const r = await inserirReuniaoNoDeal(oppId, {
    kind: dados.kind,
    inicio,
    duracaoMin: DURACAO_PADRAO_MIN,
    summary: `${rotulo} · ${nome}${empresa ? ` (${empresa})` : ''}`,
    descricao: `Reunião de ${rotulo.toLowerCase()} — Nova Ação.\nNegócio: ${appUrl()}/lead/${oppId}`,
    convidados: pessoa?.email_primary ? [pessoa.email_primary] : undefined,
    comMeet: true,
    moverEstagio: true,
  })
  recarregar(oppId)
  return r
}

/** Cria reunião a partir da página da Agenda. Se `oppId` vier, vincula
    ao negócio (cria a reunião no deal + evento); senão, cria um evento
    avulso no Google Calendar. */
export async function criarReuniaoAgenda(dados: {
  titulo: string
  dia: string   // YYYY-MM-DD
  hora: string  // HH:MM
  duracaoMin: number
  kind?: string
  oppId?: string | null
  convidados?: string[]
  comMeet?: boolean
}): Promise<Resultado> {
  if (!dados.titulo.trim()) return { ok: false, erro: 'Informe o título da reunião.' }
  const inicio = new Date(`${dados.dia}T${dados.hora}:00-03:00`) // BRT fixo
  if (isNaN(inicio.getTime())) return { ok: false, erro: 'Data ou hora inválida.' }

  if (dados.oppId) {
    const r = await inserirReuniaoNoDeal(dados.oppId, {
      kind: dados.kind ?? 'diagnostico',
      inicio,
      duracaoMin: dados.duracaoMin,
      summary: dados.titulo.trim(),
      descricao: `Negócio: ${appUrl()}/lead/${dados.oppId}`,
      convidados: dados.convidados,
      comMeet: dados.comMeet,
      moverEstagio: true,
    })
    recarregar(dados.oppId)
    revalidatePath('/agenda')
    return r
  }

  // evento avulso (sem negócio)
  const fim = new Date(inicio.getTime() + dados.duracaoMin * 60_000)
  const ev = await criarEvento({
    summary: dados.titulo.trim(),
    inicioISO: inicio.toISOString(),
    fimISO: fim.toISOString(),
    convidados: dados.convidados,
    comMeet: dados.comMeet,
  })
  revalidatePath('/agenda')
  if (!ev) return { ok: false, erro: 'A agenda não está conectada ou o Google recusou o evento.' }
  return { ok: true }
}

export async function marcarReuniao(
  meetingId: string,
  status: 'realizada' | 'no_show' | 'cancelada'
): Promise<Resultado> {
  const { data: m, error } = await db
    .from('meetings')
    .update({ status, attended_at: status === 'realizada' ? new Date().toISOString() : null })
    .eq('id', meetingId)
    .select('opportunity_id, external_event_id')
    .single()
  if (error) return { ok: false, erro: error.message }

  // Cancelar reunião → remove o evento da agenda (best-effort).
  if (status === 'cancelada' && m.external_event_id) {
    try { await cancelarEvento(m.external_event_id as string) } catch (e) { console.error('cancelar evento:', e) }
  }

  if (status === 'realizada') {
    await db.rpc('fn_move_stage', {
      p_opportunity_id: m.opportunity_id,
      p_to_stage: 'diagnostico_realizado',
      p_actor: null,
      p_actor_type: 'user',
      p_reason: null,
      p_meta: {},
    })
  }
  recarregar(m.opportunity_id as string)
  return { ok: true }
}

/** Exclui um evento da Agenda: remove do Google Calendar e, se estiver
    vinculado a um deal, marca a reunião como cancelada. */
export async function excluirEventoAgenda(eventId: string): Promise<Resultado> {
  if (!eventId) return { ok: false, erro: 'Evento inválido.' }
  try { await cancelarEvento(eventId) } catch (e) { return { ok: false, erro: (e as Error).message } }
  await db.from('meetings').update({ status: 'cancelada' }).eq('external_event_id', eventId)
  revalidatePath('/agenda')
  return { ok: true }
}

/* ---- Negócio (deal) ---- */
export async function atualizarNegocio(
  oppId: string,
  dados: {
    title?: string | null
    qualificacao?: number
    source?: string | null
    campaign?: string | null
    creative?: string | null
    product?: string | null
    owner_id?: string | null
  }
): Promise<Resultado> {
  const { error } = await db.from('opportunities').update(dados).eq('id', oppId)
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

/* ---- Contato (person) ---- */
export async function atualizarContato(
  personId: string,
  oppId: string,
  dados: { full_name?: string; phone_primary?: string | null; email_primary?: string | null }
): Promise<Resultado> {
  const { error } = await db.from('people').update(dados).eq('id', personId)
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

/* ---- Empresa (company) — entidade independente do deal ---- */
export async function atualizarEmpresa(
  companyId: string,
  oppId: string,
  dados: { trade_name?: string; cnpj?: string | null; address?: string | null; website?: string | null; segment?: string | null }
): Promise<Resultado> {
  const { error } = await db.from('companies').update(dados).eq('id', companyId)
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

/** Cria uma empresa nova e a vincula ao deal (e à pessoa do deal). */
export async function criarEmpresaNoDeal(
  oppId: string,
  personId: string,
  dados: { trade_name: string; cnpj?: string | null; address?: string | null; website?: string | null; segment?: string | null }
): Promise<Resultado> {
  const { data: comp, error } = await db
    .from('companies')
    .insert({ trade_name: dados.trade_name, cnpj: dados.cnpj || null, address: dados.address || null, website: dados.website || null, segment: dados.segment || null })
    .select('id')
    .single()
  if (error) return { ok: false, erro: error.message }

  await db.from('opportunities').update({ company_id: comp.id }).eq('id', oppId)
  await db.from('person_company').insert({ person_id: personId, company_id: comp.id }).select()
  recarregar(oppId)
  return { ok: true }
}

/** Desvincula a empresa do deal (não apaga a empresa). */
export async function desvincularEmpresa(oppId: string): Promise<Resultado> {
  const { error } = await db.from('opportunities').update({ company_id: null }).eq('id', oppId)
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

export async function criarLead(payload: Record<string, unknown>): Promise<Resultado> {
  const { error } = await db.rpc('fn_ingest_lead', { p_payload: payload })
  if (error) return { ok: false, erro: error.message }
  recarregar()
  return { ok: true }
}

/* ================= Ficha do lead: novos recursos ================= */

/** Anotação livre dentro do deal. */
export async function adicionarNota(oppId: string, body: string): Promise<Resultado> {
  if (!body.trim()) return { ok: false, erro: 'A anotação está vazia.' }
  const { error } = await db.from('notes').insert({ opportunity_id: oppId, body: body.trim() })
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

export async function removerNota(id: number, oppId: string): Promise<Resultado> {
  const { error } = await db.from('notes').delete().eq('id', id)
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

/** Mantém opportunities.next_step apontando para a tarefa aberta mais próxima —
 *  é o que alimenta a tela Hoje e os alertas de deal parado. */
async function sincronizarProximaAcao(oppId: string) {
  const { data } = await db
    .from('tasks')
    .select('title, due_at')
    .eq('opportunity_id', oppId)
    .is('done_at', null)
    .order('due_at', { ascending: true })
    .limit(1)
  const prox = data?.[0]
  await db
    .from('opportunities')
    .update({ next_step: prox?.title ?? null, next_step_due: prox?.due_at ?? null })
    .eq('id', oppId)
}

export async function adicionarTarefa(
  oppId: string,
  dados: {
    title: string
    description?: string
    kind: string
    date?: string
    time?: string
    ownerId?: string | null
    concluida?: boolean
  }
): Promise<Resultado> {
  if (!dados.title.trim()) return { ok: false, erro: 'Informe o assunto da tarefa.' }

  const due = dados.date ? new Date(`${dados.date}T${dados.time || '09:00'}`).toISOString() : null

  const { error } = await db.from('tasks').insert({
    opportunity_id: oppId,
    title: dados.title.trim(),
    description: dados.description?.trim() || null,
    kind: dados.kind,
    due_at: due,
    owner_id: dados.ownerId || null,
    done_at: dados.concluida ? new Date().toISOString() : null,
  })
  if (error) return { ok: false, erro: error.message }
  await sincronizarProximaAcao(oppId)
  recarregar(oppId)
  return { ok: true }
}

export async function alternarTarefa(id: number, oppId: string, concluir: boolean): Promise<Resultado> {
  const { error } = await db
    .from('tasks')
    .update({ done_at: concluir ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) return { ok: false, erro: error.message }
  await sincronizarProximaAcao(oppId)
  recarregar(oppId)
  return { ok: true }
}

/** Anexa a proposta como documento (arquivo no Storage) — versão automática. */
export async function subirProposta(oppId: string, form: FormData): Promise<Resultado> {
  const file = form.get('file') as File | null
  if (!file || file.size === 0) return { ok: false, erro: 'Selecione o documento da proposta.' }
  if (file.size > 25 * 1024 * 1024) return { ok: false, erro: 'Arquivo acima de 25 MB.' }

  const { data: ultima } = await db
    .from('proposals')
    .select('version')
    .eq('opportunity_id', oppId)
    .order('version', { ascending: false })
    .limit(1)
  const versao = (ultima?.[0]?.version ?? 0) + 1

  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `proposals/${oppId}/v${versao}_${Date.now()}_${safe}`

  const { error: upErr } = await db.storage
    .from('deal-files')
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return { ok: false, erro: upErr.message }

  const { error } = await db.from('proposals').insert({
    opportunity_id: oppId,
    version: versao,
    status: 'enviada',
    sent_at: new Date().toISOString(),
    file_name: file.name,
    file_path: path,
    file_mime: file.type,
    file_size: file.size,
  })
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

export async function removerProposta(id: string, oppId: string, path?: string | null): Promise<Resultado> {
  if (path) await db.storage.from('deal-files').remove([path])
  const { error } = await db.from('proposals').delete().eq('id', id)
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

export async function definirStatusProposta(id: string, oppId: string, status: string): Promise<Resultado> {
  const { error } = await db
    .from('proposals')
    .update({ status, decided_at: ['aceita', 'recusada'].includes(status) ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

/** Recalcula expected_value (MRR = soma das linhas mensais) e
 *  setup_value (soma das linhas únicas) a partir dos produtos.
 *  Cada linha vale: quantidade × valor_unitário − desconto. */
async function recomputarValores(oppId: string) {
  const { data } = await db
    .from('opportunity_products')
    .select('quantity, mrr, discount, recurrence')
    .eq('opportunity_id', oppId)

  let mensal = 0
  let unico = 0
  for (const p of data ?? []) {
    const linha = Math.max(0, Number(p.quantity ?? 1) * Number(p.mrr ?? 0) - Number(p.discount ?? 0))
    if (p.recurrence === 'mensal') mensal += linha
    else unico += linha
  }
  await db.from('opportunities').update({ expected_value: mensal, setup_value: unico }).eq('id', oppId)
}

export async function adicionarProduto(
  oppId: string,
  dados: { productId: number; quantity: number; unitValue: number; recurrence: string; discount: number }
): Promise<Resultado> {
  const { error } = await db.from('opportunity_products').insert({
    opportunity_id: oppId,
    product_id: dados.productId,
    quantity: dados.quantity,
    mrr: dados.unitValue,
    recurrence: dados.recurrence,
    discount: dados.discount,
  })
  if (error) return { ok: false, erro: error.message }
  await recomputarValores(oppId)
  recarregar(oppId)
  return { ok: true }
}

export async function removerProduto(id: number, oppId: string): Promise<Resultado> {
  const { error } = await db.from('opportunity_products').delete().eq('id', id)
  if (error) return { ok: false, erro: error.message }
  await recomputarValores(oppId)
  recarregar(oppId)
  return { ok: true }
}

/** Upload de arquivo do deal → Supabase Storage (bucket privado) + metadado. */
export async function subirArquivo(oppId: string, form: FormData): Promise<Resultado> {
  const file = form.get('file') as File | null
  if (!file || file.size === 0) return { ok: false, erro: 'Selecione um arquivo.' }
  if (file.size > 25 * 1024 * 1024) return { ok: false, erro: 'Arquivo acima de 25 MB.' }

  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${oppId}/${Date.now()}_${safe}`

  const { error: upErr } = await db.storage
    .from('deal-files')
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return { ok: false, erro: upErr.message }

  const { error } = await db.from('deal_files').insert({
    opportunity_id: oppId,
    name: file.name,
    path,
    mime: file.type,
    size: file.size,
  })
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

export async function removerArquivo(id: number, oppId: string, path: string): Promise<Resultado> {
  await db.storage.from('deal-files').remove([path])
  const { error } = await db.from('deal_files').delete().eq('id', id)
  if (error) return { ok: false, erro: error.message }
  recarregar(oppId)
  return { ok: true }
}

/* -----------------------------------------------------------------
   Contexto editável do deal para o painel do inbox (Mensagens).
   Retorna dados (não Resultado) — chamado sob demanda ao selecionar
   uma conversa.
   ----------------------------------------------------------------- */
export type ContextoDeal = {
  oppId: string
  personId: string
  title: string | null
  nome: string
  empresa: string | null
  telefone: string | null
  stage: string
  qualificacao: number
  ownerId: string | null
  valor: number
  nextStep: string | null
  nextStepDue: string | null
  produtos: { id: number; nome: string; quantity: number; mrr: number; recurrence: string; discount: number }[]
  catalogo: { id: number; name: string }[]
  notas: { id: number; body: string; created_at: string }[]
  usuarios: { id: string; full_name: string }[]
}

export async function contextoDeal(oppId: string): Promise<ContextoDeal | null> {
  const [oppRes, prodRes, catRes, notasRes, usuariosRes] = await Promise.all([
    db.from('opportunities')
      .select(`
        id, person_id, title, stage, qualificacao, owner_id, expected_value, term_months, setup_value,
        next_step, next_step_due,
        people:person_id ( full_name, phone_primary ),
        companies:company_id ( trade_name )
      `)
      .eq('id', oppId)
      .single(),
    db.from('opportunity_products').select('id, quantity, mrr, recurrence, discount, products(name)').eq('opportunity_id', oppId),
    db.from('products').select('id, name').eq('active', true).order('sort_order'),
    db.from('notes').select('id, body, created_at').eq('opportunity_id', oppId).order('created_at', { ascending: false }),
    db.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
  ])

  const o = oppRes.data as Record<string, unknown> | null
  if (!o) return null
  const pessoa = o.people as { full_name?: string; phone_primary?: string } | null

  return {
    oppId,
    personId: o.person_id as string,
    title: (o.title as string) ?? null,
    nome: pessoa?.full_name ?? 'Sem nome',
    empresa: ((o.companies as { trade_name?: string } | null)?.trade_name) ?? null,
    telefone: pessoa?.phone_primary ?? null,
    stage: o.stage as string,
    qualificacao: Number(o.qualificacao ?? 0),
    ownerId: (o.owner_id as string) ?? null,
    valor: Number(o.expected_value ?? 0) * Number(o.term_months ?? 12) + Number(o.setup_value ?? 0),
    nextStep: (o.next_step as string) ?? null,
    nextStepDue: (o.next_step_due as string) ?? null,
    produtos: (prodRes.data ?? []).map(p => ({
      id: p.id as number,
      nome: ((p.products as { name?: string } | null)?.name) ?? 'Produto',
      quantity: Number(p.quantity ?? 1),
      mrr: Number(p.mrr ?? 0),
      recurrence: (p.recurrence as string) ?? 'unico',
      discount: Number(p.discount ?? 0),
    })),
    catalogo: (catRes.data ?? []) as ContextoDeal['catalogo'],
    notas: (notasRes.data ?? []) as ContextoDeal['notas'],
    usuarios: (usuariosRes.data ?? []) as ContextoDeal['usuarios'],
  }
}

/* ---- Agenda (Google Calendar) ---- */
export async function desconectarAgenda(): Promise<Resultado> {
  try {
    await desconectar()
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'falha ao desconectar' }
  }
  revalidatePath('/agenda')
  return { ok: true }
}

/* ---- Etapas da pipeline (apresentação) ---- */
function recarregarEtapas() {
  // os rótulos moram no provider do layout → revalida tudo que os usa
  revalidatePath('/pipeline')
  revalidatePath('/pipeline/etapas')
  revalidatePath('/mensagens')
}

export async function salvarEtapas(
  itens: { stage: string; label: string; color: string; sort_order: number }[]
): Promise<Resultado> {
  for (const it of itens) {
    if (!it.label.trim()) return { ok: false, erro: 'O nome da etapa não pode ficar vazio.' }
    const { error } = await db
      .from('pipeline_stages')
      .update({ label: it.label.trim(), color: it.color, sort_order: it.sort_order, updated_at: new Date().toISOString() })
      .eq('stage', it.stage)
    if (error) return { ok: false, erro: error.message }
  }
  recarregarEtapas()
  return { ok: true }
}

/** slug ascii/underscore único a partir do nome, para virar o id (stage) da etapa. */
async function slugEtapa(nome: string): Promise<string> {
  const base = nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'etapa'
  const { data } = await db.from('pipeline_stages').select('stage')
  const usados = new Set((data ?? []).map(r => r.stage as string))
  if (!usados.has(base)) return base
  for (let i = 2; i < 100; i++) if (!usados.has(`${base}_${i}`)) return `${base}_${i}`
  return `${base}_${Date.now()}`
}

/** Cria uma etapa nova como coluna do kanban. Agora que `stage` é texto,
    isso é só um insert — sem DDL. Entra logo após `aposStage` (ou no fim). */
export async function adicionarEtapa(dados: { nome: string; cor: string; aposStage?: string | null }): Promise<Resultado> {
  if (!dados.nome.trim()) return { ok: false, erro: 'Informe o nome da etapa.' }

  const { data: linhas } = await db
    .from('pipeline_stages')
    .select('stage, sort_order, on_board, probability')
    .order('sort_order')
  const board = (linhas ?? []).filter(l => l.on_board)

  // posição: logo após a etapa escolhida, senão no fim do board
  const idxApos = dados.aposStage ? board.findIndex(l => l.stage === dados.aposStage) : board.length - 1
  const antes = board[idxApos]
  const depois = board[idxApos + 1]
  const prob = Math.round((Number(antes?.probability ?? 0) + Number(depois?.probability ?? 100)) / 2)
  const novaOrdem = Number(antes?.sort_order ?? 0) + 1

  const stage = await slugEtapa(dados.nome)

  // abre espaço: empurra todos com sort_order >= novaOrdem
  for (const l of (linhas ?? []).filter(l => Number(l.sort_order) >= novaOrdem)) {
    await db.from('pipeline_stages').update({ sort_order: Number(l.sort_order) + 1 }).eq('stage', l.stage)
  }

  const { error } = await db.from('pipeline_stages').insert({
    stage, label: dados.nome.trim(), color: dados.cor, sort_order: novaOrdem, on_board: true, probability: prob,
  })
  if (error) return { ok: false, erro: error.message }
  recarregarEtapas()
  return { ok: true }
}

/** Remove uma etapa. Bloqueia se houver negócios nela ou se for terminal
    (ganho/perdido/nutrição), que sustentam regras do funil e métricas. */
export async function removerEtapa(stage: string): Promise<Resultado> {
  const { data: st } = await db.from('pipeline_stages').select('won, lost, nurture').eq('stage', stage).maybeSingle()
  if (!st) return { ok: false, erro: 'Etapa não encontrada.' }
  if (st.won || st.lost || st.nurture) return { ok: false, erro: 'Etapas de Ganho, Perdido e Nutrição não podem ser removidas.' }

  const { count } = await db.from('opportunities').select('id', { count: 'exact', head: true }).eq('stage', stage)
  if ((count ?? 0) > 0) return { ok: false, erro: `Há ${count} negócio(s) nesta etapa. Mova-os antes de remover.` }

  const { error } = await db.from('pipeline_stages').delete().eq('stage', stage)
  if (error) return { ok: false, erro: error.message }
  recarregarEtapas()
  return { ok: true }
}

/* ---- Inbox: Rodrigues responde / assume ---- */

/** Rodrigues responde pelo inbox: TRAVA a conversa (atendimento='humano',
    a Naia não responde mais), envia pela Z-API e loga como humano. */
async function contatoDoDeal(oppId: string): Promise<{ telefone: string; nome: string | null } | null> {
  const { data: opp } = await db
    .from('opportunities')
    .select('people:person_id ( full_name, phone_primary )')
    .eq('id', oppId)
    .maybeSingle()
  const p = opp?.people as { full_name?: string; phone_primary?: string } | null
  if (!p?.phone_primary) return null
  return { telefone: p.phone_primary, nome: p.full_name ?? null }
}

export async function responderConversa(oppId: string, mensagem: string): Promise<Resultado> {
  if (!mensagem.trim()) return { ok: false, erro: 'Mensagem vazia.' }
  const c = await contatoDoDeal(oppId)
  if (!c) return { ok: false, erro: 'Lead sem telefone.' }
  const digits = c.telefone.replace(/\D/g, '')

  // envio humano = INTERVENÇÃO (a Naia para de responder esse lead)
  await db.rpc('fn_intervencao', { p_phone: digits, p_name: c.nome })

  // envia sem delay de digitação (é humano digitando de verdade)
  const { ok: enviado, messageId } = await enviarWhatsapp(c.telefone, mensagem.trim(), 0)
  if (!enviado) return { ok: false, erro: 'Falha ao enviar pela Z-API.' }

  await db.rpc('fn_log_activity', {
    p_opportunity_id: oppId, p_kind: 'whatsapp', p_direction: 'outbound',
    p_body: mensagem.trim(), p_is_automated: false, p_outcome: 'enviado',
    // guarda o messageId → o eco (fromMe) correlaciona e aprende o LID
    p_meta: messageId ? { messageId } : {},
  })
  revalidatePath('/mensagens')
  return { ok: true }
}

/** Assumir a conversa (intervenção humana — a Naia para de responder). */
export async function definirAtendimento(oppId: string, humano: boolean): Promise<Resultado> {
  if (!humano) return { ok: true } // não há "devolver": trava é permanente
  const c = await contatoDoDeal(oppId)
  if (!c) return { ok: false, erro: 'Lead sem telefone.' }
  const digits = c.telefone.replace(/\D/g, '')
  const { error } = await db.rpc('fn_intervencao', { p_phone: digits, p_name: c.nome })
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/mensagens')
  return { ok: true }
}
