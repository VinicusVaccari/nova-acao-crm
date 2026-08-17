import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { enviarWhatsapp } from '@/lib/whatsapp'

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
  try { body = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }

  const urlSecret = new URL(req.url).searchParams.get('secret')
  if (secret && body.secret !== secret && urlSecret !== secret) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  }

  const mensagem = (body.mensagem ?? body.message) as string | undefined
  if (!mensagem || !mensagem.trim()) {
    return NextResponse.json({ erro: 'mensagem vazia' }, { status: 400 })
  }

  let oppId = (body.opportunityId ?? body.opportunity_id) as string | undefined
  let telefone = (body.telefone ?? body.phone) as string | undefined

  // completa o que faltar: telefone ⇄ oportunidade
  if (telefone && !oppId) {
    const digits = String(telefone).replace(/\D/g, '')
    const { data: ident } = await db
      .from('identities').select('person_id')
      .in('kind', ['phone', 'wa_id']).in('value', ['+' + digits, digits]).limit(1).maybeSingle()
    if (ident?.person_id) {
      const { data: opp } = await db
        .from('opportunities').select('id')
        .eq('person_id', ident.person_id).not('stage', 'in', '(ganho,perdido)')
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
  const { ok: enviado, messageId } = await enviarWhatsapp(telefone, mensagem, Number.isFinite(delay) ? delay : 5)

  if (oppId) {
    await db.rpc('fn_log_activity', {
      p_opportunity_id: oppId,
      p_kind: 'whatsapp',
      p_direction: 'outbound',
      p_body: mensagem,
      p_is_automated: true, // tudo que vem do n8n é da Naia
      p_outcome: enviado ? 'enviado' : null,
      // guarda o messageId → o eco (fromMe) correlaciona e aprende o LID
      p_meta: messageId ? { messageId } : {},
    })
  }

  return NextResponse.json({ ok: enviado, opportunityId: oppId })
}
