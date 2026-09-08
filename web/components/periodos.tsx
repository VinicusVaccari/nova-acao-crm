import Link from 'next/link'

const OPCOES = [
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
]

/** Controle segmentado de período. Uma linha só, acima dos gráficos. */
export function Periodos({ atual, base, incluirMes = false }: { atual: number | null; base: string; incluirMes?: boolean }) {
  const opcoes = incluirMes
    ? [{ dias: null, label: 'Este mês' }, { dias: 1, label: 'Hoje' }, ...OPCOES, { dias: 365, label: '365 dias' }]
    : OPCOES
  return (
    <div
      className="inset flex flex-wrap items-center"
      style={{ padding: 3, gap: 2, border: '1px solid var(--hairline)' }}
    >
      {opcoes.map(o => {
        const ativo = o.dias === atual
        return (
          <Link
            key={o.dias ?? 'mes'}
            href={o.dias === null ? base : `${base}?dias=${o.dias}`}
            aria-current={ativo ? 'page' : undefined}
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
