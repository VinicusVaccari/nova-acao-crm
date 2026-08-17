-- =============================================================
-- 0005_views — a camada que os dashboards consomem
-- =============================================================

-- -------------------------------------------------------------
-- JORNADA DA OPORTUNIDADE
-- Achata o stage_history: uma linha por deal com o carimbo de
-- quando ele alcançou cada etapa. É a base de todo o resto.
-- -------------------------------------------------------------
create or replace view v_opp_journey as
with h as (
  select
    opportunity_id,
    min(changed_at) filter (where to_stage = 'qualificado')           as qualificado_at,
    min(changed_at) filter (where to_stage = 'reuniao_agendada')      as agendado_at,
    min(changed_at) filter (where to_stage = 'diagnostico_realizado') as diagnostico_at,
    min(changed_at) filter (where to_stage = 'proposta_enviada')      as proposta_at,
    min(changed_at) filter (where to_stage = 'ganho')                 as ganho_at,
    min(changed_at) filter (where to_stage = 'perdido')               as perdido_at
  from stage_history
  group by opportunity_id
),
m as (
  select
    opportunity_id,
    count(*) filter (where status = 'realizada') as meetings_held,
    count(*) filter (where status = 'no_show')   as meetings_noshow,
    min(scheduled_at)                            as first_meeting_at
  from meetings
  group by opportunity_id
)
select
  o.id,
  o.person_id, o.company_id, o.owner_id, o.sdr_id,
  o.stage, o.source_channel, o.product, o.score,
  o.expected_value, o.setup_value, o.term_months,
  o.created_at, o.first_contact_at, o.closed_at, o.lost_reason,
  -- valor total do contrato (não só o MRR)
  coalesce(o.expected_value,0) * coalesce(o.term_months,12)
    + coalesce(o.setup_value,0)                                   as contract_value,
  -- speed to lead em minutos
  extract(epoch from (o.first_contact_at - o.created_at)) / 60.0  as speed_to_lead_min,
  h.qualificado_at, h.agendado_at, h.diagnostico_at,
  h.proposta_at, h.ganho_at, h.perdido_at,
  -- ciclo de venda em dias
  extract(epoch from (h.ganho_at - o.created_at)) / 86400.0       as sales_cycle_days,
  coalesce(m.meetings_held, 0)   as meetings_held,
  coalesce(m.meetings_noshow, 0) as meetings_noshow,
  m.first_meeting_at,
  t.utm_campaign, t.utm_content, t.utm_source, t.utm_medium,
  t.campaign_external_id
from opportunities o
left join h on h.opportunity_id = o.id
left join m on m.opportunity_id = o.id
left join touchpoints t on t.id = o.first_touchpoint_id;

comment on view v_opp_journey is
  'Uma linha por oportunidade com o carimbo de cada etapa alcançada. Base dos dashboards.';

-- -------------------------------------------------------------
-- DASHBOARD COMERCIAL — os KPIs do painel principal
-- -------------------------------------------------------------
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

-- -------------------------------------------------------------
-- SÉRIE TEMPORAL DO FUNIL — alimenta os gráficos
-- -------------------------------------------------------------
create or replace function fn_funnel_series(
  p_from  date default (current_date - 29),
  p_to    date default current_date,
  p_grain text default 'day'          -- day | week | month
) returns table (
  bucket date, leads bigint, qualificados bigint, agendados bigint,
  diagnosticos bigint, propostas bigint, vendas bigint, receita numeric
) language sql stable as $$
  with days as (
    select generate_series(
      date_trunc(p_grain, p_from::timestamp),
      date_trunc(p_grain, p_to::timestamp),
      ('1 ' || p_grain)::interval)::date as bucket
  )
  select
    d.bucket,
    count(*) filter (where date_trunc(p_grain, j.created_at)::date     = d.bucket),
    count(*) filter (where date_trunc(p_grain, j.qualificado_at)::date = d.bucket),
    count(*) filter (where date_trunc(p_grain, j.agendado_at)::date    = d.bucket),
    count(*) filter (where date_trunc(p_grain, j.diagnostico_at)::date = d.bucket),
    count(*) filter (where date_trunc(p_grain, j.proposta_at)::date    = d.bucket),
    count(*) filter (where date_trunc(p_grain, j.ganho_at)::date       = d.bucket),
    coalesce(sum(j.contract_value) filter (where date_trunc(p_grain, j.ganho_at)::date = d.bucket), 0)
  from days d
  left join v_opp_journey j on true
  group by d.bucket
  order by d.bucket;
