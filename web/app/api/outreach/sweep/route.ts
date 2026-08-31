import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/* -----------------------------------------------------------------
   Gatilho MANUAL da varredura outbound-first (para teste). O disparo
   automático é do próprio banco: pg_cron roda fn_outreach_disparar()
   de minuto em minuto (ver migração 0040) — não precisa chamar isto.

   GET/POST /api/outreach/sweep?secret=<NAIA_API_SECRET>
   ----------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

function autorizado(req: Request): boolean {
  const esperado = process.env.NAIA_API_SECRET || process.env.WHATSAPP_WEBHOOK_SECRET
  if (!esperado) return true
  return new URL(req.url).searchParams.get('secret') === esperado
}

async function processar() {
  const { data, error } = await db.rpc('fn_outreach_disparar')
  if (error) return { ok: false, erro: error.message }
  return { ok: true, acionados: (data as number) ?? 0 }
}

export async function GET(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  return NextResponse.json(await processar())
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  return NextResponse.json(await processar())
}
