/* Marca Nova Ação. O símbolo (balão de fala + "!") é recriado em SVG com
   as cores oficiais do brandboard (#FAB800 amarelo, #009E9B teal). Vetor,
   então fica nítido em qualquer tamanho. Se um dia colocarem o arquivo
   oficial em /public, é só trocar aqui. */

export function LogoSimbolo({
  size = 34,
  bolha = '#FAB800',
  marca = '#fff',
  className,
}: { size?: number; bolha?: string; marca?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden role="img">
      {/* balão de fala (círculo + rabinho) */}
      <path d="M18 48 L10 62 Q9 64 11 63 L30 51 Z" fill={bolha} />
      <circle cx="33" cy="29" r="27" fill={bolha} />
      {/* exclamação */}
      <rect x="29" y="12" width="8" height="23" rx="4" fill={marca} />
      <circle cx="33" cy="42.5" r="4.6" fill={marca} />
    </svg>
  )
}

/* Logo horizontal: símbolo + "Nova Ação" em duas cores (como o brandboard).
   corNova / corAcao permitem adaptar ao fundo (claro/escuro). */
export function LogoNovaAcao({
  size = 20,
  corNova = '#fff',
  corAcao = '#FAB800',
  simbolo = true,
  gap = 10,
  className,
  style,
}: {
  size?: number
  corNova?: string
  corAcao?: string
  simbolo?: boolean
  gap?: number
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap, ...style }}>
      {simbolo && <LogoSimbolo size={Math.round(size * 1.7)} />}
      <span style={{ fontWeight: 800, fontSize: size, letterSpacing: '-0.02em', lineHeight: 1, whiteSpace: 'nowrap' }}>
        <span style={{ color: corNova }}>Nova</span>{' '}
        <span style={{ color: corAcao }}>Ação</span>
      </span>
    </span>
  )
}
