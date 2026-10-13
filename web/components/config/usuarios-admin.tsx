'use client'

import { useState, useTransition } from 'react'
import { Avatar } from '@/components/ui'
import { PAPEIS, papelLabel } from '@/lib/papeis'
import {
  atualizarUsuario, criarEquipe, renomearEquipe, removerEquipe,
  convidarUsuario, cancelarConvite,
} from '@/lib/config-actions'

type Usuario = {
  id: string; full_name: string | null; email: string | null
  role: string; is_active: boolean; lead_capacity: number; team_id: string | null
  avatar_url: string | null
}
type Equipe = { id: string; name: string }
type Convite = {
  id: string; email: string; role: string; team_id: string | null
  status: string; created_at: string; expires_at: string; token: string
}

const nomeEquipe = (equipes: Equipe[], id: string | null) =>
  id ? (equipes.find(e => e.id === id)?.name ?? '—') : '—'

function linkDoConvite(token: string) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/convite/${token}`
}

export function UsuariosAdmin({ usuarios, equipes, convites }: {
  usuarios: Usuario[]; equipes: Equipe[]; convites: Convite[]
}) {
  const [aba, setAba] = useState<'usuarios' | 'equipes' | 'convites'>('usuarios')

  const abas = [
    ['usuarios', `Usuários (${usuarios.length})`],
    ['equipes', `Equipes (${equipes.length})`],
    ['convites', `Convites (${convites.length})`],
  ] as const

  return (
    <div>
      <div className="flex" style={{ gap: 4, borderBottom: '1px solid var(--hairline)', marginBottom: 'var(--s-6)' }}>
        {abas.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className="t-sm"
            style={{
              padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
              fontWeight: aba === k ? 700 : 500,
              color: aba === k ? 'var(--brand-teal)' : 'var(--muted)',
              borderBottom: `2px solid ${aba === k ? 'var(--brand-teal)' : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {aba === 'usuarios' && <AbaUsuarios usuarios={usuarios} equipes={equipes} />}
      {aba === 'equipes' && <AbaEquipes equipes={equipes} usuarios={usuarios} />}
      {aba === 'convites' && <AbaConvites equipes={equipes} convites={convites} />}
    </div>
  )
}

