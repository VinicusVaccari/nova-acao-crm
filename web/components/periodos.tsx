import Link from 'next/link'

const OPCOES = [
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
]

/** Controle segmentado de período. Uma linha só, acima dos gráficos. */
export function Periodos({ atual, base }: { atual: number; base: string }) {
  return (
    <div
      className="inset flex items-center"
      style={{ padding: 3, gap: 2, border: '1px solid var(--hairline)' }}
    >
      {OPCOES.map(o => {
        const ativo = o.dias === atual
        return (
          <Link
            key={o.dias}
            href={`${base}?dias=${o.dias}`}
            className="t-sm"
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--r-sm)',
              fontWeight: ativo ? 600 : 500,
              color: ativo ? 'var(--ink)' : 'var(--ink-muted)',
              background: ativo ? 'var(--surface)' : 'transparent',
              boxShadow: ativo ? 'var(--shadow-sm)' : undefined,
              transition: 'all var(--fast) var(--ease)',
            }}
          >
            {o.label}
          </Link>
        )
      })}
    </div>
  )
}
