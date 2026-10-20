const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('../web/node_modules/typescript')
const ROOT = path.resolve(__dirname, '..')

// Mesmo carregador do security.test.cjs: TypeScript real, fronteiras simuladas.
function load(relative, mocks = {}) {
  const filename = path.join(ROOT, relative)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  const localRequire = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id]
    if (id === 'server-only') return {}
    if (id.startsWith('node:')) return require(id)
    throw new Error(`Dependência externa não simulada: ${id}`)
  }
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(localRequire, module, module.exports)
  return module.exports
}

/* Banco simulado: cada consulta encadeada termina numa promessa com o
   resultado configurado para a tabela (ou rpc). Basta para o caminho do
   inbound, que só lê/escreve por from()/rpc(). */
function bancoSimulado({ atendimento, atendimentoErro = null }) {
  const consulta = tabela => {
    let colunas = ''
    const resultado = () => {
      if (tabela !== 'opportunities') return { data: null, error: null }
      // O erro simulado vale só para a leitura do atendimento; a busca do
      // negócio aberto, antes dela, continua funcionando.
      if (colunas === 'atendimento' && atendimentoErro) return { data: null, error: atendimentoErro }
      return { data: { id: 'opp-1', atendimento }, error: null }
    }
    const cadeia = new Proxy({}, {
      get(_alvo, prop) {
        if (prop === 'then') return (ok, erro) => Promise.resolve(resultado()).then(ok, erro)
        if (prop === 'select') return arg => { colunas = arg; return cadeia }
        return () => cadeia
      },
    })
    return cadeia
  }
  const rpcs = {
    fn_trava_status: { data: false, error: null },
    fn_numero_teste: { data: false, error: null },
    fn_log_whatsapp_once: { data: true, error: null },
  }
  return {
    from: consulta,
    rpc: nome => Promise.resolve(rpcs[nome] ?? { data: null, error: null }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null }) }) },
  }
}

async function receberMensagem(opcoes) {
  const chamadas = { luna: 0, naia: 0 }
  let posResposta = null
  const { POST } = load('web/app/api/whatsapp/inbound/route.ts', {
    'next/server': {
      NextResponse: { json: (corpo, init) => ({ corpo, status: init?.status ?? 200 }) },
      after: fn => { posResposta = fn },
    },
    '@/lib/security/integration': {
      integrationAuthorized: () => true,
      readBoundedJson: async req => req.corpo,
      integrationRateLimit: async () => null,
    },
    '@/lib/security/media': { downloadAudio: async () => { throw new Error('sem áudio no teste') } },
    '@/lib/db': { db: bancoSimulado(opcoes) },
    '@/lib/agentes/luna/conversa': {
      responderLeadLuna: async () => { chamadas.luna++; return { assumiu: false, respondeu: false } },
    },
    '@/lib/whatsapp': {
      acionarNaia: async () => { chamadas.naia++ },
      buscarIdentidadeTelefone: async () => ({ identidade: { person_id: 'p-1', kind: 'phone', value: '+5511999990000', people: { full_name: 'Lead' } }, error: null }),
      nomeUtilizavel: v => v ?? null,
      parseZapiInbound: () => ({
        phone: '5511999990000', lid: null, messageId: 'm-1', fromMe: false, fromApi: false,
        grupo: false, nome: 'Lead', texto: 'Oi, vi a página', tipo: 'text', audioUrl: null,
      }),
    },
  })
  const resposta = await POST({ corpo: {} })
  assert.equal(resposta.status, 200)
  assert.ok(posResposta, 'a automação pós-resposta deveria ter sido agendada')
  await posResposta()
  return chamadas
}

test('lead de LP nova (atendimento humano) que escreve primeiro: nem LUNA nem Naia respondem', async () => {
  const chamadas = await receberMensagem({ atendimento: 'humano' })
  assert.deepEqual(chamadas, { luna: 0, naia: 0 })
})

test('lead dos formulários de sempre (atendimento naia) segue com LUNA e Naia', async () => {
  const chamadas = await receberMensagem({ atendimento: 'naia' })
  assert.deepEqual(chamadas, { luna: 1, naia: 1 })
})

test('sem conseguir ler o atendimento, nenhum agente entra', async () => {
  const chamadas = await receberMensagem({ atendimentoErro: { message: 'timeout' } })
  assert.deepEqual(chamadas, { luna: 0, naia: 0 })
})

/* Etiquetas de atendimento (pipeline e mensagens). Banco simulado por
   tabela: cada consulta devolve as linhas da tabela, e o filtro
   eq('atendimento', 'humano') de opportunities é respeitado. */
