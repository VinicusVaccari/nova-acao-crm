// Ensaio EXCLUSIVAMENTE local. Não contém conexão de banco remoto.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
const base = resolve(root, '.security-local', 'backups')
const destination = resolve(root, process.argv[2] ?? '')
const inside = relative(base, destination)
if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Diretório de backup local inválido.')
const container = 'na-security-restore-20260906'
const database = `security_restore_${new Date().toISOString().replace(/\D/g, '').slice(0,17)}`
async function docker(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let out = '', error = ''
    child.stdout.on('data', chunk => { out = (out + chunk).slice(-16000) })
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-16000) })
    child.on('error', () => reject(new Error('Não foi possível executar Docker.')))
    child.on('close', code => {
      if (code !== 0) {
        // PSQL pode repetir linhas de COPY com PII. Não mostrar DETAIL/CONTEXT.
        const safe = error.split('\n').filter(line => /^(?:psql:.*?:\d+: )?(?:ERROR|FATAL):/.test(line)).map(line => line.replace(/"[^"]+"/g, '"[identificador]"')).join('\n').slice(0, 800)
        reject(new Error(`Docker/PSQL local falhou (${code}). ${safe}`))
      } else resolve(out)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}
const info = JSON.parse(await docker(['inspect', container]))[0]
if (info.Name !== `/${container}` || info.HostConfig.NetworkMode !== 'none' || Object.keys(info.HostConfig.PortBindings ?? {}).length || info.Config.Image !== 'public.ecr.aws/supabase/postgres:17.6.1.165') throw new Error('Container não é o ambiente isolado esperado.')
const sql = (query, target = database) => docker(['exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', target, '-v', 'ON_ERROR_STOP=1', '-Atq'], query)
const manifestPath = join(destination, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (!manifest.complete) throw new Error('Backup incompleto.')
for (const entry of manifest.files) {
  if (!['roles.sql', 'schema.sql', 'data.sql'].includes(entry.name)) throw new Error('Arquivo inesperado no manifesto.')
  if (createHash('sha256').update(readFileSync(join(destination, entry.name))).digest('hex') !== entry.sha256) throw new Error('Hash de dump divergente.')
}
const existing = (await sql(`select count(*) from pg_database where datname='${database}';`, 'postgres')).trim()
if (existing !== '0') throw new Error('Banco de ensaio já existe; não sobrescrever.')
await sql(`create database ${database} owner supabase_admin template template0;`, 'postgres')
console.log('Banco de ensaio criado sem rede; restaurando os dumps...')
// A imagem local não cria a role Realtime referenciada pelo dump de grants.
// Ela é criada sem LOGIN/senha, exclusivamente no container sem rede.
const bootstrap = `do $$ begin if not exists(select 1 from pg_roles where rolname='supabase_realtime_admin') then create role supabase_realtime_admin nologin; end if; end $$; create schema extensions; create extension citext with schema public; create extension pgcrypto with schema extensions; create extension "uuid-ossp" with schema extensions;`
const source = name => readFileSync(join(destination, name), 'utf8')
await sql(`begin;\n${bootstrap}\n${source('roles.sql')}\n${source('schema.sql')}\nset session_replication_role=replica;\n${source('data.sql')}\nset session_replication_role=origin;\ncommit;`)
const counts = JSON.parse((await sql("select json_build_object('opportunities',(select count(*) from public.opportunities),'people',(select count(*) from public.people),'activities',(select count(*) from public.activities),'auth_users',(select count(*) from auth.users),'storage_objects',(select count(*) from storage.objects));")).trim())
manifest.restore_verified = true
manifest.restore_test = { at: new Date().toISOString(), container, database, image: info.Config.Image, network: 'none', scopes: ['public','auth','storage'], counts }
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log(`Restauração SQL concluída: ${JSON.stringify(counts)}`)
// Aplica o pacote somente na cópia local. Fixtures continuam transacionais.
await sql(readFileSync(join(root, 'supabase/migrations/0046_security_access_boundaries.sql'), 'utf8'))
await sql(`begin;\n${readFileSync(join(root, 'supabase/tests/security_access.sql'), 'utf8')}\nrollback;`)
manifest.restore_test.security_migration_and_fixtures_passed = true
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log('Migration 0046 e fixtures aprovadas no banco restaurado localmente. Produção não recebeu a migration.')
