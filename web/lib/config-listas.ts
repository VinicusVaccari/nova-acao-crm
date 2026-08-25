'use server'

import { revalidatePath } from 'next/cache'
import { db } from './db'
import { usuarioAtual } from './supabase/server'

/* CRUD compartilhado das listas simples de Configurações:
   Segmentos, Motivos de perda e Produtos e serviços. Cada uma vira uma
   lista de {id, label, ativo}. As entidades são whitelisted (nada de
   nome de tabela vindo do cliente sem validação). */

export type Resultado = { ok: true } | { ok: false; erro: string }
export type Entidade = 'segments' | 'lost_reasons' | 'products'

type Cfg = { tabela: string; idCol: string; labelCol: string; codeCol?: string; ordem?: string; rota: string }
const CFG: Record<Entidade, Cfg> = {
  segments:     { tabela: 'segments',     idCol: 'id',   labelCol: 'name',  ordem: 'sort_order', rota: '/configuracoes/segmentos' },
  lost_reasons: { tabela: 'lost_reasons', idCol: 'code', labelCol: 'label', codeCol: 'code',     rota: '/configuracoes/motivos-perda' },
  products:     { tabela: 'products',     idCol: 'id',   labelCol: 'name',  codeCol: 'code', ordem: 'sort_order', rota: '/configuracoes/produtos' },
}

async function guard() {
  const u = await usuarioAtual()
  if (!u || (u.papel !== 'admin' && u.papel !== 'gestor')) throw new Error('Sem permissão.')
}

function slug(s: string) {
  const base = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return base || `item_${Date.now()}`
}

export async function adicionarItem(ent: Entidade, label: string): Promise<Resultado> {
  try { await guard() } catch (e) { return { ok: false, erro: (e as Error).message } }
  const cfg = CFG[ent]; if (!cfg) return { ok: false, erro: 'Entidade inválida.' }
  const l = label.trim()
  if (!l) return { ok: false, erro: 'Nome vazio.' }

  const linha: Record<string, unknown> = { [cfg.labelCol]: l }
  if (cfg.codeCol) linha[cfg.codeCol] = slug(l)
  const { error } = await db.from(cfg.tabela).insert(linha)
  if (error) return { ok: false, erro: error.message }
  revalidatePath(cfg.rota)
  return { ok: true }
}

export async function renomearItem(ent: Entidade, id: string, label: string): Promise<Resultado> {
  try { await guard() } catch (e) { return { ok: false, erro: (e as Error).message } }
  const cfg = CFG[ent]; if (!cfg) return { ok: false, erro: 'Entidade inválida.' }
  const l = label.trim()
  if (!l) return { ok: false, erro: 'Nome vazio.' }
  const { error } = await db.from(cfg.tabela).update({ [cfg.labelCol]: l }).eq(cfg.idCol, id)
  if (error) return { ok: false, erro: error.message }
  revalidatePath(cfg.rota)
  return { ok: true }
}

export async function alternarItem(ent: Entidade, id: string, ativo: boolean): Promise<Resultado> {
  try { await guard() } catch (e) { return { ok: false, erro: (e as Error).message } }
  const cfg = CFG[ent]; if (!cfg) return { ok: false, erro: 'Entidade inválida.' }
  const { error } = await db.from(cfg.tabela).update({ active: ativo }).eq(cfg.idCol, id)
  if (error) return { ok: false, erro: error.message }
  revalidatePath(cfg.rota)
  return { ok: true }
}

export async function removerItem(ent: Entidade, id: string): Promise<Resultado> {
  try { await guard() } catch (e) { return { ok: false, erro: (e as Error).message } }
  const cfg = CFG[ent]; if (!cfg) return { ok: false, erro: 'Entidade inválida.' }
  const { error } = await db.from(cfg.tabela).delete().eq(cfg.idCol, id)
  if (error) return { ok: false, erro: error.message }
  revalidatePath(cfg.rota)
  return { ok: true }
}

// preço padrão + recorrência do produto (só 'products')
export async function atualizarPrecoProduto(
  id: string, dados: { default_price: number | null; recurrence: string },
): Promise<Resultado> {
  try { await guard() } catch (e) { return { ok: false, erro: (e as Error).message } }
  const preco = dados.default_price
  const { error } = await db.from('products').update({
    default_price: preco == null || Number.isNaN(preco) ? null : preco,
    recurrence: dados.recurrence === 'mensal' ? 'mensal' : 'unico',
  }).eq('id', id)
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/configuracoes/produtos')
  return { ok: true }
}
