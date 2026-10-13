import { integrationAuthorized, readBoundedJson, integrationRateLimit } from '@/lib/security/integration'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buscarIdentidadeTelefone, nomeUtilizavel } from '@/lib/whatsapp'

/* -----------------------------------------------------------------
   API da Naia para LER e ESCREVER no CRM em tempo real.

   GET  /api/naia/deal?secret=…&opportunityId=…   (ou &phone=55…)
        → snapshot do deal (contato, empresa, campos, etapa, notas)

   POST /api/naia/deal?secret=…
        body: { opportunityId | phone, contato, empresa, qualificacao | estrelas,
                camposContato, camposEmpresa, etapa, motivoPerda, nota }
        → aplica o patch (upsert por campo). Idempotente.

   Autenticação: ?secret=<NAIA_API_SECRET> (cai pra WHATSAPP_WEBHOOK_SECRET
   se o dedicado não estiver setado).
   ----------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

function autorizado(req: Request): boolean {
  return integrationAuthorized(req, process.env.NAIA_API_SECRET)
}

function lerQualificacao(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (typeof valor !== 'string') return null
  const texto = valor.trim()
  if (!/^\d+(?:[.,]\d+)?$/.test(texto)) return null
  const numero = Number(texto.replace(',', '.'))
  return Number.isFinite(numero) ? numero : null
}

type Encerramento = Record<string, unknown>

function textoEncerramento(valor: unknown): string | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null
  const texto = String(valor).trim()
  return texto && texto.toLowerCase() !== 'null' ? texto : null
}

function lerEncerramento(valor: unknown): Encerramento | null {
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) return valor as Encerramento
  if (typeof valor !== 'string') return null
  try {
    const json: unknown = JSON.parse(valor)
    return json && typeof json === 'object' && !Array.isArray(json) ? json as Encerramento : null
  } catch { return null }
}

function rotuloEncerramento(encerramento: Encerramento): string | null {
  const tipo = encerramento.tipo
  if (tipo === 'agendado') return 'LEAD AGENDADO'
  if (tipo === 'encaminhado_humano') return ({
    parceria: 'LEAD PEDIU PARCERIA', recusou_reuniao: 'LEAD RECUSOU REUNIÃO', reprovado_qualificacao: 'LEAD REPROVADO NA QUALIFICAÇÃO',
    falha_qualificacao: 'TOOL QUALIFICAÇÃO FALHOU', falha_agenda: 'TOOL AGENDA FALHOU',
  } as Record<string, string>)[String(encerramento.motivo_encaminhamento)] ?? 'LEAD PEDIU HUMANO'
  if (tipo === 'descarte') return ({
    sem_operacao_ativa: 'LEAD SEM OPERAÇÃO', servico_indisponivel: 'SERVIÇO INDISPONÍVEL', nao_e_lead: 'NÃO É LEAD',
    lead_evasivo: 'LEAD EVASIVO', conteudo_ofensivo: 'CONTEÚDO OFENSIVO',
  } as Record<string, string>)[String(encerramento.motivo_descarte)] ?? `DESCARTE: ${textoEncerramento(encerramento.motivo_descarte) ?? 'sem motivo'}`
  return 'ENCERRAMENTO NÃO RECONHECIDO'
}

function notaEncerramento(encerramento: Encerramento, rotulo: string): string {
  const linhas = [`Encerramento da Naia — ${rotulo}`]
  linhas.push('', textoEncerramento(encerramento.informacoes_adicionais) ?? 'Sem resumo da Naia.')
  return linhas.join('\n').slice(0, 8_000)
}

function emailValido(email: string | null): email is string {
  return !!email && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

type PessoaContato = { full_name?: string | null; email_primary?: string | null } | null

async function preencherNomeContato(personId: string, pessoa: PessoaContato, bruto: unknown) {
  const nome = nomeUtilizavel(bruto)
  if (!nome || nomeUtilizavel(pessoa?.full_name)) return { aplicado: false, erro: null }
  const { error } = await db.from('people').update({ full_name: nome }).eq('id', personId)
  return error ? { aplicado: false, erro: error.message } : { aplicado: true, erro: null }
}

async function atualizarEmailContato(personId: string, pessoa: PessoaContato, bruto: unknown) {
  const email = textoEncerramento(bruto)
  if (!emailValido(email)) return { aplicado: false, erro: null }
  const { data: emailCanonico, error: normalizarErro } = await db.rpc('fn_norm_email', { p_raw: email })
  const { data: atualCanonico, error: normalizarAtualErro } = await db.rpc('fn_norm_email', { p_raw: pessoa?.email_primary ?? null })
  if (normalizarErro || normalizarAtualErro || !emailCanonico) {
    return { aplicado: false, erro: normalizarErro?.message ?? normalizarAtualErro?.message ?? 'e-mail inválido' }
  }
  if (emailCanonico === atualCanonico) return { aplicado: false, erro: null }

  const { data: identidade, error: identidadeErro } = await db.from('identities').select('person_id')
    .eq('kind', 'email').eq('value', emailCanonico).maybeSingle()
  if (identidadeErro) return { aplicado: false, erro: identidadeErro.message }
  if (identidade?.person_id && identidade.person_id !== personId) return { aplicado: false, erro: 'e-mail já pertence a outro contato' }

  const { error: identidadeGravarErro } = await db.from('identities')
    .upsert({ person_id: personId, kind: 'email', value: emailCanonico }, { onConflict: 'kind,value', ignoreDuplicates: true })
  if (identidadeGravarErro) return { aplicado: false, erro: identidadeGravarErro.message }

  const { data: confirmada, error: confirmarErro } = await db.from('identities').select('person_id')
    .eq('kind', 'email').eq('value', emailCanonico).maybeSingle()
  if (confirmarErro) return { aplicado: false, erro: confirmarErro.message }
  if (confirmada?.person_id !== personId) return { aplicado: false, erro: 'e-mail já pertence a outro contato' }

  const { error } = await db.from('people').update({ email_primary: emailCanonico }).eq('id', personId)
  return error ? { aplicado: false, erro: error.message } : { aplicado: true, erro: null }
}

/** Resolve a oportunidade por id ou por telefone (cria o lead se preciso). */
async function resolverOpp(opportunityId?: string, phone?: string, criar = true): Promise<string | { blocked: true } | null> {
  if (opportunityId) return opportunityId
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const tel = '+' + digits

  const { identidade: ident } = await buscarIdentidadeTelefone(db, digits)

  if (ident?.person_id) {
    const { data: opp } = await db.from('opportunities').select('id')
      .eq('person_id', ident.person_id).is('lost_at', null).neq('stage', 'ganho')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (opp) return opp.id as string
  }
  if (!criar) return null
  const { data } = await db.rpc('fn_ingest_lead', {
    p_payload: { phone: tel, wa_id: digits, channel: 'whatsapp' },
  })
  if (data?.blocked === 'whatsapp_travado') return { blocked: true }
  return (data as { opportunity_id?: string } | null)?.opportunity_id ?? null
}

