import { integrationAuthorized, readBoundedJson, integrationRateLimit } from '@/lib/security/integration'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { criarEvento } from '@/lib/google'

/* -----------------------------------------------------------------
   Cria uma reunião no CRM via POST: registra no deal (meetings) E cria
   o evento no Google Calendar (com Meet), vinculado por opportunityId
   (ou phone). Usado pela Naia / integrações.

   POST /api/naia/reuniao?secret=<NAIA_API_SECRET>
   body: {
     opportunityId | phone,
     quando: "2025-08-20T14:00:00-03:00"   // ISO  — OU:
     dia: "2025-08-20", horario: "14:00",  // BRT
     duracaoMin?: 30,
     tipo?: "entendimento" | "apresentacao_proposta" | "followup" | "briefing",
     titulo?: "...", descricao?: "...",
     convidados?: ["email@..."],
     comMeet?: true,          // padrão true → gera link do Meet
     moverEtapa?: true        // padrão true → move p/ "reuniao_agendada" se estágio inicial
   }
   ----------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

const KINDS: Record<string, string> = {
  entendimento: 'Entendimento',
  apresentacao_proposta: 'Apresentação de Proposta',
  followup: 'Follow-up',
  briefing: 'Briefing',
}

function autorizado(req: Request): boolean {
  return integrationAuthorized(req, process.env.NAIA_API_SECRET)
}

async function resolverOpp(opportunityId?: string, phone?: string): Promise<string | null> {
  if (opportunityId) return opportunityId
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const tel = '+' + digits
  const { data: ident } = await db.from('identities').select('person_id')
    .in('kind', ['phone', 'wa_id']).in('value', [tel, digits]).limit(1).maybeSingle()
  if (ident?.person_id) {
    const { data: opp } = await db.from('opportunities').select('id')
      .eq('person_id', ident.person_id).is('lost_at', null).neq('stage', 'ganho')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (opp) return opp.id as string
  }
  const { data } = await db.rpc('fn_ingest_lead', { p_payload: { phone: tel, wa_id: digits, channel: 'whatsapp' } })
  return (data as { opportunity_id?: string } | null)?.opportunity_id ?? null
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  const limited = await integrationRateLimit('web/app/api/naia/reuniao/route.ts')
  if (limited) return limited

  let body: Record<string, unknown>
  try { body = await readBoundedJson(req) } catch { return NextResponse.json({ erro: 'json inválido' }, { status: 400 }) }

  const oppId = await resolverOpp(body.opportunityId as string | undefined, body.phone as string | undefined)
  if (!oppId) return NextResponse.json({ erro: 'informe opportunityId ou phone' }, { status: 400 })

  // quando: ISO direto, ou dia + horario (BRT)
  let inicio: Date | null = null
  if (typeof body.quando === 'string') inicio = new Date(body.quando)
  else if (typeof body.dia === 'string' && typeof body.horario === 'string') inicio = new Date(`${body.dia}T${body.horario}:00-03:00`)
  if (!inicio || Number.isNaN(inicio.getTime())) {
    return NextResponse.json({ erro: 'informe "quando" (ISO) ou "dia"+"horario"' }, { status: 400 })
  }

  const duracaoMin = Number(body.duracaoMin) > 0 ? Math.floor(Number(body.duracaoMin)) : 30
  const tipo = typeof body.tipo === 'string' && KINDS[body.tipo] ? body.tipo : 'entendimento'
  const comMeet = body.comMeet !== false
  const moverEtapa = body.moverEtapa !== false
  const convidados = Array.isArray(body.convidados)
    ? (body.convidados as unknown[]).map(e => String(e).trim()).filter(Boolean)
    : undefined

  // título/descrição — usa o que veio, senão monta a partir do lead
  const { data: opp } = await db.from('opportunities')
    .select('title, people:person_id ( full_name ), companies:company_id ( trade_name )')
    .eq('id', oppId).maybeSingle()
  const nome = (opp?.people as { full_name?: string } | null)?.full_name ?? (opp?.title as string) ?? 'Lead'
  const empresa = (opp?.companies as { trade_name?: string } | null)?.trade_name
  const summary = (typeof body.titulo === 'string' && body.titulo.trim())
    ? body.titulo.trim()
    : `${KINDS[tipo]} · ${nome}${empresa ? ` (${empresa})` : ''}`
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://nova-acao-crm.vercel.app'
  const descricao = (typeof body.descricao === 'string' && body.descricao.trim())
    ? body.descricao.trim()
    : `Reunião — Nova Ação.\nNegócio: ${base}/lead/${oppId}`

  // registra a reunião no deal
  const { data: m, error } = await db.from('meetings')
    .insert({ opportunity_id: oppId, kind: tipo, scheduled_at: inicio.toISOString(), status: 'agendada', duration_minutes: duracaoMin })
    .select('id').single()
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  // cria o evento no Google (com Meet) — best-effort
  let meetUrl: string | null = null
  let eventId: string | null = null
  try {
    const fim = new Date(inicio.getTime() + duracaoMin * 60_000)
    const ev = await criarEvento({
      summary, description: descricao,
      inicioISO: inicio.toISOString(), fimISO: fim.toISOString(),
      convidados, comMeet,
    })
    if (ev) {
      meetUrl = ev.meetUrl; eventId = ev.eventId
      await db.from('meetings').update({ external_event_id: ev.eventId, meeting_url: ev.meetUrl }).eq('id', m.id)
    }
  } catch (e) {
    console.error('naia/reuniao → calendar:', e)
  }

  // move o estágio para "reuniao_agendada" se ainda estiver no início
  if (moverEtapa) {
    const { data: o } = await db.from('opportunities').select('stage').eq('id', oppId).maybeSingle()
    if (o && ['novo', 'primeiro_contato', 'qualificado'].includes(o.stage as string)) {
      await db.rpc('fn_move_stage', { p_opportunity_id: oppId, p_to_stage: 'reuniao_agendada', p_actor: null, p_actor_type: 'ai', p_reason: null, p_meta: { via: 'naia' } })
    }
  }

  return NextResponse.json({
    ok: true, opportunityId: oppId, meetingId: m.id,
    quando: inicio.toISOString(), meetUrl, eventId,
  })
}
