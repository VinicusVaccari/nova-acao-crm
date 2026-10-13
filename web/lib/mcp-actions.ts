'use server'

import { revalidatePath } from 'next/cache'
import { db } from './db'
import { hashChaveMcp, novaChaveMcp } from './mcp/autenticacao'
import { requireAdmin } from './security/authorization'

type Resultado = { ok: true } | { ok: false; erro: string }

function recarregar() {
  revalidatePath('/configuracoes/agentes-mcp')
}

export async function criarChaveAgente(nome: string): Promise<(Resultado & { segredo?: string })> {
  let admin
  try { admin = await requireAdmin() } catch (erro) { return { ok: false, erro: (erro as Error).message } }
  const agentName = nome.trim()
  if (agentName.length < 2 || agentName.length > 100) return { ok: false, erro: 'Informe um nome entre 2 e 100 caracteres.' }

  const segredo = novaChaveMcp()
  const { error } = await db.from('mcp_agent_keys').insert({
    agent_name: agentName,
    key_hash: hashChaveMcp(segredo),
    created_by: admin.id,
  })
  if (error) return { ok: false, erro: error.message }
  recarregar()
  return { ok: true, segredo }
}

export async function revogarChaveAgente(id: string): Promise<Resultado> {
  let admin
  try { admin = await requireAdmin() } catch (erro) { return { ok: false, erro: (erro as Error).message } }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, erro: 'Chave inválida.' }
  const { data, error } = await db.from('mcp_agent_keys')
    .update({ is_active: false, revoked_at: new Date().toISOString(), revoked_by: admin.id })
    .eq('id', id)
    .eq('is_active', true)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, erro: error.message }
  if (!data) return { ok: false, erro: 'Chave não encontrada ou já revogada.' }
  recarregar()
  return { ok: true }
}
