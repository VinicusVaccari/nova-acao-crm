'use server'

import { revalidatePath } from 'next/cache'
import { db } from './db'
import { usuarioAtual } from './supabase/server'
import { requireEntityAccess } from './security/authorization'

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
  if (!Array.isArray(valores) || valores.length > 100 || valores.some(v => !Number.isInteger(v.fieldId) || typeof v.valor !== 'string' || v.valor.length > 4000)) return { ok: false, erro: 'Campos inválidos.' }
  if (!valores.length) return { ok: true }
  const ids = [...new Set(valores.map(v => v.fieldId))]
  const { data: defs, error: defsError } = await db.from('custom_fields').select('id, entity, field_type, options').in('id', ids).eq('active', true)
  if (defsError || defs?.length !== ids.length) return { ok: false, erro: 'Campo indisponível.' }
  for (const entity of new Set(defs.map(d => d.entity as string))) await requireEntityAccess(entity, entityId)
  for (const value of valores) {
    const def = defs.find(d => d.id === value.fieldId)!
    if (value.valor && def.field_type === 'select' && !(def.options as string[]).includes(value.valor)) return { ok: false, erro: 'Opção inválida.' }
    if (value.valor && def.field_type === 'number' && !Number.isFinite(Number(value.valor))) return { ok: false, erro: 'Número inválido.' }
  }

  const agora = new Date().toISOString()
  const linhas = valores.map(v => ({
    field_id: v.fieldId,
    entity_id: entityId,
    value: (v.valor ?? '').trim() || null,
    updated_at: agora,
  }))
  const { error } = await db.from('custom_field_values').upsert(linhas, { onConflict: 'field_id,entity_id' })
  if (error) return { ok: false, erro: error.message }

  revalidatePath('/lead/[id]', 'page')
  return { ok: true }
}
