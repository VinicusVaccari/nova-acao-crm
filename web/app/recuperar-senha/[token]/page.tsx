import { db } from '@/lib/db'
import { hashTokenRecuperacao } from '@/lib/recuperacao-token'
import { LogoSimbolo } from '@/components/logo-nova'
import { FormularioNovaSenha } from './formulario'

export const metadata = { title: 'Redefinir senha · Nova Ação' }
export const dynamic = 'force-dynamic'

export default async function RecuperarSenhaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  // Resíduo aceito: esta consulta confirma o token antes do envio. Com 192 bits
  // de aleatoriedade, varrer tokens válidos é inviável na prática.
  const { data: reset } = await db.from('password_resets')
    .select('status, expires_at')
    .eq('token_hash', hashTokenRecuperacao(token))
    .maybeSingle()
  const invalido = !reset || reset.status !== 'pendente' || new Date(reset.expires_at as string) <= new Date()

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--brand-ink)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400, background: 'var(--surface)', borderRadius: 16, padding: 32, boxShadow: '0 10px 40px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <LogoSimbolo size={36} />
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}><span style={{ color: '#009E9B' }}>Nova</span> <span style={{ color: '#FAB800' }}>Ação</span></span>
        </div>
        {invalido ? (
          <><h1 className="t-h2">Link inválido ou expirado</h1><p className="t-body muted" style={{ marginTop: 8 }}>Peça um novo link de recuperação.</p><a href="/esqueci-senha" className="btn btn-ghost" style={{ marginTop: 16 }}>Pedir novo link</a></>
        ) : (
          <><h1 className="t-h2">Definir nova senha</h1><p className="t-body muted" style={{ margin: '8px 0 16px' }}>Escolha uma senha nova para seu acesso.</p><FormularioNovaSenha token={token} /></>
        )}
      </div>
    </div>
  )
}
