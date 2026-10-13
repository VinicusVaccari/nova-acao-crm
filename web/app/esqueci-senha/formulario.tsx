'use client'

import { useState, useTransition } from 'react'
import { solicitarRecuperacaoSenha } from '@/lib/recuperacao-actions'

export function FormularioRecuperacaoSenha() {
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()

  function enviar(form: FormData) {
    setErro(null)
    iniciar(async () => {
      const resultado = await solicitarRecuperacaoSenha(String(form.get('email') ?? ''))
      if (resultado.ok) setMensagem(resultado.mensagem)
      else setErro(resultado.erro)
    })
  }

  if (mensagem) return <p className="t-body" style={{ color: 'var(--ink-muted)' }}>{mensagem}</p>

  return (
    <form action={enviar} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1"><span className="campo-label">E-mail</span><input name="email" type="email" className="field" autoComplete="email" required /></label>
      {erro && <p className="t-sm" style={{ color: 'var(--critical)' }}>{erro}</p>}
      <button type="submit" className="btn btn-primary" disabled={pendente}>{pendente ? 'Enviando…' : 'Enviar link'}</button>
    </form>
  )
}