/** Mapa (entity+key) → field_id para os campos personalizados ativos. */
async function mapaCampos() {
  const { data } = await db.from('custom_fields')
    .select('id, entity, key').in('entity', ['contact', 'company']).eq('active', true)
  const m = new Map<string, number>()
  for (const d of data ?? []) m.set(`${d.entity}:${d.key}`, d.id as number)
  return m
}

async function carregarValores(entityId: string | null, ids: number[]) {
  if (!entityId || ids.length === 0) return new Map<number, string | null>()
  const { data } = await db.from('custom_field_values')
    .select('field_id, value').eq('entity_id', entityId).in('field_id', ids)
  return new Map((data ?? []).map(v => [v.field_id as number, (v.value as string) ?? null]))
}

// ---------------- GET (contexto) ----------------
export async function GET(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  const limited = await integrationRateLimit('web/app/api/naia/deal/route.ts')
  if (limited) return limited
  const url = new URL(req.url)
  const oppId = await resolverOpp(url.searchParams.get('opportunityId') ?? undefined, url.searchParams.get('phone') ?? undefined, false)
  if (oppId && typeof oppId !== 'string') return NextResponse.json({ ok: true, ignored: 'contato-travado', travado: true })
  if (!oppId) return NextResponse.json({ erro: 'oportunidade não encontrada' }, { status: 404 })

  const { data: opp } = await db.from('opportunities')
    .select('id, stage, qualificacao, person_id, company_id, people:person_id(full_name,email_primary,phone_primary), companies:company_id(id,trade_name,website,segment,cnpj,city,state)')
    .eq('id', oppId).maybeSingle()
  if (!opp) return NextResponse.json({ erro: 'oportunidade não encontrada' }, { status: 404 })

  const mapa = await mapaCampos()
  const defs = [...mapa.entries()]
  const contatoIds = defs.filter(([k]) => k.startsWith('contact:')).map(([, id]) => id)
  const empresaIds = defs.filter(([k]) => k.startsWith('company:')).map(([, id]) => id)
  const [valC, valE] = await Promise.all([
    carregarValores(opp.person_id as string, contatoIds),
    carregarValores((opp.company_id as string) ?? null, empresaIds),
  ])
  const porId = (entity: 'contact' | 'company', vals: Map<number, string | null>) =>
    Object.fromEntries(defs.filter(([k]) => k.startsWith(entity + ':')).map(([k, id]) => [k.split(':')[1], vals.get(id) ?? null]))

  const { data: notas } = await db.from('notes').select('body, created_at')
    .eq('opportunity_id', oppId).order('created_at', { ascending: false }).limit(5)

  return NextResponse.json({
    ok: true,
    opportunityId: oppId,
    stage: opp.stage,
    qualificacao: opp.qualificacao ?? 0,
    contato: opp.people ?? null,
    empresa: opp.companies ?? null,
    camposContato: porId('contact', valC),
    camposEmpresa: porId('company', valE),
    notasRecentes: (notas ?? []).map(n => ({ body: n.body, at: n.created_at })),
  })
}

