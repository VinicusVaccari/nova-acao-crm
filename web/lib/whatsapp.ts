import 'server-only'
import { db } from './db'
import { detalharErroSupabase } from './erros'

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

/** Valores de identidade aceitos para um telefone recebido do WhatsApp.
    Só no Brasil o celular pode chegar com ou sem o nono dígito depois do DDD. */
export function valoresIdentidadeTelefone(digits: string): string[] {
  const limpo = digits.replace(/\D/g, '')
  const variantes = [limpo]
  if (/^55\d{10}$/.test(limpo)) {
    variantes.push(`${limpo.slice(0, 4)}9${limpo.slice(4)}`)
  } else if (/^55\d{11}$/.test(limpo) && limpo[4] === '9') {
    variantes.push(`${limpo.slice(0, 4)}${limpo.slice(5)}`)
  }
  return [...new Set(variantes.flatMap(valor => [`+${valor}`, valor]))]
}

type IdentidadeTelefone = { person_id: string; kind?: string; value?: string; people?: unknown }

/** Procura todas as variantes possíveis, preferindo exatamente a forma que
    chegou. Uma colisão entre pessoas não é resolvida em silêncio. */
export async function buscarIdentidadeTelefone(database: Pick<typeof db, 'from'>, digits: string) {
  const { data, error } = await database.from('identities').select('person_id, kind, value, people:person_id ( full_name )')
    .in('kind', ['phone', 'wa_id']).in('value', valoresIdentidadeTelefone(digits)).limit(4)
  if (error) return { identidade: null, error }

  const identidades = (data ?? []) as IdentidadeTelefone[]
  const personIds = [...new Set(identidades.map(identidade => identidade.person_id))]
  if (personIds.length > 1) console.warn('colisão de identidades de telefone entre contatos', { personIds })

  const valoresExatos = new Set([digits, `+${digits}`])
  return { identidade: identidades.find(identidade => valoresExatos.has(identidade.value ?? '')) ?? identidades[0] ?? null, error: null }
}

/** Tira de um texto de erro qualquer pedaço de credencial da Z-API. A URL
    do send-text leva instância e token no CAMINHO, e mensagens de exceção
    do fetch (ex.: "Failed to parse URL from …") repetem a URL inteira —
    sem isto, o token iria parar na coluna `erro` (que a ficha mostra) e nos
    logs da Vercel. Todo erro de Z-API que vai pra banco ou log passa aqui. */
