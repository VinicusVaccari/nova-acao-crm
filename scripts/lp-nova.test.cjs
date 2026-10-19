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
