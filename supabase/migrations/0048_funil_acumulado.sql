-- Analytic progression only: no writes to deals, activities or stage_history.
-- Positive milestones are cumulative; loss, nurture and disqualification are branches.
-- First downstream passage supplies a skipped milestone's timestamp.
-- Preserve existing view columns/order and the security_invoker boundary from 0046.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace view public.v_opp_journey with (security_invoker = true) as
with h as (
   select stage_history.opportunity_id,
     min(stage_history.changed_at) filter (where stage_history.to_stage in ('qualificado', 'reuniao_agendada', 'apresentacao_institucional', 'envio_proposta', 'apresentacao_proposta', 'negociacao', 'ganho'))                as qualificado_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage in ('reuniao_agendada', 'apresentacao_institucional', 'envio_proposta', 'apresentacao_proposta', 'negociacao', 'ganho'))           as agendado_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage in ('apresentacao_institucional', 'envio_proposta', 'apresentacao_proposta', 'negociacao', 'ganho')) as diagnostico_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage in ('envio_proposta', 'apresentacao_proposta', 'negociacao', 'ganho'))             as proposta_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'ganho')                       as ganho_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'perdido')                     as perdido_at,
     min(changed_at) filter (where to_stage = 'qualificado') as qualificado_real_at,
     min(changed_at) filter (where to_stage = 'reuniao_agendada') as agendado_real_at,
     min(changed_at) filter (where to_stage = 'apresentacao_institucional') as diagnostico_real_at,
     min(changed_at) filter (where to_stage = 'envio_proposta') as proposta_real_at
   from stage_history group by stage_history.opportunity_id
 ), m as (
   select meetings.opportunity_id,
     count(*) filter (where meetings.status = 'realizada') as meetings_held,
     count(*) filter (where meetings.status = 'no_show')   as meetings_noshow,
     min(meetings.scheduled_at) as first_meeting_at
   from meetings group by meetings.opportunity_id
 )
 select o.id, o.person_id, o.company_id, o.owner_id, o.sdr_id, o.stage, o.source_channel, o.product, o.score,
   o.expected_value, o.setup_value, o.term_months, o.created_at, o.first_contact_at, o.closed_at, o.lost_reason,
   coalesce(o.expected_value, 0::numeric) * coalesce(o.term_months, 12)::numeric + coalesce(o.setup_value, 0::numeric) as contract_value,
   extract(epoch from o.first_contact_at - o.created_at) / 60.0 as speed_to_lead_min,
   h.qualificado_at, h.agendado_at, h.diagnostico_at, h.proposta_at, h.ganho_at, h.perdido_at,
   extract(epoch from h.ganho_at - o.created_at) / 86400.0 as sales_cycle_days,
   coalesce(m.meetings_held, 0::bigint) as meetings_held,
   coalesce(m.meetings_noshow, 0::bigint) as meetings_noshow,
   m.first_meeting_at,
   t.utm_campaign, t.utm_content, t.utm_source, t.utm_medium, t.campaign_external_id,
    (h.qualificado_at is not null and h.qualificado_real_at is distinct from h.qualificado_at) as qualificado_por_avanco,
    (h.agendado_at is not null and h.agendado_real_at is distinct from h.agendado_at) as agendado_por_avanco,
    (h.diagnostico_at is not null and h.diagnostico_real_at is distinct from h.diagnostico_at) as diagnostico_por_avanco,
    (h.proposta_at is not null and h.proposta_real_at is distinct from h.proposta_at) as proposta_por_avanco
 from opportunities o
   left join h on h.opportunity_id = o.id
   left join m on m.opportunity_id = o.id
   left join touchpoints t on t.id = o.first_touchpoint_id;

