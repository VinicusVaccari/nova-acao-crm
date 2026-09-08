import { integrationAuthorized, readBoundedJson, integrationRateLimit } from '@/lib/security/integration'
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'

/* -----------------------------------------------------------------
   Adiciona um MOTIVO DE PERDA à lista gerenciada (idempotente).
   POST /api/naia/motivo-perda?secret=<NAIA_API_SECRET>
   body: { label: "Lead evasivo" }   → devolve o code (slug)
   ----------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

function autorizado(req: Request): boolean {
  return integrationAuthorized(req, process.env.NAIA_API_SECRET)
}

function slugify(l: string): string {
  return l.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'motivo'
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ ok: false, erro: 'não autorizado' }, { status: 401 })
  const limited = await integrationRateLimit('web/app/api/naia/motivo-perda/route.ts')
  if (limited) return limited

  let body: Record<string, unknown>
  try { body = await readBoundedJson(req) } catch { return NextResponse.json({ ok: false, erro: 'json inválido' }, { status: 400 }) }

  const label = String(body.label ?? body.nome ?? '').trim()
  if (!label) return NextResponse.json({ ok: false, erro: 'informe "label"' }, { status: 400 })

  const code = slugify(label)
  const { data: existe } = await db.from('lost_reasons').select('code, label').eq('code', code).maybeSingle()
  if (existe) return NextResponse.json({ ok: true, code: existe.code, label: existe.label, criado: false })

  const { error } = await db.from('lost_reasons').insert({ code, label, active: true })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  revalidatePath('/configuracoes/motivos-perda')
  return NextResponse.json({ ok: true, code, label, criado: true })
}
