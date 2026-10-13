import 'server-only'

export class OrcamentoLunaEsgotado extends Error {
  constructor(etapa: string) { super(`orçamento insuficiente: ${etapa}`); this.name = 'OrcamentoLunaEsgotado' }
}

// 55s desde a entrada no trabalho: os 5s restantes pertencem à plataforma.
// Reserva de 10s: uma parte (~6s), aviso/tarefa em paralelo (~2–3s) e liberação
// da lease. Cada transporte recebe prazo real; a reserva nunca reinicia.
export const RESERVA_FINAL_LUNA_MS = 10_000
export function criarOrcamentoLuna() {
  return { limiteEm: Date.now() + 55_000 }
}
export type OrcamentoLuna = ReturnType<typeof criarOrcamentoLuna>

export function prazoEtapaLuna(orcamento: OrcamentoLuna | undefined, etapa: string, timeoutNormalMs: number, minimoUtilMs = 3000) {
  const agora = Date.now()
  const disponivel = orcamento ? orcamento.limiteEm - agora - RESERVA_FINAL_LUNA_MS : timeoutNormalMs
  const timeoutMs = Math.min(timeoutNormalMs, disponivel)
  if (timeoutMs < minimoUtilMs) throw new OrcamentoLunaEsgotado(etapa)
  return agora + timeoutMs
}

/** Limita apenas esperas de finalização; a etapa Google usa cancelamento real. */
export async function finalizarNoPrazoLuna<T>(promessa: PromiseLike<T>, limiteEm: number, etapa: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(promessa),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OrcamentoLunaEsgotado(etapa)), Math.max(1, limiteEm - Date.now()))
      }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}
