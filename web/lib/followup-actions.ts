'use server'

import { revalidatePath } from 'next/cache'
import { userDatabase } from './security/user-db'
import { requireManager } from './security/authorization'

export type Resultado = { ok: true } | { ok: false; erro: string }

const CAMINHO = '/configuracoes/follow-up'

/** Chave mestra + modo. Grava ligado_em na PRIMEIRA vez que ativo vira
    true — nunca mais depois disso (D4: só pega negócio criado dali pra
    frente). */
export async function definirFollowupAtivo(ativo: boolean): Promise<Resultado> {
  const user = await requireManager()
  const db = await userDatabase()

  const { data: atual, error: leituraErro } = await db
    .from('followup_config').select('ligado_em').eq('id', 1).maybeSingle()
  if (leituraErro || !atual) return { ok: false, erro: 'Não foi possível consultar a configuração.' }

  const patch: Record<string, unknown> = {
    ativo, atualizado_em: new Date().toISOString(), atualizado_por: user.id,
  }
  if (ativo && !atual.ligado_em) patch.ligado_em = new Date().toISOString()

  const { error } = await db.from('followup_config').update(patch).eq('id', 1)
  if (error) return { ok: false, erro: error.message }
  revalidatePath(CAMINHO)
  return { ok: true }
}

export async function definirFollowupModo(modo: 'sombra' | 'autonomo'): Promise<Resultado> {
  const user = await requireManager()
  if (modo !== 'sombra' && modo !== 'autonomo') return { ok: false, erro: 'Modo inválido.' }
  const db = await userDatabase()
  const { error } = await db.from('followup_config')
    .update({ modo, atualizado_em: new Date().toISOString(), atualizado_por: user.id }).eq('id', 1)
  if (error) return { ok: false, erro: error.message }
  revalidatePath(CAMINHO)
  return { ok: true }
}

/** "Só números de teste": nasce ligado (seguro por padrão). Enquanto
    ligado, a cadência só dispara (em sombra ou autônomo) pra quem está em
    public.numeros_teste — pra testar em celular real, com mensagem
    saindo de verdade, sem risco de alcançar lead de cliente. */
export async function definirFollowupSomenteNumerosTeste(valor: boolean): Promise<Resultado> {
  const user = await requireManager()
  const db = await userDatabase()
  const { error } = await db.from('followup_config')
    .update({ somente_numeros_teste: valor, atualizado_em: new Date().toISOString(), atualizado_por: user.id }).eq('id', 1)
  if (error) return { ok: false, erro: error.message }
  revalidatePath(CAMINHO)
  return { ok: true }
}

/** Tempos e tetos — um patch parcial só com os campos que vieram preenchidos. */
export async function atualizarFollowupParametros(campos: {
  horas_toque_1?: number
  horas_toque_2?: number
  horas_toque_3?: number
  horas_desfecho?: number
  horas_toque_1_lote2?: number
  horas_toque_2_lote2?: number
  horas_toque_3_lote2?: number
  horas_desfecho_lote2?: number
  max_tentativas_envio?: number
  lease_minutos?: number
  teto_disparos_dia?: number
  teto_custo_dia_usd?: number
  preco_entrada_1m_usd?: number | null
  preco_saida_1m_usd?: number | null
}): Promise<Resultado> {
  const user = await requireManager()
  const db = await userDatabase()

  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString(), atualizado_por: user.id }
  for (const chave of [
    'horas_toque_1', 'horas_toque_2', 'horas_toque_3', 'horas_desfecho',
    'horas_toque_1_lote2', 'horas_toque_2_lote2', 'horas_toque_3_lote2', 'horas_desfecho_lote2',
    'max_tentativas_envio', 'lease_minutos', 'teto_disparos_dia',
    'teto_custo_dia_usd', 'preco_entrada_1m_usd', 'preco_saida_1m_usd',
  ] as const) {
    const v = campos[chave]
    if (v === undefined) continue
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
      return { ok: false, erro: `Valor inválido para ${chave}.` }
    }
    // Mesmos mínimos que fn_followup_varrer exige (0060) — sem isto a tela
    // aceitava 0 e a cadência consumia os toques sem enviar nada (achado
    // ALTO da Sentinela). A reserva precisa durar mais que os 120s do
    // executor (maxDuration de /api/followup/executar).
    if (chave === 'max_tentativas_envio' && (v === null || !Number.isInteger(v) || v < 1)) {
      return { ok: false, erro: 'Tentativas de envio por toque: um número inteiro, no mínimo 1.' }
    }
    if (chave === 'lease_minutos' && (v === null || !Number.isInteger(v) || v < 3)) {
      return { ok: false, erro: 'Prazo da reserva: um número inteiro de minutos, no mínimo 3 (o envio pode levar até 2 minutos).' }
    }
    patch[chave] = v
  }
  const { error } = await db.from('followup_config').update(patch).eq('id', 1)
  if (error) return { ok: false, erro: error.message }
  revalidatePath(CAMINHO)
  return { ok: true }
}

/** Editar = INSERT, nunca UPDATE. O vigente é a maior id da chave
    lote/toque/variante, para uma versão nunca sobrescrever a outra. */
export async function salvarFollowupTexto(lote: number, toque: number, variante: 'padrao' | 'sem_resposta', texto: string): Promise<Resultado> {
  const user = await requireManager()
  if (![1, 2].includes(lote)) return { ok: false, erro: 'Lote inválido.' }
  if (![1, 2, 3].includes(toque)) return { ok: false, erro: 'Toque inválido.' }
  if (variante !== 'padrao' && variante !== 'sem_resposta') return { ok: false, erro: 'Variante inválida.' }
  if (variante === 'sem_resposta' && lote !== 1) return { ok: false, erro: 'A variante sem resposta existe só no lote 1.' }
  const t = texto.trim()
  if (t.length < 10 || t.length > 1200) return { ok: false, erro: 'O texto precisa ter entre 10 e 1200 caracteres.' }

  const db = await userDatabase()
  const { error } = await db.from('followup_textos').insert({ lote, toque, variante, texto: t, criado_por: user.id })
  if (error) return { ok: false, erro: error.message }
  revalidatePath(CAMINHO)
  return { ok: true }
}
