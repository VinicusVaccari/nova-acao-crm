// Executor de SQL compartilhado pelos scripts.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env.local'), 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)

const URL_ = `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`

export async function sql (query) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 800)}`)
  try { return JSON.parse(text) } catch { return text }
}

/** Escapa literal de texto para interpolar em SQL. */
export const q = v => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