$$;

-- -------------------------------------------------------------
-- DASHBOARD DE MARKETING — CAC real, não CPL
-- -------------------------------------------------------------
create or replace view v_dash_marketing as
with spend as (
  select date, platform, campaign_external_id,
         max(campaign_name) as campaign_name,
         sum(spend) as spend, sum(clicks) as clicks, sum(impressions) as impressions
    from ad_spend_daily
   group by date, platform, campaign_external_id
),
res as (
  select
    coalesce(j.campaign_external_id, '-') as campaign_external_id,
    j.created_at::date as date,
    count(*)                                          as leads,
    count(*) filter (where j.qualificado_at is not null) as qualificados,
    count(*) filter (where j.meetings_held > 0)        as reunioes,
    count(*) filter (where j.ganho_at is not null)     as vendas,
    coalesce(sum(j.contract_value) filter (where j.ganho_at is not null), 0) as receita
  from v_opp_journey j
  group by 1, 2
)
select
  coalesce(s.date, r.date)                                   as date,
  s.platform,
  coalesce(s.campaign_external_id, r.campaign_external_id)   as campaign_external_id,
  s.campaign_name,
  coalesce(s.spend, 0)        as spend,
  coalesce(s.clicks, 0)       as clicks,
  coalesce(s.impressions, 0)  as impressions,
  coalesce(r.leads, 0)        as leads,
  coalesce(r.qualificados, 0) as qualificados,
  coalesce(r.reunioes, 0)     as reunioes,
  coalesce(r.vendas, 0)       as vendas,
  coalesce(r.receita, 0)      as receita,
  -- CPL: a métrica que engana
  case when coalesce(r.leads,0)    > 0 then s.spend / r.leads    end as cpl,
  -- custo por reunião realizada: a que substitui o CPL
  case when coalesce(r.reunioes,0) > 0 then s.spend / r.reunioes end as custo_por_reuniao,
  -- CAC real
  case when coalesce(r.vendas,0)   > 0 then s.spend / r.vendas   end as cac,
  case when coalesce(s.spend,0)    > 0 then r.receita / s.spend  end as roi
from spend s
full outer join res r
  on r.campaign_external_id = s.campaign_external_id and r.date = s.date;

-- -------------------------------------------------------------
-- DASHBOARD DE CS
-- -------------------------------------------------------------
create or replace view v_dash_cs as
with h as (
  select distinct on (account_id) account_id, score, trend, date
    from account_health order by account_id, date desc
),
d as (
  select account_id,
         count(*)                                                   as metas,
         count(*) filter (where actual >= target)                   as metas_batidas
    from deliverables
   where period >= date_trunc('month', current_date - interval '2 months')
   group by account_id
),
o as (
  select account_id,
         count(*)                                                    as marcos,
         count(*) filter (where done_at is not null)                 as marcos_ok,
         count(*) filter (where done_at is null and due_at < current_date) as marcos_atrasados
    from onboarding_tasks group by account_id
),
n as (
  select distinct on (account_id) account_id, score as nps, responded_at
    from nps_responses order by account_id, responded_at desc
),
i as (
  select account_id, count(*) filter (where status = 'atrasada') as faturas_atrasadas
    from invoices group by account_id
)
select
  a.id, a.name, a.status, a.mrr, a.product, a.csm_id, a.started_at, a.contract_end,
  (current_date - a.started_at)                as dias_de_casa
, (a.contract_end - current_date)              as dias_para_renovacao,
  coalesce(h.score, 50)                        as health_score,
  h.trend                                      as health_trend,
  coalesce(d.metas, 0)                         as metas_periodo,
  coalesce(d.metas_batidas, 0)                 as metas_batidas,
  case when coalesce(d.metas,0) > 0
       then round(d.metas_batidas::numeric / d.metas * 100, 1) end as pct_metas_batidas,
  coalesce(o.marcos, 0)                        as onboarding_marcos,
  coalesce(o.marcos_ok, 0)                     as onboarding_concluidos,
  coalesce(o.marcos_atrasados, 0)              as onboarding_atrasados,
  n.nps,
  coalesce(i.faturas_atrasadas, 0)             as faturas_atrasadas
