import 'server-only'
import { db } from '../db'
import { usuarioAtual } from '../supabase/server'
import { canAccessOpportunity, isManager } from './policy'

export async function requireActiveUser() {
  const user = await usuarioAtual()
  if (!user) throw new Error('Sessão inválida ou usuário desativado.')
  return user
}

export async function requireManager() {
  const user = await requireActiveUser()
  if (!isManager(user)) throw new Error('Sem permissão.')
  return user
}

export async function requireAdmin() {
  const user = await requireActiveUser()
  if (user.papel !== 'admin') throw new Error('Sem permissão.')
  return user
}

export async function requireOpportunityAccess(id: string) {
  const user = await requireActiveUser()
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Negócio inválido.')
  const { data, error } = await db.from('opportunities')
    .select('id, owner_id, sdr_id, person_id, company_id').eq('id', id).maybeSingle()
  if (error || !data || !canAccessOpportunity(user, data)) throw new Error('Negócio indisponível ou sem permissão.')
  return { user, opportunity: data }
}

export async function requireMeetingAccess(id: string) {
  await requireActiveUser()
  const { data, error } = await db.from('meetings').select('opportunity_id').eq('id', id).maybeSingle()
  if (error || !data) throw new Error('Reunião indisponível.')
  return requireOpportunityAccess(data.opportunity_id)
}

export async function requireCalendarEventAccess(id: string) {
  const user = await requireActiveUser()
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,1024}$/.test(id)) throw new Error('Evento inválido.')
  const { data, error } = await db.from('meetings').select('opportunity_id').eq('external_event_id', id)
  if (error) throw new Error('Não foi possível validar o evento.')
  if (data?.length) {
    for (const row of data) await requireOpportunityAccess(row.opportunity_id)
  } else if (!isManager(user)) throw new Error('Somente a gestão pode alterar eventos avulsos.')
  return user
}

export async function requireEntityAccess(entity: string, id: string) {
  const user = await requireActiveUser()
  const table = entity === 'contact' ? 'people' : entity === 'company' ? 'companies' : entity === 'deal' ? 'opportunities' : null
  if (!table || typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Entidade inválida.')
  if (entity === 'deal') return (await requireOpportunityAccess(id)).user
  const { data: record, error } = await db.from(table).select(entity === 'company' ? 'id, created_by' : 'id').eq('id', id).maybeSingle()
  if (error || !record) throw new Error('Entidade indisponível.')
  if (isManager(user)) return user
  if (entity === 'company' && (record as unknown as { created_by?: string }).created_by === user.id) return user
  const { data: deals, error: accessError } = await db.from('opportunities')
    .select('owner_id, sdr_id').eq(entity === 'contact' ? 'person_id' : 'company_id', id)
    .or(`owner_id.eq.${user.id},sdr_id.eq.${user.id}`).limit(1)
  if (accessError || !deals?.some(deal => canAccessOpportunity(user, deal))) throw new Error('Sem permissão para a entidade.')
  return user
}
