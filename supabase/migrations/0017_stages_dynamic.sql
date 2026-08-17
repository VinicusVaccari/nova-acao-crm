-- =============================================================
-- 0017_stages_dynamic — etapas viram DADOS (add/remove pelo CRM).
--   O enum `opp_stage` deixa de governar a coluna: `stage` vira TEXT
--   e a fonte da verdade passa a ser `pipeline_stages`. As funções do
--   funil (rank, probabilidade, transição) passam a LER a tabela, então
--   uma etapa nova criada pelo app já participa do funil — sem DDL em
--   tempo de execução. Semântica (ganho/perdido/nutrição) vira flag.
-- =============================================================

-- 1. pipeline_stages ganha semântica + probabilidade; `short` sai (só há `label`)
alter table pipeline_stages add column if not exists probability numeric  not null default 0;
alter table pipeline_stages add column if not exists won        boolean  not null default false;
alter table pipeline_stages add column if not exists lost       boolean  not null default false;
alter table pipeline_stages add column if not exists nurture    boolean  not null default false;

update pipeline_stages set probability = case stage
  when 'novo' then 2  when 'em_atendimento' then 5  when 'qualificado' then 15
  when 'reuniao_agendada' then 25  when 'diagnostico_realizado' then 40
  when 'fechamento_agendado' then 55  when 'proposta_enviada' then 65
  when 'negociacao' then 80  when 'ganho' then 100  else 0 end;

update pipeline_stages set won = (stage = 'ganho'),
                           lost = (stage = 'perdido'),
                           nurture = (stage = 'nutricao');

alter table pipeline_stages drop column if exists short;

-- 2. as views dependem da coluna: derruba antes de trocar o tipo
--    (v_objection_map depende de v_opp_journey → cai primeiro)
drop view if exists v_objection_map;
drop view if exists v_opp_journey;
drop view if exists v_sla_breaches;
drop view if exists v_stale_deals;

-- 3. as funções antigas têm o enum na assinatura: derruba em ordem de dependência
drop function if exists fn_move_stage(uuid, opp_stage, uuid, text, text, jsonb);
drop function if exists fn_enqueue_conversion(uuid, opp_stage);
drop function if exists fn_transition_allowed(opp_stage, opp_stage);
drop function if exists fn_stage_rank(opp_stage);
drop function if exists fn_stage_probability(opp_stage);

-- 4. enum -> text
alter table opportunities  alter column stage drop default;
alter table opportunities  alter column stage type text using stage::text;
alter table opportunities  alter column stage set default 'novo';
alter table stage_history  alter column from_stage type text using from_stage::text;
alter table stage_history  alter column to_stage   type text using to_stage::text;
alter table pipeline_stages alter column stage type text using stage::text;

-- 5. funções data-driven (leem pipeline_stages)
create function fn_stage_probability(p_stage text)
returns numeric language sql stable as $$
  select coalesce((select probability from pipeline_stages where stage = p_stage), 0)::numeric;
$$;

create function fn_stage_rank(p_stage text)
returns int language sql stable as $$
  select coalesce((select sort_order from pipeline_stages where stage = p_stage), 0);
$$;

-- transição válida: destino existe e é diferente da origem (fluxo livre;
-- as regras finas de perda ficam no fn_move_stage)
create function fn_transition_allowed(p_from text, p_to text)
returns boolean language plpgsql stable as $$
begin
  if p_from = p_to then return false; end if;
  if not exists (select 1 from pipeline_stages where stage = p_to) then return false; end if;
  return true;
end $$;

create function fn_enqueue_conversion(p_opportunity_id uuid, p_stage text)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_event_name text;
  v_value      numeric;
  v_opp        record;
  v_fbclid text; v_fbp text; v_gclid text; v_gaclient text;
begin
  v_event_name := case p_stage
    when 'qualificado'           then 'Lead_Qualificado'
    when 'reuniao_agendada'      then 'Reuniao_Agendada'
    when 'diagnostico_realizado' then 'Reuniao_Realizada'
    when 'proposta_enviada'      then 'Proposta_Enviada'
    when 'ganho'                 then 'Purchase'
    else null end;
  if v_event_name is null then return; end if;

  select o.*, p.email_primary, p.phone_primary into v_opp
    from opportunities o join people p on p.id = o.person_id
   where o.id = p_opportunity_id;

  select fbclid into v_fbclid from touchpoints where person_id = v_opp.person_id and fbclid is not null order by occurred_at desc limit 1;
  select fbp into v_fbp from touchpoints where person_id = v_opp.person_id and fbp is not null order by occurred_at desc limit 1;
  select gclid into v_gclid from touchpoints where person_id = v_opp.person_id and gclid is not null order by occurred_at desc limit 1;
  select ga_client_id into v_gaclient from touchpoints where person_id = v_opp.person_id and ga_client_id is not null order by occurred_at desc limit 1;

  if p_stage = 'ganho' then
    v_value := coalesce(v_opp.expected_value,0) * coalesce(v_opp.term_months,12) + coalesce(v_opp.setup_value,0);
  else
    v_value := coalesce(v_opp.expected_value,0) * coalesce(v_opp.term_months,12) * (fn_stage_probability(p_stage) / 100.0);
  end if;

  insert into outbox (destination, payload, dedupe_key)
  select d, jsonb_build_object(
           'event_name', v_event_name, 'opportunity_id', p_opportunity_id, 'person_id', v_opp.person_id,
           'value', round(v_value, 2), 'currency', 'BRL', 'email', v_opp.email_primary, 'phone', v_opp.phone_primary,
           'fbclid', v_fbclid, 'fbp', v_fbp, 'gclid', v_gclid, 'ga_client_id', v_gaclient, 'occurred_at', now()),
         d || ':' || p_opportunity_id::text || ':' || v_event_name
    from unnest(array['meta_capi','google_oci','ga4_mp']) as d
  on conflict (dedupe_key) do nothing;
