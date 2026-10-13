import { integrationAuthorized, readBoundedJson, integrationRateLimit } from '@/lib/security/integration'
import { downloadAudio } from '@/lib/security/media'
import { randomUUID } from 'node:crypto'
import { NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { responderLeadLuna } from '@/lib/agentes/luna/conversa'
import { acionarNaia, buscarIdentidadeTelefone, nomeUtilizavel, parseZapiInbound } from '@/lib/whatsapp'

/* -----------------------------------------------------------------
   Webhook de MENSAGEM RECEBIDA. É este endereço que vai na Z-API
   ("ao receber mensagem"). Fluxo:
     1. resolve o telefone e consulta a trava
     2. usa o negócio aberto; só cria um novo se o contato não estiver travado
     3. loga a mensagem no negócio existente ou recém-criado
     3. se a conversa está com a Naia → aciona o n8n
        se está com humano (Rodrigues assumiu) → só espera no inbox
   POST /api/whatsapp/inbound?secret=<WHATSAPP_WEBHOOK_SECRET>
   ----------------------------------------------------------------- */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Baixa o áudio temporário da Z-API (Backblaze) e guarda no nosso Storage,
    privado — a URL da Z-API expira. Devolve uma referência interna, assinada
    apenas para destinatários autorizados, ou null se a validação falhar. */
async function persistirAudio(url: string): Promise<string | null> {
  try {
    const { bytes, mime, ext } = await downloadAudio(url)
    const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`
    const { error } = await db.storage.from('wa-audio').upload(path, bytes, { contentType: mime, upsert: false })
    if (error) { console.error('persistirAudio upload:', error.message); return null }
    return `wa-audio:${path}`
  } catch (e) {
    console.error('persistirAudio: download ou armazenamento recusado', e instanceof Error ? e.name : 'erro')
    return null
  }
}

export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET
  if (!integrationAuthorized(req, secret)) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  }

  const limited = await integrationRateLimit('web/app/api/whatsapp/inbound/route.ts')
  if (limited) return limited

  let body: Record<string, unknown>
  try { body = await readBoundedJson(req) } catch { return NextResponse.json({ ok: true, ignored: 'json' }) }

  const { phone, lid, fromMe, fromApi, grupo, nome, texto, tipo, audioUrl, messageId } = parseZapiInbound(body)

  // DIAGNÓSTICO: registra o cru de TODO webhook (antes de qualquer filtro),
  // pra enxergar o que a Z-API manda. Best-effort — nunca quebra o fluxo.
  try {
    await db.from('wa_webhook_log').insert({
      from_me: fromMe, from_api: fromApi, phone: phone ?? (lid ? lid + '@lid' : null),
      texto: texto ?? null, raw: body,
    })
  } catch { /* ignora */ }

  // Eco da API já foi registrado quando saiu. Não tenta casar o telefone que
  // a Z-API devolveu (ele pode vir sem o nono dígito) e nunca cria um deal.
  if (fromMe && fromApi) return NextResponse.json({ ok: true, echo: 'api' })

  if (messageId) {
    const { data: receipt, error } = await db.from('security_webhook_receipts').select('message_id')
      .eq('message_id', messageId).eq('direction', fromMe ? 'outbound' : 'inbound').maybeSingle()
    if (error) return NextResponse.json({ erro: 'Proteção de mensagens indisponível.' }, { status: 503 })
    if (receipt) return NextResponse.json({ ok: true, duplicate: true })
  }

  // ignora: grupos/newsletter/broadcast e callbacks sem texto. Precisa de
  // telefone OU lid pra casar. fromMe NÃO é ignorado: pode ser o Rodrigues
  // respondendo na mão — capturamos mais abaixo.
  if (grupo || !texto || (!phone && !lid)) return NextResponse.json({ ok: true, ignored: true })

  // kind da atividade respeita o constraint do banco (whatsapp | audio)
  const kind = tipo === 'audio' ? 'audio' : 'whatsapp'

  // ---- telefone real: do payload, ou resolvido pelo LID via cadastro ----
  // O WhatsApp às vezes manda só o @lid (privacidade). O cadastro guarda
  // phone + chatlid, então convertemos LID → telefone por ali.
  let digits = phone ? phone.replace(/\D/g, '') : null
  if (!digits && lid) {
    const { data: fone, error } = await db.rpc('fn_phone_from_lid', { p_lid: lid })
    if (error) return NextResponse.json({ erro: 'Não foi possível identificar o contato.' }, { status: 503 })
    if (fone) digits = fone as string
  }
  // LID desconhecido (sem telefone no cadastro) → não dá pra casar. Fica no log.
  if (!digits) return NextResponse.json({ ok: true, ignored: 'lid-desconhecido', lid: lid ?? null })

  const tel = '+' + digits

  // A trava impede a criação do deal, além de controlar a resposta da Naia.
  // Falha de leitura não equivale a contato liberado.
  const { data: travaInicial, error: travaErro } = await db.rpc('fn_trava_status', { p_phone: digits })
  if (travaErro || typeof travaInicial !== 'boolean') {
    return NextResponse.json({ erro: 'Não foi possível consultar a trava do contato.' }, { status: 503 })
  }
  const { data: teste } = await db.rpc('fn_numero_teste', { p_phone: digits })

  // veio telefone real + lid juntos → aprende/atualiza o mapa no cadastro
  if (phone && lid) {
    await db.rpc('fn_set_chatlid', { p_phone: digits, p_lid: lid, p_name: nome })
  }

  // ---- resolve a oportunidade aberta pelo telefone (sem criar toque à toa) ----
  let oppId: string | undefined
  let oppRecenteId: string | undefined

  const { identidade: ident, error: identErro } = await buscarIdentidadeTelefone(db, digits)
  if (identErro) return NextResponse.json({ erro: 'Não foi possível consultar o contato.' }, { status: 503 })

  if (ident?.person_id) {
    const kindRecebido = phone ? 'phone' : 'wa_id'
    const valorRecebido = phone ? tel : digits
    if (ident.kind !== kindRecebido || ident.value !== valorRecebido) {
      const { error: identidadeErro } = await db.from('identities').upsert(
        { person_id: ident.person_id, kind: kindRecebido, value: valorRecebido },
        { onConflict: 'kind,value', ignoreDuplicates: true },
      )
      if (identidadeErro) return NextResponse.json({ erro: 'Não foi possível registrar o telefone do contato.' }, { status: 503 })
    }
    // O nome só era gravado na criação do lead. Quando ele ficou vazio (ou
    // virou um identificador), a primeira mensagem com nome de verdade
    // conserta. Nome já preenchido nunca é sobrescrito.
    const atual = (ident.people as { full_name?: string | null } | null)?.full_name
    if (nome && !nomeUtilizavel(atual)) {
      await db.from('people').update({ full_name: nome }).eq('id', ident.person_id)
    }

    const { data: opp, error: oppErro } = await db
      .from('opportunities')
      .select('id')
      .eq('person_id', ident.person_id)
      .is('lost_at', null)
      .neq('stage', 'ganho')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (oppErro) return NextResponse.json({ erro: 'Não foi possível consultar o negócio.' }, { status: 503 })
    if (opp) oppId = opp.id as string
    else if (travaInicial) {
      const { data: recente, error: recenteErro } = await db
        .from('opportunities')
        .select('id')
        .eq('person_id', ident.person_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (recenteErro) return NextResponse.json({ erro: 'Não foi possível consultar o último negócio.' }, { status: 503 })
      if (recente) oppRecenteId = recente.id as string
    }
  }

  // primeiro contato desse número (ou sem negócio aberto) → cria o lead
  if (!oppId) {
    if (travaInicial && oppRecenteId) {
      oppId = oppRecenteId
    }
    // Número de teste travado sem histórico não cria deal, mas precisa
    // chegar ao n8n para o #reset funcionar.
    else if (travaInicial) {
      if (teste && (!fromMe || texto.trim() === '#reset')) {
        await acionarNaia({ telefone: digits, mensagem: texto, nome, tipo, opportunityId: null })
        return NextResponse.json({ ok: true, teste: true, semOportunidade: true })
      }
      return NextResponse.json({ ok: true, ignored: 'contato-travado', travado: true })
    }
    if (!oppId) {
      const { data, error } = await db.rpc('fn_ingest_lead', {
        p_payload: { phone: tel, name: nome, wa_id: digits, channel: 'whatsapp' },
      })
      if (error) {
        console.error('inbound → fn_ingest_lead:', error.message)
        return NextResponse.json({ erro: error.message }, { status: 500 })
      }
      // A função SQL repete a proteção, cobrindo uma trava recebida entre as
      // consultas e também outros chamadores (Naia / integração de leads).
      if (data?.blocked === 'whatsapp_travado') {
        if (teste && (!fromMe || texto.trim() === '#reset')) {
          await acionarNaia({ telefone: digits, mensagem: texto, nome, tipo, opportunityId: null })
          return NextResponse.json({ ok: true, teste: true, semOportunidade: true })
        }
        return NextResponse.json({ ok: true, ignored: 'contato-travado', travado: true })
      }
      oppId = (data as { opportunity_id?: string } | null)?.opportunity_id
    }
  }
  if (!oppId) return NextResponse.json({ erro: 'sem oportunidade' }, { status: 500 })

  // Referência privada permanente; nunca repassa URL arbitrária ao navegador.
  const audioFinal = tipo === 'audio' && audioUrl
    ? await persistirAudio(audioUrl)
    : null

  // ================================================================
  // fromMe = mensagem SAINDO do nosso número. Pode ser:
  //   (a) enviada pela API — nosso sistema/Naia (fromApi=true) → ignora,
  //       já logamos na hora do envio, ou
  //   (b) o Rodrigues digitando na mão pelo WhatsApp (fromApi=false) →
  //       loga como outbound humano + trava em "intervenção" (Naia para).
  // O fromApi é o sinal decisivo. O dedup por conteúdo fica só como rede
  // de segurança caso algum payload venha sem fromApi.
  // ================================================================
  if (fromMe) {
    const desde = new Date(Date.now() - 45_000).toISOString()
    const { data: eco } = await db
      .from('activities')
      .select('id')
      .eq('opportunity_id', oppId)
      .eq('direction', 'outbound')
      .eq('body', texto)
      .gte('occurred_at', desde)
      .limit(1)
      .maybeSingle()

    if (eco) return NextResponse.json({ ok: true, opportunityId: oppId, echo: 'dedup' })

    // Rodrigues respondeu na mão → registra no chat e assume o lead
    const { data: logged, error: logError } = await db.rpc('fn_log_whatsapp_once', {
      p_opportunity_id: oppId,
      p_message_id: messageId,
      p_kind: kind,
      p_direction: 'outbound',
      p_body: texto,
      p_meta: audioFinal ? { audioUrl: audioFinal } : {},
    })
    if (logError) return NextResponse.json({ erro: 'Não foi possível registrar a mensagem.' }, { status: 500 })
    if (!logged) return NextResponse.json({ ok: true, duplicate: true })
    await db.rpc('fn_intervencao', { p_phone: digits, p_name: nome })
    if (teste && texto.trim() === '#reset') {
      await acionarNaia({ telefone: digits, mensagem: texto, nome, opportunityId: oppId, tipo })
    }
    return NextResponse.json({ ok: true, opportunityId: oppId, manual: true })
  }

  // ---- loga a mensagem recebida (entra no inbox) ----
  const { data: logged, error: logError } = await db.rpc('fn_log_whatsapp_once', {
    p_opportunity_id: oppId,
    p_message_id: messageId,
    p_kind: kind,
    p_direction: 'inbound',
    p_body: texto,
    p_meta: audioFinal ? { audioUrl: audioFinal } : {},
  })
  if (logError) return NextResponse.json({ erro: 'Não foi possível registrar a mensagem.' }, { status: 500 })
  if (!logged) return NextResponse.json({ ok: true, duplicate: true })

  // A Z-API recebe o ACK já com a mensagem persistida/deduplicada. Modelo,
  // agenda e transportes rodam depois da resposta; qualquer falha fica no
  // log em vez de deixar o provedor reenviar o mesmo webhook.
  after(async () => {
    try {
      const luna = texto.trim() === '#reset'
        ? { assumiu: false, respondeu: false }
        : await responderLeadLuna({
          opportunityId: oppId, telefone: digits, texto, tipo, messageId,
          // A espera acontece depois do ACK e do log deduplicado. Eco e
          // #reset já saíram antes deste ponto e não passam pela janela.
          aguardarAgrupamento: true,
        })
      if (luna.assumiu) return

      // trava vem da tabela de cadastro (controlada pelo n8n): se travado, Naia não responde.
      const { data: travado, error: travaFinalErro } = await db.rpc('fn_trava_status', { p_phone: digits })
      if (travaFinalErro || typeof travado !== 'boolean') {
        console.error('inbound: trava indisponível depois do log; Naia não acionada')
        return
      }
      // Número de teste sempre chega ao n8n (inclusive para #reset); a LUNA
      // já retornou acima para qualquer outra conversa que ela assumiu.
      if (!travado || teste) {
        let signedAudio: string | null = null
        if (audioFinal?.startsWith('wa-audio:')) {
          const { data } = await db.storage.from('wa-audio').createSignedUrl(audioFinal.slice('wa-audio:'.length), 3600)
          signedAudio = data?.signedUrl ?? null
        }
        await acionarNaia({ telefone: digits, mensagem: texto, nome, opportunityId: oppId, tipo, audioUrl: signedAudio })
      }
    } catch (erro) {
      console.error('inbound: automação pós-webhook falhou:', erro instanceof Error ? erro.name : 'erro')
    }
  })

  return NextResponse.json({ ok: true, opportunityId: oppId, processando: true })
}
