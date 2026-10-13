import { NextResponse } from 'next/server'
import { responderLeadLuna } from '@/lib/agentes/luna/conversa'
import { integrationAuthorizedHeaderOnly, integrationRateLimit, readBoundedJson } from '@/lib/security/integration'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Resgate de entradas que ficaram órfãs se o after() morreu durante a janela. */
export async function POST(req: Request) {
  if (!process.env.FOLLOWUP_API_SECRET) {
    return NextResponse.json({ ok: false, erro: 'integração não configurada' }, { status: 503 })
  }
  if (!integrationAuthorizedHeaderOnly(req, process.env.FOLLOWUP_API_SECRET, 'x-followup-token')) {
    return NextResponse.json({ ok: false, erro: 'não autorizado' }, { status: 401 })
  }
  const limited = await integrationRateLimit('web/app/api/luna/conversas/executar/route.ts')
  if (limited) return limited
  let body: Record<string, unknown>
  try { body = await readBoundedJson(req) } catch { return NextResponse.json({ ok: false, erro: 'json inválido' }, { status: 400 }) }
  if (typeof body.opportunity_id !== 'string' || !body.opportunity_id || typeof body.telefone !== 'string' || !body.telefone || !Number.isSafeInteger(body.activity_id)) {
    return NextResponse.json({ ok: false, erro: 'opportunity_id, telefone e activity_id obrigatórios' }, { status: 400 })
  }
  const resultado = await responderLeadLuna({
    opportunityId: body.opportunity_id,
    telefone: body.telefone,
    texto: '',
    tipo: 'text',
    activityId: body.activity_id as number,
    resgate: true,
  })
  return NextResponse.json({ ok: true, ...resultado })
}
