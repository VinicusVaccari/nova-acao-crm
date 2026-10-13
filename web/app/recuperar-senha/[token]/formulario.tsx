'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { redefinirSenha } from '@/lib/recuperacao-actions'

export function FormularioNovaSenha({ token }: { token: string }) {
  const router = useRouter()
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()

  function enviar(form: FormData) {
    const senha = String(form.get('senha') ?? '')
    if (senha !== String(form.get('confirmacao') ?? '')) { setErro('As senhas não coincidem.'); return }
    setErro(null)
    iniciar(async () => {
      const resultado = await redefinirSenha(token, senha)
      if (resultado.ok) router.push('/login?redefinida=1')
      else setErro(resultado.erro)
    })
  }

  return <form action={enviar} className="flex flex-col gap-3">
    <label className="flex flex-col gap-1"><span className="campo-label">Nova senha</span><input name="senha" type="password" className="field" autoComplete="new-password" minLength={8} required /></label>
    <label className="flex flex-col gap-1"><span className="campo-label">Confirmar nova senha</span><input name="confirmacao" type="password" className="field" autoComplete="new-password" minLength={8} required /></label>
    {erro && <p className="t-sm" style={{ color: 'var(--critical)' }}>{erro}</p>}
    <button type="submit" className="btn btn-primary" disabled={pendente}>{pendente ? 'Salvando…' : 'Redefinir senha'}</button>
  </form>
}
