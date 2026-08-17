'use client'

import { useState, useTransition } from 'react'
import {
  adicionarItem, renomearItem, alternarItem, removerItem, type Entidade,
} from '@/lib/config-listas'

export type ItemLista = { id: string; label: string; sub?: string | null; ativo: boolean }

export function ListaConfig({ entidade, itens, placeholder, ajuda }: {
  entidade: Entidade; itens: ItemLista[]; placeholder: string; ajuda?: string
}) {
  const [pend, iniciar] = useTransition()
  const [novo, setNovo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const adicionar = () => {
    const n = novo.trim(); if (!n) return
    setErro(null)
    iniciar(async () => {
      const r = await adicionarItem(entidade, n)
      if (r.ok) setNovo(''); else setErro(r.erro)
    })
  }

  return (
    <div style={{ maxWidth: 620 }}>
      <div className="flex" style={{ gap: 'var(--s-2)', marginBottom: 'var(--s-5)' }}>
        <input className="field" placeholder={placeholder} value={novo}
          onChange={e => setNovo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') adicionar() }}
          style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={adicionar} disabled={pend || !novo.trim()}>Adicionar</button>
      </div>
      {erro && <p className="t-sm" style={{ color: 'var(--serious)', marginBottom: 'var(--s-3)' }}>{erro}</p>}

      <div className="flex flex-col" style={{ gap: 'var(--s-2)', opacity: pend ? 0.6 : 1 }}>
        {itens.map(it => <Linha key={it.id} entidade={entidade} item={it} iniciar={iniciar} />)}
        {itens.length === 0 && <p className="t-sm muted">Nenhum item ainda.</p>}
      </div>
      {ajuda && <p className="t-xs muted" style={{ marginTop: 'var(--s-4)' }}>{ajuda}</p>}
    </div>
  )
}

function Linha({ entidade, item, iniciar }: {
  entidade: Entidade; item: ItemLista; iniciar: (fn: () => void) => void
}) {
  const [editando, setEditando] = useState(false)
  const [label, setLabel] = useState(item.label)

  const salvar = () => {
    const n = label.trim()
    if (n && n !== item.label) iniciar(() => { void renomearItem(entidade, item.id, n) })
    setEditando(false)
  }
  const remover = () => {
    if (confirm(`Remover "${item.label}"?`)) iniciar(() => { void removerItem(entidade, item.id) })
  }

  return (
    <div className="flex items-center" style={{ gap: 'var(--s-3)', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, opacity: item.ativo ? 1 : 0.55 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editando ? (
          <input className="field" value={label} autoFocus onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') { setLabel(item.label); setEditando(false) } }}
            onBlur={salvar} />
        ) : (
          <>
            <div style={{ fontWeight: 600 }} onDoubleClick={() => setEditando(true)}>{item.label}</div>
            {item.sub && <div className="t-xs muted" style={{ whiteSpace: 'normal' }}>{item.sub}</div>}
          </>
        )}
      </div>
      <button
        onClick={() => iniciar(() => { void alternarItem(entidade, item.id, !item.ativo) })}
        className="chip"
        style={{
          cursor: 'pointer', border: 'none',
          background: `color-mix(in srgb, ${item.ativo ? 'var(--series-3)' : 'var(--muted)'} 16%, transparent)`,
          color: item.ativo ? 'var(--series-3)' : 'var(--muted)',
        }}
      >
        {item.ativo ? 'Ativo' : 'Inativo'}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => setEditando(true)}>Renomear</button>
      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--serious)' }} onClick={remover}>Remover</button>
    </div>
  )
}
