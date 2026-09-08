const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('../web/node_modules/typescript')
const ROOT = path.resolve(__dirname, '..')

// Executa o TypeScript real com fronteiras externas simuladas, sem rede/banco.
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
    if (id.startsWith('.')) return load(path.relative(ROOT, path.resolve(path.dirname(filename), `${id}.ts`)), mocks)
    throw new Error(`Dependência externa não simulada: ${id}`)
  }
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(localRequire, module, module.exports)
  return module.exports
}

const policy = load('web/lib/security/policy.ts')
const id = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const user = { id, papel: 'vendedor' }

test('uploads validam tamanho, assinatura e extensão sem confiar no MIME informado', async () => {
  const { validateUpload } = load('web/lib/security/upload.ts')
  assert.equal(await validateUpload(new File(['%PDF-1.7 sample'], 'proposta.pdf', { type: 'text/html' })), 'application/pdf')
  assert.equal(await validateUpload(new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'avatar.png'), true), 'image/png')
  assert.equal(await validateUpload(new File(['Nome,Telefone\nTeste,123'], 'contatos.csv')), 'text/csv')
  for (const file of [new File(['<script>x</script>'], 'falso.png'), new File(['%PDF-'], 'arquivo.html'), new File([], 'vazio.pdf')]) {
    await assert.rejects(validateUpload(file))
  }
  await assert.rejects(validateUpload(new File(['%PDF-1.7 sample'], 'proposta.pdf'), true))
  await assert.rejects(validateUpload(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'grande.png'), true))
})

test('inbox assina áudios autorizados em lote e descarta URL externa', async () => {
  const rows = ['wa-audio:2026-09-06/test.ogg', 'wa-audio:2026-09-06/test.ogg', 'https://tracking.invalid/audio'].map((audioUrl, i) => ({
    id: i + 1, opportunity_id: id, occurred_at: `2026-09-06T12:00:0${i}Z`, direction: 'inbound', meta: { audioUrl },
  }))
  const query = {
    select() { return this }, eq() { return this }, in() { return this },
    order() { return this }, limit() { return this }, lt() { return this },
    then(resolve) { resolve({ data: rows }) },
  }
  const calls = []
  const { carregarMensagens } = load('web/lib/mensagens.ts', {
    './security/user-db': { async userDatabase() { return { from() { return query } } } },
    './db': { db: { storage: { from(bucket) { return { async createSignedUrls(paths, seconds) {
      calls.push({ bucket, paths, seconds })
      return { data: paths.map(path => ({ path, signedUrl: 'https://storage.invalid/signed-test', error: null })) }
    } } } } } },
  })
  const { mensagens } = await carregarMensagens(id)
  assert.deepEqual(calls, [{ bucket: 'wa-audio', paths: ['2026-09-06/test.ogg'], seconds: 3600 }])
  assert.deepEqual(mensagens.sort((a, b) => a.id - b.id).map(m => m.audioUrl),
    ['https://storage.invalid/signed-test', 'https://storage.invalid/signed-test', null])
  await assert.rejects(carregarMensagens(id, "2026-09-06'; drop table activities --"), /cursor inválido/)
})

test('redirecionamento preserva paths internos e bloqueia esquemas/hosts externos', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', '//evil.invalid', '/\\evil.invalid', 'https://evil.invalid', '/\nevil', null]) {
    assert.equal(policy.safeRedirect(value), '/')
  }
  assert.equal(policy.safeRedirect('/lead/abc?tab=mensagens#fim'), '/lead/abc?tab=mensagens#fim')
})

test('CSV neutraliza fórmulas e mantém aspas/acentos', () => {
  for (const value of ['=HYPERLINK("https://evil.invalid")', '+SUM(1,1)', '-1+2', '@SUM(1)', '  =1', '\t=1', '\n=1']) {
    assert.ok(policy.csvCell(value).startsWith('"\''))
  }
  assert.equal(policy.csvCell('João "A"'), '"João ""A"""')
})

