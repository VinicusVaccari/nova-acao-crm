import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/* -----------------------------------------------------------------
   API da Naia para LER e ESCREVER no CRM em tempo real.

   GET  /api/naia/deal?secret=…&opportunityId=…   (ou &phone=55…)
        → snapshot do deal (contato, empresa, campos, etapa, notas)

   POST /api/naia/deal?secret=…
        body: { opportunityId | phone, contato, empresa, qualificacao,
                camposContato, camposEmpresa, etapa, motivoPerda, nota }
        → aplica o patch (upsert por campo). Idempotente.

   Autenticação: ?secret=<NAIA_API_SECRET> (cai pra WHATSAPP_WEBHOOK_SECRET
   se o dedicado não estiver setado).
   ----------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

function autorizado(req: Request): boolean {
  const esperado = process.env.NAIA_API_SECRET || process.env.WHATSAPP_WEBHOOK_SECRET
  if (!esperado) return true
  return new URL(req.url).searchParams.get('secret') === esperado
}

/** Resolve a oportunidade por id ou por telefone (cria o lead se preciso). */
async function resolverOpp(opportunityId?: string, phone?: string, criar = true): Promise<string | null> {
  if (opportunityId) return opportunityId
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const tel = '+' + digits

  const { data: ident } = await db.from('identities').select('person_id')
    .in('kind', ['phone', 'wa_id']).in('value', [tel, digits]).limit(1).maybeSingle()

  if (ident?.person_id) {
    const { data: opp } = await db.from('opportunities').select('id')
      .eq('person_id', ident.person_id).not('stage', 'in', '(ganho,perdido)')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (opp) return opp.id as string
  }
  if (!criar) return null
  const { data } = await db.rpc('fn_ingest_lead', {
    p_payload: { phone: tel, wa_id: digits, channel: 'whatsapp' },
  })
  return (data as { opportunity_id?: string } | null)?.opportunity_id ?? null
}

/** Mapa (entity+key) → field_id para os campos personalizados ativos. */
async function mapaCampos() {
  const { data } = await db.from('custom_fields')
    .select('id, entity, key').in('entity', ['contact', 'company']).eq('active', true)
  const m = new Map<string, number>()
  for (const d of data ?? []) m.set(`${d.entity}:${d.key}`, d.id as number)
  return m
}

async function carregarValores(entityId: string | null, ids: number[]) {
  if (!entityId || ids.length === 0) return new Map<number, string | null>()
  const { data } = await db.from('custom_field_values')
    .select('field_id, value').eq('entity_id', entityId).in('field_id', ids)
  return new Map((data ?? []).map(v => [v.field_id as number, (v.value as string) ?? null]))
}

// ---------------- GET (contexto) ----------------
export async function GET(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  const url = new URL(req.url)
  const oppId = await resolverOpp(url.searchParams.get('opportunityId') ?? undefined, url.searchParams.get('phone') ?? undefined, false)
  if (!oppId) return NextResponse.json({ erro: 'oportunidade não encontrada' }, { status: 404 })

  const { data: opp } = await db.from('opportunities')
    .select('id, stage, qualificacao, person_id, company_id, people:person_id(full_name,email_primary,phone_primary), companies:company_id(id,trade_name,website,segment,cnpj,city,state)')
    .eq('id', oppId).maybeSingle()
  if (!opp) return NextResponse.json({ erro: 'oportunidade não encontrada' }, { status: 404 })

  const mapa = await mapaCampos()
  const defs = [...mapa.entries()]
  const contatoIds = defs.filter(([k]) => k.startsWith('contact:')).map(([, id]) => id)
  const empresaIds = defs.filter(([k]) => k.startsWith('company:')).map(([, id]) => id)
  const [valC, valE] = await Promise.all([
    carregarValores(opp.person_id as string, contatoIds),
    carregarValores((opp.company_id as string) ?? null, empresaIds),
  ])
  const porId = (entity: 'contact' | 'company', vals: Map<number, string | null>) =>
    Object.fromEntries(defs.filter(([k]) => k.startsWith(entity + ':')).map(([k, id]) => [k.split(':')[1], vals.get(id) ?? null]))

  const { data: notas } = await db.from('notes').select('body, created_at')
    .eq('opportunity_id', oppId).order('created_at', { ascending: false }).limit(5)

  return NextResponse.json({
    ok: true,
    opportunityId: oppId,
    stage: opp.stage,
    qualificacao: opp.qualificacao ?? 0,
    contato: opp.people ?? null,
    empresa: opp.companies ?? null,
    camposContato: porId('contact', valC),
    camposEmpresa: porId('company', valE),
    notasRecentes: (notas ?? []).map(n => ({ body: n.body, at: n.created_at })),
  })
}

