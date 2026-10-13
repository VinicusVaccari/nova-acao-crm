import 'server-only'

import { revalidatePath } from 'next/cache'
import { db } from './db'

type AtorPerda = { tipo: 'user'; id: string } | { tipo: 'ai' }
type ResultadoPerda = { ok: true } | { ok: false; erro: string }

/** Serviço interno, não é Server Action. O chamador deve autorizar antes:
 * Action: sessão + acesso ao negócio; API NAIA: segredo de integração.
 * O ator é construído pelo chamador confiável, nunca recebido do body.
 */
export async function registrarPerdaAutorizada(
  oppId: string, motivo: string, ator: AtorPerda,
): Promise<ResultadoPerda> {
  if (!motivo) return { ok: false, erro: 'Motivo da perda é obrigatório.' }
  const { data: resultado, error } = await db.rpc('fn_registrar_perda', {
    p_opportunity_id: oppId,
    p_motivo: motivo,
    p_actor_type: ator.tipo,
    p_changed_by: ator.tipo === 'user' ? ator.id : null,
  })
  if (error) return { ok: false, erro: 'Não foi possível registrar a perda.' }
  if (resultado === 'nao_encontrado') return { ok: false, erro: 'Negócio não encontrado ou indisponível.' }
  if (resultado === 'motivo_invalido') return { ok: false, erro: 'Motivo da perda não existe.' }
  if (resultado !== 'perdido') return { ok: false, erro: 'Não foi possível registrar a perda.' }

  revalidatePath('/')
  revalidatePath('/pipeline')
  revalidatePath('/comercial')
  revalidatePath(`/lead/${oppId}`)
  return { ok: true }
}
