'use server'

import { revalidatePath } from 'next/cache'
import { db } from './db'
import { usuarioAtual } from './supabase/server'

/** Cria uma empresa (mínimo: nome). Segmento/cidade/UF/site opcionais. */
export async function criarEmpresa(dados: {
  trade_name: string
  segment?: string
  city?: string
  state?: string
  website?: string
}): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const u = await usuarioAtual()
  if (!u) return { ok: false, erro: 'Sem sessão.' }
  const nome = (dados.trade_name ?? '').trim()
  if (!nome) return { ok: false, erro: 'Informe o nome da empresa.' }

  const { data, error } = await db
    .from('companies')
    .insert({
      trade_name: nome,
      segment: dados.segment?.trim() || null,
      city: dados.city?.trim() || null,
      state: dados.state?.trim() || null,
      website: dados.website?.trim() || null,
    })
    .select('id')
    .single()
  if (error) return { ok: false, erro: error.message }

  revalidatePath('/empresas')
  return { ok: true, id: data.id as string }
}

/** Cria um segmento na lista gerenciada (qualquer usuário logado pode, para o
    fluxo "escolher ou criar"). Não duplica (case-insensitive). */
export async function criarSegmento(nome: string): Promise<{ ok: true; name: string } | { ok: false; erro: string }> {
  const u = await usuarioAtual()
  if (!u) return { ok: false, erro: 'Sem sessão.' }
  const n = (nome ?? '').trim()
  if (!n) return { ok: false, erro: 'Informe o segmento.' }

  const { data: existe } = await db.from('segments').select('name').ilike('name', n).maybeSingle()
  if (existe) return { ok: true, name: existe.name as string }

  const { error } = await db.from('segments').insert({ name: n, active: true })
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/empresas')
  revalidatePath('/configuracoes/segmentos')
  return { ok: true, name: n }
}
