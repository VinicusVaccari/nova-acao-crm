'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/* Sub-navegação das Configurações. Só "Users" está pronto; os demais
   aparecem como "em breve" (a gente constrói um a um). */
const SECOES = [
  { href: '/configuracoes/usuarios', label: 'Usuários e equipes', pronto: true },
  { href: '/configuracoes/perfil', label: 'Perfil', pronto: true },
  { href: '/configuracoes/segmentos', label: 'Segmentos', pronto: true },
  { href: '/configuracoes/motivos-perda', label: 'Motivos de perda', pronto: true },
  { href: '/configuracoes/produtos', label: 'Produtos e serviços', pronto: true },
  { href: '/configuracoes/campos', label: 'Campos dos deals', pronto: true },
  { href: '/configuracoes/follow-up', label: 'Follow-up', pronto: true },
  { href: '/configuracoes/agentes-mcp', label: 'Agentes MCP', pronto: true },
]

export function ConfigNav() {
  const path = usePathname()
  return (
    <nav className="flex flex-col" style={{ gap: 2 }}>
      {SECOES.map(s => {
        const ativo = path.startsWith(s.href)
        if (!s.pronto) {
          return (
            <span
              key={s.href}
              className="t-sm"
              style={{ padding: '8px 12px', borderRadius: 8, color: 'var(--muted)', cursor: 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              {s.label}
              <span className="t-2xs" style={{ opacity: 0.7 }}>em breve</span>
            </span>
          )
        }
        return (
          <Link
            key={s.href}
            href={s.href}
            className="t-sm"
            style={{
              padding: '8px 12px', borderRadius: 8, fontWeight: ativo ? 700 : 500,
              background: ativo ? 'color-mix(in srgb, var(--brand-teal) 12%, transparent)' : 'transparent',
              color: ativo ? 'var(--brand-teal)' : 'var(--ink)',
            }}
          >
            {s.label}
          </Link>
        )
      })}
    </nav>
  )
}
