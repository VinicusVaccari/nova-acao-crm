import { db, dashComercial, funnelSeries, periodo } from '@/lib/db'
import { brl, brlCurto, dataCurta, dias, dur, num, pct } from '@/lib/format'
import { Kpi, Painel, Secao, Selo, Tabela, Td } from '@/components/ui'
import { FunilBarras, RankingBarras, SerieDuasContagens, SerieTaxa } from '@/components/charts'
import { Periodos } from '@/components/periodos'

export const dynamic = 'force-dynamic'

export default async function Comercial({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>
}) {
  const sp = await searchParams
  const janela = Number(sp.dias ?? 30)
  const p = periodo(janela)

  const [d, serie, objecoes, vendedores, reunioes] = await Promise.all([
    dashComercial(p),
    funnelSeries(p, janela > 45 ? 'week' : 'day'),
    db.from('v_objection_map').select('*').limit(6),
    db.rpc('fn_dash_por_vendedor', { p_from: p.de, p_to: p.ate }),
    db
      .from('meetings')
      .select('scheduled_at,status')
      .gte('scheduled_at', p.de)
      .lte('scheduled_at', `${p.ate}T23:59:59`),
  ])

  // Show rate por semana — realizadas / (realizadas + no-show)
  const semanas = new Map<string, { ok: number; falta: number }>()
  for (const m of reunioes.data ?? []) {
    if (m.status !== 'realizada' && m.status !== 'no_show') continue
    const dt = new Date(m.scheduled_at as string)
    dt.setDate(dt.getDate() - dt.getDay())
    const k = dt.toISOString().slice(0, 10)
    const v = semanas.get(k) ?? { ok: 0, falta: 0 }
    if (m.status === 'realizada') v.ok++
    else v.falta++
    semanas.set(k, v)
  }
  const serieShow = [...semanas.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({
      bucket: dataCurta(k),
      taxa: v.ok + v.falta ? Math.round((v.ok / (v.ok + v.falta)) * 1000) / 10 : 0,
    }))

  const funil = [
    { etapa: 'Leads',            valor: d.leads,               conv: null },
    { etapa: 'Qualificados',     valor: d.qualificados,        conv: pct(d.tx_qualificacao) },
    { etapa: 'Reunião agendada', valor: d.agendamentos,        conv: pct(d.tx_agendamento) },
    { etapa: 'Reunião feita',    valor: d.reunioes_realizadas, conv: pct(d.show_rate) },
    { etapa: 'Proposta',         valor: d.propostas,           conv: pct(d.tx_reuniao_proposta) },
    { etapa: 'Venda',            valor: d.vendas,              conv: pct(d.win_rate) },
  ]

  const serieVol = serie.map(s => ({
    bucket: dataCurta(s.bucket),
    leads: Number(s.leads),
    reunioes: Number(s.diagnosticos),
  }))

  const objs = (objecoes.data ?? []).map(o => ({
    rotulo: o.label as string,
    valor: Number(o.receita_perdida),
    detalhe: `${o.ocorrencias} ocorrências · ${o.pct_letal ?? 0}% letal`,
  }))

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">Comercial</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {dataCurta(p.de)} a {dataCurta(p.ate)} · {d.deals_abertos} deals abertos ·{' '}
            {brlCurto(d.pipeline_ponderado)} de pipeline ponderado
          </p>
        </div>
        <Periodos atual={janela} base="/comercial" />
      </div>

      {/* Os indicadores do painel desenhado à mão */}
      <Secao titulo="Indicadores do funil">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <Kpi rotulo="Leads" valor={num(d.leads)} nota={`${num(d.qualificados)} qualificados`} />
          <Kpi
            rotulo="Speed to lead"
            valor={dur(d.speed_to_lead_min)}
            meta="5 min"
            estado={d.speed_to_lead_min <= 5 ? 'good' : d.speed_to_lead_min <= 15 ? 'warning' : 'critical'}
          />
          <Kpi
            rotulo="TX qualificação (MQL→SQL)"
            valor={pct(d.tx_qualificacao)}
            meta="35%"
            estado={d.tx_qualificacao >= 35 ? 'good' : d.tx_qualificacao >= 25 ? 'warning' : 'critical'}
          />
          <Kpi
            rotulo="TX agendamento"
            valor={pct(d.tx_agendamento)}
            meta="60%"
            estado={d.tx_agendamento >= 60 ? 'good' : d.tx_agendamento >= 45 ? 'warning' : 'critical'}
          />
          <Kpi
            rotulo="Comparecimento (show rate)"
            valor={pct(d.show_rate)}
            meta="75%"
            estado={d.show_rate >= 75 ? 'good' : d.show_rate >= 60 ? 'warning' : 'critical'}
          />
          <Kpi
            rotulo="Conversão reunião → proposta"
            valor={pct(d.tx_reuniao_proposta)}
            meta="65%"
            estado={d.tx_reuniao_proposta >= 65 ? 'good' : d.tx_reuniao_proposta >= 50 ? 'warning' : 'critical'}
          />
          <Kpi
            rotulo="Win rate (proposta → venda)"
            valor={pct(d.win_rate)}
            meta="30%"
            estado={d.win_rate >= 30 ? 'good' : d.win_rate >= 20 ? 'warning' : 'critical'}
          />
          <Kpi
            rotulo="Ticket médio (contrato)"
            valor={brlCurto(d.ticket_medio_contrato)}
            nota={`${brl(d.ticket_medio_mrr)}/mês`}
          />
          <Kpi
            rotulo="Ciclo de venda"
            valor={dias(d.ciclo_venda_dias)}
            meta="≤ 21 dias"
            estado={d.ciclo_venda_dias <= 21 ? 'good' : d.ciclo_venda_dias <= 35 ? 'warning' : 'critical'}
          />
          <Kpi rotulo="Receita fechada" valor={brlCurto(d.receita_fechada)} nota={`${num(d.vendas)} vendas`} />
        </div>
      </Secao>

      <Secao titulo="Onde o funil trava">
        <div className="grid lg:grid-cols-2 gap-4">
          <Painel titulo="Funil de conversão" legenda="Volume por etapa e conversão em relação à etapa anterior">
            <FunilBarras dados={funil} />
          </Painel>

          <Painel
            titulo="Volume por período"
            legenda="Leads captados e reuniões realizadas — mesma escala, uma leitura só"
          >
            <SerieDuasContagens
              dados={serieVol}
              a={{ chave: 'leads', rotulo: 'Leads' }}
              b={{ chave: 'reunioes', rotulo: 'Reuniões realizadas' }}
            />
          </Painel>
        </div>
      </Secao>

      <Secao
        titulo="Show rate"
        descricao="A métrica mais subestimada da operação: cada ponto perdido aqui é verba de mídia jogada fora."
      >
        <Painel
          titulo="Comparecimento por semana"
          legenda={`${num(d.reunioes_realizadas)} realizadas · ${num(d.reunioes_no_show)} no-show · ${num(d.reunioes_pendentes)} ainda por vir`}
        >
          <SerieTaxa dados={serieShow} chave="taxa" rotulo="Show rate" meta={75} />
        </Painel>
      </Secao>

      <Secao
        titulo="Mapa de objeções"
        descricao="Alimentado sozinho a cada reunião. Ordenado por quanto dinheiro cada objeção custou, não por frequência."
      >
        <Painel
          titulo="Receita perdida por objeção"
          legenda="As três primeiras são a sua pauta de conteúdo do próximo mês"
        >
          {objs.length ? (
            <RankingBarras dados={objs} />
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              Nenhuma objeção registrada no período.
            </p>
          )}
        </Painel>
      </Secao>

      <Secao titulo="Time comercial">
        <Painel titulo="Desempenho por pessoa" legenda="Ordenado por receita fechada no período">
          <Tabela
            colunas={[
              { label: 'Pessoa' },
              { label: 'Leads', alinhar: 'd' },
              { label: 'Reuniões', alinhar: 'd' },
              { label: 'Propostas', alinhar: 'd' },
              { label: 'Vendas', alinhar: 'd' },
              { label: 'Win rate', alinhar: 'd' },
              { label: 'Ticket médio', alinhar: 'd' },
              { label: 'Ciclo', alinhar: 'd' },
              { label: 'Receita', alinhar: 'd' },
            ]}
          >
            {(vendedores.data ?? []).map((v: Record<string, never>) => (
              <tr key={String(v.owner_id)}>
                <Td forte>{v.nome}</Td>
                <Td d>{num(v.leads)}</Td>
                <Td d>{num(v.reunioes)}</Td>
                <Td d>{num(v.propostas)}</Td>
                <Td d>{num(v.vendas)}</Td>
                <Td d>{v.win_rate == null ? '—' : pct(v.win_rate)}</Td>
                <Td d>{v.ticket_medio ? brlCurto(v.ticket_medio) : '—'}</Td>
                <Td d>{v.ciclo_dias == null ? '—' : dias(v.ciclo_dias)}</Td>
                <Td d forte>
                  {brlCurto(v.receita)}
                </Td>
              </tr>
            ))}
          </Tabela>
        </Painel>
      </Secao>

      {/* A leitura acessível dos mesmos números do gráfico de funil */}
      <Secao titulo="Funil em números">
        <Painel titulo="Etapa a etapa" legenda="Os mesmos dados do gráfico, em tabela">
          <Tabela
            colunas={[
              { label: 'Etapa' },
              { label: 'Oportunidades', alinhar: 'd' },
              { label: 'Conversão da etapa anterior', alinhar: 'd' },
              { label: 'Do total de leads', alinhar: 'd' },
            ]}
          >
            {funil.map(f => (
              <tr key={f.etapa}>
                <Td forte>{f.etapa}</Td>
                <Td d>{num(f.valor)}</Td>
                <Td d>{f.conv ?? '—'}</Td>
                <Td d>{d.leads ? pct((f.valor / d.leads) * 100) : '—'}</Td>
              </tr>
            ))}
          </Tabela>
          <div className="mt-4 text-[12px]">
            <Selo
              tipo="neutro"
              texto={`Pipeline aberto: ${brl(d.pipeline_bruto)} bruto · ${brl(d.pipeline_ponderado)} ponderado pela probabilidade de cada etapa`}
            />
          </div>
        </Painel>
      </Secao>
    </>
  )
}
