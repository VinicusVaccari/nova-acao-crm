'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { aceitarConvite } from '@/lib/config-actions'

export function AceitarConvite({ token }: { token: string }) {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [pend, iniciar] = useTransition()

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    iniciar(async () => {
      const r = await aceitarConvite(token, nome, senha)
      if (r.ok) { setOk(true); setTimeout(() => router.push('/login'), 1400) }
      else setErro(r.erro)
    })
  }

  if (ok) return <p className="t-body" style={{ color: 'var(--series-3)' }}>✓ Acesso criado! Redirecionando para o login…</p>

  return (
    <form onSubmit={enviar} className="flex flex-col" style={{ gap: 12 }}>
      <input className="field" placeholder="Seu nome" value={nome} autoFocus onChange={e => setNome(e.target.value)} />
      <input className="field" type="password" placeholder="Senha (mín. 8 caracteres)" value={senha} onChange={e => setSenha(e.target.value)} />
      {erro && <p className="t-sm" style={{ color: 'var(--serious)' }}>{erro}</p>}
      <button className="btn btn-primary" disabled={pend || !nome.trim() || senha.length < 8}>
        {pend ? 'Criando…' : 'Criar acesso e entrar'}
      </button>
    </form>
  )
}
