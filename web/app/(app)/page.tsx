import Link from 'next/link'
import { db } from '@/lib/db'
import { brl, brlCurto, dur, num } from '@/lib/format'
import { Painel, Secao, Selo } from '@/components/ui'

export const dynamic = 'force-dynamic'

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

const dia = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })

/* -----------------------------------------------------------------
   A tela que abre o dia. Não é dashboard: é fila de trabalho.
   Ordem deliberada — o que perde dinheiro mais rápido vem primeiro.
   ----------------------------------------------------------------- */
export default async function Hoje() {
  const agora = new Date()
  const fimDoDia = new Date(agora)
  fimDoDia.setHours(23, 59, 59)
  const em48h = new Date(agora.getTime() + 48 * 3600 * 1000)

  const [sla, reunioesHoje, acoesVencidas, parados, semAcao] = await Promise.all([
    db.from('v_sla_breaches').select('*').limit(50),
    db
      .from('meetings')
      .select('id, kind, scheduled_at, status, opportunity_id, opportunities(person_id, expected_value, people(full_name), companies(trade_name))')
      .gte('scheduled_at', agora.toISOString())
      .lte('scheduled_at', em48h.toISOString())
      .in('status', ['agendada', 'confirmada'])
      .order('scheduled_at'),
    db
      .from('opportunities')
      .select('id, stage, next_step, next_step_due, expected_value, term_months, people(full_name), companies(trade_name)')
      .is('lost_at', null)
      .not('stage', 'in', '(ganho,nutricao)')
      .not('next_step_due', 'is', null)
      .lt('next_step_due', fimDoDia.toISOString())
      .order('next_step_due')
      .limit(30),
    db.from('v_stale_deals').select('*').limit(15),
    db
      .from('opportunities')
      .select('id', { count: 'exact', head: true })
      .is('lost_at', null)
      .not('stage', 'in', '(ganho,nutricao)')
      .is('next_step_due', null),
  ])

  const leadsParados = sla.data ?? []
  const reunioes = reunioesHoje.data ?? []
  const acoes = acoesVencidas.data ?? []
  const travados = parados.data ?? []

  const nome = (o: unknown) => {
    const r = o as { people?: { full_name?: string }; companies?: { trade_name?: string } } | null
    return { pessoa: r?.people?.full_name ?? 'Sem nome', empresa: r?.companies?.trade_name }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[19px] font-semibold tracking-tight">Hoje</h1>
        <p className="text-[13px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
          {agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })} · o que precisa
          da sua mão agora, na ordem em que custa dinheiro
        </p>
      </div>

      {/* 1 — SLA: cada minuto aqui derruba a conversão */}
      <Secao
        titulo={`Leads sem contato (${leadsParados.length})`}
        descricao="Lead que espera uma hora converte a uma fração do lead atendido em cinco minutos."
      >
        <Painel titulo="Fura-fila" legenda="Ordenado pelo que está esperando há mais tempo">
          {leadsParados.length ? (
            <div className="flex flex-col">
              {leadsParados.map(l => (
                <Link
                  key={l.id as string}
                  href={`/lead/${l.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  style={{ borderBottom: '1px solid var(--hairline)' }}
                >
                  <div>
                    <div className="text-[13px] font-medium">{l.full_name as string}</div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      {(l.phone_primary as string) ?? ''} · {(l.source_channel as string) ?? 'origem desconhecida'}
                    </div>
                  </div>
                  <Selo
                    tipo={Number(l.minutos_esperando) > 60 ? 'critical' : 'warning'}
                    texto={`esperando ${dur(Number(l.minutos_esperando))}`}
                  />
                </Link>
              ))}
            </div>
          ) : (
            <Selo tipo="good" texto="Nenhum lead fora do SLA. Todo mundo foi atendido." />
          )}
        </Painel>
      </Secao>

      {/* 2 — Reuniões: show rate se ganha nas horas anteriores */}
      <Secao
        titulo={`Reuniões nas próximas 48h (${reunioes.length})`}
        descricao="Confirmação ativa antes da hora é a alavanca mais barata de show rate."
      >
        <Painel titulo="Agenda" legenda="Marque a presença logo após cada reunião — é assim que o show rate se mede sozinho">
          {reunioes.length ? (
            <div className="flex flex-col">
              {reunioes.map(m => {
                const n = nome(m.opportunities)
                const dt = new Date(m.scheduled_at as string)
                const hoje = dt.toDateString() === agora.toDateString()
                return (
                  <Link
                    key={m.id as string}
                    href={`/lead/${m.opportunity_id}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                    style={{ borderBottom: '1px solid var(--hairline)' }}
                  >
                    <div>
                      <div className="text-[13px] font-medium">{n.pessoa}</div>
                      <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                        {n.empresa ? `${n.empresa} · ` : ''}{m.kind as string}
                      </div>
                    </div>
                    <span className="text-[13px] tabular" style={{ color: hoje ? 'var(--series-1)' : 'var(--ink-2)' }}>
                      {hoje ? 'hoje' : dia(m.scheduled_at as string)} {hora(m.scheduled_at as string)}
                    </span>
                  </Link>
                )
              })}
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>Nenhuma reunião marcada para as próximas 48h.</p>
          )}
        </Painel>
      </Secao>

      {/* 3 — Ações vencidas */}
      <Secao titulo={`Ações vencidas (${acoes.length})`}>
        <Painel titulo="Prometido e não feito" legenda="Próxima ação com prazo estourado">
          {acoes.length ? (
            <div className="flex flex-col">
              {acoes.map(o => {
                const n = nome(o)
                return (
                  <Link
                    key={o.id as string}
                    href={`/lead/${o.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                    style={{ borderBottom: '1px solid var(--hairline)' }}
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium">{n.pessoa}</div>
                      <div className="text-[12px] truncate" style={{ color: 'var(--ink-muted)' }}>
                        {o.next_step as string}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[12px]" style={{ color: 'var(--critical)' }}>
                        venceu {dia(o.next_step_due as string)}
                      </div>
                      <div className="text-[12px] tabular" style={{ color: 'var(--ink-muted)' }}>
                        {brlCurto(Number(o.expected_value ?? 0) * Number(o.term_months ?? 12))}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <Selo tipo="good" texto="Nenhuma ação vencida." />
          )}
        </Painel>
      </Secao>

      {/* 4 — Negócios travados */}
      <Secao
        titulo={`Negócios parados (${travados.length})`}
        descricao={`${semAcao.count ?? 0} negócios abertos não têm próxima ação definida — é assim que pipeline apodrece.`}
      >
        <Painel titulo="Sem movimento" legenda="Ordenado por valor: comece pelo que dói mais perder">
          {travados.length ? (
            <div className="flex flex-col">
              {travados.map(t => (
                <Link
                  key={t.id as string}
                  href={`/lead/${t.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  style={{ borderBottom: '1px solid var(--hairline)' }}
                >
                  <div>
                    <div className="text-[13px] font-medium">{t.full_name as string}</div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      {t.stage as string}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] tabular">{brl(Number(t.expected_value ?? 0))}/mês</div>
                    <div className="text-[12px]" style={{ color: 'var(--serious)' }}>
                      {num(Number(t.dias_parado))} dias parado
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Selo tipo="good" texto="Nenhum negócio parado além do limite." />
          )}
        </Painel>
      </Secao>
    </>
  )
}
