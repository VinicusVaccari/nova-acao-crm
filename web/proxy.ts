import { NextResponse, type NextRequest } from 'next/server'

/**
 * Checagem otimista de sessão — SEM chamada de rede.
 * Antes, validávamos a sessão no Supabase (getUser) a cada navegação,
 * o que somava centenas de ms por clique. Aqui só olhamos se existe o
 * cookie de auth para decidir o redirecionamento; a validação de verdade
 * acontece no layout do app (usuarioAtual → getUser), que já protege as
 * páginas do lado do servidor. Padrão "optimistic checks with proxy".
 */
export function proxy(req: NextRequest) {
  const rota = req.nextUrl.pathname
  // webhooks públicos (chamados por Z-API/Naia/formulário, sem sessão);
  // cada um se protege pela própria chave/segredo.
  const publica =
    rota.startsWith('/login') ||
    rota.startsWith('/convite') ||
    rota.startsWith('/api/ingest') ||
    rota.startsWith('/api/whatsapp') ||
    rota.startsWith('/api/naia')

  // cookie do @supabase/ssr: sb-<ref>-auth-token (pode vir em pedaços .0/.1)
  const temSessao = req.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('-auth-token'))

  if (!temSessao && !publica) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('destino', rota)
    return NextResponse.redirect(url)
  }

  if (temSessao && rota.startsWith('/login')) {
    const url = req.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
