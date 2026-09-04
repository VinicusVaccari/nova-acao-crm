// Aplica as migrations de supabase/migrations no projeto Supabase.
//
// Funciona com QUALQUER UM dos dois acessos, na ordem de preferência:
//   1. SUPABASE_ACCESS_TOKEN  -> Management API (não precisa instalar nada)
//   2. DATABASE_URL           -> conexão direta (precisa de `npm i pg`)
//
// Uso:  node scripts/migrate.mjs            aplica o que falta
//       node scripts/migrate.mjs --status   só mostra o que já foi aplicado
//       node scripts/migrate.mjs --dry      mostra o que faria
//       node scripts/migrate.mjs --only=0043_realinhar_slugs_etapas.sql
//                                             aplica somente a migration indicada

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIG_DIR = join(ROOT, 'supabase', 'migrations')

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env.local'), 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)

const args = process.argv.slice(2)
const STATUS_ONLY = args.includes('--status')
const DRY = args.includes('--dry')
const ONLY = args.find(a => a.startsWith('--only='))?.slice('--only='.length)

// ---------------------------------------------------------------
// Escolhe o meio de execução
// ---------------------------------------------------------------
async function buildRunner () {
  if (env.SUPABASE_ACCESS_TOKEN) {
    const ref = env.SUPABASE_PROJECT_REF
    const url = `https://api.supabase.com/v1/projects/${ref}/database/query`
    console.log('via     : Management API\n')
    return async sql => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql })
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 600)}`)
      try { return JSON.parse(text) } catch { return text }
    }
  }

  if (env.DATABASE_URL) {
    let pg
    try {
      pg = await import('pg')
    } catch {
      console.error('Falta a dependência: rode  npm i pg')
      process.exit(1)
    }
    const client = new pg.default.Client({
      connectionString: env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
    await client.connect()
    console.log('via     : conexão direta ao Postgres\n')
    const run = async sql => (await client.query(sql)).rows
    run.close = () => client.end()
    return run
  }

  console.error(`
Falta credencial para executar DDL.

  A chave service_role lê e grava linhas, mas não cria tabelas.
  Preencha UM dos dois em .env.local:

  Opção A (mais simples, nada para instalar)
    SUPABASE_ACCESS_TOKEN=sbp_...
    Gere em: https://supabase.com/dashboard/account/tokens

  Opção B
    DATABASE_URL=postgresql://postgres.${env.SUPABASE_PROJECT_REF}:SENHA@aws-0-<regiao>.pooler.supabase.com:5432/postgres
    Pegue em: Project Settings > Database > Connection string > URI
`)
  process.exit(1)
}

// ---------------------------------------------------------------
const run = await buildRunner()

await run(`
  create table if not exists _migrations (
    name       text primary key,
    applied_at timestamptz not null default now()
  );
`)

const applied = new Set(
  (await run('select name from _migrations')).map(r => r.name)
)

const allFiles = readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()
const files = ONLY ? allFiles.filter(f => f === ONLY) : allFiles

if (ONLY && files.length === 0) {
  console.error(`Migration não encontrada: ${ONLY}`)
  await run.close?.()
  process.exit(1)
}

if (STATUS_ONLY) {
  for (const f of files) console.log(`${applied.has(f) ? '[ok]     ' : '[pendente]'} ${f}`)
  await run.close?.()
  process.exit(0)
}

let count = 0
for (const file of files) {
  if (applied.has(file)) {
    console.log(`[pulado] ${file}`)
    continue
  }
  if (DRY) {
    console.log(`[dry]    ${file}`)
    continue
  }

  const sql = readFileSync(join(MIG_DIR, file), 'utf8')
  process.stdout.write(`[rodando] ${file} ... `)
  try {
    await run(sql)
    await run(`insert into _migrations (name) values ('${file}') on conflict do nothing`)
    console.log('ok')
    count++
  } catch (e) {
    console.log('FALHOU')
    console.error('\n' + e.message + '\n')
    await run.close?.()
    process.exit(1)
  }
}

console.log(`\n${count} migration(s) aplicada(s).`)

// ---------------------------------------------------------------
// Verificação final
// ---------------------------------------------------------------
if (!DRY && count > 0) {
  const t = await run(`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`)
  const v = await run(`
    select table_name from information_schema.views
     where table_schema = 'public' order by table_name`)
  const f = await run(`
    select routine_name from information_schema.routines
     where routine_schema = 'public' and routine_name like 'fn_%'
     order by routine_name`)

  console.log(`\ntabelas (${t.length}): ${t.map(r => r.table_name).join(', ')}`)
  console.log(`\nviews (${v.length}): ${v.map(r => r.table_name).join(', ')}`)
  console.log(`\nfunções (${f.length}): ${f.map(r => r.routine_name).join(', ')}`)
}

await run.close?.()