// ---------------- POST (patch) ----------------
export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ erro: 'json inválido' }, { status: 400 }) }

  const oppId = await resolverOpp(body.opportunityId as string | undefined, body.phone as string | undefined, true)
  if (!oppId) return NextResponse.json({ erro: 'informe opportunityId ou phone' }, { status: 400 })

  const { data: opp } = await db.from('opportunities').select('id, person_id, company_id').eq('id', oppId).maybeSingle()
  if (!opp) return NextResponse.json({ erro: 'oportunidade não encontrada' }, { status: 404 })
  const personId = opp.person_id as string
  let companyId = (opp.company_id as string) ?? null
  const applied: string[] = []

  // ---- contato (people) ----
  const contato = body.contato as Record<string, string> | undefined
  if (contato) {
    const patch: Record<string, unknown> = {}
    if (contato.full_name) patch.full_name = contato.full_name
    if (contato.email) patch.email_primary = contato.email
    if (contato.phone) patch.phone_primary = contato.phone
    if (Object.keys(patch).length) { await db.from('people').update(patch).eq('id', personId); applied.push('contato') }
  }

  // ---- empresa (companies) — cria e vincula se não existir ----
  const empresa = body.empresa as Record<string, unknown> | undefined
  if (empresa) {
    const patch: Record<string, unknown> = {}
    for (const c of ['trade_name', 'website', 'segment', 'cnpj', 'city', 'state', 'legal_name'] as const) {
      if (empresa[c]) patch[c] = empresa[c]
    }
    if (!companyId && (empresa.criarSeNaoExistir ?? true) && Object.keys(patch).length) {
      const { data: nova } = await db.from('companies').insert(patch).select('id').single()
      if (nova) { companyId = nova.id as string; await db.from('opportunities').update({ company_id: companyId }).eq('id', oppId); applied.push('empresa:criada') }
    } else if (companyId && Object.keys(patch).length) {
      await db.from('companies').update(patch).eq('id', companyId); applied.push('empresa')
    }
  }

  // ---- qualificação (0-5) ----
  if (body.qualificacao != null) {
    const q = Math.max(0, Math.min(5, Math.round(Number(body.qualificacao))))
    if (Number.isFinite(q)) { await db.from('opportunities').update({ qualificacao: q }).eq('id', oppId); applied.push('qualificacao') }
  }

  // ---- campos personalizados (upsert por entidade) ----
  const camposContato = body.camposContato as Record<string, string> | undefined
  const camposEmpresa = body.camposEmpresa as Record<string, string> | undefined
  if (camposContato || camposEmpresa) {
    const mapa = await mapaCampos()
    const linhas: { field_id: number; entity_id: string; value: string | null; updated_at: string }[] = []
    const agora = new Date().toISOString()
    for (const [k, v] of Object.entries(camposContato ?? {})) {
      const id = mapa.get(`contact:${k}`); if (id) linhas.push({ field_id: id, entity_id: personId, value: (v ?? '').trim() || null, updated_at: agora })
    }
    if (companyId) for (const [k, v] of Object.entries(camposEmpresa ?? {})) {
      const id = mapa.get(`company:${k}`); if (id) linhas.push({ field_id: id, entity_id: companyId, value: (v ?? '').trim() || null, updated_at: agora })
    }
    if (linhas.length) { await db.from('custom_field_values').upsert(linhas, { onConflict: 'field_id,entity_id' }); applied.push(`campos:${linhas.length}`) }
  }

  // ---- nota ----
  if (typeof body.nota === 'string' && body.nota.trim()) {
    await db.from('notes').insert({ opportunity_id: oppId, body: body.nota.trim(), author_id: null }); applied.push('nota')
  }

  // ---- mover etapa (por último; pode fechar o deal) ----
  if (typeof body.etapa === 'string' && body.etapa) {
    const { error } = await db.rpc('fn_move_stage', {
      p_opportunity_id: oppId, p_to_stage: body.etapa, p_actor: null,
      p_actor_type: 'ai', p_reason: (body.motivoPerda as string) ?? null, p_meta: { via: 'naia' },
    })
    if (error) return NextResponse.json({ ok: false, opportunityId: oppId, applied, erro_etapa: error.message }, { status: 200 })
    applied.push(`etapa:${body.etapa}`)
  }

  return NextResponse.json({ ok: true, opportunityId: oppId, applied })
}
