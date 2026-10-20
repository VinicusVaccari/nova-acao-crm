import { integrationAuthorizedHeaderOnly, readBoundedJson, integrationRateLimit } from '@/lib/security/integration'
import { NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { avisarGrupoLpNova, type PrimeiroContato } from '@/lib/lp-nova'

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
  if (!chave) {
    return NextResponse.json({ erro: 'integração indisponível' }, { status: 503, headers: CORS })
  }
  if (!integrationAuthorizedHeaderOnly(req, chave)) {
    return NextResponse.json({ erro: 'chave inválida' }, { status: 401, headers: CORS })
  }
  const limited = await integrationRateLimit('web/app/api/ingest/lead/route.ts')
  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await readBoundedJson(req)
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400, headers: CORS })
  }

  const texto = (valor: unknown) => {
    if (typeof valor === 'string') return valor.trim() || null
    return typeof valor === 'number' && Number.isFinite(valor) ? String(valor) : null
  }
  const primeiro = (...ch: unknown[]) => ch.map(texto).find((valor): valor is string => valor !== null) ?? null
  const nome = primeiro(body.name, body.nome, body.nome_completo, body['seu-nome'], body['your-name'], body.input_text)
  const telefones = [body.phone, body.telefone, body.celular, body.whatsapp, body.fone, body['seu-telefone'], body.phone_1].map(texto)
  const telefone = telefones.find(valor => {
    const digitos = valor?.replace(/\D/g, '') ?? ''
    return digitos.replace(/^0+/, '').length >= 10 && new Set(digitos).size >= 2
  }) ?? null
  const telefoneInvalido = telefones.some(valor => valor !== null) && telefone === null
  const emailRecebido = primeiro(body.email, body.e_mail, body['seu-email'], body['your-email'])
  const email = emailRecebido && /^[^\s@]+@[^\s@]+$/.test(emailRecebido) ? emailRecebido : null
  const emailInvalido = emailRecebido !== null && email === null

  if (!telefone && !email) {
    return NextResponse.json(
      { erro: 'informe ao menos telefone ou email — sem identificador não há como unificar o lead' },
      { status: 400, headers: CORS }
    )
  }

  const camposDoContrato = new Set([
    'name', 'nome', 'nome_completo', 'seu-nome', 'your-name', 'input_text',
    'phone', 'telefone', 'celular', 'whatsapp', 'fone', 'seu-telefone', 'phone_1',
    'email', 'e_mail', 'seu-email', 'your-email',
    'product', 'expected_value', 'company_name', 'cnpj', 'website', 'segment',
    'channel', 'wa_id', 'campaign_id', 'adset_id', 'ad_id',
    'servico', 'assunto', 'interesse', 'mensagem', 'message', 'sua-mensagem',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'gclid', 'gbraid', 'wbraid', 'fbclid', 'fbc', 'fbp', 'ga_client_id', 'clique_em',
    'landing_page', 'page_url', 'referrer', 'ip', 'user_agent',
  ])
  const camposForaDoContrato = Object.keys(body).filter(campo => !camposDoContrato.has(campo))
  const camposTipoInvalido = [
    'product', 'expected_value', 'company_name', 'website', 'segment', 'channel', 'wa_id', 'campaign_id', 'adset_id', 'ad_id',
    'servico', 'assunto', 'interesse', 'mensagem', 'message', 'sua-mensagem',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'gclid', 'gbraid', 'wbraid', 'fbclid', 'fbc', 'fbp', 'ga_client_id', 'referrer',
  ].filter(campo => campo in body && body[campo] !== null && typeof body[campo] !== 'string' && !(typeof body[campo] === 'number' && Number.isFinite(body[campo])))
  if ('cnpj' in body && body.cnpj !== null && typeof body.cnpj !== 'string') camposTipoInvalido.push('cnpj')
  const cliqueRecebido = texto(body.clique_em)
  const dataClique = cliqueRecebido?.match(/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/)
  const diaCliqueValido = dataClique !== undefined && dataClique !== null && (() => {
    const ano = Number(dataClique[1])
    const mes = Number(dataClique[2])
    const dia = Number(dataClique[3])
    const data = new Date(Date.UTC(ano, mes - 1, dia))
    return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia
  })()
  const cliqueEmValido = diaCliqueValido &&
    !Number.isNaN(Date.parse(cliqueRecebido ?? ''))

  const camposNormalizados = [
    'product', 'expected_value', 'company_name', 'cnpj', 'website', 'segment',
    'channel', 'wa_id', 'campaign_id', 'adset_id', 'ad_id',
    'servico', 'assunto', 'interesse', 'mensagem', 'message', 'sua-mensagem',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'gclid', 'gbraid', 'wbraid', 'fbclid', 'fbc', 'fbp', 'ga_client_id', 'referrer',
  ] as const

  // ip e user agent entram no toque para diagnóstico de tracking
  const payload = {
    ...body,
    ...Object.fromEntries(camposNormalizados.filter(campo => campo in body).map(campo => [campo, campo === 'cnpj' && typeof body[campo] !== 'string' ? null : texto(body[campo])])),
    name: nome ?? null,
    phone: telefone ?? null,
    email: email ?? null,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    user_agent: req.headers.get('user-agent'),
    referrer: texto(body.referrer) ?? texto(req.headers.get('referer')),
    landing_page: primeiro(body.landing_page, body.page_url),
    clique_em: cliqueEmValido ? cliqueRecebido : null,
  }
  const avisos = { campos_fora_do_contrato: camposForaDoContrato, campos_tipo_invalido: camposTipoInvalido, telefone_invalido: telefoneInvalido, email_invalido: emailInvalido, clique_em_invalido: cliqueRecebido !== null && !cliqueEmValido }

  const { data, error } = await db.rpc('fn_ingest_lead', { p_payload: payload })

  if (error) {
    console.error('ingest lead:', error.message)
    return NextResponse.json({ erro: error.message }, { status: 500, headers: CORS })
  }
  const oppId = (data as { opportunity_id?: string } | null)?.opportunity_id
  const personId = (data as { person_id?: string } | null)?.person_id
  const subjectType = oppId ? 'opportunity' : 'person'
  const subjectId = oppId ?? personId
  const registrarEvento = async (eventName: string, payload: object, contexto: string) => {
    if (!subjectId) {
      console.error(`ingest lead ${contexto}: sem pessoa ou negócio para registrar no diário`)
      return
    }
    const { error: erroEvento } = await db.from('events').insert({
      event_name: eventName, subject_type: subjectType, subject_id: subjectId,
      actor_type: 'external', payload, source: 'api:ingest',
    })
    if (erroEvento) console.error(`ingest lead ${contexto}:`, erroEvento.message)
  }
  if (camposForaDoContrato.length) {
    await registrarEvento('lead.campo_fora_do_contrato', { campos: camposForaDoContrato }, 'campos fora do contrato')
  }
  if (camposTipoInvalido.length) {
    await registrarEvento('lead.campo_tipo_invalido', { campos: camposTipoInvalido }, 'campos tipo inválido')
  }
  if (telefoneInvalido) {
    await registrarEvento('lead.telefone_invalido', { campos: ['phone'] }, 'telefone inválido')
  }
  if (data?.blocked === 'whatsapp_travado') {
    return NextResponse.json({ ...(data as object), avisos }, { status: 200, headers: CORS })
  }

  // Guarda serviço/mensagem do formulário como primeira anotação do lead.
  const servico = primeiro(body.servico, body.assunto, body.interesse)
  const mensagem = primeiro(body.mensagem, body.message, body['sua-mensagem'])
  if (oppId && (servico || mensagem)) {
    const partes = [servico ? `Serviço: ${servico}` : '', mensagem ?? ''].filter(Boolean)
    const { error: erroNota } = await db.from('notes').insert({ opportunity_id: oppId, body: partes.join('\n') })
    if (erroNota) console.error('ingest lead nota:', erroNota.message)
  }

  // Lead novo de LP nova: nenhum agente atende, então avisa o grupo do
  // comercial. Depois da resposta, para o formulário não esperar a Z-API.
  const criado = data as { created?: boolean; atendimento?: string; primeiro_contato?: PrimeiroContato | null } | null
  if (oppId && criado?.created && criado.atendimento === 'humano') {
    after(() => avisarGrupoLpNova({
      opportunityId: oppId,
      nome, telefone,
      empresa: texto(body.company_name), site: texto(body.website),
      mensagem,
      landingPage: payload.landing_page,
      utmSource: texto(body.utm_source), utmMedium: texto(body.utm_medium), utmCampaign: texto(body.utm_campaign),
      primeiroContato: criado.primeiro_contato ?? null,
    }))
  }

  return NextResponse.json({ ...(data as object), avisos }, { status: 201, headers: CORS })
}
