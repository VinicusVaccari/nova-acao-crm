export const MOTIVO_CONVERSA_SEM_RESPOSTA = 'guardrail:conversa_sem_resposta'

const MARCAS_CONVERSA_ANTERIOR = [
  'conversamos', 'nossa conversa', 'você disse', 'você comentou',
  'como falamos', 'lembra', 'estávamos falando', 'ficou parada', 'retomando nossa',
]

function normalizar(texto: string): string {
  return texto.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
}

export function deveBloquearConversaSemResposta(params: { mensagem: string; leadRespondeu: boolean }): boolean {
  if (params.leadRespondeu) return false
  const mensagem = normalizar(params.mensagem)
  return MARCAS_CONVERSA_ANTERIOR.some(marca => mensagem.includes(normalizar(marca)))
}
