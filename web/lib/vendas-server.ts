import 'server-only'
import { userDatabase } from './security/user-db'
import { resumirVendas, type Venda } from './vendas'

export async function carregarVendas(periodo: { de: string; ate: string }) {
  const db = await userDatabase()
  const vendas: Venda[] = []
  const tamanho = 500
  // A mesma data de ganho dos indicadores existentes, com limites em Brasília.
  // Paginação evita que o limite padrão do Supabase corte o total silenciosamente.
  for (let inicio = 0; ; inicio += tamanho) {
    const { data, error } = await db.from('v_opp_journey')
      .select('id, ganho_at, expected_value, setup_value, term_months')
      .gte('ganho_at', `${periodo.de}T00:00:00-03:00`)
      .lte('ganho_at', `${periodo.ate}T23:59:59.999999-03:00`)
      .order('ganho_at').order('id')
      .range(inicio, inicio + tamanho - 1)
    if (error) throw new Error('Não foi possível carregar as vendas do período.')
    const pagina = (data ?? []) as Venda[]
    vendas.push(...pagina)
    if (pagina.length < tamanho) break
  }
  return resumirVendas(vendas)
}
