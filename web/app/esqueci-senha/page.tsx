import { LogoSimbolo } from '@/components/logo-nova'
import { FormularioRecuperacaoSenha } from './formulario'

export const metadata = { title: 'Recuperar senha · Nova Ação' }

export default function EsqueciSenhaPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--brand-ink)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400, background: 'var(--surface)', borderRadius: 16, padding: 32, boxShadow: '0 10px 40px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <LogoSimbolo size={36} />
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}><span style={{ color: '#009E9B' }}>Nova</span> <span style={{ color: '#FAB800' }}>Ação</span></span>
        </div>
        <h1 className="t-h2">Recuperar senha</h1>
        <p className="t-body muted" style={{ margin: '8px 0 16px' }}>Informe seu e-mail para receber um link de recuperação.</p>
        <FormularioRecuperacaoSenha />
      </div>
    </div>
  )
}
