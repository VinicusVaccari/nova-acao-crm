import { usuarioAtual } from '@/lib/supabase/server'
import { PerfilForm } from '@/components/config/perfil-form'

export const dynamic = 'force-dynamic'

export default async function PerfilPage() {
  const u = await usuarioAtual()
  return (
    <div>
      <h2 className="t-h2" style={{ marginBottom: 'var(--s-5)' }}>Perfil</h2>
      <PerfilForm nome={u?.nome ?? ''} email={u?.email ?? ''} papel={u?.papel ?? ''} avatar={u?.avatar ?? null} />
    </div>
  )
}