test('autorização por carteira nega outras contas, inclusive negócio sem dono', () => {
  assert.equal(policy.canAccessOpportunity(user, { owner_id: id, sdr_id: null }), true)
  assert.equal(policy.canAccessOpportunity(user, { owner_id: other, sdr_id: id }), true)
  assert.equal(policy.canAccessOpportunity(user, { owner_id: other, sdr_id: null }), false)
  assert.equal(policy.canAccessOpportunity(user, { owner_id: null, sdr_id: null }), false)
  for (const papel of ['admin', 'gestor']) assert.equal(policy.canAccessOpportunity({ id, papel }, { owner_id: other, sdr_id: null }), true)
})

test('mass assignment rejeita campos arbitrários, tipos e tamanhos inválidos', () => {
  assert.deepEqual(policy.allowedPatch({ title: 'Lead', qualificacao: 3 }, ['title', 'qualificacao']), { title: 'Lead', qualificacao: 3 })
  for (const payload of [{ role: 'admin' }, { title: {} }, { title: 'x'.repeat(4001) }, { title: NaN }, []]) {
    assert.throws(() => policy.allowedPatch(payload, ['title']))
  }
})

function actions(db, guards = {}) {
  const deny = async () => { throw new Error('FORBIDDEN') }
  const names = ['requireActiveUser','requireOpportunityAccess','requireMeetingAccess','requireCalendarEventAccess','requireManager','requireAdmin']
  return load('web/lib/actions.ts', {
    './db': { db }, './security/authorization': Object.fromEntries(names.map(name => [name, guards[name] ?? deny])),
    './supabase/server': { usuarioAtual: deny },
    './google': { cancelarEvento: deny, criarEvento: deny, desconectar: deny },
    './mensagens': { carregarConversas: deny, carregarMensagens: deny }, './whatsapp': { enviarWhatsapp: deny },
    './security/integration': { integrationRateLimit: async () => null },
    'next/cache': { revalidatePath() {} },
  })
}

test('todas as 38 Actions recusam chamada não autorizada antes de acessar banco/integradores', async () => {
  const api = actions(new Proxy({}, { get() { throw new Error('BANCO ACESSADO ANTES DO GUARD') } }))
  assert.equal(Object.keys(api).length, 38)
  for (const [name, action] of Object.entries(api)) {
    await assert.rejects(action({ oppId: id }, {}, {}, {}, {}), /FORBIDDEN/, name)
  }
})

test('exclusão de arquivo usa path do banco e vínculo ao negócio, ignora path do cliente', async () => {
  const filters = [], removed = []
  const chain = {
    select() { return this }, delete() { return this },
    eq(k,v) { filters.push([k,v]); return this },
    async maybeSingle() { return { data: { path: `${id}/documento.pdf` }, error: null } },
    then(resolve) { return Promise.resolve({ error: null }).then(resolve) },
  }
  const db = { from() { return chain }, storage: { from() { return { async remove(paths) { removed.push(...paths); return { error: null } } } } } }
  const api = actions(db, { requireOpportunityAccess: async () => ({ user, opportunity: { id } }) })
  assert.deepEqual(await api.removerArquivo(123,id,`${other}/vitima.pdf`), { ok: true })
  assert.deepEqual(removed, [`${id}/documento.pdf`])
  assert.equal(filters.filter(([k,v]) => k === 'opportunity_id' && v === id).length, 2)
})

test('arquivo de outra oportunidade não é removido do Storage', async () => {
  let deleted = false
  const chain = { select() { return this }, eq() { return this }, async maybeSingle() { return { data: null } } }
  const db = { from() { return chain }, storage: { from() { deleted = true; throw new Error('Não deve acessar Storage') } } }
  const api = actions(db, { requireOpportunityAccess: async () => ({ user, opportunity: { id } }) })
  assert.equal((await api.removerArquivo(123,id,'victim')).ok, false)
  assert.equal(deleted, false)
})

