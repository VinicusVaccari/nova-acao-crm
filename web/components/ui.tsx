import type { ReactNode } from 'react'

/* ---------------- Avatar com iniciais ---------------- */

export function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase()
  return (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

/** Deriva uma cor estável a partir do nome — mesmo lead, mesma cor sempre. */
const PALETA_AV = ['#01aaaf', '#6366f1', '#8b5cf6', '#0e8ecf', '#f97316', '#0d8f52', '#a855f7', '#d19a10']
export function corDoNome(nome: string): string {
  let h = 0
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0
  return PALETA_AV[h % PALETA_AV.length]
}

export function Avatar({
  nome,
  src,
  tamanho = 36,
  cor,
}: {
  nome: string
  src?: string | null
  tamanho?: number
  cor?: string
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={nome}
        width={tamanho}
        height={tamanho}
        className="avatar"
        style={{ width: tamanho, height: tamanho, borderRadius: '50%', objectFit: 'cover', display: 'block' }}
      />
    )
  }
  return (
    <span
      className="avatar"
      style={
        {
          width: tamanho,
          height: tamanho,
          fontSize: Math.round(tamanho * 0.38),
          '--av': cor ?? corDoNome(nome),
        } as React.CSSProperties
      }
    >
      {iniciais(nome)}
    </span>
  )
}

/* =================================================================
   Componentes do sistema. Tudo aqui consome as escalas do
   design system — nenhum valor solto.
   ================================================================= */

export function Cabecalho({
  titulo,
  descricao,
  acao,
}: {
  titulo: string
  descricao?: ReactNode
  acao?: ReactNode
}) {
  return (
    <div
      className="flex flex-wrap items-end justify-between gap-4"
      style={{ marginBottom: 'var(--s-8)' }}
    >
      <div>
        <h1 className="t-h1">{titulo}</h1>
        {descricao && (
          <p className="t-body muted" style={{ marginTop: 'var(--s-1)' }}>
            {descricao}
          </p>
        )}
      </div>
      {acao}
    </div>
  )
}

export function Secao({
  titulo,
  descricao,
  acao,
  children,
}: {
  titulo: string
  descricao?: string
  acao?: ReactNode
  children: ReactNode
}) {
  return (
    <section style={{ marginBottom: 'var(--s-10)' }}>
      <div
        className="flex flex-wrap items-end justify-between gap-3"
        style={{ marginBottom: 'var(--s-4)' }}
      >
        <div>
          <h2 className="t-h2">{titulo}</h2>
          {descricao && (
            <p className="t-sm muted" style={{ marginTop: 'var(--s-1)', maxWidth: '78ch' }}>
              {descricao}
            </p>
          )}
        </div>
        {acao}
      </div>
      {children}
    </section>
  )
}

export function Painel({
  titulo,
  legenda,
  acao,
  children,
  className = '',
  semPadding,
}: {
  titulo?: string
  legenda?: string
  acao?: ReactNode
  children: ReactNode
  className?: string
  semPadding?: boolean
}) {
  return (
    <div className={`card ${className}`}>
      {titulo && (
        <div
          className="flex items-start justify-between gap-3"
          style={{ padding: `var(--s-4) var(--s-5) 0` }}
        >
          <div>
            <h3 className="t-h3">{titulo}</h3>
            {legenda && (
              <p className="t-sm muted" style={{ marginTop: 2 }}>
                {legenda}
              </p>
            )}
          </div>
          {acao}
        </div>
      )}
      <div style={{ padding: semPadding ? 0 : `var(--s-4) var(--s-5) var(--s-5)` }}>{children}</div>
    </div>
  )
}

/* ---------------- Stat tile ---------------- */

type Estado = 'good' | 'warning' | 'critical' | null

const CORES: Record<string, string> = {
  good: 'var(--good)',
  warning: 'var(--serious)',
  critical: 'var(--critical)',
  neutro: 'var(--ink-muted)',
}

const ROTULOS: Record<string, string> = {
  good: 'na meta',
  warning: 'atenção',
  critical: 'abaixo',
}

export function Kpi({
  rotulo,
  valor,
  meta,
  estado = null,
  nota,
}: {
  rotulo: string
  valor: string
  meta?: string
  estado?: Estado
  nota?: string
}) {
  const cor = estado ? CORES[estado] : CORES.neutro
  const marca = estado ? ROTULOS[estado] : null

  return (
    <div className="card card-hover" style={{ padding: 'var(--s-4)' }}>
      <div className="t-label" style={{ minHeight: 28 }}>
        {rotulo}
      </div>

      <div className="t-metric tabular" style={{ marginTop: 'var(--s-2)' }}>
        {valor}
      </div>

      <div
        className="flex items-center flex-wrap gap-x-2 t-xs"
        style={{ marginTop: 'var(--s-3)', minHeight: 18 }}
      >
        {marca && (
          <span className="chip" style={{ background: `color-mix(in srgb, ${cor} 14%, transparent)`, color: cor }}>
            <span aria-hidden className="chip-dot" style={{ background: cor }} />
            {marca}
          </span>
        )}
        {meta && <span className="muted">meta {meta}</span>}
        {!meta && nota && <span className="muted">{nota}</span>}
      </div>
    </div>
  )
}

/* ---------------- Selo de estado ---------------- */

export function Selo({
  tipo,
  texto,
  forte,
}: {
  tipo: Estado | 'neutro'
  texto: string
  forte?: boolean
}) {
  const cor = CORES[tipo ?? 'neutro']
  return (
    <span
      className="chip"
      style={
        forte
          ? { background: `color-mix(in srgb, ${cor} 14%, transparent)`, color: cor }
          : { color: 'var(--ink-2)' }
      }
    >
      <span aria-hidden className="chip-dot" style={{ background: cor }} />
      {texto}
    </span>
  )
}

/* ---------------- Tabela ---------------- */

export function Tabela({
  colunas,
  children,
}: {
  colunas: { label: string; alinhar?: 'e' | 'd' }[]
  children: ReactNode
}) {
  return (
    <div className="overflow-x-auto" style={{ margin: `0 calc(var(--s-5) * -1)`, padding: `0 var(--s-5)` }}>
      <table className="tbl">
        <thead>
          <tr>
            {colunas.map(c => (
              <th key={c.label} className={c.alinhar === 'd' ? 'num' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ children, d, forte }: { children: ReactNode; d?: boolean; forte?: boolean }) {
  return (
    <td className={d ? 'num' : undefined} style={forte ? { fontWeight: 600 } : undefined}>
      {children}
    </td>
  )
}

/* ---------------- Estado vazio ---------------- */

export function Vazio({ texto, tom = 'neutro' }: { texto: string; tom?: 'neutro' | 'good' }) {
  if (tom === 'good') return <Selo tipo="good" texto={texto} forte />
  return (
    <p className="t-sm muted" style={{ padding: `var(--s-4) 0` }}>
      {texto}
    </p>
  )
}
