'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { IconeConfig, IconeSair, IconeTema } from '@/components/icones'
import { LogoSimbolo } from '@/components/logo-nova'

export function Topbar({ usuario }: { usuario: { nome: string; email: string; papel: string; avatar?: string | null } }) {
  const router = useRouter()
  const [tema, setTema] = useState<'light' | 'dark' | null>(null)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    const salvo = localStorage.getItem('tema') as 'light' | 'dark' | null
    const inicial = salvo ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    setTema(inicial)
    document.documentElement.dataset.theme = inicial
  }, [])

  function alternarTema() {
    const novo = tema === 'dark' ? 'light' : 'dark'
    setTema(novo)
    localStorage.setItem('tema', novo)
    document.documentElement.dataset.theme = novo
  }

  async function sair() {
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await sb.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const iniciais = usuario.nome.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase()

  return (
    <header
      className="fixed top-0 inset-x-0 z-40 flex items-stretch"
      style={{ height: 'var(--topbar-h)', background: 'var(--nav-bg)' }}
    >
      {/* canto do logo */}
      <Link
        href="/"
        className="hidden md:grid place-items-center shrink-0"
        style={{ width: 'var(--sidebar-w)' }}
        aria-label="Nova Ação"
      >
        <span style={{ transform: 'translateY(2px)' }}><LogoSimbolo size={36} /></span>
      </Link>

      {/* divisória curta entre a logo e o nome — não encosta no topo/base */}
      <span
        aria-hidden
        className="hidden md:block shrink-0"
        style={{ width: 1, alignSelf: 'center', height: '46%', borderRadius: 1, background: 'var(--nav-hairline)' }}
      />

      {/* faixa da navbar — mesma cor escura da moldura */}
      <div
        className="flex-1 flex items-center"
        style={{ padding: '0 var(--s-6) 0 14px', gap: 'var(--s-3)' }}
      >
        <div className="min-w-0">
          <div className="t-h3" style={{ lineHeight: 1.1, letterSpacing: '-0.02em' }}>
            <span style={{ color: 'var(--nav-ink)' }}>Nova</span> <span style={{ color: '#FAB800' }}>Ação</span>
          </div>
          <div className="t-xs" style={{ letterSpacing: '0.04em', color: 'var(--nav-ink-2)' }}>Comercial</div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={alternarTema}
            className="grid place-items-center"
            style={{ width: 36, height: 36, borderRadius: 'var(--r-md)', color: 'var(--nav-ink-2)', border: '1px solid var(--nav-hairline)' }}
            title={tema === 'dark' ? 'Tema claro' : 'Tema escuro'}
            aria-label="Alternar tema"
          >
            <IconeTema />
          </button>

          <div className="relative">
            <button
              onClick={() => setMenu(v => !v)}
              className="flex items-center gap-3"
              style={{ height: 36, padding: `0 var(--s-3) 0 var(--s-1)`, borderRadius: 'var(--r-full)', border: '1px solid var(--nav-hairline)', color: 'var(--nav-ink)' }}
            >
              {usuario.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={usuario.avatar} alt={usuario.nome} width={28} height={28}
                  className="shrink-0" style={{ width: 28, height: 28, borderRadius: 'var(--r-full)', objectFit: 'cover', display: 'block' }} />
              ) : (
                <span
                  className="grid place-items-center shrink-0"
                  style={{ width: 28, height: 28, borderRadius: 'var(--r-full)', background: 'var(--brand-teal)', color: '#fff', fontSize: 'var(--text-2xs)', fontWeight: 700 }}
                >
                  {iniciais}
                </span>
              )}
              <span className="t-sm hidden sm:block" style={{ fontWeight: 600, color: 'var(--nav-ink)' }}>{usuario.nome.split(' ')[0]}</span>
            </button>

            {menu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 z-20 card surgir" style={{ top: 42, width: 224, padding: 'var(--s-2)', boxShadow: 'var(--shadow-lg)' }}>
                  <div style={{ padding: `var(--s-2) var(--s-3)` }}>
                    <div className="t-sm" style={{ fontWeight: 600 }}>{usuario.nome}</div>
                    <div className="t-xs muted truncate">{usuario.email}</div>
                    <div className="chip" style={{ marginTop: 'var(--s-2)', background: 'var(--surface-2)', color: 'var(--ink-2)' }}>{usuario.papel}</div>
                  </div>
                  <div style={{ height: 1, background: 'var(--hairline)', margin: `var(--s-2) 0` }} />
                  {(usuario.papel === 'admin' || usuario.papel === 'gestor') && (
                    <Link
                      href="/configuracoes"
                      onClick={() => setMenu(false)}
                      className="flex items-center gap-2 w-full t-sm"
                      style={{ padding: `var(--s-2) var(--s-3)`, borderRadius: 'var(--r-md)', color: 'var(--ink)' }}
                    >
                      <IconeConfig />
                      Configurações
                    </Link>
                  )}
                  <button
                    onClick={sair}
                    className="flex items-center gap-2 w-full t-sm"
                    style={{ padding: `var(--s-2) var(--s-3)`, borderRadius: 'var(--r-md)', color: 'var(--critical)' }}
                  >
                    <IconeSair />
                    Sair da conta
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
