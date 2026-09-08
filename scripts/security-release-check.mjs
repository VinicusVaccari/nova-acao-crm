// Verificação de rollout: apenas leituras e requests que devem ser rejeitados
// antes de operações comerciais. Nunca envia mensagem nem cria/exclui lead.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
const privateDir = join(root, '.security-local')
const prod = parseEnv(readFileSync(join(privateDir, 'vercel-production-20260907.env'), 'utf8'))
const base = 'https://nova-acao-crm.vercel.app'
const required = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','INGEST_API_KEY','NAIA_API_SECRET','WHATSAPP_WEBHOOK_SECRET','ZAPI_INSTANCE','ZAPI_TOKEN','NAIA_WEBHOOK_URL']
const missing = required.filter(key => !prod[key])
console.log(JSON.stringify({ requiredEnvironmentPresent: missing.length === 0, missing,
  maskedValues: Object.values(prod).filter(value => value === '[SENSITIVE]').length }))
if (missing.length) throw new Error('Variáveis obrigatórias ausentes; não publicar.')

const backupDir = join(privateDir, 'backups', '2026-09-07T15-53-37-399Z')
const manifest = JSON.parse(readFileSync(join(backupDir, 'manifest.json'), 'utf8'))
const storage = JSON.parse(readFileSync(join(backupDir, 'storage-manifest.json'), 'utf8'))
if (!manifest.complete || !manifest.restore_verified || !manifest.restore_test?.security_migration_and_fixtures_passed || !storage.complete) throw new Error('Backup/ensaio incompleto.')
for (const item of [...manifest.files, ...storage.objects]) {
  const file = item.name ?? item.file
  if (!/^(roles|schema|data)\.sql$|^storage\/[0-9a-f]{64}\.bin$/.test(file)) throw new Error('Caminho inesperado no manifesto.')
  const bytes = readFileSync(join(backupDir, file))
  if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('Integridade do backup divergente.')
}
console.log(JSON.stringify({ backupHashesVerified: true, restoreVerified: true, storageObjects: storage.objects.length }))

const secrets = new Set()
let replySecret
const snapshots = join(privateDir, 'n8n-review')
for (const file of readdirSync(snapshots).filter(file => /^[A-Za-z0-9_-]+\.json$/.test(file))) {
  const w = JSON.parse(readFileSync(join(snapshots, file), 'utf8')).workflow
  for (const n of (w.activeVersion?.nodes ?? w.nodes)) {
    if (n.disabled) continue
    const url = String(n.parameters?.url ?? '').replace(/^=/, '')
    if (url.startsWith(base + '/api/naia/')) {
      const secret = url.match(/[?&]secret=([^&\s"'<>]+)/)?.[1]
      if (secret) secrets.add(secret)
    }
    if (url === base + '/api/whatsapp/reply') replySecret = n.parameters?.jsonBody?.match(/"secret"\s*:\s*"([^"\n]+)"/)?.[1]
  }
}
if (!secrets.size || !replySecret) throw new Error('Segredos dos contratos não identificados nos snapshots privados.')

async function probe(path, options, expected) {
  const started = Date.now()
  const response = await fetch(new URL(path, base), { ...options, redirect: 'manual', signal: AbortSignal.timeout(25000) })
  const body = await response.json().catch(() => null)
  // Nunca exibir URL completa/query, resposta arbitrária ou credenciais.
  const result = { path: path.split('?')[0], status: response.status, expected, json: !!body, elapsedMs: Date.now() - started }
  console.log(JSON.stringify(result))
  if (response.status !== expected || !body) throw new Error('Smoke HTTP divergente; resposta omitida.')
  return response
}
const routes = ['/api/ingest/lead','/api/naia/deal','/api/naia/estrelas','/api/naia/motivo-perda','/api/naia/perder','/api/naia/reuniao','/api/outreach/sweep','/api/whatsapp/inbound','/api/whatsapp/reply']
for (const path of routes) await probe(path, { method: 'POST', headers: { authorization: 'Bearer security-check-invalid', 'content-type': 'application/json' }, body: '{}' }, 401)
for (const secret of secrets) await probe('/api/naia/deal?opportunityId=00000000-0000-0000-0000-000000000000&secret=' + encodeURIComponent(secret), {}, 404)
// Mensagem vazia é recusada antes de resolver destinatário ou chamar Z-API.
await probe('/api/whatsapp/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: replySecret, mensagem: '' }) }, 400)
const login = await fetch(base + '/login', { redirect: 'manual', signal: AbortSignal.timeout(25000) })
console.log(JSON.stringify({ path: '/login', status: login.status, frameHeader: login.headers.get('x-frame-options'), contentTypeHeader: login.headers.get('x-content-type-options') }))
if (login.status !== 200) throw new Error('Login indisponível.')
if (process.argv.includes('--hardened')) {
  if (login.headers.get('x-frame-options') !== 'DENY' || login.headers.get('x-content-type-options') !== 'nosniff') throw new Error('Headers do novo deployment ausentes.')
  const local = { ...parseEnv(readFileSync(join(root, 'web/.env.local'), 'utf8')), ...parseEnv(readFileSync(join(root, '.env.local'), 'utf8')) }
  const supabase = new URL(local.SUPABASE_URL)
  if (supabase.protocol !== 'https:' || supabase.hostname !== `${manifest.project_ref}.supabase.co`) throw new Error('Projeto do probe difere do backup.')
  for (const table of ['opportunities', 'CADASTRO N8N | NOVA AÇÃO']) {
    for (const role of ['anon','service_role']) {
      const key = role === 'anon' ? local.SUPABASE_ANON_KEY ?? local.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? prod.NEXT_PUBLIC_SUPABASE_ANON_KEY : local.SUPABASE_SERVICE_ROLE_KEY
      if (!key || key === '[SENSITIVE]') throw new Error('Chave indisponível para o probe de permissões.')
      const response = await fetch(new URL(`/rest/v1/${encodeURIComponent(table)}?select=id&limit=0`, supabase), {
        headers: { apikey: key, authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(25000),
      })
      const body = await response.json().catch(() => null)
      const passed = role === 'service_role' ? response.status === 200 && Array.isArray(body) && body.length === 0
        : [401,403].includes(response.status) && body?.code === '42501'
      console.log(JSON.stringify({ table, role, status: response.status, passed, readsZeroRows: true }))
      if (!passed) throw new Error('Permissão Data API inesperada; corpo omitido.')
    }
  }
}
console.log('Smoke sem mutações comerciais aprovado. Não substitui ensaio completo de envio, CRUD e agenda.')
