import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/* -----------------------------------------------------------------
   Porta de entrada de lead. Landing page, formulário, Meta Lead Ads,
   indicação — todos chamam aqui, direto, sem orquestrador no meio.
   Uma transação: resolve identidade, grava o toque, cria o card,
   emite o evento.

   POST /api/ingest/lead
   Header: x-api-key: <INGEST_API_KEY>
   ----------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-api-key',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: Request) {
  const chave = process.env.INGEST_API_KEY
  if (chave && req.headers.get('x-api-key') !== chave) {
    return NextResponse.json({ erro: 'chave inválida' }, { status: 401, headers: CORS })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400, headers: CORS })
  }

  // Aceita nomes de campo em português (CF7, WPForms etc.) além dos em inglês.
  const primeiro = (...ch: unknown[]) => ch.find(v => typeof v === 'string' && v.trim() !== '') as string | undefined
  const nome = primeiro(body.name, body.nome, body.nome_completo, body['seu-nome'], body['your-name'])
  const telefone = primeiro(body.phone, body.telefone, body.celular, body.whatsapp, body.fone, body['seu-telefone'])
  const email = primeiro(body.email, body.e_mail, body['seu-email'], body['your-email'])

  if (!telefone && !email) {
    return NextResponse.json(
      { erro: 'informe ao menos telefone ou email — sem identificador não há como unificar o lead' },
      { status: 400, headers: CORS }
    )
  }

  // ip e user agent entram no toque para diagnóstico de tracking
  const payload = {
    ...body,
    name: nome ?? null,
    phone: telefone ?? null,
    email: email ?? null,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    user_agent: req.headers.get('user-agent'),
    referrer: body.referrer ?? req.headers.get('referer'),
    landing_page: primeiro(body.landing_page, body.page_url) ?? null,
  }

  const { data, error } = await db.rpc('fn_ingest_lead', { p_payload: payload })

  if (error) {
    console.error('ingest lead:', error.message)
    return NextResponse.json({ erro: error.message }, { status: 500, headers: CORS })
  }

  // Guarda serviço/mensagem do formulário como primeira anotação do lead.
  const oppId = (data as { opportunity_id?: string } | null)?.opportunity_id
  const servico = primeiro(body.servico, body.assunto, body.interesse)
  const mensagem = primeiro(body.mensagem, body.message, body['sua-mensagem'])
  if (oppId && (servico || mensagem)) {
    const partes = [servico ? `Serviço: ${servico}` : '', mensagem ?? ''].filter(Boolean)
    await db.from('notes').insert({ opportunity_id: oppId, body: partes.join('\n') })
  }

  return NextResponse.json(data, { status: 201, headers: CORS })
}
