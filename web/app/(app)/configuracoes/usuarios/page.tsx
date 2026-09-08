import { requireManager } from '@/lib/security/authorization'
import { db } from '@/lib/db'
import { UsuariosAdmin } from '@/components/config/usuarios-admin'

export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  await requireManager()
  const [usuariosRes, equipesRes, convitesRes] = await Promise.all([
    db.from('profiles')
      .select('id, full_name, email, role, is_active, lead_capacity, team_id, avatar_url')
      .order('full_name', { ascending: true }),
    db.from('teams').select('id, name').order('name', { ascending: true }),
    db.from('invites')
      .select('id, email, role, team_id, status, created_at, expires_at, token')
      .eq('status', 'pendente')
      .order('created_at', { ascending: false }),
  ])

  return (
    <UsuariosAdmin
      usuarios={usuariosRes.data ?? []}
      equipes={equipesRes.data ?? []}
      convites={convitesRes.data ?? []}
    />
  )
}
