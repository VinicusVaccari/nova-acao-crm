import { Suspense } from 'react'
import { FormularioLogin } from './formulario'
import { LogoSimbolo } from '@/components/logo-nova'

export const metadata = { title: 'Entrar · Nova Ação' }

export default function Login() {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* ---------- painel da marca ---------- */}
      <div
        className="relative hidden lg:flex flex-col justify-between overflow-hidden"
        style={{ background: 'var(--brand-ink)', padding: 'var(--s-12)' }}
      >
        {/* luz âmbar da marca ao fundo */}
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            width: 620, height: 620, right: -180, top: -160, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(253,185,46,0.22) 0%, transparent 68%)',
          }}
        />
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            width: 520, height: 520, left: -160, bottom: -180, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(1,170,175,0.22) 0%, transparent 68%)',
          }}
        />

        <div className="relative flex items-center gap-3">
          <LogoSimbolo size={40} />
          <span style={{ fontWeight: 800, fontSize: 'var(--text-xl)', letterSpacing: '-0.02em' }}>
            <span style={{ color: '#fff' }}>Nova</span> <span style={{ color: '#FAB800' }}>Ação</span>
          </span>
        </div>

        <div className="relative" style={{ maxWidth: 520 }}>
          <h1 className="t-display" style={{ color: '#fff' }}>
            Do lead
            <br />
            <span style={{ color: 'var(--accent)' }}>ao fechamento</span>, numa espinha só.
          </h1>
          <p style={{ color: '#b6aede', fontSize: 'var(--text-lg)', lineHeight: 'var(--lh-xl)', marginTop: 'var(--s-5)' }}>
            A operação <strong style={{ color: '#fff', fontWeight: 600 }}>comercial</strong> inteira num lugar:
            captação, qualificação, reunião, proposta e venda — cada etapa medida, cada lead na hora.
          </p>

          {/* funil comercial — barras que afunilam, do lead à venda */}
          <div className="flex flex-col" style={{ gap: 8, marginTop: 'var(--s-8)' }}>
            {[
              ['Lead', '#01aaaf', 100],
              ['Qualificado', '#0e8ecf', 82],
              ['Reunião', '#8b5cf6', 64],
              ['Proposta', '#fdb92e', 46],
              ['Venda', '#16a34a', 30],
            ].map(([label, cor, w]) => (
              <div
                key={label as string}
                className="flex items-center"
                style={{
                  width: `${w}%`,
                  minWidth: 132,
                  height: 34,
                  padding: '0 14px',
                  borderRadius: 8,
                  borderLeft: `3px solid ${cor}`,
                  background: `linear-gradient(90deg, color-mix(in srgb, ${cor} 34%, transparent), color-mix(in srgb, ${cor} 8%, transparent))`,
                }}
              >
                <span style={{ color: '#fff', fontSize: 'var(--text-sm)', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-8" style={{ marginTop: 'var(--s-8)' }}>
            {[
              ['Segundos', 'lead entra no CRM'],
              ['5 min', 'speed-to-lead'],
              ['0 min', 'preenchendo CRM'],
            ].map(([a, b]) => (
              <div key={b}>
                <div style={{ color: 'var(--accent)', fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em' }}>{a}</div>
                <div style={{ color: '#9d95c4', fontSize: 'var(--text-sm)', marginTop: 2 }}>{b}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative t-sm" style={{ color: '#7e76a8' }}>
          15 anos de operação · agencianovaacao.com.br
        </div>
      </div>

      {/* ---------- formulário ---------- */}
      <div className="flex items-center justify-center" style={{ padding: 'var(--s-6)' }}>
        <div className="w-full surgir" style={{ maxWidth: 380 }}>
          <div className="lg:hidden flex items-center gap-3" style={{ marginBottom: 'var(--s-8)' }}>
            <LogoSimbolo size={34} />
            <span style={{ fontWeight: 800, fontSize: 'var(--text-lg)', letterSpacing: '-0.02em' }}>
              <span style={{ color: '#009E9B' }}>Nova</span> <span style={{ color: '#FAB800' }}>Ação</span>
            </span>
          </div>

          <h2 className="t-h1">Entrar</h2>
          <p className="t-body muted" style={{ marginTop: 'var(--s-2)', marginBottom: 'var(--s-8)' }}>
            Acesse o sistema de operação da agência.
          </p>

          <Suspense fallback={null}>
            <FormularioLogin />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
