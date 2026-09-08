'use client'

import { csvCell } from '@/lib/security/policy'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui'
import { Drawer } from '@/components/drawer'
import { criarEmpresa } from '@/lib/empresas-actions'
import { SegmentoSelect } from '@/components/segmento-select'

export type EmpresaRow = {
  id: string
  nome: string
  segment: string | null
  city: string | null
  state: string | null
  negociacoes: number
  ultimo_contato: string | null
  responsavel_nome: string | null
  responsavel_avatar: string | null
}

type Ordem = 'nome' | 'negociacoes' | 'ultimo_contato'

function dataContato(iso: string | null): string {
  if (!iso) return 'Não realizado'
  const d = new Date(iso)
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

export function EmpresasLista({ empresas, segmentos = [] }: { empresas: EmpresaRow[]; segmentos?: string[] }) {
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<Ordem>('nome')
  const [asc, setAsc] = useState(true)
  const [criar, setCriar] = useState(false)

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const arr = empresas.filter(e =>
      !q || [e.nome, e.segment, e.responsavel_nome].filter(Boolean).join(' ').toLowerCase().includes(q),
    )
    const dir = asc ? 1 : -1
    return [...arr].sort((a, b) => {
      if (ordem === 'nome') return a.nome.localeCompare(b.nome) * dir
      if (ordem === 'negociacoes') return (a.negociacoes - b.negociacoes) * dir
      const ta = a.ultimo_contato ? new Date(a.ultimo_contato).getTime() : 0
      const tb = b.ultimo_contato ? new Date(b.ultimo_contato).getTime() : 0
      return (ta - tb) * dir
    })
  }, [empresas, busca, ordem, asc])

  const sortar = (col: Ordem) => {
    if (ordem === col) setAsc(v => !v)
    else { setOrdem(col); setAsc(col === 'nome') }
  }
  const seta = (col: Ordem) => (ordem === col ? (asc ? ' ▲' : ' ▼') : '')

  const exportarCsv = () => {
    const esc = csvCell
    const cab = ['Empresa', 'Segmento', 'Cidade', 'UF', 'Negociações', 'Último contato', 'Responsável']
    const linhas = filtradas.map(e => [
      e.nome, e.segment ?? '', e.city ?? '', e.state ?? '',
      String(e.negociacoes),
      e.ultimo_contato ? dataContato(e.ultimo_contato) : '',
      e.responsavel_nome ?? '',
    ].map(esc).join(';'))
    // BOM (﻿) para acentos no Excel; ';' = separador padrão do Excel pt-BR
    const csv = '﻿' + [cab.map(esc).join(';'), ...linhas].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `empresas-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      {/* cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-4" style={{ marginBottom: 'var(--s-5)' }}>
        <div>
          <h1 className="t-h1">Empresas</h1>
          <p className="t-sm muted" style={{ marginTop: 2 }}>{empresas.length} empresas</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost" onClick={exportarCsv} disabled={filtradas.length === 0}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 15.5h12" /></svg>
            Exportar
          </button>
          <button className="btn btn-primary" onClick={() => setCriar(true)}>Criar empresa</button>
        </div>
      </div>

      {/* busca */}
      <div className="flex items-center gap-2" style={{ marginBottom: 'var(--s-4)' }}>
        <input
          className="field"
          style={{ maxWidth: 320 }}
          placeholder="Buscar empresa, segmento ou responsável…"
          value={busca}
          onChange={e => setBusca(e.target.value)}
        />
        {busca && <span className="t-sm muted">{filtradas.length} resultado(s)</span>}
      </div>

      {/* tabela */}
      <div className="card" style={{ padding: 'var(--s-4) var(--s-5)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <Th onClick={() => sortar('nome')}>EMPRESAS{seta('nome')}</Th>
                <Th>RESPONSÁVEL</Th>
                <Th>SEGMENTO</Th>
                <Th onClick={() => sortar('negociacoes')}>NEGOCIAÇÕES{seta('negociacoes')}</Th>
                <Th onClick={() => sortar('ultimo_contato')}>ÚLTIMO CONTATO{seta('ultimo_contato')}</Th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(e => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 600 }}>
                    {e.nome}
                    {(e.city || e.state) && (
                      <span className="t-xs muted" style={{ display: 'block', fontWeight: 400 }}>
                        {[e.city, e.state].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </td>
                  <td>
                    {e.responsavel_nome ? (
                      <span className="flex items-center gap-2">
                        <Avatar nome={e.responsavel_nome} src={e.responsavel_avatar} tamanho={26} />
                        <span className="t-sm truncate">{e.responsavel_nome}</span>
                      </span>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>{e.segment || <span className="muted">—</span>}</td>
                  <td className="tabular">{e.negociacoes > 0 ? e.negociacoes : <span className="muted">–</span>}</td>
                  <td className="t-sm" style={{ color: e.ultimo_contato ? 'var(--ink)' : 'var(--ink-muted)' }}>
                    {dataContato(e.ultimo_contato)}
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 'var(--s-6)' }}>Nenhuma empresa encontrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {criar && <DrawerCriar segmentos={segmentos} onClose={() => setCriar(false)} />}
    </div>
  )
}

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <th
      onClick={onClick}
      style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {children}
    </th>
  )
}

function DrawerCriar({ segmentos, onClose }: { segmentos: string[]; onClose: () => void }) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [f, setF] = useState({ trade_name: '', segment: '', city: '', state: '', website: '' })
  const set = (p: Partial<typeof f>) => setF(v => ({ ...v, ...p }))

  const salvar = () => {
    setErro(null)
    start(async () => {
      const r = await criarEmpresa(f)
      if (r.ok) { onClose(); router.refresh() } else setErro(r.erro)
    })
  }

  return (
    <Drawer
      titulo="Nova empresa"
      aberto
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={pend || !f.trade_name.trim()}>{pend ? 'Salvando…' : 'Criar empresa'}</button>
        </>
      }
    >
      <div className="flex flex-col" style={{ gap: 'var(--s-4)' }}>
        <label className="flex flex-col gap-1">
          <span className="campo-label">Nome da empresa *</span>
          <input className="field" value={f.trade_name} onChange={e => set({ trade_name: e.target.value })} autoFocus />
        </label>
        <div className="flex flex-col gap-1">
          <span className="campo-label">Segmento</span>
          <SegmentoSelect segmentos={segmentos} value={f.segment} onChange={v => set({ segment: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span className="campo-label">Cidade</span><input className="field" value={f.city} onChange={e => set({ city: e.target.value })} /></label>
          <label className="flex flex-col gap-1"><span className="campo-label">UF</span><input className="field" value={f.state} onChange={e => set({ state: e.target.value })} maxLength={2} /></label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="campo-label">Site</span>
          <input className="field" value={f.website} onChange={e => set({ website: e.target.value })} placeholder="https://…" />
        </label>
        {erro && <p className="t-sm" style={{ color: 'var(--critical)' }}>{erro}</p>}
      </div>
    </Drawer>
  )
}
