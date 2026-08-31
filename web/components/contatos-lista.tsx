'use client'

import { useMemo, useState } from 'react'
import { Avatar } from '@/components/ui'

export type ContatoRow = {
  id: string
  nome: string
  email_primary: string | null
  phone_primary: string | null
  cargo: string | null
  empresa: string | null
  negociacoes: number
  ultimo_contato: string | null
  responsavel_nome: string | null
  responsavel_avatar: string | null
}

type Ordem = 'nome' | 'empresa' | 'negociacoes' | 'ultimo_contato'

function dataContato(iso: string | null): string {
  if (!iso) return 'Não realizado'
  const d = new Date(iso)
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

export function ContatosLista({ contatos }: { contatos: ContatoRow[] }) {
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<Ordem>('nome')
  const [asc, setAsc] = useState(true)

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const arr = contatos.filter(c =>
      !q || [c.nome, c.empresa, c.email_primary, c.phone_primary, c.cargo, c.responsavel_nome].filter(Boolean).join(' ').toLowerCase().includes(q),
    )
    const dir = asc ? 1 : -1
    return [...arr].sort((a, b) => {
      if (ordem === 'nome') return a.nome.localeCompare(b.nome) * dir
      if (ordem === 'empresa') return (a.empresa ?? '').localeCompare(b.empresa ?? '') * dir
      if (ordem === 'negociacoes') return (a.negociacoes - b.negociacoes) * dir
      const ta = a.ultimo_contato ? new Date(a.ultimo_contato).getTime() : 0
      const tb = b.ultimo_contato ? new Date(b.ultimo_contato).getTime() : 0
      return (ta - tb) * dir
    })
  }, [contatos, busca, ordem, asc])

  const sortar = (col: Ordem) => {
    if (ordem === col) setAsc(v => !v)
    else { setOrdem(col); setAsc(col === 'nome' || col === 'empresa') }
  }
  const seta = (col: Ordem) => (ordem === col ? (asc ? ' ▲' : ' ▼') : '')

  const exportarCsv = () => {
    const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`
    const cab = ['Nome', 'Cargo', 'Empresa', 'E-mail', 'Telefone', 'Negociações', 'Último contato', 'Responsável']
    const linhas = filtrados.map(c => [
      c.nome, c.cargo ?? '', c.empresa ?? '', c.email_primary ?? '', c.phone_primary ?? '',
      String(c.negociacoes),
      c.ultimo_contato ? dataContato(c.ultimo_contato) : '',
      c.responsavel_nome ?? '',
    ].map(esc).join(';'))
    const csv = '﻿' + [cab.map(esc).join(';'), ...linhas].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `contatos-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4" style={{ marginBottom: 'var(--s-5)' }}>
        <div>
          <h1 className="t-h1">Contatos</h1>
          <p className="t-sm muted" style={{ marginTop: 2 }}>{contatos.length} contatos</p>
        </div>
        <button className="btn btn-ghost" onClick={exportarCsv} disabled={filtrados.length === 0}>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 15.5h12" /></svg>
          Exportar
        </button>
      </div>

      <div className="flex items-center gap-2" style={{ marginBottom: 'var(--s-4)' }}>
        <input
          className="field"
          style={{ maxWidth: 340 }}
          placeholder="Buscar nome, empresa, e-mail, telefone…"
          value={busca}
          onChange={e => setBusca(e.target.value)}
        />
        {busca && <span className="t-sm muted">{filtrados.length} resultado(s)</span>}
      </div>

      <div className="card" style={{ padding: 'var(--s-4) var(--s-5)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <Th onClick={() => sortar('nome')}>CONTATO{seta('nome')}</Th>
                <Th onClick={() => sortar('empresa')}>EMPRESA{seta('empresa')}</Th>
                <Th>E-MAIL</Th>
                <Th>TELEFONE</Th>
                <Th>RESPONSÁVEL</Th>
                <Th onClick={() => sortar('negociacoes')}>NEGOCIAÇÕES{seta('negociacoes')}</Th>
                <Th onClick={() => sortar('ultimo_contato')}>ÚLTIMO CONTATO{seta('ultimo_contato')}</Th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>
                    <span className="flex items-center gap-2">
                      <Avatar nome={c.nome} tamanho={28} />
                      <span>
                        {c.nome}
                        {c.cargo && <span className="t-xs muted" style={{ display: 'block', fontWeight: 400 }}>{c.cargo}</span>}
                      </span>
                    </span>
                  </td>
                  <td>{c.empresa || <span className="muted">—</span>}</td>
                  <td className="t-sm">{c.email_primary || <span className="muted">—</span>}</td>
                  <td className="t-sm tabular">{c.phone_primary || <span className="muted">—</span>}</td>
                  <td>
                    {c.responsavel_nome ? (
                      <span className="flex items-center gap-2">
                        <Avatar nome={c.responsavel_nome} src={c.responsavel_avatar} tamanho={24} />
                        <span className="t-sm truncate">{c.responsavel_nome}</span>
                      </span>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td className="tabular">{c.negociacoes > 0 ? c.negociacoes : <span className="muted">–</span>}</td>
                  <td className="t-sm" style={{ color: c.ultimo_contato ? 'var(--ink)' : 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
                    {dataContato(c.ultimo_contato)}
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 'var(--s-6)' }}>Nenhum contato encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <th onClick={onClick} style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  )
}
