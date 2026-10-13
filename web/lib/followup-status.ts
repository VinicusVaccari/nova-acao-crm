/**
 * O selo representa uma cadência ainda em andamento. O histórico continua
 * intacto, mas uma resposta posterior ao último envio encerra sua exibição.
 */
export function deveMostrarSeloFollowup(
  ultimoDisparoEnviadoEm: string | null | undefined,
  ultimaInboundEm: string | null | undefined,
): boolean {
  if (!ultimoDisparoEnviadoEm) return false
  if (!ultimaInboundEm) return true
  return new Date(ultimaInboundEm).getTime() <= new Date(ultimoDisparoEnviadoEm).getTime()
}
