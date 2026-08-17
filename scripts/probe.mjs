// Testa o que o projeto Supabase aceita com as credenciais disponíveis.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)

const URL_ = env.SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

console.log('projeto :', URL_)

// 1) REST responde?
const r = await fetch(`${URL_}/rest/v1/`, { headers: H })
console.log('rest    :', r.status, r.statusText)

if (r.ok) {
  const spec = await r.json()
  const tables = Object.keys(spec.definitions || spec.components?.schemas || {})
  console.log('tabelas :', tables.length ? tables.join(', ') : '(nenhuma no schema public)')
}

// 2) Existe alguma RPC capaz de rodar SQL?
for (const fn of ['exec_sql', 'execute_sql', 'query', 'sql']) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'select 1', sql: 'select 1' })
  })
  if (res.status !== 404) console.log(`rpc ${fn}:`, res.status, (await res.text()).slice(0, 160))
}

// 3) Management API (precisa de Personal Access Token, não da service_role)
if (env.SUPABASE_ACCESS_TOKEN) {
  const m = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: 'select version()' })
    }
  )
  console.log('mgmt api:', m.status, (await m.text()).slice(0, 200))
} else {
  console.log('mgmt api: sem SUPABASE_ACCESS_TOKEN')
}
