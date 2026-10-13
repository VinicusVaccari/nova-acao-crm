import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { db } from '../db'

export function secretMatches(expected: string | undefined, supplied: unknown): boolean {
  if (!expected || typeof supplied !== 'string' || supplied.length > 4096) return false
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(supplied).digest()
  return timingSafeEqual(a, b)
}

// Compatibilidade transitória: provedores atuais ainda usam query/body.
// Header tem precedência e permite migrar os workflows sem interrupção.
export function integrationAuthorized(req: Request, expected: string | undefined, bodySecret?: unknown): boolean {
  const header = req.headers.get('authorization')
  if (header !== null) return header.startsWith('Bearer ') && secretMatches(expected, header.slice(7))
  return secretMatches(expected, req.headers.get('x-api-key')) ||
    secretMatches(expected, new URL(req.url).searchParams.get('secret')) || secretMatches(expected, bodySecret)
}

// Para ENDPOINT NOVO: regra da casa sem exceção — segredo só em header.
// Nunca aceita query string nem body, nem para compatibilidade. Use esta,
// não integrationAuthorized, em toda rota nova.
export function integrationAuthorizedHeaderOnly(req: Request, expected: string | undefined, headerCustom?: string): boolean {
  const header = req.headers.get('authorization')
  if (header !== null) return header.startsWith('Bearer ') && secretMatches(expected, header.slice(7))
  return secretMatches(expected, req.headers.get('x-api-key')) ||
    (!!headerCustom && secretMatches(expected, req.headers.get(headerCustom)))
}

export async function readBoundedJson(req: Request, maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length')) > maxBytes) throw new Error('Payload muito grande.')
  if (!req.body) throw new Error('JSON ausente.')
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error('Payload muito grande.')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON deve ser um objeto.')
  return parsed as Record<string, unknown>
}

export async function integrationRateLimit(scope: string, limit = 600): Promise<Response | null> {
  // Limite global por integração: não confia em X-Forwarded-For fornecido pelo chamador.
  const key = createHash('sha256').update(scope).digest('hex')
  const { data, error } = await db.rpc('fn_security_rate_limit', { p_key: key, p_limit: limit, p_seconds: 60 })
  if (error) return Response.json({ erro: 'Proteção temporariamente indisponível.' }, { status: 503 })
  if (!data) return Response.json({ erro: 'Limite de requisições atingido.' }, { status: 429, headers: { 'Retry-After': '60' } })
  return null
}