/* ---------------- USUÁRIOS ---------------- */
function AbaUsuarios({ usuarios, equipes }: { usuarios: Usuario[]; equipes: Equipe[] }) {
  const [pend, iniciar] = useTransition()
  const salvar = (id: string, campos: Parameters<typeof atualizarUsuario>[1]) =>
    iniciar(() => { void atualizarUsuario(id, campos) })

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tbl" style={{ width: '100%', minWidth: 720 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Usuário</th>
            <th style={{ textAlign: 'left' }}>Papel</th>
            <th style={{ textAlign: 'left' }}>Equipe</th>
            <th style={{ textAlign: 'left' }}>Capacidade</th>
            <th style={{ textAlign: 'left' }}>Status</th>
          </tr>
        </thead>
        <tbody style={{ opacity: pend ? 0.6 : 1 }}>
          {usuarios.map(u => (
            <tr key={u.id}>
              <td>
                <div className="flex items-center" style={{ gap: 'var(--s-3)' }}>
                  <Avatar nome={u.full_name || u.email || '?'} src={u.avatar_url} tamanho={36} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{u.full_name || '—'}</div>
                    <div className="t-xs muted">{u.email}</div>
                  </div>
                </div>
              </td>
              <td>
                {u.role === 'ia' ? <span>Naia (IA)</span> : (
                  <select className="field" defaultValue={u.role} onChange={e => salvar(u.id, { role: e.target.value })} style={{ minWidth: 140 }}>
                    {PAPEIS.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
                  </select>
                )}
              </td>
              <td>
                {u.role === 'ia' ? '—' : (
                  <select className="field" defaultValue={u.team_id ?? ''} onChange={e => salvar(u.id, { team_id: e.target.value || null })} style={{ minWidth: 140 }}>
                    <option value="">— sem equipe —</option>
                    {equipes.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                )}
              </td>
              <td>
                {u.role === 'ia' ? '—' : (
                  <input
                    type="number" min={0} className="field" defaultValue={u.lead_capacity}
                    onBlur={e => { const n = Number(e.target.value); if (n !== u.lead_capacity) salvar(u.id, { lead_capacity: n }) }}
                    style={{ width: 76 }}
                  />
                )}
              </td>
              <td>
                {u.role === 'ia' ? <span className="chip">Perfil do sistema</span> : <button
                  onClick={() => salvar(u.id, { is_active: !u.is_active })}
                  className="chip"
                  style={{
                    cursor: 'pointer', border: 'none',
                    background: `color-mix(in srgb, ${u.is_active ? 'var(--series-3)' : 'var(--serious)'} 16%, transparent)`,
                    color: u.is_active ? 'var(--series-3)' : 'var(--serious)',
                  }}
                >
                  {u.is_active ? 'Ativo' : 'Inativo'}
                </button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-xs muted" style={{ marginTop: 'var(--s-4)' }}>
        As mudanças salvam na hora. Capacidade = quantos leads simultâneos o vendedor recebe no rodízio.
      </p>
    </div>
  )
}

/* ---------------- EQUIPES ---------------- */
function AbaEquipes({ equipes, usuarios }: { equipes: Equipe[]; usuarios: Usuario[] }) {
  const [pend, iniciar] = useTransition()
  const [nova, setNova] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const conta = (id: string) => usuarios.filter(u => u.team_id === id).length

  const adicionar = () => {
    const n = nova.trim()
    if (!n) return
    setErro(null)
    iniciar(async () => {
      const r = await criarEquipe(n)
      if (r.ok) setNova(''); else setErro(r.erro)
    })
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="flex" style={{ gap: 'var(--s-2)', marginBottom: 'var(--s-5)' }}>
        <input
          className="field" placeholder="Nome da nova equipe" value={nova}
          onChange={e => setNova(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') adicionar() }}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary" onClick={adicionar} disabled={pend || !nova.trim()}>Criar equipe</button>
      </div>
      {erro && <p className="t-sm" style={{ color: 'var(--serious)', marginBottom: 'var(--s-3)' }}>{erro}</p>}

      <div className="flex flex-col" style={{ gap: 'var(--s-2)', opacity: pend ? 0.6 : 1 }}>
        {equipes.map(e => <LinhaEquipe key={e.id} equipe={e} membros={conta(e.id)} iniciar={iniciar} />)}
        {equipes.length === 0 && <p className="t-sm muted">Nenhuma equipe ainda.</p>}
      </div>
    </div>
  )
}

function LinhaEquipe({ equipe, membros, iniciar }: {
  equipe: Equipe; membros: number; iniciar: (fn: () => void) => void
}) {
  const [editando, setEditando] = useState(false)
  const [nome, setNome] = useState(equipe.name)

  const salvar = () => {
    const n = nome.trim()
    if (n && n !== equipe.name) iniciar(() => { void renomearEquipe(equipe.id, n) })
    setEditando(false)
  }
  const remover = () => {
    if (confirm(`Remover a equipe "${equipe.name}"? Os membros ficam sem equipe.`)) {
      iniciar(() => { void removerEquipe(equipe.id) })
    }
  }

  return (
    <div className="flex items-center" style={{ gap: 'var(--s-3)', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10 }}>
      {editando ? (
        <input className="field" value={nome} autoFocus onChange={e => setNome(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') { setNome(equipe.name); setEditando(false) } }}
          onBlur={salvar} style={{ flex: 1 }} />
      ) : (
        <span style={{ flex: 1, fontWeight: 600 }} onDoubleClick={() => setEditando(true)}>{equipe.name}</span>
      )}
      <span className="t-xs muted">{membros} {membros === 1 ? 'membro' : 'membros'}</span>
      <button className="btn btn-ghost btn-sm" onClick={() => setEditando(true)}>Renomear</button>
      <button className="btn btn-ghost btn-sm" onClick={remover} style={{ color: 'var(--serious)' }}>Remover</button>
    </div>
  )
}

/* ---------------- CONVITES ---------------- */
function AbaConvites({ equipes, convites }: { equipes: Equipe[]; convites: Convite[] }) {
  const [pend, iniciar] = useTransition()
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<string>('vendedor')
  const [equipe, setEquipe] = useState<string>('')
  const [erro, setErro] = useState<string | null>(null)
  const [novoLink, setNovoLink] = useState<string | null>(null)
  const [novoEnviado, setNovoEnviado] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)

  const copiar = (texto: string, id: string) => {
    void navigator.clipboard.writeText(texto)
    setCopiado(id); setTimeout(() => setCopiado(null), 1500)
  }

  const convidar = () => {
    setErro(null); setNovoLink(null)
    iniciar(async () => {
      const r = await convidarUsuario(email, papel, equipe || null)
      if (r.ok) { setNovoLink(r.link); setNovoEnviado(r.enviado); setEmail('') } else setErro(r.erro)
    })
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ padding: 'var(--s-5)', border: '1px solid var(--hairline)', borderRadius: 12, marginBottom: 'var(--s-6)' }}>
        <div style={{ fontWeight: 700, marginBottom: 'var(--s-4)' }}>Convidar usuário</div>
        <div className="flex" style={{ gap: 'var(--s-2)', flexWrap: 'wrap' }}>
          <input className="field" type="email" placeholder="email@empresa.com" value={email}
            onChange={e => setEmail(e.target.value)} style={{ flex: '1 1 220px' }} />
          <select className="field" value={papel} onChange={e => setPapel(e.target.value)}>
            {PAPEIS.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
          <select className="field" value={equipe} onChange={e => setEquipe(e.target.value)}>
            <option value="">— sem equipe —</option>
            {equipes.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button className="btn btn-primary" onClick={convidar} disabled={pend || !email.trim()}>Convidar</button>
        </div>
        {erro && <p className="t-sm" style={{ color: 'var(--serious)', marginTop: 'var(--s-3)' }}>{erro}</p>}
        {novoLink && (
          <div style={{ marginTop: 'var(--s-4)', padding: 'var(--s-3)', borderRadius: 8, background: 'color-mix(in srgb, var(--brand-teal) 10%, transparent)' }}>
            <p className="t-xs muted" style={{ marginBottom: 4 }}>
              {novoEnviado
                ? '✓ Convite enviado por e-mail. Link também disponível abaixo:'
                : 'Convite criado (e-mail ainda não configurado — Resend). Copie o link:'}
            </p>
            <div className="flex items-center" style={{ gap: 'var(--s-2)' }}>
              <input className="field" readOnly value={novoLink} style={{ flex: 1 }} />
              <button className="btn btn-ghost btn-sm" onClick={() => copiar(novoLink, 'novo')}>
                {copiado === 'novo' ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ fontWeight: 700, marginBottom: 'var(--s-3)' }}>Convites pendentes</div>
      <div className="flex flex-col" style={{ gap: 'var(--s-2)', opacity: pend ? 0.6 : 1 }}>
        {convites.map(c => (
          <div key={c.id} className="flex items-center" style={{ gap: 'var(--s-3)', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{c.email}</div>
              <div className="t-xs muted">
                {papelLabel(c.role)} · {nomeEquipe(equipes, c.team_id)} · expira {new Date(c.expires_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => copiar(linkDoConvite(c.token), c.id)}>
              {copiado === c.id ? 'Copiado!' : 'Copiar link'}
            </button>
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--serious)' }}
              onClick={() => iniciar(() => { void cancelarConvite(c.id) })}>Cancelar</button>
          </div>
        ))}
        {convites.length === 0 && <p className="t-sm muted">Nenhum convite pendente.</p>}
      </div>
    </div>
  )
}
