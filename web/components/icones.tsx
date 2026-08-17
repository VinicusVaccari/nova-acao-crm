/* Ícones em traço de 1.6px, grade de 20px. Sem dependência externa —
   o traço acompanha a cor do texto e a espessura fica igual em todos. */

type P = { className?: string }

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const IconeHoje = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 7.5h14M6 3v2.5M14 3v2.5" />
    <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
    <path d="M7 11h3" />
  </svg>
)

export const IconeConfig = (p: P) => (
  <svg {...base} {...p} viewBox="0 0 24 24">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export const IconeMensagens = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h10a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 15 14H8l-4 3z" />
    <path d="M7 8h6M7 10.5h4" />
  </svg>
)

export const IconeAgenda = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
    <path d="M3 8h14M7 3v3M13 3v3" />
    <path d="M6.5 11h1.5M12 11h1.5M6.5 13.5h1.5M12 13.5h1.5" />
  </svg>
)

export const IconePipeline = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="3.5" width="4.5" height="13" rx="1.5" />
    <rect x="8.5" y="3.5" width="4.5" height="9" rx="1.5" />
    <rect x="14.5" y="3.5" width="3" height="6" rx="1.5" />
  </svg>
)

export const IconeComercial = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 16.5V9M7.7 16.5V4.5M12.3 16.5v-5M17 16.5V7" />
  </svg>
)

export const IconeMarketing = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 12V8a1.5 1.5 0 0 1 1.5-1.5h2L12 3v14l-5.5-3.5h-2A1.5 1.5 0 0 1 3 12Z" />
    <path d="M15 8.2a3 3 0 0 1 0 3.6" />
  </svg>
)

export const IconeClientes = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="7" r="2.8" />
    <path d="M2.8 16.5a5.2 5.2 0 0 1 10.4 0" />
    <path d="M14 5.2a2.8 2.8 0 0 1 0 5.2M15.5 16.5a5 5 0 0 0-1.6-3.6" />
  </svg>
)

export const IconeBusca = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13.2 13.2 3.3 3.3" />
  </svg>
)

export const IconeSair = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7.5 3.5h-3A1.5 1.5 0 0 0 3 5v10a1.5 1.5 0 0 0 1.5 1.5h3" />
    <path d="M12.5 13.5 16.5 10l-4-3.5M16 10H7.5" />
  </svg>
)

export const IconeTema = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 2.5a7.5 7.5 0 1 0 7.5 7.5A5.6 5.6 0 0 1 10 2.5Z" />
  </svg>
)

export const IconeRecolher = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
    <path d="M8 3.5v13" />
  </svg>
)

export const IconeMais = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </svg>
)

export const IconeAlerta = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 3.2 2.8 16h14.4L10 3.2Z" />
    <path d="M10 8v3.2M10 13.8v.4" />
  </svg>
)
