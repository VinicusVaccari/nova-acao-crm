'use client'

import { useEffect } from 'react'

/** Painel lateral deslizante (à direita), estilo RD. */
export function Drawer({
  titulo,
  aberto,
  onClose,
  children,
  footer,
}: {
  titulo: string
  aberto: boolean
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  // fecha no Esc e trava o scroll do fundo
  useEffect(() => {
    if (!aberto) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [aberto, onClose])

  if (!aberto) return null

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={titulo}>
        <div className="drawer-head">
          <h2 className="t-h1">{titulo}</h2>
          <button className="drawer-x" onClick={onClose} aria-label="Fechar">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  )
}
