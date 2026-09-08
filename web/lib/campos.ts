import 'server-only'
import { db } from './db'
import { requireActiveUser, requireEntityAccess } from './security/authorization'

/* Carrega as definições de campos personalizados de uma entidade
   (company | contact) já com o VALOR salvo para uma entidade específica
   (company_id ou person_id). Usado na ficha do lead. */

export type CampoComValor = {
  id: number
  key: string
  label: string
  field_type: string
  options: string[]
  required: boolean
  valor: string | null
}

export async function carregarCamposCustom(
  entity: 'company' | 'contact',
  entityId: string | null,
): Promise<CampoComValor[]> {
  await requireActiveUser()
  if (entityId) await requireEntityAccess(entity, entityId)
  const { data: defs } = await db
    .from('custom_fields')
    .select('id, key, label, field_type, options, required')
    .eq('entity', entity)
    .eq('active', true)
    .order('sort_order').order('id')

  const lista = (defs ?? []) as Array<{ id: number; key: string; label: string; field_type: string; options: string[] | null; required: boolean }>
  if (lista.length === 0) return []

  let valores = new Map<number, string | null>()
  if (entityId) {
    const { data: vals } = await db
      .from('custom_field_values')
      .select('field_id, value')
      .eq('entity_id', entityId)
      .in('field_id', lista.map(d => d.id))
    valores = new Map((vals ?? []).map(v => [v.field_id as number, (v.value as string) ?? null]))
  }

  return lista.map(d => ({
    id: d.id, key: d.key, label: d.label, field_type: d.field_type,
    options: d.options ?? [], required: d.required,
    valor: valores.get(d.id) ?? null,
  }))
}