// ---------------- POST (patch) ----------------
export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  const limited = await integrationRateLimit('web/app/api/naia/deal/route.ts')
  if (limited) return limited

  let body: Record<string, unknown>
  try { body = await readBoundedJson(req) } catch { return NextResponse.json({ erro: 'json inválido' }, { status: 400 }) }

  const oppId = await resolverOpp(body.opportunityId as string | undefined, body.phone as string | undefined, true)
  if (oppId && typeof oppId !== 'string') return NextResponse.json({ ok: true, ignored: 'contato-travado', travado: true })
  if (!oppId) return NextResponse.json({ erro: 'informe opportunityId ou phone' }, { status: 400 })

  const { data: opp } = await db.from('opportunities').select('id, person_id, company_id, people:person_id(full_name,email_primary)').eq('id', oppId).maybeSingle()
  if (!opp) return NextResponse.json({ erro: 'oportunidade não encontrada' }, { status: 404 })
  const personId = opp.person_id as string
  let companyId = (opp.company_id as string) ?? null
  const applied: string[] = []
  let erroQualificacao: string | null = null
  let erroNota: string | null = null
  let erroNome: string | null = null
  let erroEmail: string | null = null
  let erroEncerramento: string | null = null

  const pessoa = opp.people as PessoaContato
  const contato = body.contato as Record<string, unknown> | undefined

  // ---- contato (people) ----
  if (contato?.phone) {
    await db.from('people').update({ phone_primary: contato.phone }).eq('id', personId)
    applied.push('contato')
  }

  // ---- veredito da Naia: resumo idempotente, bastão e dados que ela coletou ----
  const encerramento = lerEncerramento(body.encerramento)
  if (typeof body.encerramento === 'string' && !encerramento) erroEncerramento = 'encerramento JSON inválido'
  const rotulo = encerramento ? rotuloEncerramento(encerramento) : null
  if (encerramento && rotulo) {
    const textoNota = notaEncerramento(encerramento, rotulo)
    const { data: existente, error: buscaNotaErro } = await db.from('notes').select('id')
      .eq('opportunity_id', oppId).eq('body', textoNota).limit(1).maybeSingle()
    if (buscaNotaErro) erroNota = buscaNotaErro.message
    else if (!existente?.id) {
      const { error } = await db.from('notes').insert({ opportunity_id: oppId, body: textoNota, author_id: null })
      if (error) erroNota = error.message
      else applied.push('nota:encerramento')
    }

  }

  const dados = encerramento?.dados as Record<string, unknown> | null
  const nomeBruto = textoEncerramento(contato?.full_name) ?? dados?.nome
  const nome = await preencherNomeContato(personId, pessoa, nomeBruto)
  if (nome.erro) erroNome = nome.erro
  else if (nome.aplicado) applied.push('contato:nome')

  const emailBruto = textoEncerramento(contato?.email) ?? dados?.email
  const email = await atualizarEmailContato(personId, pessoa, emailBruto)
  if (email.erro) erroEmail = email.erro
  else if (email.aplicado) applied.push('contato:email')

  // ---- empresa (companies) — cria e vincula se não existir ----
  const empresa = body.empresa as Record<string, unknown> | undefined
  if (empresa) {
    const patch: Record<string, unknown> = {}
    for (const c of ['trade_name', 'website', 'segment', 'cnpj', 'city', 'state', 'legal_name'] as const) {
      if (empresa[c]) patch[c] = empresa[c]
    }
    if (!companyId && (empresa.criarSeNaoExistir ?? true) && Object.keys(patch).length) {
      const { data: nova } = await db.from('companies').insert(patch).select('id').single()
      if (nova) { companyId = nova.id as string; await db.from('opportunities').update({ company_id: companyId }).eq('id', oppId); applied.push('empresa:criada') }
    } else if (companyId && Object.keys(patch).length) {
      await db.from('companies').update(patch).eq('id', companyId); applied.push('empresa')
    }
  }

  // ---- qualificação (0-5); primeiro valor válido: qualificacao, depois estrelas ----
  const qualificacaoNumero = [body.qualificacao, body.estrelas]
    .map(lerQualificacao).find((valor): valor is number => valor !== null)
  if (qualificacaoNumero !== undefined) {
    const q = Math.max(0, Math.min(5, Math.round(qualificacaoNumero)))
    const { error } = await db.from('opportunities').update({ qualificacao: q }).eq('id', oppId)
    if (error) erroQualificacao = error.message
    else applied.push('qualificacao')
  }

  // ---- campos personalizados (upsert por entidade) ----
  const camposContato = body.camposContato as Record<string, string> | undefined
  const camposEmpresa = body.camposEmpresa as Record<string, string> | undefined
  if (camposContato || camposEmpresa) {
    const mapa = await mapaCampos()
    const linhas: { field_id: number; entity_id: string; value: string | null; updated_at: string }[] = []
    const agora = new Date().toISOString()
    for (const [k, v] of Object.entries(camposContato ?? {})) {
      const id = mapa.get(`contact:${k}`); if (id) linhas.push({ field_id: id, entity_id: personId, value: (v ?? '').trim() || null, updated_at: agora })
    }
    if (companyId) for (const [k, v] of Object.entries(camposEmpresa ?? {})) {
      const id = mapa.get(`company:${k}`); if (id) linhas.push({ field_id: id, entity_id: companyId, value: (v ?? '').trim() || null, updated_at: agora })
    }
    if (linhas.length) { await db.from('custom_field_values').upsert(linhas, { onConflict: 'field_id,entity_id' }); applied.push(`campos:${linhas.length}`) }
  }

  // ---- nota ----
  if (typeof body.nota === 'string' && body.nota.trim()) {
    await db.from('notes').insert({ opportunity_id: oppId, body: body.nota.trim(), author_id: null }); applied.push('nota')
  }

  // ---- produtos (catálogo) — liga produtos ao deal por code ou nome ----
  if (Array.isArray(body.produtos) && body.produtos.length) {
    const termos = (body.produtos as unknown[]).map(p => String(p).trim().toLowerCase()).filter(Boolean)
    if (termos.length) {
      const { data: cat } = await db.from('products').select('id, code, name, default_price, recurrence').eq('active', true)
      type Prod = { id: number; code: string; name: string; default_price: number | null; recurrence: string | null }
      const acha = (t: string) => (cat ?? []).find((p: Prod) =>
        String(p.code).toLowerCase() === t || String(p.name).toLowerCase() === t)
      const linhas = termos.map(acha).filter((p): p is Prod => !!p).map(p => ({
        opportunity_id: oppId, product_id: p.id, quantity: 1,
        mrr: p.default_price ?? 0, recurrence: p.recurrence ?? 'unico', // sobe o preço do catálogo
      }))
      if (linhas.length) {
        await db.from('opportunity_products').upsert(linhas, { onConflict: 'opportunity_id,product_id', ignoreDuplicates: true })
        // recomputa o valor do deal (mensal vs. único), pra refletir no card/ficha
        const { data: itens } = await db.from('opportunity_products').select('quantity, mrr, discount, recurrence').eq('opportunity_id', oppId)
        let mensal = 0, unico = 0
        for (const it of itens ?? []) {
          const linha = Math.max(0, Number(it.quantity ?? 1) * Number(it.mrr ?? 0) - Number(it.discount ?? 0))
          if (it.recurrence === 'mensal') mensal += linha; else unico += linha
        }
        await db.from('opportunities').update({ expected_value: mensal, setup_value: unico }).eq('id', oppId)
        applied.push(`produtos:${linhas.length}`)
      }
    }
  }

  // ---- mover etapa (por último; pode fechar o deal) ----
  let erroEtapa: string | null = null
  if (typeof body.etapa === 'string' && body.etapa) {
    const { error } = await db.rpc('fn_move_stage', {
      p_opportunity_id: oppId, p_to_stage: body.etapa, p_actor: null,
      p_actor_type: 'ai', p_reason: (body.motivoPerda as string) ?? null, p_meta: { via: 'naia' },
    })
    if (error) erroEtapa = error.message
    else applied.push(`etapa:${body.etapa}`)
  }

  if (erroQualificacao || erroEtapa || erroNota || erroNome || erroEmail || erroEncerramento) return NextResponse.json({
    ok: false, opportunityId: oppId, applied,
    ...(erroQualificacao ? { erro_qualificacao: erroQualificacao } : {}),
    ...(erroEtapa ? { erro_etapa: erroEtapa } : {}),
    ...(erroNota ? { erro_nota: erroNota } : {}),
    ...(erroNome ? { erro_nome: erroNome } : {}),
    ...(erroEmail ? { erro_email: erroEmail } : {}),
    ...(erroEncerramento ? { erro_encerramento: erroEncerramento } : {}),
  }, { status: 200 })
  return NextResponse.json({ ok: true, opportunityId: oppId, applied })
}
