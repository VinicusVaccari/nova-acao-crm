const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('../web/node_modules/typescript')

function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  const localRequire = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id]
    if (id === 'server-only') return {}
    throw new Error(`Dependência não simulada: ${id}`)
  }
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(localRequire, module, module.exports)
  return module.exports
}

const vendas = load('web/lib/vendas.ts')
const venda = (patch = {}) => ({
  id: 'teste', ganho_at: '2026-09-08T15:12:26Z', expected_value: '2108.00',
  setup_value: '3632.40', term_months: 12, ...patch,
})

test('venda mista separa vendidos da projeção e preserva centavos', () => {
  const r = vendas.resumirVendas([venda()])
  assert.equal(r.vendidos, 5740.40)
  assert.equal(r.mensal, 2108)
  assert.equal(r.unico, 3632.40)
  assert.deepEqual(r.cohorts[0].meses, [5740.4, ...Array(11).fill(2108)])
  assert.equal(r.cohorts[0].totalProjetado, 28928.40)
  assert.match(vendas.moedaVenda(r.vendidos), /5\.740,40/)
})

test('cohort agrega o mês e respeita os prazos individuais, inclusive produtos únicos', () => {
  const r = vendas.resumirVendas([
    venda({ expected_value: 100, setup_value: 20, term_months: 2 }),
    venda({ id: 'outro', expected_value: 10, setup_value: 0, term_months: 3 }),
    venda({ id: 'anterior', ganho_at: '2026-08-10T12:00:00Z', expected_value: 0, setup_value: 150 }),
  ])
  assert.equal(r.vendas, 3)
  assert.equal(r.vendidos, 280)
  assert.deepEqual(r.cohorts.map(c => c.mes), ['2026-09', '2026-08'])
  assert.deepEqual(r.cohorts[0].meses, [130, 110, 10, ...Array(9).fill(0)])
  assert.equal(r.cohorts[0].totalProjetado, 250)
  assert.deepEqual(r.cohorts[1].meses, [150, ...Array(11).fill(0)])
})

test('horizonte de 12 meses, prazo nulo e resultado vazio', () => {
  for (const prazo of [null, 24]) {
    const r = vendas.resumirVendas([venda({ expected_value: 100, setup_value: 0, term_months: prazo })])
    assert.equal(r.cohorts[0].totalProjetado, 1200)
  }
  assert.equal(vendas.resumirVendas([venda({ term_months: 0 })]).cohorts[0].totalProjetado, 3632.40)
  assert.deepEqual(vendas.resumirVendas([]), { cohorts: [], vendas: 0, vendidos: 0, unico: 0, mensal: 0 })
})

test('cohort e filtros respeitam Brasília na virada de mês e ano', () => {
  assert.equal(vendas.resumirVendas([venda({ ganho_at: '2026-10-01T01:00:00Z' })]).cohorts[0].mes, '2026-09')
  const agora = new Date('2026-10-01T01:00:00Z')
  assert.deepEqual(vendas.periodoIndicadores(undefined, agora), { de: '2026-09-01', ate: '2026-09-30', atual: null })
  assert.deepEqual(vendas.periodoIndicadores('1', agora), { de: '2026-09-30', ate: '2026-09-30', atual: 1 })
  assert.deepEqual(vendas.periodoIndicadores('7', new Date('2026-01-03T12:00:00Z')), { de: '2025-12-28', ate: '2026-01-03', atual: 7 })
  for (const invalido of ['x', '0', '-1', 'Infinity']) assert.equal(vendas.periodoIndicadores(invalido, agora).atual, null)
  assert.equal(vendas.periodoIndicadores('10000', agora).atual, 366)
})

test('agregação preserva centavos entre muitos negócios', () => {
  const r = vendas.resumirVendas(Array.from({ length: 100 }, (_, i) => venda({ id: String(i), expected_value: 0.1, setup_value: 0.2 })))
  assert.equal(r.vendidos, 30)
  assert.equal(r.cohorts[0].totalProjetado, 140)
})

test('leitura usa sessão, período na consulta e paginação sem truncar o indicador', async () => {
  const calls = []
  let sessoes = 0
  const query = {
    select() { return this },
    gte(...v) { calls.push(['gte', ...v]); return this },
    lte(...v) { calls.push(['lte', ...v]); return this },
    order() { return this },
    async range(de, ate) {
      calls.push(['range', de, ate])
      return { data: Array.from({ length: de === 0 ? 500 : 1 }, (_, i) => venda({ id: String(de + i) })), error: null }
    },
  }
  const { carregarVendas } = load('web/lib/vendas-server.ts', {
    './vendas': vendas,
    './security/user-db': { async userDatabase() { sessoes++; return { from(t) { assert.equal(t, 'v_opp_journey'); return query } } } },
  })
  const r = await carregarVendas({ de: '2026-09-01', ate: '2026-09-08' })
  assert.equal(sessoes, 1)
  assert.equal(r.vendas, 501)
  assert.equal(r.vendidos, 2875940.40)
  assert.deepEqual(calls.filter(c => c[0] === 'range'), [['range', 0, 499], ['range', 500, 999]])
  assert.ok(calls.some(c => c[0] === 'gte' && c[2] === '2026-09-01T00:00:00-03:00'))
  assert.ok(calls.some(c => c[0] === 'lte' && c[2] === '2026-09-08T23:59:59.999999-03:00'))
})

test('erros de autenticação ou consulta não viram indicador zerado', async () => {
  const semSessao = load('web/lib/vendas-server.ts', {
    './vendas': vendas,
    './security/user-db': { async userDatabase() { throw new Error('Sem sessão') } },
  })
  const periodo = { de: '2026-09-01', ate: '2026-09-08' }
  await assert.rejects(semSessao.carregarVendas(periodo), /Sem sessão/)
  const q = { select() { return this }, gte() { return this }, lte() { return this }, order() { return this }, async range() { return { error: { message: 'falha' }, data: null } } }
  const falhaBanco = load('web/lib/vendas-server.ts', {
    './vendas': vendas,
    './security/user-db': { async userDatabase() { return { from() { return q } } } },
  })
  await assert.rejects(falhaBanco.carregarVendas(periodo), /Não foi possível carregar/)
})
