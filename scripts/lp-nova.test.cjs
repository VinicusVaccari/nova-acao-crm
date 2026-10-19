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
