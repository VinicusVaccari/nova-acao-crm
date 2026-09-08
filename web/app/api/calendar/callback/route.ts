import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { salvarConexao, trocarCodigo } from '@/lib/google'
import { usuarioAtual } from '@/lib/supabase/server'

/* Volta do consentimento do Google: confere o `state`, troca o código
   pelos tokens e grava a conexão. Sempre volta para /agenda. */

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const origin = url.origin
  const agenda = (q: string) => NextResponse.redirect(`${origin}/agenda?${q}`)

  const jar = await cookies()
  const salvo = jar.get('gcal_state')?.value
  jar.delete('gcal_state')

  if (url.searchParams.get('error')) return agenda('erro=negado')

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state || state !== salvo) return agenda('erro=state')

  const user = await usuarioAtual()
  if (!user || user.papel !== 'admin') return NextResponse.json({ erro: 'Sem permissão.' }, { status: 403 })

  try {
    const tok = await trocarCodigo(code, `${origin}/api/calendar/callback`)
    await salvarConexao(user.id, tok)
  } catch (e) {
    console.error('callback calendar:', e)
    return agenda('erro=troca')
  }

  return agenda('conectado=1')
}
