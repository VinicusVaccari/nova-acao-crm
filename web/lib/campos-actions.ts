'use server'

import { revalidatePath } from 'next/cache'
import { db } from './db'
import { usuarioAtual } from './supabase/server'

/* Salva os VALORES dos campos personalizados de uma entidade (a empresa ou
   o contato de um deal). Qualquer usuário logado que edita o deal pode
   preencher — não é restrito a admin. Upsert por (campo, entidade). */

export async function salvarCamposCustom(
  entityId: string,
  valores: { fieldId: number; valor: string }[],
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const u = await usuarioAtual()
  if (!u) return { ok: false, erro: 'Sem sessão.' }
  if (!entityId) return { ok: false, erro: 'Sem entidade vinculada.' }

  const agora = new Date().toISOString()
  const linhas = valores.map(v => ({
    field_id: v.fieldId,
    entity_id: entityId,
    value: (v.valor ?? '').trim() || null,
    updated_at: agora,
  }))
  const { error } = await db.from('custom_field_values').upsert(linhas, { onConflict: 'field_id,entity_id' })
  if (error) return { ok: false, erro: error.message }

  revalidatePath('/lead', 'layout')
  return { ok: true }
}
