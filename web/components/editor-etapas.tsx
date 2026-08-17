'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { adicionarEtapa, removerEtapa, salvarEtapas } from '@/lib/actions'
import type { Estagio } from '@/lib/estagios'

/* Editor das etapas: nome, cor, ordem — e adicionar/remover.
   Etapas de função fixa (Venda/Perdido/Nutrição) sustentam as regras do
   funil: podem ser movidas e renomeadas, mas não removidas nem trocadas
   de papel. Vêm marcadas com um selo do papel. */

function papelFixo(l: Estagio): string | null {
  if (l.won) return 'Venda'
  if (l.lost) return 'Perdido'
  if (l.nurture) return 'Nutrição'
  return null
}

function LinhaEtapa({ l, i, total, onCampo, onMover, onRemover }: {
  l: Estagio
  i?: number
  total?: number
  onCampo: (id: string, campo: keyof Estagio, valor: string) => void
  onMover: (id: string, dir: -1 | 1) => void
  onRemover: (id: string) => void
}) {
  const papel = papelFixo(l)
  const podeRemover = !papel
  return (
    <div className="ee-row">
      <span className="ee-swatch" style={{ background: l.cor }} />
      <div className="ee-nomewrap">
        <input className="field ee-nome" value={l.label} onChange={e => onCampo(l.id, 'label', e.target.value)} placeholder="Nome da etapa" />
        {papel && (
          <span className="ee-papel" title="Etapa de função fixa: dá para mover e renomear, mas não remover nem trocar a função.">
            <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="9" width="11" height="7.5" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>
            {papel}
          </span>
        )}
      </div>
      <input className="ee-cor" type="color" value={l.cor} onChange={e => onCampo(l.id, 'cor', e.target.value)} aria-label="Cor" />
      {i !== undefined && total !== undefined ? (
        <div className="ee-mover">
          <button className="ee-arrow" disabled={i === 0} onClick={() => onMover(l.id, -1)} aria-label="Subir">↑</button>
          <button className="ee-arrow" disabled={i === total - 1} onClick={() => onMover(l.id, 1)} aria-label="Descer">↓</button>
        </div>
      ) : (
        <span className="ee-mover" />
      )}
      {podeRemover ? (
        <button className="ee-del" onClick={() => onRemover(l.id)} aria-label="Remover etapa" title="Remover etapa">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h12M8 6V4h4v2M6 6l.7 9.5A1.5 1.5 0 0 0 8.2 17h3.6a1.5 1.5 0 0 0 1.5-1.5L14 6" /></svg>
        </button>
      ) : (
        <span className="ee-del" />
      )}
    </div>
  )
}

export function EditorEtapas({ estagios }: { estagios: Estagio[] }) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null)
  const [linhas, setLinhas] = useState<Estagio[]>(estagios)

  // após um add/remove + router.refresh(), reidrata do servidor
  useEffect(() => { setLinhas(estagios) }, [estagios])

  const [novoNome, setNovoNome] = useState('')
  const [novaCor, setNovaCor] = useState('#01aaaf')

  const board = linhas.filter(l => !l.noBoard)
  const fora = linhas.filter(l => l.noBoard)

  const setCampo = (id: string, campo: keyof Estagio, valor: string) =>
    setLinhas(ls => ls.map(l => (l.id === id ? { ...l, [campo]: valor } : l)))

  const mover = (id: string, dir: -1 | 1) => {
    setLinhas(ls => {
      const b = ls.filter(l => !l.noBoard).map(l => ({ ...l }))
      const i = b.findIndex(l => l.id === id)
      const j = i + dir
      if (j < 0 || j >= b.length) return ls
      ;[b[i], b[j]] = [b[j], b[i]]
      b.forEach((l, k) => (l.ordem = k + 1))
      const fb = ls.filter(l => l.noBoard).map((l, k) => ({ ...l, ordem: b.length + k + 1 }))
      return [...b, ...fb]
    })
  }

  const payload = () => linhas.map(l => ({ stage: l.id, label: l.label, color: l.cor, sort_order: l.ordem }))

  const salvar = () => {
    setMsg(null)
    start(async () => {
      const r = await salvarEtapas(payload())
      if (!r.ok) return setMsg({ ok: false, txt: r.erro })
      setMsg({ ok: true, txt: 'Etapas salvas.' })
      router.refresh()
    })
  }

  const adicionar = () => {
    if (!novoNome.trim()) return setMsg({ ok: false, txt: 'Dê um nome para a nova etapa.' })
    setMsg(null)
    start(async () => {
      await salvarEtapas(payload()) // preserva edições pendentes
      const r = await adicionarEtapa({ nome: novoNome, cor: novaCor })
      if (!r.ok) return setMsg({ ok: false, txt: r.erro })
      setNovoNome('')
      setMsg({ ok: true, txt: 'Etapa adicionada.' })
      router.refresh()
    })
  }

  const remover = (id: string) => {
    if (!confirm('Remover esta etapa? Isso não pode ser desfeito.')) return
    setMsg(null)
    start(async () => {
      const r = await removerEtapa(id)
      if (!r.ok) return setMsg({ ok: false, txt: r.erro })
      setMsg({ ok: true, txt: 'Etapa removida.' })
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--s-5)' }}>
      <div className="card" style={{ padding: 'var(--s-4)' }}>
        <div className="ee-head">
          <span />
          <span className="ct-lead-lbl">Nome</span>
          <span className="ct-lead-lbl" style={{ textAlign: 'center' }}>Cor</span>
          <span className="ct-lead-lbl" style={{ textAlign: 'center' }}>Ordem</span>
          <span />
        </div>
        {board.map((l, i) => (
          <LinhaEtapa key={l.id} l={l} i={i} total={board.length} onCampo={setCampo} onMover={mover} onRemover={remover} />
        ))}

        {/* adicionar nova etapa */}
        <div className="ee-row ee-add">
          <span className="ee-swatch" style={{ background: novaCor }} />
          <input className="field ee-nome" value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Nome da nova etapa…" onKeyDown={e => { if (e.key === 'Enter') adicionar() }} />
          <input className="ee-cor" type="color" value={novaCor} onChange={e => setNovaCor(e.target.value)} aria-label="Cor" />
          <button className="btn btn-ghost btn-sm" style={{ gridColumn: '4 / 6' }} disabled={pend} onClick={adicionar}>+ Adicionar</button>
        </div>
      </div>

      {fora.length > 0 && (
        <div className="card" style={{ padding: 'var(--s-4)' }}>
          <p className="ct-lead-lbl" style={{ marginBottom: 'var(--s-2)' }}>Estados fora do kanban</p>
          {fora.map(l => (
            <LinhaEtapa key={l.id} l={l} onCampo={setCampo} onMover={mover} onRemover={remover} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={pend} onClick={salvar}>{pend ? 'Salvando…' : 'Salvar alterações'}</button>
        {msg && <span className="t-sm" style={{ color: msg.ok ? 'var(--good)' : 'var(--critical)' }}>{msg.txt}</span>}
      </div>
    </div>
  )
}