from accounts a
left join h on h.account_id = a.id
left join d on d.account_id = a.id
left join o on o.account_id = a.id
left join n on n.account_id = a.id
left join i on i.account_id = a.id;

-- -------------------------------------------------------------
-- MAPA DE OBJEÇÕES VIVO
-- Frequência x quanto dinheiro cada objeção custou.
-- -------------------------------------------------------------
create or replace view v_objection_map as
select
  ob.code,
  ob.label,
  count(*)                                                     as ocorrencias,
  count(*) filter (where oc.outcome = 'matou_o_deal')           as mataram_deal,
  count(*) filter (where oc.outcome = 'superada')               as superadas,
  round(count(*) filter (where oc.outcome = 'matou_o_deal')::numeric
        / nullif(count(*), 0) * 100, 1)                         as pct_letal,
  coalesce(sum(j.contract_value) filter (where oc.outcome = 'matou_o_deal'), 0) as receita_perdida,
  max(oc.detected_at)                                           as ultima_ocorrencia
from objection_occurrences oc
join objections ob on ob.id = oc.objection_id
left join v_opp_journey j on j.id = oc.opportunity_id
group by ob.code, ob.label
order by receita_perdida desc, ocorrencias desc;

-- -------------------------------------------------------------
-- SLA DE PRIMEIRO CONTATO — quem está estourando agora
-- -------------------------------------------------------------
create or replace view v_sla_breaches as
select
  o.id, o.created_at, o.source_channel, o.owner_id, o.sdr_id,
  p.full_name, p.phone_primary,
  round(extract(epoch from (now() - o.created_at)) / 60.0, 1) as minutos_esperando
from opportunities o
join people p on p.id = o.person_id
where o.first_contact_at is null
  and o.stage = 'novo'
  and now() - o.created_at > interval '5 minutes'
order by o.created_at;

-- -------------------------------------------------------------
-- DEALS PARADOS — sem próxima ação
-- -------------------------------------------------------------
create or replace view v_stale_deals as
select
  o.id, o.stage, o.owner_id, o.expected_value,
  p.full_name,
  round(extract(epoch from (now() - o.stage_since)) / 86400.0, 1) as dias_parado,
  o.next_step, o.next_step_due
from opportunities o
join people p on p.id = o.person_id
where o.stage not in ('ganho','perdido','nutricao')
  and (o.next_step_due is null or o.next_step_due < now())
  and now() - o.stage_since > interval '3 days'
order by o.expected_value desc nulls last;

-- -------------------------------------------------------------
-- RANKING POR VENDEDOR
-- -------------------------------------------------------------
create or replace function fn_dash_por_vendedor(
  p_from date default (current_date - 29),
  p_to   date default current_date
) returns table (
  owner_id uuid, nome text, leads bigint, reunioes bigint, propostas bigint,
  vendas bigint, receita numeric, win_rate numeric, ticket_medio numeric,
  ciclo_dias numeric, speed_to_lead_min numeric
) language sql stable as $$
  select
    pr.id, pr.full_name,
    count(*) filter (where j.created_at::date between p_from and p_to),
    count(*) filter (where j.diagnostico_at::date between p_from and p_to),
    count(*) filter (where j.proposta_at::date between p_from and p_to),
    count(*) filter (where j.ganho_at::date between p_from and p_to),
    coalesce(sum(j.contract_value) filter (where j.ganho_at::date between p_from and p_to), 0),
    round(count(*) filter (where j.ganho_at::date between p_from and p_to)::numeric
          / nullif(count(*) filter (where j.proposta_at::date between p_from and p_to), 0) * 100, 1),
    round(coalesce(avg(j.contract_value) filter (where j.ganho_at::date between p_from and p_to), 0), 2),
    round(percentile_cont(0.5) within group (order by j.sales_cycle_days)
          filter (where j.ganho_at::date between p_from and p_to)::numeric, 1),
    round(percentile_cont(0.5) within group (order by j.speed_to_lead_min)
          filter (where j.created_at::date between p_from and p_to)::numeric, 1)
  from profiles pr
  left join v_opp_journey j on j.owner_id = pr.id or j.sdr_id = pr.id
  where pr.is_active
  group by pr.id, pr.full_name
  order by 7 desc;
$$;
