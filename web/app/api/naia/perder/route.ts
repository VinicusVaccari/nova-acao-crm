import { integrationAuthorized, readBoundedJson, integrationRateLimit } from '@/lib/security/integration'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { registrarPerdaAutorizada } from '@/lib/negociacao-service'

/* -----------------------------------------------------------------
   Marca um deal como PERDIDO (modelo de status: grava lost_at + lost_reason,
   MANTÉM a etapa — assim sabemos ONDE perdemos). NÃO cria/duplica deal.

   POST /api/naia/perder?secret=<NAIA_API_SECRET>
   body: { opportunityId | phone, motivo: "<code>" }
   O motivo tem que ser um code existente (ver /api/naia/motivo-perda).
   ----------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

function autorizado(req: Request): boolean {
  return integrationAuthorized(req, process.env.NAIA_API_SECRET)
}

/** Acha o deal SEM criar nada (por opportunityId, ou deal aberto da pessoa). */
async function acharOpp(opportunityId?: string, phone?: string): Promise<string | null> {
  if (opportunityId) {
    const { data } = await db.from('opportunities').select('id').eq('id', opportunityId).maybeSingle()
    return data?.id ?? null
  }
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const tel = '+' + digits
  const { data: ident } = await db.from('identities').select('person_id')
    .in('kind', ['phone', 'wa_id']).in('value', [tel, digits]).limit(1).maybeSingle()
  if (!ident?.person_id) return null
  const { data: opp } = await db.from('opportunities').select('id')
    .eq('person_id', ident.person_id).is('lost_at', null).neq('stage', 'ganho')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return opp?.id ?? null
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ ok: false, erro: 'não autorizado' }, { status: 401 })
  const limited = await integrationRateLimit('web/app/api/naia/perder/route.ts')
  if (limited) return limited

  let body: Record<string, unknown>
  try { body = await readBoundedJson(req) } catch { return NextResponse.json({ ok: false, erro: 'json inválido' }, { status: 400 }) }

  const oppId = await acharOpp(body.opportunityId as string | undefined, body.phone as string | undefined)
  if (!oppId) return NextResponse.json({ ok: false, erro: 'deal não encontrado (este endpoint não cria deal)' }, { status: 404 })

  const motivo = String(body.motivo ?? body.motivoPerda ?? '').trim()
  if (!motivo) return NextResponse.json({ ok: false, erro: 'informe "motivo" (code do motivo de perda)' }, { status: 400 })

  const { data: mr } = await db.from('lost_reasons').select('code').eq('code', motivo).maybeSingle()
  if (!mr) return NextResponse.json({ ok: false, erro: `motivo "${motivo}" não existe — crie em /api/naia/motivo-perda ou use um code válido` }, { status: 400 })

  // A integração já foi autenticada acima. Não chamar uma Server Action
  // que exige sessão de usuário. O ator da automação não vem do body.
  const r = await registrarPerdaAutorizada(oppId, motivo, { tipo: 'ai' })
  if (!r.ok) return NextResponse.json({ ok: false, erro: r.erro }, { status: 500 })

  return NextResponse.json({ ok: true, opportunityId: oppId, status: 'perdido', motivo })
}
