'use client'

import { useState } from 'react'
import { Drawer } from '@/components/drawer'
import type { CardPipeline } from '@/lib/estagios'

export type Filtros = {
  status: '' | 'andamento' | 'vendido' | 'perdido'
  criacao: '' | 'hoje' | 'ontem' | '7' | '15' | '30' | '90' | 'custom'
  de?: string
  ate?: string
  qualMin: number
  busca: string
  produtoId: number
  valorMin?: number
  valorMax?: number
}

export const filtroVazio: Filtros = { status: '', criacao: '', qualMin: 0, busca: '', produtoId: 0 }

export function contarFiltros(f: Filtros): number {
  let n = 0
  if (f.status) n++
  if (f.criacao) n++
  if (f.qualMin > 0) n++
  if (f.busca.trim()) n++
  if (f.produtoId) n++
  if ((f.valorMin ?? 0) > 0 || (f.valorMax ?? 0) > 0) n++
  return n
}

function dentroPeriodo(iso: string, f: Filtros): boolean {
  const d = new Date(iso)
  const now = new Date()
  const hoje0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (f.criacao === 'hoje') return d >= hoje0
  if (f.criacao === 'ontem') {
    const ontem = new Date(hoje0); ontem.setDate(ontem.getDate() - 1)
    return d >= ontem && d < hoje0
  }
  if (['7', '15', '30', '90'].includes(f.criacao)) {
    const lim = new Date(now); lim.setDate(lim.getDate() - Number(f.criacao))
    return d >= lim
  }
  if (f.criacao === 'custom') {
    if (f.de && d < new Date(f.de + 'T00:00:00')) return false
    if (f.ate && d > new Date(f.ate + 'T23:59:59')) return false
    return true
  }
  return true
}

export function aplicarFiltros(cards: CardPipeline[], f: Filtros): CardPipeline[] {
  return cards.filter(c => {
    if (f.status) { if (c.status !== f.status) return false }
    else if (c.status === 'perdido') return false // por padrão, esconde perdidos do board
    if (f.criacao && !dentroPeriodo(c.created_at, f)) return false
    if (f.qualMin > 0 && (c.qualificacao || 0) < f.qualMin) return false
    if (f.busca.trim()) {
      const q = f.busca.toLowerCase().trim()
      const hay = [c.nome, c.empresa, c.title].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (f.produtoId && !c.produtoIds.includes(f.produtoId)) return false
    if ((f.valorMin ?? 0) > 0 && c.contractValue < (f.valorMin as number)) return false
    if ((f.valorMax ?? 0) > 0 && c.contractValue > (f.valorMax as number)) return false
    return true
  })
}

/* --------------- Drawer de filtros --------------- */

function EstrelasFiltro({ valor, onSet }: { valor: number; onSet: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => {
        const on = n <= valor
        return (
          <button key={n} type="button" onClick={() => onSet(n === valor ? 0 : n)} aria-label={`${n}+`} style={{ lineHeight: 0 }}>
            <svg width="24" height="24" viewBox="0 0 20 20" fill={on ? 'var(--accent)' : 'none'} stroke={on ? 'var(--accent)' : 'var(--ink-muted)'} strokeWidth="1.4" strokeLinejoin="round">
              <path d="M10 2.5l2.3 4.7 5.2.76-3.75 3.66.88 5.18L10 14.9l-4.63 2.4.88-5.18L2.5 7.96l5.2-.76z" />
            </svg>
          </button>
        )
      })}
      {valor > 0 && <span className="t-sm muted" style={{ marginLeft: 6 }}>{valor}+ estrelas</span>}
    </div>
  )
}

export function FiltrosDrawer({
  aberto,
  onClose,
  filtros,
  onAplicar,
  onLimpar,
  catalogo,
}: {
  aberto: boolean
  onClose: () => void
  filtros: Filtros
  onAplicar: (f: Filtros) => void
  onLimpar: () => void
  catalogo: { id: number; name: string }[]
}) {
  const [d, setD] = useState<Filtros>(filtros)
  // sincroniza quando reabre
  const [visto, setVisto] = useState(aberto)
  if (aberto !== visto) {
    setVisto(aberto)
    if (aberto) setD(filtros)
  }

  const set = (patch: Partial<Filtros>) => setD(v => ({ ...v, ...patch }))

  return (
    <Drawer
      titulo="Filtros"
      aberto={aberto}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => { onLimpar(); onClose() }}>Limpar filtros</button>
          <button className="btn btn-primary" onClick={() => { onAplicar(d); onClose() }}>Aplicar filtros</button>
        </>
      }
    >
      <label className="flex flex-col gap-1">
        <span className="campo-label">Status da negociação</span>
        <select className="field" value={d.status} onChange={e => set({ status: e.target.value as Filtros['status'] })}>
          <option value="">Todos</option>
          <option value="andamento">Em andamento</option>
          <option value="vendido">Vendido</option>
          <option value="perdido">Perdido</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="campo-label">Data de criação</span>
        <select className="field" value={d.criacao} onChange={e => set({ criacao: e.target.value as Filtros['criacao'] })}>
          <option value="">Qualquer data</option>
          <option value="hoje">Hoje</option>
          <option value="ontem">Ontem</option>
          <option value="7">Últimos 7 dias</option>
          <option value="15">Últimos 15 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="custom">Personalizado…</option>
        </select>
      </label>
      {d.criacao === 'custom' && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span className="campo-label">De</span><input type="date" className="field" value={d.de ?? ''} onChange={e => set({ de: e.target.value })} /></label>
          <label className="flex flex-col gap-1"><span className="campo-label">Até</span><input type="date" className="field" value={d.ate ?? ''} onChange={e => set({ ate: e.target.value })} /></label>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="campo-label">Qualificação (mínima)</span>
        <EstrelasFiltro valor={d.qualMin} onSet={n => set({ qualMin: n })} />
      </div>

      <label className="flex flex-col gap-1">
        <span className="campo-label">Nome (empresa, contato ou negócio)</span>
        <input className="field" placeholder="Buscar…" value={d.busca} onChange={e => set({ busca: e.target.value })} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="campo-label">Produto ou serviço</span>
        <select className="field" value={d.produtoId} onChange={e => set({ produtoId: Number(e.target.value) })}>
          <option value={0}>Todos</option>
          {catalogo.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <span className="campo-label">Valor total (contrato)</span>
        <div className="flex items-center gap-2">
          <input type="number" min={0} className="field" placeholder="R$ mínimo" value={d.valorMin ?? ''} onChange={e => set({ valorMin: e.target.value ? Number(e.target.value) : undefined })} />
          <span className="t-sm muted">até</span>
          <input type="number" min={0} className="field" placeholder="R$ máximo" value={d.valorMax ?? ''} onChange={e => set({ valorMax: e.target.value ? Number(e.target.value) : undefined })} />
        </div>
      </div>
    </Drawer>
  )
}