const NEGOCIOS = [
  { id: 'opp-lp', atendimento: 'humano', telefone: '5511977771111' },   // LP nova, sem trava
  { id: 'opp-antigo', atendimento: 'naia', telefone: '5511977772222' }, // formulário de sempre
  { id: 'opp-travado', atendimento: 'naia', telefone: '5511977773333' }, // trava antiga, ninguém respondeu
]
function bancoPorTabela() {
  const linhas = {
    opportunities: NEGOCIOS.map(n => ({
      id: n.id, atendimento: n.atendimento, stage: 'novo', created_at: '2026-10-19T12:00:00Z',
      people: { full_name: n.id, phone_primary: n.telefone }, companies: null, profiles: null,
    })),
    v_conversas: NEGOCIOS.map(n => ({
      opportunity_id: n.id, nome: n.id, empresa: null, telefone: n.telefone,
      ultima_at: '2026-10-19T12:00:00Z', ultima: 'oi', humano_respondeu: false, nao_lidas: 1,
    })),
    v_trava_atual: [{ phone: '5511977773333' }],
  }
  const consulta = tabela => {
    let soHumano = false
    const resultado = () => {
      let data = linhas[tabela] ?? []
      if (tabela === 'opportunities' && soHumano) data = data.filter(n => n.atendimento === 'humano')
      return { data, error: null }
    }
    const cadeia = new Proxy({}, {
      get(_alvo, prop) {
        if (prop === 'then') return (ok, erro) => Promise.resolve(resultado()).then(ok, erro)
        if (prop === 'eq') return (coluna, valor) => { if (coluna === 'atendimento' && valor === 'humano') soHumano = true; return cadeia }
        return () => cadeia
      },
    })
    return cadeia
  }
  return { from: consulta }
}

test('pipeline: negócio de LP nova mostra "Rodrigues" mesmo sem trava; os outros seguem a trava', async () => {
  const banco = bancoPorTabela()
  const { carregarPipeline } = load('web/lib/crm.ts', {
    './db': { db: banco },
    './security/user-db': { userDatabase: async () => banco },
    './security/authorization': { requireOpportunityAccess: async () => {} },
    './google': { reconciliarReunioes: async () => {} },
    './estagios': { ESTAGIOS: [] },
    './followup-status': { deveMostrarSeloFollowup: () => false },
    './followup-rodadas': { toqueExibidoSeloFollowup: () => 0, totalSeloFollowup: () => 0 },
  })
  const porId = Object.fromEntries((await carregarPipeline()).map(c => [c.id, c.atendimento]))
  // 'voce' e 'travado' viram o chip "Rodrigues" no kanban; 'naia' vira "Naia".
  assert.deepEqual(porId, { 'opp-lp': 'voce', 'opp-antigo': 'naia', 'opp-travado': 'travado' })
})

/* Aviso no grupo + teste de primeiro contato. A rota de entrada só chama o
   aviso para negócio NOVO de LP nova; o texto e o envio ficam em lib/lp-nova. */
async function ingerir(resultadoRpc) {
  const avisos = []
  const posResposta = []
  process.env.INGEST_API_KEY = 'chave-teste'
  const { POST } = load('web/app/api/ingest/lead/route.ts', {
    'next/server': {
      NextResponse: { json: (corpo, init) => ({ corpo, status: init?.status ?? 200 }) },
      after: fn => { posResposta.push(fn) },
    },
    '@/lib/security/integration': {
      integrationAuthorizedHeaderOnly: () => true,
      readBoundedJson: async req => req.corpo,
      integrationRateLimit: async () => null,
    },
    '@/lib/db': {
      db: {
        rpc: async () => ({ data: resultadoRpc, error: null }),
        from: () => ({ insert: async () => ({ error: null }) }),
      },
    },
    '@/lib/lp-nova': { avisarGrupoLpNova: async aviso => { avisos.push(aviso) } },
  })
  const resposta = await POST({
    corpo: {
      name: 'Ana Teste', phone: '11977771111', company_name: 'Ana Metal', website: 'anametal.com.br',
      mensagem: 'Investe hoje: Google Ads\nOrçamento mensal para marketing: R$ 3 a 5 mil\nDor principal: Poucos leads',
      landing_page: 'https://site.test/lp/trafego-pago', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'lp-tp',
    },
    headers: { get: () => null },
  })
  for (const fn of posResposta) await fn()
  return { resposta, avisos }
}

