import { MESES_PROJECAO, moedaVenda, type CohortVenda } from '@/lib/vendas'
import { Painel, Tabela, Td } from './ui'

const mesVenda = (mes: string) => new Intl.DateTimeFormat('pt-BR', {
  month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo',
}).format(new Date(`${mes}-01T12:00:00Z`))

export function CohortsVendas({ cohorts }: { cohorts: CohortVenda[] }) {
  return (
    <Painel titulo="Projeção de receita por cohort de venda" legenda="Cada linha agrupa as vendas do mesmo mês dentro do período selecionado.">
      {cohorts.length ? (
        <Tabela colunas={[
          { label: 'Mês da venda' },
          { label: 'Vendas', alinhar: 'd' },
          { label: 'Vendidos', alinhar: 'd' },
          ...Array.from({ length: MESES_PROJECAO }, (_, i) => ({ label: `Mês ${i + 1}`, alinhar: 'd' as const })),
          { label: 'Projeção em 12 meses', alinhar: 'd' },
        ]}>
          {cohorts.map(c => (
            <tr key={c.mes}>
              <Td forte>{mesVenda(c.mes)}</Td>
              <Td d>{c.vendas}</Td>
              <Td d forte>{moedaVenda(c.vendidos)}</Td>
              {c.meses.map((valor, i) => <Td key={i} d>{moedaVenda(valor)}</Td>)}
              <Td d forte>{moedaVenda(c.totalProjetado)}</Td>
            </tr>
          ))}
        </Tabela>
      ) : <p className="t-sm muted">Nenhuma venda no período selecionado.</p>}
      <p className="t-xs muted" style={{ marginTop: 'var(--s-4)' }}>
        Vendidos = valor único + primeira mensalidade. Mês 1 é o mês da venda e inclui o valor único;
        os meses seguintes incluem apenas as mensalidades, até o prazo de cada negócio (12 meses quando não informado).
        A projeção mostra até 12 meses, sem proporcionalidade por dia, cancelamentos ou expansão.
      </p>
      <p className="t-xs muted" style={{ marginTop: 'var(--s-2)' }}>
        Estimativa com os valores atuais dos negócios, não receita recebida nem LTV medido.
        Alterações posteriores nos valores recalculam a projeção e o indicador Vendidos.
      </p>
    </Painel>
  )
}
