import { db } from '@/lib/db'
import { LogoSimbolo } from '@/components/logo-nova'
import { AceitarConvite } from '@/components/config/aceitar-convite'

export const metadata = { title: 'Convite · Nova Ação' }
export const dynamic = 'force-dynamic'

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const { data: conv } = await db
    .from('invites')
    .select('email, status, expires_at')
    .eq('token', token)
    .maybeSingle()

  const invalido = !conv || conv.status !== 'pendente' || new Date(conv.expires_at as string) < new Date()

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--brand-ink)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400, background: 'var(--surface)', borderRadius: 16, padding: 32, boxShadow: '0 10px 40px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <LogoSimbolo size={36} />
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}>
            <span style={{ color: '#009E9B' }}>Nova</span> <span style={{ color: '#FAB800' }}>Ação</span>
          </span>
        </div>

        {invalido ? (
          <>
            <h1 className="t-h2">Convite inválido</h1>
            <p className="t-body muted" style={{ marginTop: 8 }}>
              Este convite não existe, já foi usado ou expirou. Peça um novo para o administrador.
            </p>
            <a href="/login" className="btn btn-ghost" style={{ marginTop: 16 }}>Ir para o login</a>
          </>
        ) : (
          <>
            <h1 className="t-h2">Criar seu acesso</h1>
            <p className="t-body muted" style={{ margin: '8px 0 16px' }}>
              Convite para <strong>{conv!.email}</strong>. Defina seu nome e uma senha.
            </p>
            <AceitarConvite token={token} />
          </>
        )}
      </div>
    </div>
  )
}