test('criação manual usa RPC atômico e ator da sessão', async () => {
  let call
  const db = { async rpc(name,args) { call = { name,args }; return { error: null } } }
  const api = actions(db, { requireActiveUser: async () => user })
  assert.equal((await api.criarLead({ name: 'Teste', phone: '+5511999999999' })).ok, true)
  assert.equal(call.name, 'fn_create_lead_for_user')
  assert.equal(call.args.p_user_id, id)
  await assert.rejects(api.criarLead({ name: 'Teste', phone: '+5511999999999', owner_id: other }), /Campo não permitido/)
})

function integration(result = { data: true, error: null }) {
  return load('web/lib/security/integration.ts', { '../db': { db: { async rpc() { return result } } } })
}

function lossFixture(options = {}) {
  const writes = [], reads = [], invalidated = []
  const db = {
    async rpc() { return options.limitResult ?? { data: true, error: null } },
    from(table) {
      let update, filter
      return {
        select() { return this },
        eq(key, value) { filter = [key, value]; return this },
        update(patch) { update = patch; return this },
        async maybeSingle() {
          reads.push({ table, filter })
          if (table === 'opportunities') {
            if (filter[1] !== id) return { data: null, error: null }
            if (update) {
              if (options.updateError) return { data: null, error: { message: 'TEST_UPDATE_FAILED' } }
              writes.push({ table, patch: update, filter })
            }
            return { data: { id, stage: 'qualificado' }, error: null }
          }
          if (table === 'lost_reasons') return { data: filter[1] === 'sem_interesse' ? { code: 'sem_interesse', label: 'Sem interesse' } : null, error: null }
          throw new Error(`Tabela inesperada no teste: ${table}`)
        },
        async insert(row) {
          assert.equal(table, 'stage_history')
          if (options.historyError) return { error: { message: 'TEST_HISTORY_FAILED' } }
          writes.push({ table, row })
          return { error: null }
        },
      }
    },
  }
  const service = load('web/lib/negociacao-service.ts', {
    './db': { db }, 'next/cache': { revalidatePath(p) { invalidated.push(p) } },
  })
  const route = load('web/app/api/naia/perder/route.ts', {
    '@/lib/db': { db }, '@/lib/negociacao-service': service,
    '@/lib/security/integration': integration(options.limitResult),
    'next/server': { NextResponse: Response },
    // Qualquer retorno à Action/sessão precisa falhar no teste.
    '@/lib/actions': { marcarPerdido() { throw new Error('SESSÃO NÃO PODE SER EXIGIDA PELA API') } },
  })
  return { db, writes, reads, invalidated, service, route }
}

test('NAIA marca perda com segredo válido sem cookies e fixa ator ai, inclusive no legado query', async () => {
  const previous = process.env.NAIA_API_SECRET
  process.env.NAIA_API_SECRET = 'test-only-loss-secret'
  try {
    for (const headerAuth of [false, true]) {
      const fixture = lossFixture()
      const url = 'https://app.invalid/api/naia/perder' + (headerAuth ? '' : '?secret=test-only-loss-secret')
      const res = await fixture.route.POST(new Request(url, { method: 'POST',
        headers: { 'content-type': 'application/json', ...(headerAuth ? { authorization: 'Bearer test-only-loss-secret' } : {}) },
        body: JSON.stringify({ opportunityId: id, motivo: 'sem_interesse', actorType: 'user', changed_by: other }),
      }))
      assert.equal(res.status, 200)
      assert.equal((await res.json()).ok, true)
      assert.equal(fixture.writes.length, 2)
      const [loss, history] = fixture.writes
      assert.equal(loss.patch.lost_reason, 'sem_interesse')
      assert.equal(loss.patch.paused_at, null)
      assert.equal(Object.hasOwn(loss.patch, 'stage'), false)
      assert.ok(Number.isFinite(Date.parse(loss.patch.lost_at)))
      assert.deepEqual(loss.filter, ['id', id])
      assert.equal(history.row.actor_type, 'ai')
      assert.equal(history.row.changed_by, null)
      assert.equal(history.row.from_stage, 'qualificado')
      assert.equal(history.row.to_stage, 'perdido')
      assert.equal(history.row.changed_at, loss.patch.lost_at)
      assert.ok(fixture.invalidated.includes(`/lead/${id}`))
    }
  } finally {
    if (previous === undefined) delete process.env.NAIA_API_SECRET
    else process.env.NAIA_API_SECRET = previous
  }
})

