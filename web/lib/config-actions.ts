'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { db } from './db'
import { usuarioAtual } from './supabase/server'
import { PAPEIS_VALIDOS, papelLabel, type Papel } from './papeis'
import { enviarEmailConvite } from './email'

/* -----------------------------------------------------------------
   Configurações → Users. Gestão de usuários (profiles), equipes
   (teams) e convites (invites). Só admin/gestor. O envio do e-mail
   do convite (Resend) e a página de aceite entram no próximo passo —
   por ora o convite é criado e o link fica disponível pra copiar.
   ----------------------------------------------------------------- */

export type Resultado = { ok: true } | { ok: false; erro: string }

function appBase() {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://nova-acao-crm.vercel.app'
}

function linkConvite(token: string) {
  return `${appBase()}/convite/${token}`
}

/** Só admin/gestor mexem em Configurações. Devolve o usuário ou lança. */
async function exigirGestor() {
  const u = await usuarioAtual()
  if (!u || (u.papel !== 'admin' && u.papel !== 'gestor')) {
    throw new Error('Sem permissão.')
  }
  return u
}

function recarregar() {
  revalidatePath('/configuracoes/usuarios')
}

// ---------------- EQUIPES ----------------

export async function criarEquipe(nome: string): Promise<Resultado> {
  try { await exigirGestor() } catch (e) { return { ok: false, erro: (e as Error).message } }
  const n = nome.trim()
  if (!n) return { ok: false, erro: 'Nome vazio.' }
  const { error } = await db.from('teams').insert({ name: n })
  if (error) return { ok: false, erro: error.message }
  recarregar()
  return { ok: true }
}

export async function renomearEquipe(id: string, nome: string): Promise<Resultado> {
  try { await exigirGestor() } catch (e) { return { ok: false, erro: (e as Error).message } }
  const n = nome.trim()
  if (!n) return { ok: false, erro: 'Nome vazio.' }
  const { error } = await db.from('teams').update({ name: n }).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  recarregar()
  return { ok: true }
}

export async function removerEquipe(id: string): Promise<Resultado> {
  try { await exigirGestor() } catch (e) { return { ok: false, erro: (e as Error).message } }
  // os membros ficam sem equipe (team_id -> null pela FK on delete set null)
  const { error } = await db.from('teams').delete().eq('id', id)
  if (error) return { ok: false, erro: error.message }
  recarregar()
  return { ok: true }
}

// ---------------- USUÁRIOS ----------------

export async function atualizarUsuario(
  id: string,
  campos: { role?: string; team_id?: string | null; is_active?: boolean; lead_capacity?: number },
): Promise<Resultado> {
  try { await exigirGestor() } catch (e) { return { ok: false, erro: (e as Error).message } }

  const patch: Record<string, unknown> = {}
  if (campos.role !== undefined) {
    if (!PAPEIS_VALIDOS.has(campos.role as Papel)) return { ok: false, erro: 'Papel inválido.' }
    patch.role = campos.role
  }
  if (campos.team_id !== undefined) patch.team_id = campos.team_id || null
  if (campos.is_active !== undefined) patch.is_active = campos.is_active
  if (campos.lead_capacity !== undefined) patch.lead_capacity = Math.max(0, Math.floor(campos.lead_capacity))

  if (Object.keys(patch).length === 0) return { ok: true }
  const { error } = await db.from('profiles').update(patch).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  recarregar()
  return { ok: true }
}

// ---------------- CONVITES ----------------

export async function convidarUsuario(
  email: string,
  role: string,
  teamId: string | null,
): Promise<{ ok: true; link: string; enviado: boolean } | { ok: false; erro: string }> {
  let quem
  try { quem = await exigirGestor() } catch (e) { return { ok: false, erro: (e as Error).message } }

  const mail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { ok: false, erro: 'E-mail inválido.' }
  if (!PAPEIS_VALIDOS.has(role as Papel)) return { ok: false, erro: 'Papel inválido.' }

  // já existe usuário com esse e-mail?
  const { data: jaTem } = await db.from('profiles').select('id').eq('email', mail).maybeSingle()
  if (jaTem) return { ok: false, erro: 'Já existe um usuário com esse e-mail.' }

  // cancela convites pendentes anteriores do mesmo e-mail (substitui)
  await db.from('invites').update({ status: 'cancelado' }).eq('email', mail).eq('status', 'pendente')

  const token = randomBytes(24).toString('hex')
  const { error } = await db.from('invites').insert({
    email: mail, role, team_id: teamId || null, token, invited_by: quem.id,
  })
  if (error) return { ok: false, erro: error.message }

  const link = linkConvite(token)
  const { enviado } = await enviarEmailConvite(mail, link, quem.nome, papelLabel(role))
  recarregar()
  return { ok: true, link, enviado }
}

/* --------- ACEITE DO CONVITE (rota pública /convite/[token]) --------- */

