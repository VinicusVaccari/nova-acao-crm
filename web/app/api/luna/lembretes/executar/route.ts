import { NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { detalharExcecao, fetchFalhouAntesDeConectar } from '@/lib/erros'
import { extrairLinksLuna, limparMensagemLuna, preencherTextoLembreteLuna, textoLembreteLuna, validarLembreteLuna, type TipoLembreteLuna } from '@/lib/luna'
import { integrationAuthorizedHeaderOnly, integrationRateLimit, readBoundedJson } from '@/lib/security/integration'
import { ocultarSegredosZapi } from '@/lib/whatsapp'
import { enviarMensagemLunaPartida } from '@/lib/agentes/luna/envio'
import { avisarGrupoLuna } from '@/lib/agentes/luna/avisos'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Lembrete = {
  id: string
  tipo: TipoLembreteLuna
  agendado_para: string
  telefone: string
  status: 'reservado' | 'enviando' | 'enviado' | 'falhou' | 'indeterminado'
  motivo: string | null
  variante: number | null
  meetings: {
    id: string
    scheduled_at: string
    status: string
    meeting_url: string | null
    opportunity_id: string
    opportunities: {
      person_id: string
      lost_at: string | null
      paused_at: string | null
      people: { full_name: string | null } | null
      companies: { trade_name: string | null } | null
    } | null
  } | null
}

async function marcar(lembreteId: string, status: 'enviado' | 'falhou' | 'indeterminado', motivo: string | null = null, variante?: number) {
  const patch = status === 'enviado'
    ? { status, enviado_em: new Date().toISOString(), motivo, ...(variante ? { variante } : {}) }
    : { status, motivo, alerta_pendente: true }
  const { error } = await db.from('luna_lembretes')
    .update(patch).eq('id', lembreteId).eq('status', 'enviando')
  if (error) console.error(`luna: lembrete ${lembreteId} — falha ao marcar ${status}:`, error.message)
}

function escolherVarianteLembreteLuna(variantes: number[], ultima: number | null, aleatorio = Math.random) {
  const candidatas = variantes.filter(variante => variante !== ultima)
  const disponiveis = candidatas.length ? candidatas : variantes
  return disponiveis[Math.min(disponiveis.length - 1, Math.floor(aleatorio() * disponiveis.length))] ?? 1
}

async function ultimaVarianteDoLead(tipo: TipoLembreteLuna, personId: string | null) {
  if (!personId) return null
  const { data, error } = await db.from('luna_variacoes_lead').select('variante')
    .eq('person_id', personId).eq('ponto', `lembrete_${tipo}`)
    .order('enviado_em', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle()
  if (error) { console.error('luna: não foi possível ler a última variante do lembrete:', error.message); return null }
  return typeof data?.variante === 'number' ? data.variante : null
}

async function registrarVarianteDoLead(tipo: TipoLembreteLuna, personId: string | null, variante: number) {
  if (!personId) return
  const { error } = await db.from('luna_variacoes_lead').insert({ person_id: personId, ponto: `lembrete_${tipo}`, variante })
  if (error) console.error('luna: não foi possível registrar a variante do lembrete:', error.message)
}

function preencherTextoBase(texto: string, lembrete: Lembrete) {
  const reuniao = lembrete.meetings!
  return preencherTextoLembreteLuna(texto, {
    nome: reuniao.opportunities?.people?.full_name,
    scheduledAt: reuniao.scheduled_at,
    meetUrl: reuniao.meeting_url,
  })
}

function lembreteValido(mensagem: string, lembrete: Lembrete) {
  const reuniao = lembrete.meetings!
  const segura = validarLembreteLuna(mensagem, { tipo: lembrete.tipo, scheduledAt: reuniao.scheduled_at, meetUrl: reuniao.meeting_url })
  if (!segura) return false
  if (lembrete.tipo === '1h' && reuniao.meeting_url?.trim() && !mensagem.includes(reuniao.meeting_url.trim())) return false
  const links = extrairLinksLuna(mensagem)
  return !links.some(({ url }) => url !== reuniao.meeting_url?.trim()) && !/\b(preço|proposta|qualifica(?:ção|r)|contrato)\b/i.test(mensagem)
}

function dadosAlerta(lembrete: Lembrete) {
  const reuniao = lembrete.meetings
  const negocio = reuniao?.opportunities
  if (!reuniao || !negocio) return null
  return {
    meetingId: reuniao.id,
    tipo: lembrete.tipo,
    lead: negocio.people?.full_name ?? null,
    empresa: negocio.companies?.trade_name ?? null,
    scheduledAt: reuniao.scheduled_at,
    opportunityId: reuniao.opportunity_id,
  }
}

async function avisarTermino(lembrete: Lembrete, status: 'falhou' | 'indeterminado', motivo: string) {
  const dados = dadosAlerta(lembrete)
  if (!dados) {
    console.warn(`luna: lembrete ${lembrete.id} terminou ${status}, mas não foi possível montar o aviso interno`)
    return
  }
  // Invariante: o término dispara no máximo um aviso, mesmo com workers concorrentes.
  const { data: dono, error } = await db.rpc('fn_luna_alerta_reivindicar', { p_lembrete_id: lembrete.id })
  if (error) { console.error(`luna: alerta do lembrete ${lembrete.id} não reivindicado:`, error.message); return }
  if (!dono) return
  await avisarGrupoLuna({
    tipo: 'lembrete_nao_saiu', meetingId: dados.meetingId, opportunityId: dados.opportunityId,
    lead: dados.lead, empresa: dados.empresa, scheduledAt: dados.scheduledAt,
    lembreteTipo: dados.tipo, lembreteStatus: status, detalhe: motivo,
  })
}

async function processarLembrete(lembreteId: string, limiteEnvioEm: number) {
  const [{ data: config, error: configErro }, { data: bruto, error: lembreteErro }] = await Promise.all([
    db.from('luna_config').select('ativo, modo').eq('id', 1).maybeSingle(),
    db.from('luna_lembretes').select(`
      id, tipo, telefone, agendado_para, variante,
      meetings!inner (
        id, scheduled_at, status, meeting_url, opportunity_id,
        opportunities!inner (
          lost_at, paused_at, person_id,
          people!inner ( full_name ),
          companies ( trade_name )
        )
      )
    `).eq('id', lembreteId).maybeSingle(),
  ])

  if (lembreteErro || !bruto) {
    await marcar(lembreteId, 'falhou', `não foi possível carregar o lembrete: ${lembreteErro?.message ?? 'não encontrado'}`)
    return
  }

  const lembrete = bruto as unknown as Lembrete
  const terminarComAlerta = async (status: 'falhou' | 'indeterminado', motivo: string) => {
    await marcar(lembreteId, status, motivo)
    await avisarTermino(lembrete, status, motivo)
  }
  if (configErro || !config || !config.ativo) {
    await terminarComAlerta('falhou', 'LUNA desativada ou configuração indisponível antes do envio')
    return
  }
  const reuniao = lembrete.meetings
  const negocio = reuniao?.opportunities
  if (!reuniao || !negocio || !['agendada', 'confirmada'].includes(reuniao.status) ||
    new Date(reuniao.scheduled_at) <= new Date() || negocio.lost_at || negocio.paused_at) {
    await terminarComAlerta('falhou', 'reunião ou negócio deixou de ser elegível antes do envio')
    return
  }
  if (lembrete.agendado_para !== reuniao.scheduled_at) {
    const { error } = await db.from('luna_lembretes')
      .update({ status: 'falhou', motivo: 'horário da reunião mudou; lembrete substituído', alerta_pendente: false })
      .eq('id', lembreteId).eq('status', 'enviando')
    if (error) console.error(`luna: lembrete ${lembreteId} — não foi possível descartar horário antigo:`, error.message)
    return
  }

  const nome = negocio.people?.full_name ?? null
  const empresa = negocio.companies?.trade_name ?? null
  const { data: textosBrutos, error: textoErro } = await db.from('luna_textos').select('texto, variante')
    .eq('tipo', lembrete.tipo).order('id', { ascending: false }).limit(12)
  if (textoErro) console.error(`luna: lembrete ${lembreteId} — texto base indisponível:`, textoErro.message)
  const textos = Array.isArray(textosBrutos) ? textosBrutos : textosBrutos ? [textosBrutos] : []
  const vigentes = new Map<number, string>()
  for (const texto of textos) if (typeof texto.variante === 'number' && typeof texto.texto === 'string' && !vigentes.has(texto.variante)) vigentes.set(texto.variante, texto.texto)
  const variantes = [...vigentes.keys()].filter(variante => variante >= 1 && variante <= 3)
  const ultimaVariante = await ultimaVarianteDoLead(lembrete.tipo, negocio.person_id ?? null)
  const variante = escolherVarianteLembreteLuna(variantes.length ? variantes : [1, 2, 3], ultimaVariante)
  const fallback = textoLembreteLuna(lembrete.tipo, { nome, scheduledAt: reuniao.scheduled_at, meetUrl: reuniao.meeting_url, variante })
  // Decisão do coordenador em 25/09/2026: lembrete é literal. Não chamar
  // gerarLembreteLuna nem reescrever a base; conversa continua usando modelo.
  const textoBase = vigentes.get(variante)
  const base = limparMensagemLuna(textoBase ? preencherTextoBase(textoBase, lembrete) : fallback) || limparMensagemLuna(fallback)
  if (!lembreteValido(base, lembrete)) {
    await terminarComAlerta('falhou', 'Texto base recusado pelo guardrail: hora, link do Meet ou conteúdo obrigatório inválido')
    return
  }
  const mensagem = base

  // O schema pedido não tem status "sombra". "enviado" é o estado terminal
  // do processamento e o motivo preserva explicitamente que nada saiu.
  if (config.modo === 'sombra') {
    await marcar(lembreteId, 'enviado', 'modo_sombra: texto base literal validado e registrado sem envio', variante)
    return
  }

  let envio: Awaited<ReturnType<typeof enviarMensagemLunaPartida>>
  try {
    envio = await enviarMensagemLunaPartida({ telefone: lembrete.telefone, mensagem, opportunityId: reuniao.opportunity_id, limiteEnvioEm })
  } catch (erro) {
    const motivo = ocultarSegredosZapi(`falha ao chamar Z-API: ${detalharExcecao(erro)}`)
    await terminarComAlerta(fetchFalhouAntesDeConectar(erro) ? 'falhou' : 'indeterminado', motivo)
    return
  }

  if (!envio.ok) {
    if (envio.adiado && envio.partesEnviadas === 0 && !envio.envio.podeTerSaido) {
      const detalheAdiamento = envio.envio.erro ?? 'telefone ocupado; nenhuma parte enviada'
      const motivo = detalheAdiamento.startsWith('envio_adiado:') ? detalheAdiamento : `envio_adiado: ${detalheAdiamento}`
      // A varredura já retoma falhas certas dentro da tolerância, na mesma linha.
      const { error } = await db.from('luna_lembretes')
        .update({ status: 'falhou', tentativas: 0, motivo, alerta_pendente: false }).eq('id', lembreteId).eq('status', 'enviando')
      if (error) console.error(`luna: lembrete ${lembreteId} — não foi possível adiar:`, error.message)
      else console.warn(`luna: lembrete ${lembreteId} adiado: ${motivo}`)
      return
    }
    const detalhe = envio.partesEnviadas > 0
      ? `falhou na parte ${envio.partesEnviadas + 1} de ${envio.totalPartes}: ${envio.envio.erro ?? 'Z-API recusou o envio'}`
      : envio.envio.erro ?? 'Z-API recusou o envio'
    await terminarComAlerta(envio.envio.podeTerSaido ? 'indeterminado' : 'falhou', ocultarSegredosZapi(detalhe))
    return
  }

  const atividade = envio.envio.logErro ? `; atividade não pôde ser gravada: ${envio.envio.logErro}` : ''
  await marcar(lembreteId, 'enviado', `lembrete enviado${atividade}`, variante)
  await registrarVarianteDoLead(lembrete.tipo, negocio.person_id ?? null, variante)
  const { error: passagemErro } = await db.from('meetings')
    .update({ luna_passou_para_humano_em: null }).eq('id', reuniao.id).eq('scheduled_at', lembrete.agendado_para)
  if (passagemErro) console.error(`luna: lembrete ${lembreteId} — não foi possível reabrir a conversa:`, passagemErro.message)
  await avisarGrupoLuna({
    tipo: 'lembrete_enviado', meetingId: reuniao.id, opportunityId: reuniao.opportunity_id,
    lead: nome, empresa, scheduledAt: reuniao.scheduled_at, lembreteTipo: lembrete.tipo,
  })
}

async function processarAlerta(lembreteId: string) {
  const { data: bruto, error } = await db.from('luna_lembretes').select(`
    id, tipo, telefone, agendado_para, status, motivo,
    meetings!inner (
      id, scheduled_at, status, meeting_url, opportunity_id,
      opportunities!inner (
        lost_at, paused_at,
        people!inner ( full_name ),
        companies ( trade_name )
      )
    )
  `).eq('id', lembreteId).maybeSingle()
  if (error || !bruto) {
    console.warn(`luna: alerta do lembrete ${lembreteId} não pôde ser carregado:`, error?.message ?? 'não encontrado')
    return
  }
  const lembrete = bruto as unknown as Lembrete
  if (lembrete.status === 'falhou' || lembrete.status === 'indeterminado') {
    await avisarTermino(lembrete, lembrete.status, lembrete.motivo ?? 'falha sem motivo registrado')
  }
}

export async function POST(req: Request) {
  const limiteEnvioEm = Date.now() + 50_000
  // O relógio e a rota reaproveitam o mesmo segredo já usado pelo follow-up;
  // nenhum token novo é introduzido nesta fase.
  if (!process.env.FOLLOWUP_API_SECRET) {
    return NextResponse.json({ ok: false, erro: 'integração não configurada' }, { status: 503 })
  }
  if (!integrationAuthorizedHeaderOnly(req, process.env.FOLLOWUP_API_SECRET, 'x-followup-token')) {
    return NextResponse.json({ ok: false, erro: 'não autorizado' }, { status: 401 })
  }
  const limited = await integrationRateLimit('web/app/api/luna/lembretes/executar/route.ts')
  if (limited) return limited

  let body: Record<string, unknown>
  try { body = await readBoundedJson(req) } catch {
    return NextResponse.json({ ok: false, erro: 'json inválido' }, { status: 400 })
  }
  if (typeof body.lembrete_id !== 'string' || !body.lembrete_id) {
    return NextResponse.json({ ok: false, erro: 'lembrete_id obrigatório' }, { status: 400 })
  }
  if (body.acao === 'alerta') {
    after(() => processarAlerta(body.lembrete_id as string))
    return NextResponse.json({ ok: true, status: 'alertando' })
  }

  const { data: lembrete, error } = await db.from('luna_lembretes')
    .update({ status: 'enviando', tentativas: 1 })
    .eq('id', body.lembrete_id).eq('status', 'reservado').gt('lease_ate', new Date().toISOString())
    .select('id').maybeSingle()
  if (error) {
    console.error(`luna: lembrete ${body.lembrete_id} — falha ao reivindicar:`, error.message)
    return NextResponse.json({ ok: false, erro: 'não foi possível reservar o lembrete' }, { status: 503 })
  }
  if (!lembrete) return NextResponse.json({ ok: false, erro: 'reserva vencida ou já processada' }, { status: 409 })

  after(() => processarLembrete(lembrete.id, limiteEnvioEm))
  return NextResponse.json({ ok: true, status: 'processando' })
}
