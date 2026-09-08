// Copia os bytes do Storage para um backup local já criado. Somente leitura
// remota. Nomes de arquivos do cliente nunca viram caminhos locais.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
const base = resolve(root, '.security-local', 'backups')
const destination = resolve(root, process.argv[2] ?? '')
const inside = relative(base, destination)
if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Informe um diretório específico dentro de .security-local/backups.')
const env = { ...process.env, ...parseEnv(readFileSync(join(root, '.env.local'), 'utf8')) }
const manifestPath = join(destination, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (!manifest.complete || manifest.project_ref !== env.SUPABASE_PROJECT_REF) throw new Error('Dump incompleto ou projeto diferente.')
if (manifest.storage_bytes_included) throw new Error('Storage já exportado; não sobrescrever.')
const api = new URL(env.SUPABASE_URL)
if (api.protocol !== 'https:' || api.hostname !== `${env.SUPABASE_PROJECT_REF}.supabase.co`) throw new Error('Host inesperado.')
const response = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: "select bucket_id,name,metadata->>'size' as expected_bytes,metadata->>'mimetype' as mime from storage.objects order by bucket_id,name" }),
  signal: AbortSignal.timeout(30000), redirect: 'error',
})
if (!response.ok) throw new Error(`Inventário Storage HTTP ${response.status}`)
const objects = await response.json()
if (!Array.isArray(objects)) throw new Error('Inventário inválido.')
const storageDir = join(destination, 'storage')
mkdirSync(storageDir, { recursive: true })
const inventory = { created_at: new Date().toISOString(), expected_objects: objects.length, complete: false, objects: [] }
const save = () => writeFileSync(join(destination, 'storage-manifest.json'), JSON.stringify(inventory, null, 2))
save()
for (let offset = 0; offset < objects.length; offset += 4) {
  await Promise.all(objects.slice(offset, offset + 4).map(async object => {
    const endpoint = new URL(`/storage/v1/object/authenticated/${encodeURIComponent(object.bucket_id)}/${object.name.split('/').map(encodeURIComponent).join('/')}`, api)
    const res = await fetch(endpoint, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }, signal: AbortSignal.timeout(30000), redirect: 'error' })
    if (!res.ok) throw new Error(`Download Storage HTTP ${res.status}; objeto não exibido.`)
    const chunks = []
    let size = 0
    for await (const chunk of res.body) {
      size += chunk.length
      if (size > 50 * 1024 * 1024) throw new Error('Objeto acima do limite de segurança do exportador.')
      chunks.push(chunk)
    }
    if (object.expected_bytes !== null && Number(object.expected_bytes) !== size) throw new Error('Tamanho de objeto diverge do inventário; repetir com snapshot consistente.')
    const content = Buffer.concat(chunks)
    const filename = `${createHash('sha256').update(JSON.stringify([object.bucket_id, object.name])).digest('hex')}.bin`
    writeFileSync(join(storageDir, filename), content, { flag: 'wx' })
    inventory.objects.push({ bucket: object.bucket_id, path: object.name, mime: object.mime, file: `storage/${filename}`, bytes: size, sha256: createHash('sha256').update(content).digest('hex') })
  }))
  save()
  console.log(`Storage: ${inventory.objects.length}/${objects.length} objetos copiados.`)
}
inventory.complete = true
save()
manifest.storage_bytes_included = true
manifest.storage_objects = inventory.objects.length
manifest.storage_bytes = inventory.objects.reduce((sum, object) => sum + object.bytes, 0)
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log(`Storage copiado e hashes registrados: ${manifest.storage_objects} objetos, ${manifest.storage_bytes} bytes. Restauração ainda precisa ser ensaiada.`)
