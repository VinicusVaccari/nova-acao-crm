export type LinhaProdutoValor = {
  quantity?: number | null
  mrr?: number | null
  discount?: number | null
  recurrence?: string | null
}

export function calcularValoresProdutos(produtos: LinhaProdutoValor[]) {
  let mensal = 0
  let unico = 0
  for (const p of produtos) {
    const linha = Math.max(0, Number(p.quantity ?? 1) * Number(p.mrr ?? 0) - Number(p.discount ?? 0))
    if (p.recurrence === 'mensal') mensal += linha
    else unico += linha
  }
  return { expectedValue: mensal, setupValue: unico }
}

export function validarDadosProduto(dados: {
  quantity: number
  unitValue: number
  recurrence: string
  discount: number
}) {
  if (!Number.isInteger(dados.quantity) || dados.quantity < 1) return 'Quantidade inválida.'
  if (!Number.isFinite(dados.unitValue) || dados.unitValue < 0) return 'Valor unitário inválido.'
  if (!['mensal', 'unico'].includes(dados.recurrence)) return 'Recorrência inválida.'
  if (!Number.isFinite(dados.discount) || dados.discount < 0) return 'Desconto inválido.'
  return null
}