test('API de perda recusa segredo ausente/incorreto ou não configurado antes de ler/gravar negócio', async () => {
  const previous = process.env.NAIA_API_SECRET
  try {
    for (const [configured, query] of [['test-only-loss-secret', ''], ['test-only-loss-secret', '?secret=wrong'], [undefined, '?secret=test-only-loss-secret']]) {
      if (configured === undefined) delete process.env.NAIA_API_SECRET
      else process.env.NAIA_API_SECRET = configured
      const fixture = lossFixture()
      const res = await fixture.route.POST(new Request(`https://app.invalid/api/naia/perder${query}`, {
        method: 'POST', body: JSON.stringify({ opportunityId: id, motivo: 'sem_interesse' }),
      }))
      assert.equal(res.status, 401)
      assert.equal(fixture.reads.length, 0)
      assert.equal(fixture.writes.length, 0)
    }
  } finally {
    if (previous === undefined) delete process.env.NAIA_API_SECRET
    else process.env.NAIA_API_SECRET = previous
  }
})

test('API de perda preserva rate limit e rejeita motivo/negócio ausentes sem escrita', async () => {
  const previous = process.env.NAIA_API_SECRET
  process.env.NAIA_API_SECRET = 'test-only-loss-secret'
  try {
    for (const [options, oppId, motivo, status] of [
      [{ limitResult: { data: false, error: null } }, id, 'sem_interesse', 429],
      [{}, other, 'sem_interesse', 404], [{}, id, 'inexistente', 400], [{}, id, '', 400],
    ]) {
      const fixture = lossFixture(options)
      const res = await fixture.route.POST(new Request('https://app.invalid/api/naia/perder?secret=test-only-loss-secret', {
        method: 'POST', body: JSON.stringify({ opportunityId: oppId, motivo }),
      }))
      assert.equal(res.status, status)
      assert.equal(fixture.writes.length, 0)
    }
  } finally {
    if (previous === undefined) delete process.env.NAIA_API_SECRET
    else process.env.NAIA_API_SECRET = previous
  }
})

test('Action de perda mantém guard de carteira e ignora tentativa de se passar por IA', async () => {
  const fixture = lossFixture()
  const api = actions(fixture.db, { requireOpportunityAccess: async oppId => {
    if (oppId !== id) throw new Error('FORBIDDEN')
    return { user, opportunity: { id } }
  } })
  await assert.rejects(api.marcarPerdido(other, 'sem_interesse', 'ai'), /FORBIDDEN/)
  assert.equal(fixture.writes.length, 0)
  assert.equal((await api.marcarPerdido(id, 'sem_interesse', 'ai')).ok, true)
  assert.equal(fixture.writes[1].row.actor_type, 'user')
  assert.equal(fixture.writes[1].row.changed_by, user.id)
})

test('perda não declara sucesso se a atualização ou o histórico falhar', async () => {
  const updateFailed = lossFixture({ updateError: true })
  assert.equal((await updateFailed.service.registrarPerdaAutorizada(id, 'sem_interesse', { tipo: 'ai' })).ok, false)
  assert.equal(updateFailed.writes.length, 0)
  const historyFailed = lossFixture({ historyError: true })
  const result = await historyFailed.service.registrarPerdaAutorizada(id, 'sem_interesse', { tipo: 'ai' })
  assert.equal(result.ok, false)
  assert.match(result.erro, /Perda registrada.*histórico/)
  assert.equal(historyFailed.writes.length, 1)
})