create or replace function fn_dash_comercial(
  p_from  date default (current_date - 29),
  p_to    date default current_date,
  p_owner uuid default null
) returns jsonb language sql stable as $$
with j as (
  select * from v_opp_journey
   where (p_owner is null or owner_id = p_owner or sdr_id = p_owner)
),
-- leads: contados por data de criação
leads as (
  select count(*)::numeric as n,
         percentile_cont(0.5) within group (order by speed_to_lead_min)
           filter (where speed_to_lead_min is not null) as speed_median
    from j where created_at::date between p_from and p_to
),
-- etapas: contadas por quando o evento aconteceu no período
st as (
  select
    count(*) filter (where qualificado_at::date  between p_from and p_to)::numeric as qualificados,
    count(*) filter (where agendado_at::date     between p_from and p_to)::numeric as agendados,
    count(*) filter (where diagnostico_at::date  between p_from and p_to)::numeric as diagnosticos,
    count(*) filter (where proposta_at::date     between p_from and p_to)::numeric as propostas,
    count(*) filter (where ganho_at::date        between p_from and p_to)::numeric as ganhos,
    count(*) filter (where perdido_at::date      between p_from and p_to)::numeric as perdidos,
    coalesce(avg(contract_value)   filter (where ganho_at::date between p_from and p_to), 0) as ticket_contrato,
    coalesce(avg(expected_value)   filter (where ganho_at::date between p_from and p_to), 0) as ticket_mrr,
    coalesce(sum(contract_value)   filter (where ganho_at::date between p_from and p_to), 0) as receita,
    percentile_cont(0.5) within group (order by sales_cycle_days)
      filter (where ganho_at::date between p_from and p_to) as ciclo_mediano
  from j
),
-- show rate: por reuniões cujo horário caiu no período
mt as (
  select
    count(*) filter (where status = 'realizada')::numeric as realizadas,
    count(*) filter (where status = 'no_show')::numeric   as no_shows,
    count(*) filter (where status in ('agendada','confirmada'))::numeric as pendentes
  from meetings mm
  join opportunities oo on oo.id = mm.opportunity_id
  where mm.scheduled_at::date between p_from and p_to
    and (p_owner is null or oo.owner_id = p_owner or oo.sdr_id = p_owner)
),
pipe as (
  select coalesce(sum(contract_value * probability / 100.0), 0) as ponderado,
         coalesce(sum(contract_value), 0)                       as bruto,
         count(*)::numeric                                      as deals_abertos
    from j join opportunities o2 on o2.id = j.id
   where j.stage not in ('ganho','perdido','nutricao')
)
select jsonb_build_object(
  'periodo',            jsonb_build_object('de', p_from, 'ate', p_to),

  'leads',              leads.n,
  'speed_to_lead_min',  round(coalesce(leads.speed_median, 0)::numeric, 1),

  'qualificados',       st.qualificados,
  'diagnosticos',       st.diagnosticos,
  'qualificados_por_avanco', (select count(*) from j where qualificado_por_avanco and qualificado_at::date between p_from and p_to),
  'agendados_por_avanco', (select count(*) from j where agendado_por_avanco and agendado_at::date between p_from and p_to),
  'diagnosticos_por_avanco', (select count(*) from j where diagnostico_por_avanco and diagnostico_at::date between p_from and p_to),
  'propostas_por_avanco', (select count(*) from j where proposta_por_avanco and proposta_at::date between p_from and p_to),
  'tx_qualificacao',    round(case when leads.n > 0 then st.qualificados / leads.n * 100 else 0 end, 1),

  'agendamentos',       st.agendados,
  'tx_agendamento',     round(case when st.qualificados > 0 then st.agendados / st.qualificados * 100 else 0 end, 1),

  'reunioes_realizadas', mt.realizadas,
  'reunioes_no_show',    mt.no_shows,
  'reunioes_pendentes',  mt.pendentes,
  'show_rate',          round(case when (mt.realizadas + mt.no_shows) > 0
                                   then mt.realizadas / (mt.realizadas + mt.no_shows) * 100 else 0 end, 1),

  'propostas',          st.propostas,
  'tx_reuniao_proposta', round(case when st.diagnosticos > 0 then st.propostas / st.diagnosticos * 100 else 0 end, 1),

  'vendas',             st.ganhos,
  'perdidos',           st.perdidos,
  'win_rate',           round(case when st.propostas > 0 then st.ganhos / st.propostas * 100 else 0 end, 1),
  'tx_lead_venda',      round(case when leads.n > 0 then st.ganhos / leads.n * 100 else 0 end, 2),

  'ticket_medio_mrr',   round(st.ticket_mrr, 2),
  'ticket_medio_contrato', round(st.ticket_contrato, 2),
  'receita_fechada',    round(st.receita, 2),
  'ciclo_venda_dias',   round(coalesce(st.ciclo_mediano, 0)::numeric, 1),

  'pipeline_bruto',     round(pipe.bruto, 2),
  'pipeline_ponderado', round(pipe.ponderado, 2),
  'deals_abertos',      pipe.deals_abertos
)
from leads, st, mt, pipe;
$$;

commit;
