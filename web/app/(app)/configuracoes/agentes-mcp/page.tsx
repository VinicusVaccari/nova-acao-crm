import { AgentesMcpAdmin } from '@/components/config/agentes-mcp-admin'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/security/authorization'

export const dynamic = 'force-dynamic'

export default async function AgentesMcpPage() {
  await requireAdmin()
  const { data, error } = await db.from('mcp_agent_keys')
    .select('id, agent_name, is_active, created_at, revoked_at, last_used_at, expires_at')
    .order('expires_at', { ascending: true })
  if (error) throw new Error('Não foi possível carregar as chaves MCP.')
  return <AgentesMcpAdmin chaves={data ?? []} />
}
