import { integrationAuthorized, readBoundedJson, integrationRateLimit } from '@/lib/security/integration'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { criarTarefaNaia, hoje9hBrasil, TIPOS_TAREFA_NAIA } from '@/lib/naia-tarefa'
import { buscarIdentidadeTelefone } from '@/lib/whatsapp'

/* -----------------------------------------------------------------
   Cria UMA tarefa num deal existente — a fila de trabalho do humano.
   NÃO cria e NÃO duplica deal: se não achar, retorna 404.

   Serve para a Naia deixar o lead na mão do Rodrigues quando ela
   trava sem decidir (descarte por `lead_evasivo` ou `sem_operacao`):
   a tarefa vira o next_step do negócio e o lead aparece na tela Hoje.

   POST /api/naia/tarefa   (segredo em header; ?secret= por compat)
   body: { opportunityId | phone,
           assunto, descricao?, tipo?,
           quando? | (dia? + horario?) | emDias?,
           responsavel? }

   Idempotente: repetir a chamada com o mesmo assunto no mesmo deal
   devolve a tarefa que já existe, não cria uma segunda.
   ----------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

type Achado =
  | { tipo: 'ok'; id: string }
  | { tipo: 'nao_encontrado' }
  | { tipo: 'falha_banco' }

function autorizado(req: Request): boolean {
  return integrationAuthorized(req, process.env.NAIA_API_SECRET)
}

/** Acha o deal ABERTO, sem criar nada. Distingue "não existe" de "o banco
    falhou": falha de leitura não pode virar 404, senão o n8n desiste de um
    lead que existe. Mesma lição da trava em fn_ingest_lead (0049). */
async function acharOpp(opportunityId?: string, phone?: string): Promise<Achado> {
  if (opportunityId) {
    const { data, error } = await db.from('opportunities').select('id')
      .eq('id', opportunityId).is('lost_at', null).not('stage', 'in', '(ganho,nutricao)')
      .maybeSingle()
    if (error) return { tipo: 'falha_banco' }
    return data?.id ? { tipo: 'ok', id: data.id as string } : { tipo: 'nao_encontrado' }
  }

  if (!phone) return { tipo: 'nao_encontrado' }
  const digits = phone.replace(/\D/g, '')
  if (!digits) return { tipo: 'nao_encontrado' }
  const { identidade: ident, error: identErro } = await buscarIdentidadeTelefone(db, digits)
  if (identErro) return { tipo: 'falha_banco' }
  if (!ident?.person_id) return { tipo: 'nao_encontrado' }

  const { data: opp, error: oppErro } = await db.from('opportunities').select('id')
    .eq('person_id', ident.person_id).is('lost_at', null).not('stage', 'in', '(ganho,nutricao)')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (oppErro) return { tipo: 'falha_banco' }
  return opp?.id ? { tipo: 'ok', id: opp.id as string } : { tipo: 'nao_encontrado' }
}

/** Hoje às 09:00 em Brasília (UTC−3), como ISO. */
function hoje9h(): Date {
  return new Date(hoje9hBrasil())
}

/** O prazo, em três formatos — o n8n manda o que for mais fácil no ramo.
    `dia`/`horario` e `emDias` são lidos em horário de Brasília (UTC−3).
    Sem prazo, cai em HOJE: tarefa sem prazo não aparece na tela Hoje, e o
    objetivo deste endpoint é justamente fazer o lead aparecer. */
function resolverPrazo(body: Record<string, unknown>): string | 'invalido' {
  const quando = body.quando as string | undefined
  if (quando) {
    // Data pura vira meia-noite UTC — que é a noite anterior em Brasília.
    if (/^\d{4}-\d{2}-\d{2}$/.test(quando.trim())) return 'invalido'
    const d = new Date(quando)
    return Number.isNaN(d.getTime()) ? 'invalido' : d.toISOString()
  }

  const dia = body.dia as string | undefined
  if (dia) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia.trim())) return 'invalido'
    const horario = (body.horario as string | undefined)?.trim() || '09:00'
    if (!/^\d{2}:\d{2}$/.test(horario)) return 'invalido'
    const d = new Date(`${dia.trim()}T${horario}:00-03:00`)
    if (Number.isNaN(d.getTime())) return 'invalido'
    // new Date("2026-02-30") não falha: escorrega para março. Confere a volta.
    const voltaBrt = new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
    if (voltaBrt !== dia.trim()) return 'invalido'
    return d.toISOString()
  }

  if (body.emDias != null) {
    const n = Number(body.emDias)
    if (!Number.isFinite(n)) return 'invalido'
    const d = hoje9h()
    if (Number.isNaN(d.getTime())) return 'invalido'
    d.setUTCDate(d.getUTCDate() + Math.round(n))
    return d.toISOString()
  }

  return hoje9h().toISOString()
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ ok: false, erro: 'não autorizado' }, { status: 401 })
  const limited = await integrationRateLimit('web/app/api/naia/tarefa/route.ts')
  if (limited) return limited

  let body: Record<string, unknown>
  try { body = await readBoundedJson(req) } catch { return NextResponse.json({ ok: false, erro: 'json inválido' }, { status: 400 }) }

  const achado = await acharOpp(body.opportunityId as string | undefined, body.phone as string | undefined)
  if (achado.tipo === 'falha_banco') {
    return NextResponse.json({ ok: false, erro: 'não foi possível consultar o negócio' }, { status: 503 })
  }
  if (achado.tipo === 'nao_encontrado') {
    return NextResponse.json({ ok: false, erro: 'deal aberto não encontrado (este endpoint não cria deal)' }, { status: 404 })
  }
  const oppId = achado.id

  const assunto = String(body.assunto ?? body.title ?? '').trim()
  if (!assunto) return NextResponse.json({ ok: false, erro: 'informe "assunto"' }, { status: 400 })

  const tipo = String(body.tipo ?? 'geral')
  if (!(TIPOS_TAREFA_NAIA as readonly string[]).includes(tipo)) {
    return NextResponse.json({ ok: false, erro: `"tipo" inválido; use um de: ${TIPOS_TAREFA_NAIA.join(', ')}` }, { status: 400 })
  }

  const prazo = resolverPrazo(body)
  if (prazo === 'invalido') {
    return NextResponse.json({ ok: false, erro: 'prazo inválido; use "quando" (ISO com hora), "dia"+"horario", ou "emDias"' }, { status: 400 })
  }

  const resultado = await criarTarefaNaia({
    oppId, assunto, descricao: (body.descricao as string | undefined)?.trim() || null,
    prazo, responsavel: (body.responsavel as string | undefined)?.trim() || null, tipo,
  })
  if (!resultado.ok) return NextResponse.json({
    ok: false, erro: resultado.erro,
    ...(resultado.taskId ? { opportunityId: oppId, taskId: resultado.taskId } : {}),
  }, { status: resultado.status })
  if (resultado.repetida) return NextResponse.json({ ok: true, opportunityId: oppId, taskId: resultado.taskId, assunto: resultado.assunto, repetida: true })
  return NextResponse.json({
    ok: true, opportunityId: oppId, taskId: resultado.taskId, assunto: resultado.assunto,
    prazo: resultado.prazo, responsavel: resultado.responsavel, repetida: false,
  })
}
