/**
 * `followup_disparos.toque` é global (1..6); já `followup_textos.toque`
 * é a posição dentro do lote (1..3). O executor recebe do banco as colunas
 * geradas lote/toque_no_lote e nunca deve consultar texto pelo toque global.
 */
export function chaveTextoBaseFollowup(lote: number, toqueNoLote: number) {
  if (![1, 2].includes(lote) || ![1, 2, 3].includes(toqueNoLote)) {
    throw new Error(`Chave de texto de follow-up inválida: lote ${lote}, toque no lote ${toqueNoLote}.`)
  }
  return { lote, toque: toqueNoLote }
}

/** O lote 2 só existe depois do toque 4; até lá o teto honesto é três. */
export function totalSeloFollowup(lote: number): number {
  if (![1, 2].includes(lote)) throw new Error(`Lote de follow-up inválido: ${lote}.`)
  return lote * 3
}

/**
 * A posição exibida continua contando cada lote como três lugares, mesmo se
 * o lote anterior terminou antes por uma resposta do lead. `toque` global
 * não serve mais para a UI porque passa a ser só a chave idempotente.
 */
export function toqueExibidoSeloFollowup(lote: number, toqueNoLote: number): number {
  chaveTextoBaseFollowup(lote, toqueNoLote)
  return (lote - 1) * 3 + toqueNoLote
}

/** Espelha a decisão de estado de fn_followup_elegiveis (migration 0064). */
export function proximoToqueFollowupRodada({
  loteMax,
  toquesNoLoteAtual,
  respondeuNoLoteAtual,
}: {
  loteMax: number
  toquesNoLoteAtual: number
  respondeuNoLoteAtual: boolean
}): { lote: number; toqueNoLote: number } | null {
  if (![0, 1, 2].includes(loteMax) || ![0, 1, 2, 3].includes(toquesNoLoteAtual)) {
    throw new Error('Estado de rodada de follow-up inválido.')
  }
  if (loteMax === 0) return { lote: 1, toqueNoLote: 1 }
  if (toquesNoLoteAtual < 3 && !respondeuNoLoteAtual) {
    return { lote: loteMax, toqueNoLote: toquesNoLoteAtual + 1 }
  }
  if (respondeuNoLoteAtual && loteMax < 2) return { lote: loteMax + 1, toqueNoLote: 1 }
  return null
}
