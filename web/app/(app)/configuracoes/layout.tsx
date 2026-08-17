import { redirect } from 'next/navigation'
import { usuarioAtual } from '@/lib/supabase/server'
import { ConfigNav } from '@/components/config/config-nav'

/* Configurações — só admin/gestor. Layout com sub-nav à esquerda. */
export default async function ConfigLayout({ children }: { children: React.ReactNode }) {
  const u = await usuarioAtual()
  if (!u) redirect('/login')
  if (u.papel !== 'admin' && u.papel !== 'gestor') redirect('/')

  return (
    <div>
      <h1 className="t-h1" style={{ marginBottom: 'var(--s-6)' }}>Configurações</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 220px) 1fr', gap: 'var(--s-8)', alignItems: 'start' }}>
        <aside style={{ position: 'sticky', top: 'calc(var(--topbar-h) + var(--s-6))' }}>
          <ConfigNav />
        </aside>
        <section style={{ minWidth: 0 }}>{children}</section>
      </div>
    </div>
  )
}
