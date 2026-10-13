import { integrationAuthorized, readBoundedJson, integrationRateLimit } from '@/lib/security/integration'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buscarIdentidadeTelefone, enviarComoNaia } from '@/lib/whatsapp'

/* -----------------------------------------------------------------
   Webhook de RESPOSTA DA NAIA. O n8n chama aqui com o texto a enviar;
   o nosso sistema envia pela Z-API e loga a saída no inbox como
   automatizada (tudo que vem do n8n é da Naia). O Rodrigues NÃO passa
   por aqui — ele responde pelo inbox (sistema → Z-API direto).

   POST /api/whatsapp/reply
   Body: {
     "secret": "<WHATSAPP_WEBHOOK_SECRET>",   // ou ?secret= na URL
     "mensagem": "texto a enviar",
     "telefone": "5511999999999"              // ou "opportunityId"
   }
   ----------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET
  let body: Record<string, unknown>
  try { body = await readBoundedJson(req) } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }

  if (!integrationAuthorized(req, secret, body.secret)) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  }
  const limited = await integrationRateLimit('web/app/api/whatsapp/reply/route.ts')
  if (limited) return limited

  const mensagem = (body.mensagem ?? body.message) as string | undefined
  if (!mensagem || !mensagem.trim()) {
    return NextResponse.json({ erro: 'mensagem vazia' }, { status: 400 })
  }

  let oppId = (body.opportunityId ?? body.opportunity_id) as string | undefined
  let telefone = (body.telefone ?? body.phone) as string | undefined

  // completa o que faltar: telefone ⇄ oportunidade
  if (telefone && !oppId) {
    const digits = String(telefone).replace(/\D/g, '')
    const { identidade: ident } = await buscarIdentidadeTelefone(db, digits)
    if (ident?.person_id) {
      const { data: opp } = await db
        .from('opportunities').select('id')
        .eq('person_id', ident.person_id).is('lost_at', null).neq('stage', 'ganho')
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      oppId = opp?.id as string | undefined
    }
  }
  if (oppId && !telefone) {
    const { data: opp } = await db
      .from('opportunities').select('people:person_id ( phone_primary )').eq('id', oppId).maybeSingle()
    telefone = (opp?.people as { phone_primary?: string } | null)?.phone_primary ?? undefined
  }

  if (!telefone) return NextResponse.json({ erro: 'sem telefone de destino' }, { status: 400 })

  const delay = Number(body.delayTyping)
  // ÚNICO caminho de envio automatizado — o mesmo que o executor da
  // cadência de follow-up usa. Contrato desta rota inalterado: mesmo
  // body, mesma resposta, mesmo status.
  const { ok: enviado, logErro } = await enviarComoNaia({
    telefone, mensagem, opportunityId: oppId, delayTyping: Number.isFinite(delay) ? delay : 5,
  })
  // Não muda o contrato (mesmo body/resposta/status), mas não engole a
  // falha em silêncio: sem a activity, a próxima janela de silêncio do
  // follow-up contaria a partir da mensagem errada.
  if (logErro) console.error('enviarComoNaia: falha ao registrar atividade —', logErro)

  return NextResponse.json({ ok: enviado, opportunityId: oppId })
}
