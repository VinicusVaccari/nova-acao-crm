import { revalidatePath } from 'next/cache'
import { db } from './db'

export const TIPOS_TAREFA_NAIA = ['geral', 'ligacao', 'whatsapp', 'email', 'reuniao', 'proposta'] as const

export function hoje9hBrasil(): string {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return new Date(`${brt.toISOString().slice(0, 10)}T09:00:00-03:00`).toISOString()
}

export async function sincronizarProximaAcaoNaia(oppId: string): Promise<boolean> {
  const { data, error: leituraErro } = await db
    .from('tasks')
    .select('title, due_at')
    .eq('opportunity_id', oppId)
    .is('done_at', null)
    .order('due_at', { ascending: true })
    .limit(1)
  if (leituraErro) return false
  const prox = data?.[0]
  const { error } = await db
    .from('opportunities')
    .update({ next_step: prox?.title ?? null, next_step_due: prox?.due_at ?? null })
    .eq('id', oppId)
  return !error
}

export type CriarTarefaNaiaEntrada = {
  oppId: string
  assunto: string
  descricao?: string | null
  prazo: string
  responsavel?: string | null
  tipo?: string
}

export type CriarTarefaNaiaResultado =
  | { ok: true; taskId: string | null; assunto: string; prazo: string; responsavel: string | null; repetida: boolean }
  | { ok: false; erro: string; status: 400 | 500 | 503; taskId?: string | null }

export async function criarTarefaNaia(entrada: CriarTarefaNaiaEntrada): Promise<CriarTarefaNaiaResultado> {
  const assunto = entrada.assunto.trim()
  if (!assunto) return { ok: false, erro: 'informe "assunto"', status: 400 }
  const tipo = entrada.tipo ?? 'geral'
  if (!(TIPOS_TAREFA_NAIA as readonly string[]).includes(tipo)) {
    return { ok: false, erro: `"tipo" inválido; use um de: ${TIPOS_TAREFA_NAIA.join(', ')}`, status: 400 }
  }

  let ownerId: string | null = null
  const responsavel = entrada.responsavel?.trim()
  if (responsavel) {
    const { data: perfil, error: perfilErro } = await db.from('profiles').select('id')
      .eq('email', responsavel).eq('is_active', true).maybeSingle()
    if (perfilErro) return { ok: false, erro: 'não foi possível consultar o responsável', status: 503 }
    if (!perfil?.id) return { ok: false, erro: `responsável não encontrado ou inativo: ${responsavel}`, status: 400 }
    ownerId = perfil.id as string
  }

  const { data: jaExiste, error: dedupErro } = await db.from('tasks').select('id')
    .eq('opportunity_id', entrada.oppId).eq('title', assunto).is('done_at', null)
    .limit(1).maybeSingle()
  if (dedupErro) return { ok: false, erro: 'não foi possível verificar tarefa existente', status: 503 }
  if (jaExiste?.id) return { ok: true, taskId: jaExiste.id as string, assunto, prazo: entrada.prazo, responsavel: ownerId ? responsavel ?? null : null, repetida: true }

  const { data: criada, error } = await db.from('tasks').insert({
    opportunity_id: entrada.oppId,
    title: assunto,
    description: entrada.descricao?.trim() || null,
    kind: tipo,
    due_at: entrada.prazo,
    owner_id: ownerId,
  }).select('id').single()
  if (error) return { ok: false, erro: error.message, status: 500 }

  if (!await sincronizarProximaAcaoNaia(entrada.oppId)) {
    return { ok: false, taskId: (criada?.id as string | undefined) ?? null, erro: 'tarefa criada, mas a fila do negócio não foi atualizada; refaça a chamada', status: 500 }
  }

  revalidatePath('/pipeline')
  revalidatePath(`/lead/${entrada.oppId}`)
  revalidatePath('/')
  return { ok: true, taskId: (criada?.id as string | undefined) ?? null, assunto, prazo: entrada.prazo, responsavel: ownerId ? responsavel ?? null : null, repetida: false }
}
