import 'server-only'

import { db } from '@/lib/db'

type ChamadaMcp = {
  agentKeyId: string | null
  toolName: string
  toolGroup: 'agregado' | 'dado_pessoal'
  status: 'ok' | 'erro' | 'negado'
  errorDetail?: string
  requestedIp: string | null
  args?: Record<string, unknown>
  durationMs?: number
}

export async function registrarChamadaMcp(chamada: ChamadaMcp) {
  const { error } = await db.from('mcp_tool_calls').insert({
    agent_key_id: chamada.agentKeyId,
    tool_name: chamada.toolName,
    tool_group: chamada.toolGroup,
    args: chamada.args ?? {},
    status: chamada.status,
    error_detail: chamada.errorDetail ?? null,
    requested_ip: chamada.requestedIp,
    duration_ms: chamada.durationMs ?? null,
  })
  if (error) {
    console.error('mcp: auditoria não gravada:', error.message)
    return false
  }
  return true
}
