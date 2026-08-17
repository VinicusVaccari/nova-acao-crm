'use client'

import { useState, useTransition } from 'react'
import {
  criarCampo, alternarCampo, removerCampo,
  type EntidadeCampo, type TipoCampo,
} from '@/lib/config-campos'

type Campo = {
  id: number; entity: string; key: string; label: string
  field_type: string; options: string[]; required: boolean; active: boolean
}

const ENTIDADES: { v: EntidadeCampo; label: string }[] = [
  { v: 'deal', label: 'Negócios' },
  { v: 'company', label: 'Empresas' },
  { v: 'contact', label: 'Contatos' },
]
const TIPOS: { v: TipoCampo; label: string }[] = [
  { v: 'text', label: 'Texto' },
  { v: 'number', label: 'Número' },
  { v: 'date', label: 'Data' },
  { v: 'select', label: 'Seleção' },
  { v: 'boolean', label: 'Sim/Não' },
]
const tipoLabel = (v: string) => TIPOS.find(t => t.v === v)?.label ?? v

export function CamposAdmin({ campos }: { campos: Campo[] }) {
  const [aba, setAba] = useState<EntidadeCampo>('deal')
  const daAba = campos.filter(c => c.entity === aba)

  return (
    <div>
      <div className="flex" style={{ gap: 4, borderBottom: '1px solid var(--hairline)', marginBottom: 'var(--s-5)' }}>
        {ENTIDADES.map(e => (
          <button key={e.v} onClick={() => setAba(e.v)} className="t-sm"
            style={{
              padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
              fontWeight: aba === e.v ? 700 : 500, color: aba === e.v ? 'var(--brand-teal)' : 'var(--muted)',
              borderBottom: `2px solid ${aba === e.v ? 'var(--brand-teal)' : 'transparent'}`, marginBottom: -1,
            }}>
            {e.label} ({campos.filter(c => c.entity === e.v).length})
          </button>
        ))}
      </div>

      <NovoCampo entity={aba} />
      <ListaCampos campos={daAba} />
    </div>
  )
}

function NovoCampo({ entity }: { entity: EntidadeCampo }) {
  const [pend, iniciar] = useTransition()
  const [label, setLabel] = useState('')
  const [tipo, setTipo] = useState<TipoCampo>('text')
  const [opcoes, setOpcoes] = useState('')
  const [obrig, setObrig] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const criar = () => {
    setErro(null)
    const opts = opcoes.split('\n').map(o => o.trim()).filter(Boolean)
    iniciar(async () => {
      const r = await criarCampo(entity, label, tipo, opts, obrig)
      if (r.ok) { setLabel(''); setOpcoes(''); setTipo('text'); setObrig(false) } else setErro(r.erro)
    })
  }

  return (
    <div style={{ padding: 'var(--s-5)', border: '1px solid var(--hairline)', borderRadius: 12, marginBottom: 'var(--s-6)', maxWidth: 640 }}>
      <div style={{ fontWeight: 700, marginBottom: 'var(--s-4)' }}>Novo campo</div>
      <div className="flex" style={{ gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="field" placeholder="Nome do campo (ex.: Nicho)" value={label}
          onChange={e => setLabel(e.target.value)} style={{ flex: '1 1 220px' }} />
        <select className="field" value={tipo} onChange={e => setTipo(e.target.value as TipoCampo)}>
          {TIPOS.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
        <label className="flex items-center t-sm" style={{ gap: 6 }}>
          <input type="checkbox" checked={obrig} onChange={e => setObrig(e.target.checked)} /> Obrigatório
        </label>
      </div>
      {tipo === 'select' && (
        <textarea className="field" placeholder="Uma opção por linha" value={opcoes}
          onChange={e => setOpcoes(e.target.value)} rows={3} style={{ marginTop: 'var(--s-3)', width: '100%' }} />
      )}
      {erro && <p className="t-sm" style={{ color: 'var(--serious)', marginTop: 'var(--s-3)' }}>{erro}</p>}
      <button className="btn btn-primary" onClick={criar} disabled={pend || !label.trim()} style={{ marginTop: 'var(--s-4)' }}>
        Adicionar campo
      </button>
    </div>
  )
}

function ListaCampos({ campos }: { campos: Campo[] }) {
  const [pend, iniciar] = useTransition()
  const remover = (c: Campo) => { if (confirm(`Remover o campo "${c.label}"?`)) iniciar(() => { void removerCampo(c.id) }) }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--s-2)', maxWidth: 640, opacity: pend ? 0.6 : 1 }}>
      {campos.map(c => (
        <div key={c.id} className="flex items-center" style={{ gap: 'var(--s-3)', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, opacity: c.active ? 1 : 0.55 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>
              {c.label}{c.required && <span style={{ color: 'var(--serious)' }}> *</span>}
            </div>
            <div className="t-xs muted">
              {tipoLabel(c.field_type)}
              {c.field_type === 'select' && c.options.length > 0 ? ` · ${c.options.join(', ')}` : ''}
            </div>
          </div>
          <button onClick={() => iniciar(() => { void alternarCampo(c.id, !c.active) })} className="chip"
            style={{ cursor: 'pointer', border: 'none', background: `color-mix(in srgb, ${c.active ? 'var(--series-3)' : 'var(--muted)'} 16%, transparent)`, color: c.active ? 'var(--series-3)' : 'var(--muted)' }}>
            {c.active ? 'Ativo' : 'Inativo'}
          </button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--serious)' }} onClick={() => remover(c)}>Remover</button>
        </div>
      ))}
      {campos.length === 0 && <p className="t-sm muted">Nenhum campo personalizado ainda.</p>}
    </div>
  )
}