end $$;

create function fn_move_stage(
  p_opportunity_id uuid,
  p_to_stage       text,
  p_actor          uuid  default null,
  p_actor_type     text  default 'user',
  p_reason         text  default null,
  p_meta           jsonb default '{}'
) returns opportunities language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_from  text;
  v_since timestamptz;
  v_opp   opportunities;
  v_won   boolean;
  v_lost  boolean;
begin
  select stage, stage_since into v_from, v_since from opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'Oportunidade % não encontrada', p_opportunity_id; end if;

  select won, lost into v_won, v_lost from pipeline_stages where stage = p_to_stage;
  if not found then raise exception 'Etapa inexistente: %', p_to_stage; end if;

  if not fn_transition_allowed(v_from, p_to_stage) then
    raise exception 'Transição inválida: % -> %', v_from, p_to_stage;
  end if;

  if v_lost and coalesce(p_reason,'') = '' then
    raise exception 'Motivo de perda é obrigatório';
  end if;
  if v_lost and not exists (select 1 from lost_reasons where code = p_reason) then
    raise exception 'Motivo de perda inválido: %. Use a lista fechada.', p_reason;
  end if;

  update opportunities set
    stage       = p_to_stage,
    stage_since = now(),
    probability = fn_stage_probability(p_to_stage),
    closed_at   = case when v_won or v_lost then now() else null end,
    lost_reason = case when v_lost then p_reason else lost_reason end
  where id = p_opportunity_id
  returning * into v_opp;

  insert into stage_history (opportunity_id, from_stage, to_stage, changed_by, actor_type, reason, duration_in_prev)
  values (p_opportunity_id, v_from, p_to_stage, p_actor, p_actor_type, p_reason, now() - v_since);

  insert into events (event_name, subject_type, subject_id, actor_type, actor_id, payload, source)
  values (
    case when fn_stage_rank(p_to_stage) < fn_stage_rank(v_from) and fn_stage_rank(p_to_stage) > 0
         then 'opportunity.regressed' else 'opportunity.stage_changed' end,
    'opportunity', p_opportunity_id, p_actor_type, p_actor::text,
    jsonb_build_object('from', v_from, 'to', p_to_stage, 'reason', p_reason) || p_meta,
    'db:fn_move_stage'
  );

  perform fn_enqueue_conversion(p_opportunity_id, p_to_stage);
  return v_opp;
end $$;

-- 6. recria as views (literais em text)
create view v_opp_journey as
 with h as (
   select stage_history.opportunity_id,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'qualificado')           as qualificado_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'reuniao_agendada')       as agendado_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'diagnostico_realizado')  as diagnostico_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'proposta_enviada')        as proposta_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'ganho')                   as ganho_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'perdido')                 as perdido_at
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
   t.utm_campaign, t.utm_content, t.utm_source, t.utm_medium, t.campaign_external_id
 from opportunities o
   left join h on h.opportunity_id = o.id
   left join m on m.opportunity_id = o.id
   left join touchpoints t on t.id = o.first_touchpoint_id;

create view v_sla_breaches as
 select o.id, o.created_at, o.source_channel, o.owner_id, o.sdr_id, p.full_name, p.phone_primary,
   round(extract(epoch from now() - o.created_at) / 60.0, 1) as minutos_esperando
 from opportunities o join people p on p.id = o.person_id
 where o.first_contact_at is null and o.stage = 'novo' and (now() - o.created_at) > '00:05:00'::interval
 order by o.created_at;

create view v_stale_deals as
 select o.id, o.stage, o.owner_id, o.expected_value, p.full_name,
   round(extract(epoch from now() - o.stage_since) / 86400.0, 1) as dias_parado,
   o.next_step, o.next_step_due
 from opportunities o join people p on p.id = o.person_id
 where o.stage <> all (array['ganho','perdido','nutricao'])
   and (o.next_step_due is null or o.next_step_due < now())
   and (now() - o.stage_since) > '3 days'::interval
 order by o.expected_value desc nulls last;

-- recria v_objection_map (dependia de v_opp_journey)
create view v_objection_map as
 select ob.code, ob.label,
    count(*) as ocorrencias,
    count(*) filter (where oc.outcome = 'matou_o_deal') as mataram_deal,
    count(*) filter (where oc.outcome = 'superada') as superadas,
    round(count(*) filter (where oc.outcome = 'matou_o_deal')::numeric / nullif(count(*), 0)::numeric * 100::numeric, 1) as pct_letal,
    coalesce(sum(j.contract_value) filter (where oc.outcome = 'matou_o_deal'), 0::numeric) as receita_perdida,
    max(oc.detected_at) as ultima_ocorrencia
   from objection_occurrences oc
     join objections ob on ob.id = oc.objection_id
     left join v_opp_journey j on j.id = oc.opportunity_id
  group by ob.code, ob.label
  order by (coalesce(sum(j.contract_value) filter (where oc.outcome = 'matou_o_deal'), 0::numeric)) desc, (count(*)) desc;
