'use client'

import { useState, useTransition } from 'react'
import { salvarCamposCustom } from '@/lib/campos-actions'
import type { CampoComValor } from '@/lib/campos'

/* Bloco de campos personalizados dentro de um painel da ficha (Contato ou
   Empresa). Mostra os valores; "Editar campos" troca para inputs por tipo.
   Salva todos de uma vez (upsert). */
export function CamposCustom({ entityId, campos }: { entityId: string; campos: CampoComValor[] }) {
  const [edit, setEdit] = useState(false)
  const [vals, setVals] = useState<Record<number, string>>(
    () => Object.fromEntries(campos.map(c => [c.id, c.valor ?? ''])),
  )
  const [pend, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  if (campos.length === 0) return null

  const set = (id: number, v: string) => setVals(s => ({ ...s, [id]: v }))
  const salvar = () => {
    setErro(null)
    start(async () => {
      const r = await salvarCamposCustom(entityId, campos.map(c => ({ fieldId: c.id, valor: vals[c.id] ?? '' })))
      if (r.ok) setEdit(false); else setErro(r.erro)
    })
  }

  return (
    <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 'var(--s-3)', paddingTop: 'var(--s-3)' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--s-3)' }}>
        <span className="t-sm" style={{ fontWeight: 600, color: 'var(--ink-2)' }}>Informações adicionais</span>
        {!edit && (
          <button onClick={() => setEdit(true)} className="t-sm" style={{ color: 'var(--series-1)', fontWeight: 600 }}>Editar</button>
        )}
      </div>

      {edit ? (
        <div className="flex flex-col" style={{ gap: 'var(--s-3)' }}>
          {campos.map(c => (
            <label key={c.id} className="flex flex-col gap-1">
              <span className="t-sm" style={{ color: 'var(--ink-2)' }}>{c.label}</span>
              <EntradaCampo campo={c} valor={vals[c.id] ?? ''} onChange={v => set(c.id, v)} />
            </label>
          ))}
          {erro && <p className="t-sm" style={{ color: 'var(--critical)' }}>{erro}</p>}
          <div className="flex gap-2" style={{ marginTop: 'var(--s-1)' }}>
            <button className="btn btn-primary btn-sm" onClick={salvar} disabled={pend}>{pend ? 'Salvando…' : 'Salvar'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setVals(Object.fromEntries(campos.map(c => [c.id, c.valor ?? '']))); setEdit(false) }}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 'var(--s-3)' }}>
          {campos.map(c => (
            <div key={c.id} className="flex items-baseline justify-between gap-3">
              <span className="t-body shrink-0" style={{ color: 'var(--ink-muted)' }}>{c.label}</span>
              <span className="t-body text-right" style={{ color: 'var(--ink)', fontWeight: 600, wordBreak: 'break-word' }}>
                {formatar(c) || '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatar(c: CampoComValor): string {
  if (!c.valor) return ''
  if (c.field_type === 'boolean') return c.valor === 'true' ? 'Sim' : 'Não'
  return c.valor
}

function EntradaCampo({ campo, valor, onChange }: { campo: CampoComValor; valor: string; onChange: (v: string) => void }) {
  if (campo.field_type === 'select') {
    return (
      <select className="field" value={valor} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>
        {campo.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (campo.field_type === 'boolean') {
    return (
      <label className="flex items-center t-sm" style={{ gap: 6 }}>
        <input type="checkbox" checked={valor === 'true'} onChange={e => onChange(e.target.checked ? 'true' : 'false')} /> Sim
      </label>
    )
  }
  const tipo = campo.field_type === 'number' ? 'number' : campo.field_type === 'date' ? 'date' : 'text'
  return <input className="field" type={tipo} value={valor} onChange={e => onChange(e.target.value)} />
}
