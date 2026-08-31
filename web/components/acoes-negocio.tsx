'use client'

import { useRef, useState, useTransition, type ReactNode, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { moverEstagio, marcarPerdido, criarMotivoPerda, pausarNegociacao, duplicarNegociacao, excluirNegociacao, retomarNegociacao } from '@/lib/actions'
import type { StatusNeg } from '@/lib/estagios'

/* Ações do negócio no canto do banner: Marcar perda (👎) + Marcar venda (👍)
   quando em andamento, e o menu "Gerenciar negociação" (⋮). Os menus abrem
   em posição FIXA para não serem cortados pelo overflow do banner. */

const IC = {
  retomar: <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />,
  pausar: <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>,
  duplicar: <><rect width="13" height="13" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
  apagar: <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
}
const THUMB_DOWN = <path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
const THUMB_UP = <path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />

// botões sobre o banner escuro
const btnPill: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, height: 42, padding: '0 19px', borderRadius: 999, fontSize: 'var(--text-md)', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }
const btnPerda: CSSProperties = { ...btnPill, color: '#fff', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.30)' }
const btnVenda: CSSProperties = { ...btnPill, color: '#fff', background: '#1a8fd0', border: '1px solid #1a8fd0' }

function Item({ icone, filled, danger, children, onClick }: { icone: ReactNode; filled?: boolean; danger?: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="acao-item" style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', padding: '10px 12px', borderRadius: 8, fontSize: 'var(--text-sm)', fontWeight: 500, width: '100%', color: danger ? 'var(--critical)' : 'var(--ink)' }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', opacity: 0.8 }}>{icone}</svg>
      {children}
    </button>
  )
}

