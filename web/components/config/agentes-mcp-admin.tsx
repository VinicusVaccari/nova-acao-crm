'use client'

import { useState, useTransition } from 'react'
import { criarChaveAgente, revogarChaveAgente } from '@/lib/mcp-actions'

type Chave = {
  id: string
  agent_name: string
  is_active: boolean
  created_at: string
  revoked_at: string | null
  last_used_at: string | null
  expires_at: string
}

function textoExpiracao(expiresAt: string) {
  const dias = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000)
  if (dias < 0) return `Expirada há ${Math.abs(dias)} dias`
  return `Expira em ${dias} dias`
}

export function AgentesMcpAdmin({ chaves }: { chaves: Chave[] }) {
  const [nome, setNome] = useState('')
  const [segredo, setSegredo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()

  const criar = () => {
    setErro(null); setSegredo(null)
    iniciar(async () => {
      const resultado = await criarChaveAgente(nome)
      if (!resultado.ok) { setErro(resultado.erro); return }
      setSegredo(resultado.segredo ?? null)
      setNome('')
    })
  }
  const revogar = (id: string) => {
    if (!confirm('Revogar esta chave? O agente perderá acesso imediatamente.')) return
    iniciar(async () => {
      const resultado = await revogarChaveAgente(id)
      if (!resultado.ok) setErro(resultado.erro)
    })
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ padding: 'var(--s-5)', border: '1px solid var(--hairline)', borderRadius: 12, marginBottom: 'var(--s-6)' }}>
        <h1 className="t-h2" style={{ marginBottom: 'var(--s-2)' }}>Agentes MCP</h1>
        <p className="t-sm muted" style={{ marginBottom: 'var(--s-4)' }}>Cada chave é de somente leitura e pode ser revogada individualmente.</p>
        <div className="flex" style={{ gap: 'var(--s-2)' }}>
          <input className="field" value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do agente" style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={criar} disabled={pendente || !nome.trim()}>Criar chave</button>
        </div>
        {erro && <p className="t-sm" style={{ color: 'var(--serious)', marginTop: 'var(--s-3)' }}>{erro}</p>}
        {segredo && <div style={{ marginTop: 'var(--s-4)', padding: 'var(--s-3)', borderRadius: 8, background: 'color-mix(in srgb, var(--brand-teal) 10%, transparent)' }}>
          <div className="t-sm" style={{ fontWeight: 700 }}>Copie agora: esta chave não será exibida novamente.</div>
          <code className="t-xs" style={{ display: 'block', overflowWrap: 'anywhere', marginTop: 8 }}>{segredo}</code>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => void navigator.clipboard.writeText(segredo)}>Copiar chave</button>
        </div>}
      </div>

      <div style={{ overflowX: 'auto', opacity: pendente ? 0.6 : 1 }}>
        <table className="tbl" style={{ width: '100%', minWidth: 680 }}>
          <thead><tr><th>Agente</th><th>Status</th><th>Expiração</th><th>Último uso</th><th /></tr></thead>
          <tbody>
            {chaves.map(chave => <tr key={chave.id}>
              <td><div style={{ fontWeight: 600 }}>{chave.agent_name}</div><div className="t-xs muted">Criada em {new Date(chave.created_at).toLocaleString('pt-BR')}</div></td>
              <td><span className="chip">{chave.is_active ? 'Ativa' : 'Revogada'}</span></td>
              <td style={{ color: Math.ceil((new Date(chave.expires_at).getTime() - Date.now()) / 86_400_000) <= 14 ? 'var(--serious)' : undefined, fontWeight: Math.ceil((new Date(chave.expires_at).getTime() - Date.now()) / 86_400_000) <= 14 ? 600 : undefined }}>{textoExpiracao(chave.expires_at)}</td>
              <td>{chave.last_used_at ? new Date(chave.last_used_at).toLocaleString('pt-BR') : 'Nunca'}</td>
              <td>{chave.is_active && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--serious)' }} onClick={() => revogar(chave.id)}>Revogar</button>}</td>
            </tr>)}
            {chaves.length === 0 && <tr><td colSpan={5} className="muted">Nenhuma chave criada.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
