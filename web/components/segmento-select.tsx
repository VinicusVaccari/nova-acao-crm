'use client'

import { useState, useTransition } from 'react'
import { criarSegmento } from '@/lib/empresas-actions'

/* Seletor de SEGMENTO: escolhe um da lista gerenciada OU cria um novo.
   Nunca texto livre solto. Funciona controlado (value/onChange, ex.: drawer)
   e também dentro de um <form> (via `name`, o <select> envia o valor). */
export function SegmentoSelect({
  name,
  segmentos,
  value,
  defaultValue,
  onChange,
}: {
  name?: string
  segmentos: string[]
  value?: string
  defaultValue?: string
  onChange?: (v: string) => void
}) {
  const [lista, setLista] = useState<string[]>(segmentos)
  const [val, setVal] = useState<string>(value ?? defaultValue ?? '')
  const [criando, setCriando] = useState(false)
  const [novo, setNovo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()

  const atual = value ?? val
  const setar = (v: string) => { setVal(v); onChange?.(v) }

  const criar = () => {
    const n = novo.trim()
    if (!n) return
    setErro(null)
    start(async () => {
      const r = await criarSegmento(n)
      if (!r.ok) { setErro(r.erro); return }
      setLista(l => (l.includes(r.name) ? l : [...l, r.name].sort((a, b) => a.localeCompare(b))))
      setar(r.name)
      setCriando(false)
      setNovo('')
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {/* o select envia o valor no form (name); quando "criar", o próprio val já foi setado */}
      <select
        name={name}
        className="field"
        value={atual}
        onChange={e => {
          if (e.target.value === '__novo__') { setCriando(true); return }
          setCriando(false)
          setar(e.target.value)
        }}
      >
        <option value="">— sem segmento —</option>
        {lista.map(s => <option key={s} value={s}>{s}</option>)}
        <option value="__novo__">+ Criar novo segmento…</option>
      </select>

      {criando && (
        <div className="flex items-center gap-2">
          <input
            className="field"
            placeholder="Nome do novo segmento"
            value={novo}
            onChange={e => setNovo(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); criar() } }}
            autoFocus
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={criar} disabled={pend || !novo.trim()}>{pend ? '…' : 'Criar'}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCriando(false); setNovo(''); setErro(null) }}>Cancelar</button>
        </div>
      )}
      {erro && <span className="t-sm" style={{ color: 'var(--critical)' }}>{erro}</span>}
    </div>
  )
}
