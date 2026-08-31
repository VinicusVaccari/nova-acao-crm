'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { IconeAgenda, IconeComercial, IconeContatos, IconeEmpresas, IconeHoje, IconeMensagens, IconePipeline } from '@/components/icones'

type Item = {
  href: string
  label: string
  Icone: (p: { className?: string }) => React.JSX.Element
}

// grupos separados por uma divisória fina no rail
const GRUPOS: Item[][] = [
  [
    { href: '/', label: 'Hoje', Icone: IconeHoje },
    { href: '/pipeline', label: 'Pipeline', Icone: IconePipeline },
    { href: '/empresas', label: 'Empresas', Icone: IconeEmpresas },
    { href: '/contatos', label: 'Contatos', Icone: IconeContatos },
    { href: '/agenda', label: 'Agenda', Icone: IconeAgenda },
    { href: '/mensagens', label: 'Mensagens', Icone: IconeMensagens },
  ],
  [{ href: '/comercial', label: 'Indicadores', Icone: IconeComercial }],
]

export function Sidebar({ alertas }: { alertas?: number }) {
  const path = usePathname()
  const ativo = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))

  return (
    <aside
      className="fixed left-0 bottom-0 z-30 hidden md:flex flex-col items-center"
      style={{ top: 'var(--topbar-h)', width: 'var(--sidebar-w)', background: 'var(--nav-bg)' }}
    >
      {/* ícones (o logo mora na topbar, no canto escuro, emendando com este rail) */}
      <nav className="flex flex-col items-center" style={{ padding: `var(--s-4) 0`, gap: 4 }}>
        {GRUPOS.map((grupo, gi) => (
          <div key={gi} className="flex flex-col items-center" style={{ gap: 4 }}>
            {gi > 0 && <div className="rail-sep" />}
            {grupo.map(it => (
              <Link key={it.href} href={it.href} className="rail-item" data-ativo={ativo(it.href)}>
                <it.Icone />
                {it.href === '/' && alertas ? <span className="rail-badge" /> : null}
                <span className="rail-tip">{it.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}

/** Barra inferior no celular — o rail some abaixo de md. */
export function NavMobile() {
  const path = usePathname()
  const itens = GRUPOS.flat()
  const ativo = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 flex"
      style={{ background: 'var(--nav-bg)', borderTop: '1px solid var(--nav-hairline)' }}
    >
      {itens.map(it => (
        <Link
          key={it.href}
          href={it.href}
          className="flex-1 flex flex-col items-center justify-center gap-1"
          style={{
            height: 56,
            color: ativo(it.href) ? 'var(--accent)' : 'var(--nav-ink-2)',
            fontSize: 'var(--text-2xs)',
            fontWeight: ativo(it.href) ? 700 : 500,
          }}
        >
          <it.Icone />
          {it.label}
        </Link>
      ))}
    </nav>
  )
}
