type Registro = Record<string, unknown>

export const MOTIVO_NOME_NAO_DITO_PELO_LEAD = 'guardrail:nome_nao_dito_pelo_lead'

function registro(valor: unknown): Registro | null {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Registro : null
}

function tokens(texto: string): string[] {
  return texto.trim().split(/\s+/)
    .map(termo => termo.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '').replaceAll(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase('pt-BR'))
    .filter(Boolean)
}

function contemSequencia(texto: string, alvo: string[]): boolean {
  const origem = tokens(texto)
  if (!alvo.length || alvo.length > origem.length) return false
  for (let inicio = 0; inicio <= origem.length - alvo.length; inicio++) {
    if (alvo.every((termo, indice) => origem[inicio + indice] === termo)) return true
  }
  return false
}

function falasInbound(contexto: unknown): string[] {
  const origem = registro(contexto)
  if (!origem || !Array.isArray(origem.last_activities)) return []
  return origem.last_activities.flatMap(atividade => {
    const item = registro(atividade)
    return item?.direction === 'inbound' && typeof item.body === 'string' ? [item.body] : []
  })
}

/**
 * O perfil do WhatsApp pode ser salvo em people.full_name. A IA não recebe
 * esse campo, mas esta trava usa o contexto cru apenas para impedir que uma
 * resposta probabilística o reintroduza sem o lead tê-lo escrito.
 */
export function deveBloquearNomeNaoDitoPeloLead(params: { mensagem: string; contexto: unknown }): boolean {
  const origem = registro(params.contexto)
  const person = origem && registro(origem.person)
  const nomeCompleto = typeof person?.full_name === 'string' ? person.full_name.trim() : ''
  if (!nomeCompleto) return false

  const alvoCompleto = tokens(nomeCompleto)
  const primeiroTermoBruto = nomeCompleto.split(/\s+/)[0] ?? ''
  const alvoPrimeiroTermo = primeiroTermoBruto.length >= 3 ? tokens(primeiroTermoBruto) : []
  const mensagensInbound = falasInbound(params.contexto)

  const nomeCompletoNaoDito = contemSequencia(params.mensagem, alvoCompleto)
    && !mensagensInbound.some(mensagem => contemSequencia(mensagem, alvoCompleto))
  const primeiroTermoNaoDito = alvoPrimeiroTermo.length > 0
    && contemSequencia(params.mensagem, alvoPrimeiroTermo)
    && !mensagensInbound.some(mensagem => contemSequencia(mensagem, alvoPrimeiroTermo))

  return nomeCompletoNaoDito || primeiroTermoNaoDito
}
