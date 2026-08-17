import 'server-only'

/* -----------------------------------------------------------------
   WhatsApp via Z-API + Naia. O nosso sistema é o hub: recebe pela
   Z-API, loga, decide quem responde (Naia ou humano) e envia de volta.
   A Z-API é só transporte; a Naia é o "cérebro" plugável (n8n hoje).
   ----------------------------------------------------------------- */

const ZAPI_BASE = process.env.ZAPI_BASE_URL || 'https://api.z-api.io'

export function zapiConfigurada(): boolean {
  return !!(process.env.ZAPI_INSTANCE && process.env.ZAPI_TOKEN)
}
export function naiaConfigurada(): boolean {
  return !!process.env.NAIA_WEBHOOK_URL
}

/** Envia um texto pelo WhatsApp via Z-API. `delayTyping` mostra o
    "digitando…" por N segundos antes de entregar (default 5). Best-effort.
    Devolve o messageId da Z-API — usamos pra correlacionar o eco (fromMe)
    e aprender o mapa LID→pessoa. */
export async function enviarWhatsapp(
  telefone: string, mensagem: string, delayTyping = 5,
): Promise<{ ok: boolean; messageId: string | null }> {
  if (!zapiConfigurada()) {
    console.warn('Z-API não configurada — mensagem não enviada')
    return { ok: false, messageId: null }
  }
  const url = `${ZAPI_BASE}/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.ZAPI_CLIENT_TOKEN ? { 'Client-Token': process.env.ZAPI_CLIENT_TOKEN } : {}),
    },
    body: JSON.stringify({ phone: telefone.replace(/\D/g, ''), message: mensagem, delayTyping }),
  })
  const txt = await res.text()
  if (!res.ok) {
    console.error('enviarWhatsapp falhou:', res.status, txt)
    return { ok: false, messageId: null }
  }
  let messageId: string | null = null
  try {
    const j = JSON.parse(txt) as { messageId?: string; id?: string; zaapId?: string }
    messageId = j.messageId ?? j.id ?? j.zaapId ?? null
  } catch { /* resposta sem json — segue sem messageId */ }
  return { ok: true, messageId }
}

/** Aciona a Naia (n8n): manda a mensagem + contexto. A Naia processa e
    devolve a resposta chamando /api/whatsapp/reply. Fire-and-forget. */
export async function acionarNaia(payload: {
  telefone: string
  mensagem: string
  nome?: string | null
  opportunityId: string
  tipo: 'text' | 'audio' | 'image'
  audioUrl?: string | null
}): Promise<void> {
  const url = process.env.NAIA_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.NAIA_WEBHOOK_TOKEN ? { 'x-naia-token': process.env.NAIA_WEBHOOK_TOKEN } : {}),
      },
      body: JSON.stringify({ ...payload, audioUrl: payload.audioUrl ?? null }),
    })
  } catch (e) {
    console.error('acionarNaia falhou:', e)
  }
}

type ZapiInbound = {
  phone?: string; lid: string | null; messageId: string | null
  fromMe: boolean; fromApi: boolean; grupo: boolean; nome: string | null
  texto: string | null; tipo: 'text' | 'audio' | 'image'; audioUrl: string | null
}

/** Extrai o essencial do payload da Z-API (mensagem recebida), de forma
    tolerante ao formato (texto, áudio, imagem…). Marca grupo/newsletter/
    broadcast para o inbound ignorar (só 1:1 vira lead). */
export function parseZapiInbound(body: Record<string, unknown>): ZapiInbound {
  const b = body as Record<string, unknown> & {
    phone?: string; chatLid?: string; messageId?: string
    fromMe?: boolean; fromApi?: boolean; senderName?: string; chatName?: string
    isGroup?: boolean; isNewsletter?: boolean; broadcast?: boolean; isStatusReply?: boolean
    text?: { message?: string }; message?: string
    audio?: { audioUrl?: string }; image?: { caption?: string }
  }
  const jid = typeof b.phone === 'string' ? b.phone : ''
  const ehLid = jid.includes('@lid')
  // grupo/comunidade de verdade = JID @g.us (ou prefixo 120363). @lid é
  // contato 1:1 (identificador de privacidade), NÃO é grupo.
  const pareceGrupo = jid.endsWith('@g.us') || (!ehLid && jid.startsWith('120363'))
  const grupo = !!(b.isGroup || b.isNewsletter || b.broadcast || b.isStatusReply || pareceGrupo)

  // LID = identificador interno do WhatsApp (privacidade/multi-device). Pode
  // vir no lugar do telefone. Guardamos só os dígitos pra casar por identidade.
  const lidRaw = [b.phone, b.chatLid].find(v => typeof v === 'string' && v.includes('@lid'))
  const lid = lidRaw ? lidRaw.replace(/\D/g, '') : null
  // telefone real só quando NÃO é @lid
  const phone = ehLid ? undefined : (typeof b.phone === 'string' ? b.phone : undefined)

  let texto: string | null = null
  let tipo: 'text' | 'audio' | 'image' = 'text'
  let audioUrl: string | null = null
  if (b.audio) { tipo = 'audio'; texto = '[áudio recebido]'; audioUrl = b.audio.audioUrl ?? null }
  else if (b.text?.message) { tipo = 'text'; texto = b.text.message }
  else if (typeof b.message === 'string') { tipo = 'text'; texto = b.message }
  else if (b.image) { tipo = 'image'; texto = b.image.caption || '[imagem recebida]' }

  return {
    phone,
    lid,
    messageId: typeof b.messageId === 'string' ? b.messageId : null,
    fromMe: !!b.fromMe,
    fromApi: !!b.fromApi,   // true = saiu pela API (nosso sistema/Naia), não digitado na mão
    grupo,
    nome: b.senderName ?? b.chatName ?? null,
    texto,
    tipo,
    audioUrl,
  }
}
