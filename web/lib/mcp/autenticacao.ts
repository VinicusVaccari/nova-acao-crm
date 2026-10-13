import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'

const SEM_FORMATACAO_INVISIVEL = /[\u00ad\u200b\u200c\u200d\ufeff]/g

export type ChaveMcp = {
  id: string
  agentName: string
  allowsLeadData: boolean
}

export type ResultadoAutenticacaoMcp =
  | { tipo: 'autorizado'; chave: ChaveMcp }
  | { tipo: 'negado'; chaveId: string | null; motivo: string }
  | { tipo: 'indisponivel'; motivo: string }

export function hashChaveMcp(segredo: string) {
  return createHash('sha256').update(segredo).digest('hex')
}

export function novaChaveMcp() {
  return `mcp_${randomBytes(32).toString('hex')}`
}

export async function autenticarChaveMcp(segredo: string | undefined): Promise<ResultadoAutenticacaoMcp> {
  if (!segredo) return { tipo: 'negado', chaveId: null, motivo: 'Chave ausente.' }
  const limpo = segredo.replace(SEM_FORMATACAO_INVISIVEL, '').trim()
  if (!limpo) return { tipo: 'negado', chaveId: null, motivo: 'Chave ausente.' }
  if (!/^mcp_[a-f0-9]{64}$/.test(limpo)) return { tipo: 'negado', chaveId: null, motivo: 'Chave inválida.' }

  const { data, error } = await db.from('mcp_agent_keys')
    .select('id, agent_name, allows_lead_data, is_active, revoked_at, expires_at')
    .eq('key_hash', hashChaveMcp(limpo))
    .maybeSingle()
  if (error) {
    console.error('mcp: chave não consultada:', error.message)
    return { tipo: 'indisponivel', motivo: 'Não foi possível autenticar a chave.' }
  }
  if (!data) return { tipo: 'negado', chaveId: null, motivo: 'Chave inválida.' }
  if (!data.is_active || data.revoked_at) return { tipo: 'negado', chaveId: data.id, motivo: 'Chave revogada.' }
  if (new Date(data.expires_at) < new Date()) return { tipo: 'negado', chaveId: data.id, motivo: 'Chave expirada.' }

  const { error: usoErro } = await db.from('mcp_agent_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
  if (usoErro) {
    console.error('mcp: último uso não atualizado:', usoErro.message)
    return { tipo: 'indisponivel', motivo: 'Não foi possível registrar o uso da chave.' }
  }

  return {
    tipo: 'autorizado',
    chave: { id: data.id, agentName: data.agent_name, allowsLeadData: data.allows_lead_data },
  }
}