test('segredo ausente/incorreto é negado; Bearer, API key e legado válido funcionam', () => {
  const { integrationAuthorized } = integration()
  const secret = 'test-only-secret'
  assert.equal(integrationAuthorized(new Request('https://app.invalid'), undefined), false)
  assert.equal(integrationAuthorized(new Request('https://app.invalid?secret=wrong'), secret), false)
  assert.equal(integrationAuthorized(new Request(`https://app.invalid?secret=${secret}`), secret), true)
  assert.equal(integrationAuthorized(new Request('https://app.invalid',{ headers:{authorization:`Bearer ${secret}`} }), secret), true)
  assert.equal(integrationAuthorized(new Request('https://app.invalid',{ headers:{'x-api-key':secret} }), secret), true)
  assert.equal(integrationAuthorized(new Request(`https://app.invalid?secret=${secret}`,{ headers:{authorization:'Bearer wrong'} }), secret), false)
})

test('JSON recusa listas, escalar, tamanho mentido e stream maior que o limite', async () => {
  const { readBoundedJson } = integration()
  const req = body => new Request('https://app.invalid',{ method:'POST',body })
  assert.deepEqual(await readBoundedJson(req('{"name":"Lead"}')), { name:'Lead' })
  for (const body of ['[]','null','123','{']) await assert.rejects(readBoundedJson(req(body)))
  await assert.rejects(readBoundedJson(req('{"x":"'+'x'.repeat(100)+'"}'),32))
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(64)); c.close() } })
  await assert.rejects(readBoundedJson(new Request('https://app.invalid',{ method:'POST',body:stream,duplex:'half',headers:{'content-length':'1'} }),32))
})

test('rate limit falha fechado e retorna Retry-After ao exceder quota', async () => {
  assert.equal(await integration().integrationRateLimit('test'), null)
  assert.equal((await integration({ data:null,error:{} }).integrationRateLimit('test')).status,503)
  const limited = await integration({ data:false,error:null }).integrationRateLimit('test')
  assert.equal(limited.status,429)
  assert.equal(limited.headers.get('retry-after'),'60')
})

test('SSRF bloqueia hosts não autorizados, IPs privados e arquivos falsos', async () => {
  const media = load('web/lib/security/media.ts', {
    'node:dns/promises': { async lookup() { return [{ address:'127.0.0.1',family:4 }] } },
    'node:https': { request() { throw new Error('Não deveria conectar') } },
  })
  for (const url of ['http://s.z-api.io/audio','https://evil.invalid/audio','https://127.0.0.1/audio','https://s.z-api.io:8443/audio','https://u:p@s.z-api.io/audio','https://s.z-api.io.evil.invalid/audio']) assert.throws(() => media.allowedAudioUrl(url))
  for (const ip of ['127.0.0.1','169.254.169.254','10.0.0.1','172.16.0.1','192.168.0.1','100.64.0.1','0.0.0.0','::1','224.0.0.1','300.1.2.3']) assert.equal(media.publicIPv4(ip),false,ip)
  assert.equal(media.publicIPv4('8.8.8.8'),true)
  await assert.rejects(media.downloadAudio('https://s.z-api.io/audio'), /Endereço/)
  assert.throws(() => media.audioFormat(Buffer.from('<html>malicious</html>')))
  assert.deepEqual(media.audioFormat(Buffer.from('OggSsample')), { mime:'audio/ogg',ext:'ogg' })
})

test('download fixa o IP validado, mantém TLS e rejeita redirect HTTP', async () => {
  const { EventEmitter } = require('node:events')
  let options
  const media = load('web/lib/security/media.ts', {
    'node:dns/promises': { async lookup() { return [{ address:'8.8.8.8',family:4 }] } },
    'node:https': { request(opts, callback) {
      options = opts
      const req = new EventEmitter()
      req.end = () => {
        const response = new EventEmitter()
        response.statusCode = 302
        response.headers = { location: 'http://169.254.169.254' }
        response.destroy = () => {}
        callback(response)
      }
      return req
    } },
  })
  await assert.rejects(media.downloadAudio('https://s.z-api.io/audio'),/Resposta/)
  assert.equal(options.hostname,'8.8.8.8')
  assert.equal(options.servername,'s.z-api.io')
  assert.equal(options.rejectUnauthorized,true)
})
