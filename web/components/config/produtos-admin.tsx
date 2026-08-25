'use client'

import { useState, useTransition } from 'react'
import {
  adicionarItem, renomearItem, alternarItem, removerItem, atualizarPrecoProduto,
} from '@/lib/config-listas'

type Produto = {
  id: string
  name: string
  active: boolean
  default_price: number | null
  recurrence: string
}

export function ProdutosAdmin({ produtos }: { produtos: Produto[] }) {
  const [pend, iniciar] = useTransition()
  const [novo, setNovo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const adicionar = () => {
    const n = novo.trim(); if (!n) return
    setErro(null)
    iniciar(async () => { const r = await adicionarItem('products', n); if (r.ok) setNovo(''); else setErro(r.erro) })
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="flex" style={{ gap: 'var(--s-2)', marginBottom: 'var(--s-5)' }}>
        <input className="field" placeholder="Novo produto/serviço (ex.: Consultoria)" value={novo}
          onChange={e => setNovo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') adicionar() }} style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={adicionar} disabled={pend || !novo.trim()}>Adicionar</button>
      </div>
      {erro && <p className="t-sm" style={{ color: 'var(--serious)', marginBottom: 'var(--s-3)' }}>{erro}</p>}

      <div className="flex flex-col" style={{ gap: 'var(--s-2)', opacity: pend ? 0.6 : 1 }}>
        {produtos.map(p => <LinhaProduto key={p.id} p={p} iniciar={iniciar} />)}
        {produtos.length === 0 && <p className="t-sm muted">Nenhum produto ainda.</p>}
      </div>
      <p className="t-xs muted" style={{ marginTop: 'var(--s-4)' }}>
        O preço definido aqui é o <b>padrão</b> — ao adicionar o produto num negócio (pelo sistema ou pela Naia), ele já sobe com esse valor. Dá pra editar o valor por negócio sem mudar o catálogo.
      </p>
    </div>
  )
}

function LinhaProduto({ p, iniciar }: { p: Produto; iniciar: (fn: () => void) => void }) {
  const [editando, setEditando] = useState(false)
  const [nome, setNome] = useState(p.name)
  const [preco, setPreco] = useState(p.default_price != null ? String(p.default_price) : '')
  const [rec, setRec] = useState(p.recurrence === 'mensal' ? 'mensal' : 'unico')

  const salvarNome = () => {
    const n = nome.trim()
    if (n && n !== p.name) iniciar(() => { void renomearItem('products', p.id, n) })
    setEditando(false)
  }
  const salvarPreco = () => {
    const v = preco.trim() === '' ? null : Number(preco.replace(',', '.'))
    iniciar(() => { void atualizarPrecoProduto(p.id, { default_price: v, recurrence: rec }) })
  }
  const mudarRec = (r: string) => {
    setRec(r)
    const v = preco.trim() === '' ? null : Number(preco.replace(',', '.'))
    iniciar(() => { void atualizarPrecoProduto(p.id, { default_price: v, recurrence: r }) })
  }
  const remover = () => { if (confirm(`Remover "${p.name}"?`)) iniciar(() => { void removerItem('products', p.id) }) }

  return (
    <div className="flex items-center" style={{ gap: 'var(--s-3)', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, opacity: p.active ? 1 : 0.55, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        {editando ? (
          <input className="field" value={nome} autoFocus onChange={e => setNome(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') salvarNome(); if (e.key === 'Escape') { setNome(p.name); setEditando(false) } }}
            onBlur={salvarNome} />
        ) : (
          <span style={{ fontWeight: 600 }} onDoubleClick={() => setEditando(true)}>{p.name}</span>
        )}
      </div>

      <div className="flex items-center" style={{ gap: 6 }}>
        <span className="t-xs muted">R$</span>
        <input className="field" type="number" min={0} step="0.01" value={preco} placeholder="0,00"
          onChange={e => setPreco(e.target.value)} onBlur={salvarPreco} style={{ width: 110 }} />
      </div>

      <select className="field" value={rec} onChange={e => mudarRec(e.target.value)} style={{ width: 110 }}>
        <option value="unico">Único</option>
        <option value="mensal">Mensal</option>
      </select>

      <button onClick={() => iniciar(() => { void alternarItem('products', p.id, !p.active) })} className="chip"
        style={{ cursor: 'pointer', border: 'none', background: `color-mix(in srgb, ${p.active ? 'var(--series-3)' : 'var(--muted)'} 16%, transparent)`, color: p.active ? 'var(--series-3)' : 'var(--muted)' }}>
        {p.active ? 'Ativo' : 'Inativo'}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => setEditando(true)}>Renomear</button>
      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--serious)' }} onClick={remover}>Remover</button>
    </div>
  )
}