export function AcoesNegocio({ oppId, status, motivos = [] }: { oppId: string; status: StatusNeg; motivos?: { code: string; label: string }[] }) {
  const [menu, setMenu] = useState<'none' | 'gerenciar' | 'perda'>('none')
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null)
  const [pend, start] = useTransition()
  const gerRef = useRef<HTMLButtonElement>(null)
  const perdaRef = useRef<HTMLButtonElement>(null)
  const router = useRouter()

  const abrir = (qual: 'gerenciar' | 'perda', ref: React.RefObject<HTMLButtonElement | null>) => {
    if (menu === qual) { setMenu('none'); return }
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
    setMenu(qual)
  }

  const rodar = (fn: () => Promise<{ ok: boolean; erro?: string }>, aposOk: () => void, confirmar?: string) => {
    if (confirmar && !window.confirm(confirmar)) return
    setMenu('none')
    start(async () => { const r = await fn(); if (r.ok) aposOk() })
  }
  const refrescar = () => router.refresh()
  const paraPipeline = () => router.push('/pipeline')

  const andamento = status === 'andamento'

  // "criar motivo" dentro do menu de perda: cria na lista e já marca a perda
  const [criandoMot, setCriandoMot] = useState(false)
  const [novoMot, setNovoMot] = useState('')
  const criarEPerder = () => {
    const l = novoMot.trim()
    if (!l) return
    start(async () => {
      const r = await criarMotivoPerda(l)
      if (!r.ok) return
      const p = await marcarPerdido(oppId, r.code)
      if (p.ok) { setMenu('none'); setCriandoMot(false); setNovoMot(''); router.refresh() }
    })
  }

  return (
    <div className="flex items-center flex-wrap justify-end" style={{ gap: 8 }}>
      {andamento && (
        <>
          <button ref={perdaRef} disabled={pend} onClick={() => abrir('perda', perdaRef)} style={btnPerda}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{THUMB_DOWN}</svg>
            Marcar perda
          </button>
          <button disabled={pend} onClick={() => rodar(() => moverEstagio(oppId, 'ganho'), refrescar)} style={btnVenda}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{THUMB_UP}</svg>
            Marcar venda
          </button>
        </>
      )}

      <button
        ref={gerRef}
        aria-label="Gerenciar negociação"
        disabled={pend}
        onClick={() => { setTip(null); abrir('gerenciar', gerRef) }}
        onMouseEnter={() => { const r = gerRef.current?.getBoundingClientRect(); if (r) setTip({ top: r.top - 8, left: r.left + r.width / 2 }) }}
        onMouseLeave={() => setTip(null)}
        style={{ width: 46, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', cursor: 'pointer', border: 'none', transition: 'background .12s, color .12s', color: (tip || menu === 'gerenciar') ? '#1a8fd0' : '#fff', background: (tip || menu === 'gerenciar') ? '#cbe9fc' : 'rgba(255,255,255,0.12)' }}
      >
        <svg width="21" height="21" viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="4" r="1.8" /><circle cx="10" cy="10" r="1.8" /><circle cx="10" cy="16" r="1.8" /></svg>
      </button>

      {tip && menu !== 'gerenciar' && (
        <div style={{ position: 'fixed', top: tip.top, left: tip.left, transform: 'translate(-50%, -100%)', zIndex: 1000, background: '#1c2b46', color: '#fff', fontSize: 'var(--text-xs)', fontWeight: 600, padding: '6px 10px', borderRadius: 8, whiteSpace: 'nowrap', boxShadow: '0 6px 18px rgba(0,0,0,0.3)', pointerEvents: 'none' }}>
          Gerenciar Negociação
        </div>
      )}

      {menu !== 'none' && pos && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => { setMenu('none'); setCriandoMot(false) }} />
          <div style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 1000, minWidth: 236, maxHeight: '60vh', overflowY: 'auto', background: 'var(--plane)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-lg)', boxShadow: '0 16px 44px rgba(0,0,0,0.22)', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {menu === 'gerenciar' ? (
              <>
                {(status === 'perdido' || status === 'pausado') && (
                  <Item icone={IC.retomar} onClick={() => rodar(() => retomarNegociacao(oppId), refrescar)}>Retomar negociação</Item>
                )}
                {andamento && (
                  <Item icone={IC.pausar} filled onClick={() => rodar(() => pausarNegociacao(oppId), refrescar)}>Pausar negociação</Item>
                )}
                <Item icone={IC.duplicar} onClick={() => rodar(() => duplicarNegociacao(oppId), paraPipeline)}>Duplicar negociação</Item>
                <Item icone={IC.apagar} danger onClick={() => rodar(() => excluirNegociacao(oppId), paraPipeline, 'Apagar esta negociação? Remove o negócio e todo o histórico (notas, tarefas, reuniões, produtos). Não dá para desfazer.')}>Apagar negociação</Item>
              </>
            ) : (
              <>
                <div className="t-xs muted" style={{ padding: '4px 10px 6px', fontWeight: 600 }}>Motivo da perda</div>
                {motivos.length === 0 && <div className="t-sm muted" style={{ padding: '4px 10px' }}>Nenhum motivo cadastrado.</div>}
                {motivos.map(m => (
                  <button key={m.code} className="acao-item" style={{ textAlign: 'left', padding: '9px 12px', borderRadius: 8, fontSize: 'var(--text-sm)', fontWeight: 500, width: '100%', color: 'var(--ink)' }} onClick={() => rodar(() => marcarPerdido(oppId, m.code), refrescar)}>
                    {m.label}
                  </button>
                ))}

                <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 4, paddingTop: 4 }}>
                  {!criandoMot ? (
                    <button className="acao-item" style={{ textAlign: 'left', padding: '9px 12px', borderRadius: 8, fontSize: 'var(--text-sm)', fontWeight: 600, width: '100%', color: 'var(--series-1)' }} onClick={() => setCriandoMot(true)}>+ Criar motivo</button>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, padding: '4px 8px' }}>
                      <input
                        className="field"
                        placeholder="Novo motivo de perda"
                        value={novoMot}
                        onChange={e => setNovoMot(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); criarEPerder() } }}
                        autoFocus
                      />
                      <button className="btn btn-primary btn-sm" onClick={criarEPerder} disabled={pend || !novoMot.trim()}>Criar</button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