export async function aceitarConvite(
  token: string, nome: string, senha: string,
): Promise<Resultado> {
  const t = (token || '').trim()
  const n = (nome || '').trim()
  if (!t) return { ok: false, erro: 'Convite inválido.' }
  if (n.length < 2) return { ok: false, erro: 'Informe seu nome.' }
  if ((senha || '').length < 8) return { ok: false, erro: 'A senha precisa de ao menos 8 caracteres.' }

  // convite válido?
  const { data: conv } = await db
    .from('invites')
    .select('id, email, role, team_id, status, expires_at')
    .eq('token', t)
    .maybeSingle()
  if (!conv || conv.status !== 'pendente') return { ok: false, erro: 'Convite inválido ou já usado.' }
  if (new Date(conv.expires_at as string) < new Date()) {
    await db.from('invites').update({ status: 'expirado' }).eq('id', conv.id)
    return { ok: false, erro: 'Este convite expirou.' }
  }

  // cria o login (auth) já confirmado
  const { data: criado, error: eAuth } = await db.auth.admin.createUser({
    email: conv.email as string,
    password: senha,
    email_confirm: true,
    user_metadata: { full_name: n },
  })
  if (eAuth || !criado?.user) {
    return { ok: false, erro: eAuth?.message || 'Não foi possível criar o acesso.' }
  }

  // cria/atualiza o perfil com o papel e a equipe do convite
  const { error: eProf } = await db.from('profiles').upsert({
    id: criado.user.id,
    full_name: n,
    email: conv.email,
    role: conv.role,
    team_id: conv.team_id,
    is_active: true,
  })
  if (eProf) return { ok: false, erro: eProf.message }

  await db.from('invites').update({ status: 'aceito', accepted_at: new Date().toISOString() }).eq('id', conv.id)
  return { ok: true }
}

export async function cancelarConvite(id: string): Promise<Resultado> {
  try { await exigirGestor() } catch (e) { return { ok: false, erro: (e as Error).message } }
  const { error } = await db.from('invites').update({ status: 'cancelado' }).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  recarregar()
  return { ok: true }
}

// ---------------- PERFIL (do próprio usuário) ----------------

export async function atualizarMeuPerfil(nome: string): Promise<Resultado> {
  const u = await usuarioAtual()
  if (!u) return { ok: false, erro: 'Sem sessão.' }
  const n = nome.trim()
  if (n.length < 2) return { ok: false, erro: 'Informe seu nome.' }
  const { error } = await db.from('profiles').update({ full_name: n }).eq('id', u.id)
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/configuracoes/perfil')
  return { ok: true }
}

export async function alterarMinhaSenha(senhaAtual: string, novaSenha: string): Promise<Resultado> {
  const u = await usuarioAtual()
  if (!u) return { ok: false, erro: 'Sem sessão.' }
  if (!senhaAtual) return { ok: false, erro: 'Informe sua senha atual.' }
  if ((novaSenha || '').length < 8) return { ok: false, erro: 'A nova senha precisa de ao menos 8 caracteres.' }
  if (novaSenha === senhaAtual) return { ok: false, erro: 'A nova senha deve ser diferente da atual.' }

  // valida a senha ATUAL tentando autenticar num cliente isolado (sem sessão)
  const verif = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error: eLogin } = await verif.auth.signInWithPassword({ email: u.email, password: senhaAtual })
  if (eLogin) return { ok: false, erro: 'Senha atual incorreta.' }

  const { error } = await db.auth.admin.updateUserById(u.id, { password: novaSenha })
  if (error) return { ok: false, erro: error.message }
  return { ok: true }
}

/** Sobe a foto de perfil (máx 2 MB, JPG/PNG/GIF) e grava avatar_url. */
export async function atualizarMinhaFoto(
  fd: FormData,
): Promise<{ ok: true; url: string } | { ok: false; erro: string }> {
  const u = await usuarioAtual()
  if (!u) return { ok: false, erro: 'Sem sessão.' }
  const file = fd.get('foto')
  if (!(file instanceof File) || file.size === 0) return { ok: false, erro: 'Selecione uma imagem.' }
  if (file.size > 2 * 1024 * 1024) return { ok: false, erro: 'A imagem deve ter no máximo 2 MB.' }

  const tipos: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }
  const ext = tipos[file.type]
  if (!ext) return { ok: false, erro: 'Formato inválido. Use JPG, PNG ou GIF.' }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const path = `${u.id}.${ext}`
  const { error: eUp } = await db.storage.from('avatars').upload(path, bytes, { contentType: file.type, upsert: true })
  if (eUp) return { ok: false, erro: eUp.message }

  const base = db.storage.from('avatars').getPublicUrl(path).data.publicUrl
  const url = `${base}?v=${Date.now()}` // cache-buster: força atualizar a imagem
  const { error } = await db.from('profiles').update({ avatar_url: url }).eq('id', u.id)
  if (error) return { ok: false, erro: error.message }

  revalidatePath('/configuracoes/perfil')
  return { ok: true, url }
}
