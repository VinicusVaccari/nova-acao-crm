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
  const { data: o, error: leituraErro } = await db.from('opportunities')
    .select('stage').eq('id', oppId).maybeSingle()
  if (leituraErro || !o) return { ok: false, erro: 'Negócio não encontrado ou indisponível.' }

  const { data: mr, error: motivoErro } = await db.from('lost_reasons')
    .select('label').eq('code', motivo).maybeSingle()
  if (motivoErro) return { ok: false, erro: 'Não foi possível consultar o motivo da perda.' }

  const agora = new Date().toISOString()
  const { data: atualizado, error } = await db.from('opportunities')
    .update({ lost_at: agora, lost_reason: motivo, paused_at: null })
    .eq('id', oppId).select('id').maybeSingle()
  if (error) return { ok: false, erro: 'Não foi possível registrar a perda.' }
  if (!atualizado) return { ok: false, erro: 'Negócio não encontrado ou indisponível.' }

  // Mantém a etapa comercial e registra a perda como evento na timeline.
  // As duas gravações ainda não são uma transação; não mascarar falha parcial.
  const { error: historicoErro } = await db.from('stage_history').insert({
    opportunity_id: oppId,
    from_stage: o.stage,
    to_stage: 'perdido',
    reason: mr?.label ?? motivo,
    actor_type: ator.tipo,
    changed_by: ator.tipo === 'user' ? ator.id : null,
    changed_at: agora,
  })

  revalidatePath('/')
  revalidatePath('/pipeline')
  revalidatePath('/comercial')
  revalidatePath(`/lead/${oppId}`)
  if (historicoErro) return { ok: false, erro: 'Perda registrada, mas houve falha ao registrar o histórico. Verifique antes de tentar novamente.' }
  return { ok: true }
}