export function ocultarSegredosZapi(texto: string): string {
  let t = texto
    .replace(/\/token\/[^/\s"']+/g, '/token/***')
    .replace(/\/instances\/[^/\s"']+/g, '/instances/***')
  for (const segredo of [process.env.ZAPI_TOKEN, process.env.ZAPI_CLIENT_TOKEN, process.env.ZAPI_INSTANCE]) {
    if (segredo && segredo.length >= 4) t = t.split(segredo).join('***')
  }
  return t
}

/** Cópia da exceção SEM credencial, pra ela poder subir sem vazar nada. A
    exceção original do fetch não pode subir: /api/whatsapp/reply e
    responderConversa não têm catch, o runtime do Next registra a exceção
    inteira, e ela carrega a URL com instância e token — na mensagem
    ("Failed to parse URL from …"), no stack e em propriedades como `input`
    do ERR_INVALID_URL (achado ALTO da Sentinela, 3ª rodada). A cópia mantém
    só o que diagnóstico e classificação leem — name, code, mensagem, stack
    e a cadeia de cause/errors — tudo passado por ocultarSegredosZapi; o
    resto das propriedades fica pra trás de propósito. */
function excecaoSemSegredo(e: unknown, profundidade = 0): unknown {
  if (typeof e === 'string') return ocultarSegredosZapi(e)
  if (e === null || (typeof e !== 'object' && typeof e !== 'function')) return e
  // Fail-closed: NUNCA devolve o objeto original, nem no corte de
  // profundidade (achado ALTO da Sentinela na re-revisão) — um objeto
  // desconhecido pode carregar a URL em qualquer propriedade.
  if (profundidade > 5) return new Error('(cadeia de causas truncada ao ocultar credenciais da Z-API)')
  const o = e as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown; cause?: unknown; errors?: unknown }
  const mensagem = ocultarSegredosZapi(typeof o.message === 'string' ? o.message : '')
  const opcoes = o.cause !== undefined ? { cause: excecaoSemSegredo(o.cause, profundidade + 1) } : undefined
  const copia: Error & { code?: string | number } = Array.isArray(o.errors)
    ? new AggregateError(o.errors.map(sub => excecaoSemSegredo(sub, profundidade + 1)), mensagem, opcoes)
    : new Error(mensagem, opcoes)
  if (typeof o.name === 'string') copia.name = o.name
  if (typeof o.code === 'string' || typeof o.code === 'number') copia.code = o.code
  copia.stack = typeof o.stack === 'string' ? ocultarSegredosZapi(o.stack) : `${copia.name}: ${mensagem}`
  return copia
}

/** Envia um texto pelo WhatsApp via Z-API. `delayTyping` mostra o
    "digitando…" por N segundos antes de entregar (default 5). Best-effort.
    Devolve o messageId da Z-API — usamos pra correlacionar o eco (fromMe)
    e aprender o mapa LID→pessoa.
    Exceção do fetch (rede, timeout) SOBE como sempre subiu — o contrato de
    /api/whatsapp/reply e do envio humano não muda —, mas já sem credencial
    (excecaoSemSegredo). Quem precisa separar "com certeza não saiu" de
    "pode ter saído" é o executor do follow-up, com
    fetchFalhouAntesDeConectar (web/lib/erros.ts), que lê a cópia. */
export async function enviarWhatsapp(
  telefone: string, mensagem: string, delayTyping = 5, limiteEm?: number,
): Promise<{ ok: boolean; messageId: string | null; erro: string | null; podeTerSaido: boolean }> {
  return enviarWhatsappParaDestino(telefone.replace(/\D/g, ''), mensagem, delayTyping, limiteEm)
}

/** Envia para grupo preservando o identificador da Z-API: JID do WhatsApp
    (ex.: 123-456@g.us) ou o identificador do cofre (ex.: 18 dígitos-group). */
export async function enviarWhatsappGrupo(
  grupo: string, mensagem: string, delayTyping = 5, limiteEm?: number,
): Promise<{ ok: boolean; messageId: string | null; erro: string | null; podeTerSaido: boolean }> {
  const destino = grupo.trim()
  if (!(/^[\p{L}\p{N}._-]+@g\.us$/u.test(destino) || /^\d+-group$/.test(destino))) {
    return { ok: false, messageId: null, erro: 'identificador de grupo inválido', podeTerSaido: false }
  }
  return enviarWhatsappParaDestino(destino, mensagem, delayTyping, limiteEm)
}

async function enviarWhatsappParaDestino(
  destino: string, mensagem: string, delayTyping: number, limiteEm?: number,
): Promise<{ ok: boolean; messageId: string | null; erro: string | null; podeTerSaido: boolean }> {
  if (!zapiConfigurada()) {
    console.warn('Z-API não configurada — mensagem não enviada')
    return { ok: false, messageId: null, erro: 'Z-API não configurada', podeTerSaido: false }
  }
  const url = `${ZAPI_BASE}/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`
  let res: Response
  let txt: string
  try {
    const timeoutMs = Math.min(20000, limiteEm === undefined ? 20000 : limiteEm - Date.now())
    if (timeoutMs <= 0) throw new DOMException('Prazo do envio esgotado', 'TimeoutError')
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.ZAPI_CLIENT_TOKEN ? { 'Client-Token': process.env.ZAPI_CLIENT_TOKEN } : {}),
      },
      body: JSON.stringify({ phone: destino, message: mensagem, delayTyping }),
    })
    txt = await res.text()
  } catch (e) {
    throw excecaoSemSegredo(e)
  }
  if (!res.ok) {
    // code+corpo de verdade — quem chama (o executor do follow-up) precisa
    // disto pra não gravar só "falha no envio" sem dizer por quê (achado
    // do incidente de 13/09/2026: erro genérico demais pra diagnosticar).
    const erro = ocultarSegredosZapi(`zapi_http_${res.status}${txt ? `: ${txt.slice(0, 1000)}` : ''}`)
    console.error('enviarWhatsapp falhou:', erro)
    // 5xx e 408: a requisição chegou do outro lado e a resposta não diz se
    // foi processada (um 502/504 de proxy pode vir DEPOIS de a Z-API ter
    // enfileirado a mensagem). Na dúvida, pode ter saído — a mesma régua de
    // fetchFalhouAntesDeConectar. 4xx (inclusive 429) é recusa explícita.
    const podeTerSaido = res.status >= 500 || res.status === 408
    return { ok: false, messageId: null, erro, podeTerSaido }
  }
  let messageId: string | null = null
  try {
    const j = JSON.parse(txt) as { messageId?: string; id?: string; zaapId?: string }
    messageId = j.messageId ?? j.id ?? j.zaapId ?? null
  } catch { /* resposta sem json — segue sem messageId */ }
  return { ok: true, messageId, erro: null, podeTerSaido: true }
}

/** ÚNICO caminho de envio automatizado "como a Naia" — usado por
    /api/whatsapp/reply (a Naia respondendo) e pelo executor da cadência
    de follow-up (o agente dando o toque). Um caminho só, um
    comportamento só: envia pela Z-API e loga como automatizado
    (is_automated=true). NUNCA usar para envio humano — isso é
    responderConversa (web/lib/actions.ts), que grava intervenção e
    trava o contato. Misturar os dois calaria a Naia no lead. */
