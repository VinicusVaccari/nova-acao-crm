import { integrationAuthorized, integrationRateLimit } from '@/lib/security/integration'
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
  return integrationAuthorized(req, process.env.NAIA_API_SECRET)
}

async function processar() {
  const { data, error } = await db.rpc('fn_outreach_disparar')
  if (error) return { ok: false, erro: error.message }
  return { ok: true, acionados: (data as number) ?? 0 }
}

export async function GET(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  const limited = await integrationRateLimit('web/app/api/outreach/sweep/route.ts')
  if (limited) return limited
  return NextResponse.json(await processar())
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  const limited = await integrationRateLimit('web/app/api/outreach/sweep/route.ts')
  if (limited) return limited
  return NextResponse.json(await processar())
}
