'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { safeRedirect } from '@/lib/security/policy'
import { IconeAlerta } from '@/components/icones'

export function FormularioLogin() {
  const router = useRouter()
  const params = useSearchParams()
  const destino = safeRedirect(params.get('destino'))

  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function entrar(fd: FormData) {
    setCarregando(true)
    setErro(null)

    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { error } = await sb.auth.signInWithPassword({
      email: String(fd.get('email')).trim(),
      password: String(fd.get('senha')),
    })

    if (error) {
      setErro(
        error.message === 'Invalid login credentials'
          ? 'E-mail ou senha incorretos.'
          : error.message
      )
      setCarregando(false)
      return
    }

    router.push(destino)
    router.refresh()
  }

  return (
    <form action={entrar} className="flex flex-col" style={{ gap: 'var(--s-4)' }}>
      <label className="flex flex-col" style={{ gap: 'var(--s-2)' }}>
        <span className="t-sm dim" style={{ fontWeight: 600 }}>E-mail</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="voce@novaacao.com.br"
          className="field"
        />
      </label>

      <label className="flex flex-col" style={{ gap: 'var(--s-2)' }}>
        <span className="t-sm dim" style={{ fontWeight: 600 }}>Senha</span>
        <input
          name="senha"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="field"
        />
      </label>

      {erro && (
        <div
          className="flex items-start gap-2 t-sm"
          style={{
            padding: `var(--s-3)`,
            borderRadius: 'var(--r-md)',
            background: 'color-mix(in srgb, var(--critical) 10%, transparent)',
            color: 'var(--critical)',
          }}
        >
          <IconeAlerta className="shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={carregando}
        className="btn btn-primary"
        style={{ height: 40, marginTop: 'var(--s-2)' }}
      >
        {carregando ? 'Entrando…' : 'Entrar'}
      </button>

      <p className="t-xs muted" style={{ marginTop: 'var(--s-2)', textAlign: 'center' }}>
        Acesso restrito ao time. Esqueceu a senha? Fale com o administrador.
      </p>
    </form>
  )
}