export async function enviarComoNaia(params: {
  telefone: string
  mensagem: string
  opportunityId?: string | null
  delayTyping?: number
  /** Em mensagem particionada, só a primeira parte registra a atividade. */
  registrarAtividade?: boolean
  /** Corpo único da atividade, quando o transporte recebe só uma parte. */
  textoAtividade?: string
  /** Opcional: prazo absoluto do transporte e do registro, usado pela LUNA. */
  limiteEm?: number
}): Promise<{ ok: boolean; messageId: string | null; activityId: number | null; logErro: string | null; erro: string | null; podeTerSaido: boolean }> {
  const { telefone, mensagem, opportunityId, delayTyping, registrarAtividade = true, textoAtividade, limiteEm } = params
  const { ok: enviado, messageId, erro, podeTerSaido } = await enviarWhatsapp(telefone, mensagem, delayTyping ?? 5, limiteEm)

  let activityId: number | null = null
  let logErro: string | null = null
  if (opportunityId && registrarAtividade) {
    const registro = db.rpc('fn_log_activity', {
      p_opportunity_id: opportunityId,
      p_kind: 'whatsapp',
      p_direction: 'outbound',
      p_body: textoAtividade ?? mensagem,
      p_is_automated: true, // tudo que sai por aqui é da Naia
      p_outcome: enviado ? 'enviado' : null,
      p_meta: messageId ? { messageId } : {},
    })
    const { data, error } = await (limiteEm === undefined ? registro : registro.abortSignal(AbortSignal.timeout(Math.max(1, limiteEm - Date.now()))))
    // Falha silenciosa aqui é grave: a mensagem saiu e some da conversa.
    // O relógio da cadência de follow-up NÃO depende deste log (ancora em
    // followup_disparos.enviado_em), mas o chamador precisa saber pra
    // anotar o problema — não dá pra desfazer um envio que já saiu pela Z-API.
    if (error) logErro = detalharErroSupabase(error)
    activityId = (data as number | null) ?? null
  }
  return { ok: enviado, messageId, activityId, logErro, erro, podeTerSaido }
}

/** Aciona a Naia (n8n): manda a mensagem + contexto. A Naia processa e
    devolve a resposta chamando /api/whatsapp/reply. Fire-and-forget. */
export async function acionarNaia(payload: {
  telefone: string
  mensagem: string
  nome?: string | null
  opportunityId?: string | null
  tipo: 'text' | 'audio' | 'image'
  audioUrl?: string | null
}): Promise<void> {
  const url = process.env.NAIA_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      signal: AbortSignal.timeout(20000),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.NAIA_WEBHOOK_TOKEN ? { 'x-naia-token': process.env.NAIA_WEBHOOK_TOKEN } : {}),
      },
      body: JSON.stringify({ ...payload, audioUrl: payload.audioUrl ?? null }),
    })
  } catch (e) {
    console.error('acionarNaia falhou:', e instanceof Error ? e.name : 'erro')
  }
}

type ZapiInbound = {
  phone?: string; lid: string | null; messageId: string | null
  fromMe: boolean; fromApi: boolean; grupo: boolean; nome: string | null
  texto: string | null; tipo: 'text' | 'audio' | 'image'; audioUrl: string | null
}

/** Nem tudo que chega no lugar do nome serve como nome do lead. Descarta
    identificador cru ("149035549777938@lid", só dígitos) e o nome do nosso
    próprio perfil no WhatsApp — esse nunca é o nome de quem está do outro
    lado, e foi assim que contatos acabaram batizados com o do vendedor. */
export function nomeUtilizavel(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s || s.includes('@') || !/\p{L}/u.test(s)) return null
  const proprio = process.env.ZAPI_PERFIL_NOME?.trim()
  if (proprio && s.localeCompare(proprio, 'pt-BR', { sensitivity: 'base' }) === 0) return null
  return s
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

  // senderName = quem ENVIOU a mensagem; chatName = de quem é a CONVERSA.
  // Em fromMe o remetente somos nós, então o nome do lead só pode sair do
  // chatName — usar senderName aqui grava o nosso perfil no contato.
  const fromMe = !!b.fromMe
  const nome = fromMe
    ? nomeUtilizavel(b.chatName)
    : (nomeUtilizavel(b.senderName) ?? nomeUtilizavel(b.chatName))

  return {
    phone,
    lid,
    messageId: typeof b.messageId === 'string' ? b.messageId : null,
    fromMe,
    fromApi: !!b.fromApi,   // true = saiu pela API (nosso sistema/Naia), não digitado na mão
    grupo,
    nome,
    texto,
    tipo,
    audioUrl,
  }
}
