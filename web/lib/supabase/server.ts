import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Cliente ligado à sessão do usuário. Respeita RLS — vendedor só
 *  enxerga o que é dele. Diferente de lib/db.ts, que usa service_role. */
export async function supabaseServer() {
  const jar = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: cookiesToSet => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => jar.set(name, value, options))
          } catch {
            // chamado de um Server Component: o middleware já renova a sessão
          }
        },
      },
    }
  )
}

export async function usuarioAtual() {
  const sb = await supabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null

  const { data: perfil } = await sb
    .from('profiles')
    .select('id, full_name, email, role, avatar_url')
    .eq('id', user.id)
    .maybeSingle()

  return {
    id: user.id,
    email: user.email ?? '',
    nome: perfil?.full_name ?? user.email ?? '',
    papel: (perfil?.role as string) ?? 'vendedor',
    avatar: (perfil?.avatar_url as string) ?? null,
  }
}
