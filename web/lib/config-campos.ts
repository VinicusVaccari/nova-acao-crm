'use server'

import { revalidatePath } from 'next/cache'
import { db } from './db'
import { usuarioAtual } from './supabase/server'

/* Campos personalizados (custom_fields) por entidade: deal | company |
   contact. Aqui é o CADASTRO das definições. Só admin/gestor. */

export type Resultado = { ok: true } | { ok: false; erro: string }
export type EntidadeCampo = 'deal' | 'company' | 'contact'
export type TipoCampo = 'text' | 'number' | 'date' | 'select' | 'boolean'

const ENTS = new Set<EntidadeCampo>(['deal', 'company', 'contact'])
const TIPOS = new Set<TipoCampo>(['text', 'number', 'date', 'select', 'boolean'])

async function guard() {
  const u = await usuarioAtual()
  if (!u || (u.papel !== 'admin' && u.papel !== 'gestor')) throw new Error('Sem permissão.')
}

function slug(s: string) {
  const base = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return base || `campo_${Date.now()}`
}

export async function criarCampo(
  entity: EntidadeCampo, label: string, tipo: TipoCampo, opcoes: string[], obrigatorio: boolean,
): Promise<Resultado> {
  try { await guard() } catch (e) { return { ok: false, erro: (e as Error).message } }
  if (!ENTS.has(entity)) return { ok: false, erro: 'Entidade inválida.' }
  if (!TIPOS.has(tipo)) return { ok: false, erro: 'Tipo inválido.' }
  const l = label.trim()
  if (!l) return { ok: false, erro: 'Nome vazio.' }

  const options = tipo === 'select' ? opcoes.map(o => o.trim()).filter(Boolean) : []
  if (tipo === 'select' && options.length === 0) return { ok: false, erro: 'Adicione ao menos uma opção.' }

  const { error } = await db.from('custom_fields').insert({
    entity, key: slug(l), label: l, field_type: tipo, options, required: obrigatorio,
  })
  if (error) {
    return { ok: false, erro: /duplicate|unique/i.test(error.message) ? 'Já existe um campo com esse nome nessa entidade.' : error.message }
  }
  revalidatePath('/configuracoes/campos')
  return { ok: true }
}

export async function alternarCampo(id: number, ativo: boolean): Promise<Resultado> {
  try { await guard() } catch (e) { return { ok: false, erro: (e as Error).message } }
  const { error } = await db.from('custom_fields').update({ active: ativo }).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/configuracoes/campos')
  return { ok: true }
}

export async function removerCampo(id: number): Promise<Resultado> {
  try { await guard() } catch (e) { return { ok: false, erro: (e as Error).message } }
  const { error } = await db.from('custom_fields').delete().eq('id', id)
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/configuracoes/campos')
  return { ok: true }
}
