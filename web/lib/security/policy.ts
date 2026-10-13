export type Actor = { id: string; papel: string }
export type OpportunityAccess = { owner_id: string | null; sdr_id: string | null }

export function isManager(actor: Actor): boolean {
  return actor.papel === 'admin' || actor.papel === 'gestor'
}

// Mesma regra de carteira das policies do CRM: gestão, responsável, SDR —
// ou vendedor ativo vendo a fila da Naia (owner_id nulo = sem dono, está
// com a Naia; ver docs/02). Dono preenchido nunca é ignorado por isto.
export function canAccessOpportunity(actor: Actor, opportunity: OpportunityAccess, naiaId: string | null = null): boolean {
  return isManager(actor)
    || opportunity.owner_id === actor.id
    || opportunity.sdr_id === actor.id
    || (actor.papel === 'vendedor' && (
      opportunity.owner_id === naiaId
      // Compatibilidade transitória: o app pode entrar antes da 0082.
      || (naiaId === null && opportunity.owner_id === null)
    ))
}

export function safeRedirect(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return '/'
  try {
    const base = 'https://internal.invalid'
    const url = new URL(value, base)
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : '/'
  } catch { return '/' }
}

export function csvCell(value: string): string {
  const text = String(value ?? '')
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function allowedPatch(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Dados inválidos.')
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!fields.includes(key)) throw new Error('Campo não permitido.')
    if (entry !== null && typeof entry !== 'string' && typeof entry !== 'number') throw new Error('Valor inválido.')
    if (typeof entry === 'string' && entry.length > 4000) throw new Error('Texto muito longo.')
    if (typeof entry === 'number' && !Number.isFinite(entry)) throw new Error('Número inválido.')
    result[key] = entry
  }
  return result
}
