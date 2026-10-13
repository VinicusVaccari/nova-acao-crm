export type VarianteFollowup = 'padrao' | 'sem_resposta'

/** O lote 2 só existe depois de uma resposta; portanto nunca usa variante. */
export function varianteTextoFollowup(lote: number, leadRespondeu: boolean): VarianteFollowup {
  return lote === 1 && !leadRespondeu ? 'sem_resposta' : 'padrao'
}
