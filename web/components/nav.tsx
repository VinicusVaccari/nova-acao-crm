'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const OPERACAO = [
  { href: '/', label: 'Hoje' },
  { href: '/pipeline', label: 'Pipeline' },
]

const ANALISE = [
  { href: '/comercial', label: 'Comercial' },
  { href: '/marketing', label: 'Marketing' },
  { href: '/cs', label: 'Clientes' },
]

export function Nav() {
  const path = usePathname()
  const ativo = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))

  return (
    <header
      className="sticky top-0 z-20 backdrop-blur"
      style={{
        borderBottom: '1px solid var(--hairline)',
        background: 'color-mix(in srgb, var(--plane) 88%, transparent)',
      }}
    >
      <div className="mx-auto w-full max-w-[1400px] px-6">
        <div className="flex items-center gap-6 h-14 overflow-x-auto">
          <Link href="/" className="flex items-baseline gap-2 shrink-0">
            <span className="text-[14px] font-semibold tracking-tight">Nova Ação</span>
            <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>OS</span>
          </Link>

          <nav className="flex items-center gap-1 shrink-0">
            {OPERACAO.map(a => (
              <Aba key={a.href} {...a} ativo={ativo(a.href)} />
            ))}
          </nav>

          <span aria-hidden className="h-5 w-px shrink-0" style={{ background: 'var(--hairline)' }} />

          <nav className="flex items-center gap-1 shrink-0">
            <span className="text-[11px] mr-1" style={{ color: 'var(--ink-muted)' }}>Painéis</span>
            {ANALISE.map(a => (
              <Aba key={a.href} {...a} ativo={ativo(a.href)} />
            ))}
          </nav>
        </div>
      </div>
    </header>
  )
}

function Aba({ href, label, ativo }: { href: string; label: string; ativo: boolean }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-lg text-[13px] transition-colors whitespace-nowrap"
      style={{
        color: ativo ? 'var(--ink)' : 'var(--ink-2)',
        background: ativo ? 'var(--surface)' : 'transparent',
        border: `1px solid ${ativo ? 'var(--hairline)' : 'transparent'}`,
        fontWeight: ativo ? 600 : 400,
      }}
    >
      {label}
    </Link>
  )
}
