import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'

/* -----------------------------------------------------------------
   Ajusta APENAS as estrelas (qualificação, 0–5) de um deal existente.
   NÃO cria e NÃO duplica: se não achar o deal, retorna 404.

   POST /api/naia/estrelas?secret=<NAIA_API_SECRET>
   body: { opportunityId | phone, estrelas: 0..5 }
   ----------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

function autorizado(req: Request): boolean {
  const esperado = process.env.NAIA_API_SECRET || process.env.WHATSAPP_WEBHOOK_SECRET
  if (!esperado) return true
  return new URL(req.url).searchParams.get('secret') === esperado
}

/** Acha o deal SEM criar nada. Por opportunityId direto, ou pelo telefone
    (deal aberto mais recente da pessoa). Se não achar, null. */
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

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, erro: 'json inválido' }, { status: 400 }) }

  const oppId = await acharOpp(body.opportunityId as string | undefined, body.phone as string | undefined)
  if (!oppId) return NextResponse.json({ ok: false, erro: 'deal não encontrado (este endpoint não cria deal)' }, { status: 404 })

  const bruto = Number(body.estrelas ?? body.qualificacao)
  if (Number.isNaN(bruto)) return NextResponse.json({ ok: false, erro: 'informe "estrelas" (0 a 5)' }, { status: 400 })
  const estrelas = Math.max(0, Math.min(5, Math.round(bruto)))

  const { error } = await db.from('opportunities').update({ qualificacao: estrelas }).eq('id', oppId)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  revalidatePath('/pipeline')
  revalidatePath(`/lead/${oppId}`)
  return NextResponse.json({ ok: true, opportunityId: oppId, estrelas })
}
