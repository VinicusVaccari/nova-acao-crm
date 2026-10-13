'use server'

import { randomBytes } from 'node:crypto'
import { headers } from 'next/headers'
import { after } from 'next/server'
import { db } from './db'
import { enviarEmailRecuperacao } from './email'
import { hashTokenRecuperacao } from './recuperacao-token'

const MENSAGEM = 'Se esse e-mail estiver cadastrado, enviamos um link de recuperação.'
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function appBase() {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://nova-acao-crm.vercel.app'
}

function resposta() {
  return { ok: true as const, mensagem: MENSAGEM }
}

function indisponivel() {
  return { ok: false as const, erro: 'Não foi possível processar seu pedido. Tente de novo em alguns minutos.' }
}

async function enviarDepois(para: string, link: string) {
  try {
    const resultado = await enviarEmailRecuperacao(para, link)
    if (!resultado.enviado) console.error('recuperação: e-mail não enviado:', resultado.motivo)
  } catch (erro) {
    console.error('recuperação: e-mail falhou:', erro)
  }
}

export async function solicitarRecuperacaoSenha(email: string): Promise<{ ok: true; mensagem: string } | { ok: false; erro: string }> {
  const mail = email.trim().toLowerCase()
  if (!EMAIL_VALIDO.test(mail)) return { ok: false, erro: 'E-mail inválido.' }

  const cabecalhos = await headers()
  const ip = cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const haUmaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: limiteErro } = await db
    .from('password_reset_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('requested_ip', ip)
    .gte('created_at', haUmaHora)
  if (limiteErro) {
    console.error('recuperação: limite de IP não consultado:', limiteErro.message)
    return indisponivel()
  }
  const { error: limpezaErro } = await db.from('password_reset_attempts').delete().lt('created_at', haUmaHora)
  if (limpezaErro) {
    console.error('recuperação: tentativas antigas não limpas:', limpezaErro.message)
    return indisponivel()
  }
  const { error: tentativaErro } = await db.from('password_reset_attempts').insert({ requested_ip: ip })
  if (tentativaErro) {
    console.error('recuperação: tentativa não gravada:', tentativaErro.message)
    return indisponivel()
  }
  if ((count ?? 0) >= 10) return resposta()

  const { data: perfil, error: perfilErro } = await db
    .from('profiles')
    .select('id, email, is_active, role')
    .eq('email', mail)
    .maybeSingle()
  if (perfilErro) {
    console.error('recuperação: perfil não consultado:', perfilErro.message)
    return indisponivel()
  }
  if (!perfil || !perfil.is_active || perfil.role === 'ia') return resposta()

  const haCincoMinutos = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data: recente, error: recenteErro } = await db
    .from('password_resets')
    .select('id')
    .eq('user_id', perfil.id)
    .eq('status', 'pendente')
    .gte('created_at', haCincoMinutos)
    .maybeSingle()
  if (recenteErro) {
    console.error('recuperação: token recente não consultado:', recenteErro.message)
    return indisponivel()
  }
  if (recente) return resposta()

  const { error: cancelarErro } = await db
    .from('password_resets')
    .update({ status: 'cancelado' })
    .eq('user_id', perfil.id)
    .eq('status', 'pendente')
  if (cancelarErro) {
    console.error('recuperação: tokens pendentes não cancelados:', cancelarErro.message)
    return indisponivel()
  }

  const token = randomBytes(24).toString('hex')
  const { error: inserirErro } = await db.from('password_resets').insert({
    user_id: perfil.id,
    token_hash: hashTokenRecuperacao(token),
    requested_ip: ip,
  })
  if (inserirErro) {
    console.error('recuperação: token não criado:', inserirErro.message)
    return indisponivel()
  }

  // Decisão consciente: o caminho válido ainda consulta mais o Supabase que
  // os demais; aceitamos esse resíduo, menor que a variação de rede, para não
  // manter consultas falsas difíceis de sustentar só para equalizar tempo.
  after(() => enviarDepois(mail, `${appBase()}/recuperar-senha/${token}`))
  return resposta()
}

export async function redefinirSenha(token: string, novaSenha: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const t = token.trim()
  if (novaSenha.length < 8) return { ok: false, erro: 'A nova senha precisa de ao menos 8 caracteres.' }
  const { data: consumidos, error: resetErro } = await db.rpc('fn_consumir_password_reset', {
    p_token_hash: hashTokenRecuperacao(t),
  })
  if (resetErro) return { ok: false, erro: 'Não foi possível processar seu pedido. Tente de novo em alguns minutos.' }
  const reset = consumidos?.[0]
  if (!reset) return { ok: false, erro: 'Link inválido ou expirado. Peça um novo.' }

  async function restaurarPendente() {
    const { data, error } = await db.from('password_resets')
      .update({ status: 'pendente', used_at: null })
      .eq('id', reset.id)
      .eq('status', 'usado')
      .eq('used_at', reset.used_at)
      .select('id')
      .maybeSingle()
    return !error && Boolean(data)
  }

  const { data: perfil, error: perfilErro } = await db.from('profiles').select('is_active').eq('id', reset.user_id).maybeSingle()
  if (perfilErro) {
    await restaurarPendente()
    return { ok: false, erro: 'Não foi possível processar seu pedido. Tente de novo em alguns minutos.' }
  }
  if (!perfil?.is_active) {
    const { error: cancelarInativoErro } = await db.from('password_resets')
      .update({ status: 'cancelado' })
      .eq('id', reset.id)
      .eq('status', 'usado')
      .eq('used_at', reset.used_at)
    if (cancelarInativoErro) return { ok: false, erro: 'Não foi possível processar seu pedido. Tente de novo em alguns minutos.' }
    return { ok: false, erro: 'Link inválido ou expirado. Peça um novo.' }
  }
  const { error: authErro } = await db.auth.admin.updateUserById(reset.user_id, { password: novaSenha })
  if (authErro) {
    const restaurado = await restaurarPendente()
    return restaurado
      ? { ok: false, erro: 'Não foi possível redefinir a senha. Tente de novo.' }
      : { ok: false, erro: 'Não foi possível redefinir a senha. Peça um novo link.' }
  }
  const { error: cancelarErro } = await db.from('password_resets').update({ status: 'cancelado' }).eq('user_id', reset.user_id).eq('status', 'pendente')
  if (cancelarErro) return { ok: false, erro: 'Não foi possível processar seu pedido. Tente de novo em alguns minutos.' }
  return { ok: true }
}