test('lead novo de LP nova: o grupo é avisado, com o resultado do teste 50/50', async () => {
  const { resposta, avisos } = await ingerir({ opportunity_id: 'opp-lp', person_id: 'p-1', created: true, atendimento: 'humano', primeiro_contato: 'mensagem' })
  assert.equal(resposta.status, 201)
  assert.equal(avisos.length, 1)
  assert.equal(avisos[0].opportunityId, 'opp-lp')
  assert.equal(avisos[0].primeiroContato, 'mensagem')
  assert.equal(avisos[0].landingPage, 'https://site.test/lp/trafego-pago')
  assert.equal(avisos[0].utmCampaign, 'lp-tp')
})

test('lead dos formulários de sempre, ou lead que voltou: nenhum aviso no grupo', async () => {
  const antigo = await ingerir({ opportunity_id: 'opp-antigo', person_id: 'p-2', created: true, atendimento: 'naia', primeiro_contato: null })
  const voltou = await ingerir({ opportunity_id: 'opp-lp', person_id: 'p-1', created: false })
  assert.deepEqual([antigo.avisos.length, voltou.avisos.length], [0, 0])
})

function carregarAviso({ grupo, envio = { ok: true, messageId: 'm-1', erro: null } }) {
  const enviados = []
  const auditoria = []
  const mod = load('web/lib/lp-nova.ts', {
    '@/lib/db': {
      db: {
        rpc: async nome => nome === 'fn_lp_aviso_grupo_whatsapp' ? { data: grupo, error: null } : { data: null, error: null },
        from: () => ({ insert: async linha => { auditoria.push(linha); return { error: null } } }),
      },
    },
    '@/lib/whatsapp': {
      enviarWhatsappGrupo: async (destino, texto) => { enviados.push({ destino, texto }); return envio },
      ocultarSegredosZapi: t => t,
    },
    '@/lib/erros': { detalharExcecao: e => String(e) },
  })
  return { ...mod, enviados, auditoria }
}

const AVISO = {
  opportunityId: 'opp-lp', nome: 'Ana Teste', telefone: '+5511977771111', empresa: 'Ana Metal', site: 'anametal.com.br',
  mensagem: 'Investe hoje: Google Ads\nOrçamento mensal para marketing: R$ 3 a 5 mil\nDor principal: Poucos leads',
  landingPage: 'https://site.test/lp/trafego-pago?utm_source=google', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'lp-tp',
  primeiroContato: 'ligacao',
}

test('texto do aviso: LP, telefone legível, respostas, origem e primeiro contato', () => {
  const { textoAvisoLpNova } = carregarAviso({ grupo: null })
  assert.equal(textoAvisoLpNova(AVISO), [
    '🔔 *NOVO LEAD — LP Tráfego Pago*',
    '*Nome:* Ana Teste',
    '*WhatsApp:* (11) 97777-1111',
    '*Empresa:* Ana Metal · anametal.com.br',
    '*Investe hoje:* Google Ads',
    '*Orçamento mensal:* R$ 3 a 5 mil',
    '*Dor principal:* Poucos leads',
    '*Origem:* google / cpc / lp-tp',
    '*Primeiro contato (teste 50/50):* 📞 LIGAÇÃO',
    'Acesse: https://nova-acao-crm.vercel.app/lead/opp-lp',
  ].join('\n'))
})

test('aviso vai para o grupo do cofre e fica auditado; sem grupo no cofre, nada sai', async () => {
  const comGrupo = carregarAviso({ grupo: '120363429271213364-group' })
  assert.deepEqual(await comGrupo.avisarGrupoLpNova(AVISO), { status: 'enviado' })
  assert.equal(comGrupo.enviados[0].destino, '120363429271213364-group')
  assert.equal(comGrupo.auditoria[0].workflow, 'lp_nova_aviso_grupo')
  assert.equal(comGrupo.auditoria[0].status, 'enviado')

  const semGrupo = carregarAviso({ grupo: null })
  assert.deepEqual(await semGrupo.avisarGrupoLpNova(AVISO), { status: 'config_invalida' })
  assert.equal(semGrupo.enviados.length, 0)
  assert.equal(semGrupo.auditoria[0].status, 'config_invalida')
})

test('mensagens: negócio de LP nova aparece como "Você"; travado sem resposta continua "Travado"', async () => {
  const banco = bancoPorTabela()
  const { carregarConversas } = load('web/lib/mensagens.ts', {
    './db': { db: banco },
    './security/user-db': { userDatabase: async () => banco },
  })
  const porId = Object.fromEntries((await carregarConversas()).map(c => [c.oppId, [c.atendimento, c.responsavelHumano]]))
  assert.deepEqual(porId, {
    'opp-lp': ['humano', true],       // statusConversa → 'voce'
    'opp-antigo': ['naia', false],    // → 'naia'
    'opp-travado': ['humano', false], // → 'travado' (ninguém respondeu)
  })
})
