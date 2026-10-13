import { userDatabase } from '@/lib/security/user-db'
import { dashComercial, funnelSeries } from '@/lib/db'
import { carregarVendas } from '@/lib/vendas-server'
import { moedaVenda, periodoIndicadores } from '@/lib/vendas'
import { normalizarDashFollowup, normalizarDashPerdas } from '@/lib/dash-comercial'
import { CohortsVendas } from '@/components/cohorts-vendas'
import { brl, brlCurto, dataCurta, dias, dur, num, pct } from '@/lib/format'
import { Kpi, Painel, Secao, Selo, Tabela, Td } from '@/components/ui'
import { FunilBarras, SerieDuasContagens, SerieTaxa } from '@/components/charts'
import { Periodos } from '@/components/periodos'

export const dynamic = 'force-dynamic'

export default async function Comercial({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>
}) {
  const db = await userDatabase()
  const sp = await searchParams
  const p = periodoIndicadores(sp.dias)
  const janela = p.atual ?? 30

  const [d, serie, vendedores, reunioes, vendas, perfisVendedores, perdas, followup] = await Promise.all([
    dashComercial(p),
    funnelSeries(p, janela > 45 ? 'week' : 'day'),
    db.rpc('fn_dash_por_vendedor', { p_from: p.de, p_to: p.ate }),
    db
      .from('meetings')
      .select('scheduled_at,status')
      .gte('scheduled_at', p.de)
      .lte('scheduled_at', `${p.ate}T23:59:59`),
    carregarVendas(p),
    db.from('profiles').select('id').eq('role', 'vendedor').eq('is_active', true),
    db.rpc('fn_dash_perdas', { p_from: p.de, p_to: p.ate }),
    db.rpc('fn_dash_followup', { p_from: p.de, p_to: p.ate }),
  ])

  if (perfisVendedores.error || vendedores.error || perdas.error || followup.error) {
    throw new Error('Não foi possível carregar o desempenho dos vendedores.')
  }
  // O RPC legado inclui todos os perfis ativos. A tabela comercial mostra
  // apenas quem tem o papel Vendedor, mesmo sem movimento no período.
  const idsVendedores = new Set((perfisVendedores.data ?? []).map(perfil => perfil.id))
  const timeComercial = (vendedores.data ?? []).filter((v: { owner_id: string }) => idsVendedores.has(v.owner_id))
  const dashPerdas = normalizarDashPerdas(perdas.data)
  const dashFollowup = normalizarDashFollowup(followup.data)
  const usd = (v: number) => `US$ ${v.toFixed(2)}`

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
    { etapa: 'Leads',                 valor: d.leads,         conv: null, porAvanco: 0 },
    { etapa: 'Qualificação',          valor: d.qualificados,  conv: pct(d.tx_qualificacao), porAvanco: d.qualificados_por_avanco },
    { etapa: 'Etapa de agendamento',  valor: d.agendamentos,  conv: pct(d.tx_agendamento), porAvanco: d.agendados_por_avanco },
    { etapa: 'Etapa de diagnóstico',  valor: d.diagnosticos,  conv: d.agendamentos ? pct(d.diagnosticos / d.agendamentos * 100) : '—', porAvanco: d.diagnosticos_por_avanco },
    { etapa: 'Etapa de proposta',     valor: d.propostas,     conv: pct(d.tx_reuniao_proposta), porAvanco: d.propostas_por_avanco },
    { etapa: 'Venda',                 valor: d.vendas,        conv: pct(d.win_rate), porAvanco: 0 },
  ]

  const serieVol = serie.map(s => ({
    bucket: dataCurta(s.bucket),
    leads: Number(s.leads),
    reunioes: Number(s.diagnosticos),
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
        <Periodos atual={p.atual} base="/comercial" incluirMes />
      </div>

      {/* Os indicadores do painel desenhado à mão */}
      <Secao titulo="Indicadores do funil" descricao="Conversões incluem etapas superadas por avanço direto. Comparecimento conta apenas reuniões reais.">
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
            rotulo="Conversão à etapa de agendamento"
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
            rotulo="Conversão diagnóstico → proposta"
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
          <Kpi rotulo="Vendidos" valor={moedaVenda(vendas.vendidos)} nota={`${num(vendas.vendas)} vendas · valor único + primeira mensalidade`} />
        </div>
      </Secao>

      <Secao titulo="Receita por mês de venda">
        <div className="flex flex-wrap gap-x-6 gap-y-2 t-sm" style={{ marginBottom: 'var(--s-4)' }}>
          <span>Valor único vendido: <strong>{moedaVenda(vendas.unico)}</strong></span>
          <span>Novo valor mensal vendido: <strong>{moedaVenda(vendas.mensal)}/mês</strong></span>
        </div>
        <CohortsVendas cohorts={vendas.cohorts} />
      </Secao>

      <Secao titulo="Motivos de perda" descricao="Negócios perdidos no período selecionado. A origem vem do ator do evento de perda no histórico de etapas.">
        <div className="grid lg:grid-cols-2 gap-4">
          <Painel titulo="Motivos registrados" legenda={`${num(dashPerdas.total_perdidos)} perdas no período`}>
            <Tabela colunas={[{ label: 'Motivo' }, { label: 'Perdas', alinhar: 'd' }, { label: 'Do total', alinhar: 'd' }]}>
              {dashPerdas.motivos.map(motivo => (
                <tr key={motivo.rotulo}>
                  <Td forte>{motivo.rotulo}</Td>
                  <Td d>{num(motivo.quantidade)}</Td>
                  <Td d>{pct(motivo.percentual)}</Td>
                </tr>
              ))}
              {dashPerdas.motivos.length === 0 && (
                <tr><td colSpan={3} className="t-sm muted">Nenhuma perda registrada no período.</td></tr>
              )}
            </Tabela>
          </Painel>
          <Painel titulo="Como a perda foi registrada" legenda="Automática: Naia ou MEL. Vendedor: perda marcada manualmente.">
            <div className="grid grid-cols-3 gap-3">
              <Kpi rotulo="Automática" valor={num(dashPerdas.automaticas)} />
              <Kpi rotulo="Vendedor" valor={num(dashPerdas.vendedor)} />
              <Kpi rotulo="Não identificado" valor={num(dashPerdas.nao_identificado)} />
            </div>
          </Painel>
        </div>
      </Secao>

      <Secao titulo="Follow-up (MEL)" descricao="Coorte pelo primeiro toque enviado no período. As respostas, etapas e desfechos continuam sendo acompanhados depois dele.">
        <div className="grid lg:grid-cols-2 gap-4">
          <Painel titulo="Coorte do período" legenda="Só entram negócios cujo primeiro disparo enviado caiu no período selecionado.">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Kpi rotulo="Leads na coorte" valor={num(dashFollowup.leads_coorte)} />
              <Kpi rotulo="Toques enviados" valor={num(dashFollowup.toques_enviados)} />
              <Kpi rotulo="Responderam" valor={num(dashFollowup.responderam)} nota={pct(dashFollowup.tx_resposta)} />
              <Kpi rotulo="Qualificados" valor={num(dashFollowup.qualificados)} nota={pct(dashFollowup.tx_qualificacao)} />
              <Kpi rotulo={'Perdidos por “sumiu”'} valor={num(dashFollowup.perdidos_sumiu)} />
            </div>
          </Painel>
          <Painel titulo="Desfecho dos qualificados" legenda="Situação atual dos negócios que chegaram a qualificado depois do primeiro toque.">
            <div className="grid grid-cols-3 gap-3" style={{ marginBottom: 'var(--s-4)' }}>
              <Kpi rotulo="Venderam" valor={num(dashFollowup.qualificados_venderam)} nota={pct(dashFollowup.tx_venda)} />
              <Kpi rotulo="Perderam" valor={num(dashFollowup.qualificados_perderam)} />
              <Kpi rotulo="Em andamento" valor={num(dashFollowup.qualificados_em_andamento)} />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 t-sm">
              <span>Custo da coorte: <strong>{usd(dashFollowup.custo_coorte_usd)}</strong></span>
              <span>Custo de hoje: <strong>{usd(dashFollowup.custo_hoje_usd)}</strong> de {usd(dashFollowup.teto_custo_dia_usd)}</span>
            </div>
          </Painel>
        </div>
      </Secao>

      <Secao titulo="Onde o funil trava">
        <div className="grid lg:grid-cols-2 gap-4">
          <Painel titulo="Funil acumulado" legenda="Uma venda direta também supera as etapas anteriores. Isso não registra reuniões ou propostas como realizadas.">
            <FunilBarras dados={funil} />
          </Painel>

          <Painel
            titulo="Volume por período"
            legenda="Leads captados e negócios que alcançaram ou superaram a etapa de diagnóstico"
          >
            <SerieDuasContagens
              dados={serieVol}
              a={{ chave: 'leads', rotulo: 'Leads' }}
              b={{ chave: 'reunioes', rotulo: 'Etapa de diagnóstico' }}
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

      <Secao titulo="Time comercial">
        <Painel titulo="Desempenho dos vendedores" legenda="Vendedores ativos · etapas de diagnóstico e proposta incluem avanços diretos · valores incluem o prazo contratado">
          <Tabela
            colunas={[
              { label: 'Vendedor' },
              { label: 'Leads', alinhar: 'd' },
              { label: 'Etapa diagnóstico', alinhar: 'd' },
              { label: 'Etapa proposta', alinhar: 'd' },
              { label: 'Vendas', alinhar: 'd' },
              { label: 'Win rate', alinhar: 'd' },
              { label: 'Ticket (contrato)', alinhar: 'd' },
              { label: 'Ciclo', alinhar: 'd' },
              { label: 'Valor dos contratos', alinhar: 'd' },
            ]}
          >
            {timeComercial.map((v: Record<string, never>) => (
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
            {timeComercial.length === 0 && (
              <tr><td colSpan={9} className="t-sm muted">Nenhum vendedor ativo disponível.</td></tr>
            )}
          </Tabela>
        </Painel>
      </Secao>

      {/* A leitura acessível dos mesmos números do gráfico de funil */}
      <Secao titulo="Funil em números">
        <Painel titulo="Etapa a etapa" legenda="Etapas alcançadas ou superadas. A coluna Por avanço direto identifica os negócios que pularam aquela etapa.">
          <Tabela
            colunas={[
              { label: 'Etapa' },
              { label: 'Oportunidades', alinhar: 'd' },
              { label: 'Por avanço direto', alinhar: 'd' },
              { label: 'Conversão da etapa anterior', alinhar: 'd' },
              { label: 'Do total de leads', alinhar: 'd' },
            ]}
          >
            {funil.map(f => (
              <tr key={f.etapa}>
                <Td forte>{f.etapa}</Td>
                <Td d>{num(f.valor)}</Td>
                <Td d>{num(f.porAvanco)}</Td>
                <Td d>{f.conv ?? '—'}</Td>
                <Td d>{d.leads ? pct((f.valor / d.leads) * 100) : '—'}</Td>
              </tr>
            ))}
          </Tabela>
          <p className="t-xs muted" style={{ marginTop: 'var(--s-3)' }}>
            Cada marco conta na primeira data em que foi alcançado ou superado; etapas puladas usam a data do avanço.
            Leads contam pela criação. Como as datas podem cair em períodos diferentes, as conversões do período podem superar 100%.
          </p>
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
