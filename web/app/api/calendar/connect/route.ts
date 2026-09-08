import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { authUrl, googleConfigurado } from '@/lib/google'
import { usuarioAtual } from '@/lib/supabase/server'

/* Inicia o OAuth do Google Calendar: guarda um `state` (anti-CSRF) e
   manda o usuário para a tela de consentimento. */

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  const user = await usuarioAtual()
  if (!user) return NextResponse.redirect(`${origin}/login`)
  if (user.papel !== 'admin') return NextResponse.json({ erro: 'Sem permissão.' }, { status: 403 })
  if (!googleConfigurado()) return NextResponse.redirect(`${origin}/agenda?erro=config`)

  const state = crypto.randomUUID()
  const jar = await cookies()
  jar.set('gcal_state', state, {
    httpOnly: true,
    secure: origin.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })

  const redirectUri = `${origin}/api/calendar/callback`
  return NextResponse.redirect(authUrl(redirectUri, state))
}
