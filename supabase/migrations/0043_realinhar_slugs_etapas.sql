-- Realinha os SLUGS das etapas aos RÓTULOS. Renomear a etapa no CRM só mudava
-- o label; o slug (chave em opportunities.stage / stage_history) ficava o antigo
-- e desencontrado (ex.: slug reuniao_agendada aparecia como "Desqualificado").
-- Mantém novo/qualificado/ganho/perdido/nutricao (usados no backend).
-- Troca em 2 passos com prefixo temporário para não colidir no ciclo.

-- ---- passo 1: para tmp (t_<novo>) ----
do $$
declare
  mapa jsonb := jsonb_build_object(
    'em_atendimento',        'primeiro_contato',
    'reuniao_agendada',      'desqualificado',
    'diagnostico_realizado', 'reuniao_agendada',
    'fechamento_agendado',   'apresentacao_institucional',
    'proposta_enviada',      'envio_proposta',
    'negociacao',            'apresentacao_proposta',
    'negociacao_2',          'negociacao'
  );
  de text; para text;
  layout_legado boolean := exists (
    select 1 from pipeline_stages where stage = 'em_atendimento'
  );
begin
  for de, para in select key, value from jsonb_each_text(mapa) loop
    -- Há dois estados possíveis em produção:
    --   1) layout todo legado: renomeia tabela + dados;
    --   2) colunas já novas, mas cards ainda em slugs antigos: corrige apenas
    --      o slug que não existe mais. Isso preserva slugs válidos ambíguos,
    --      como reuniao_agendada e negociacao.
    if layout_legado or not exists (select 1 from pipeline_stages where stage = de) then
      if layout_legado then
        update pipeline_stages set stage = 't_'||para where stage = de;
      end if;
      update opportunities set stage = 't_'||para where stage = de;
      update stage_history set from_stage = 't_'||para where from_stage = de;
      update stage_history set to_stage   = 't_'||para where to_stage = de;
    end if;
  end loop;
end $$;

-- ---- passo 2: tira o prefixo t_ ----
update pipeline_stages set stage      = substring(stage from 3)      where left(stage, 2) = 't_';
update opportunities   set stage      = substring(stage from 3)      where left(stage, 2) = 't_';
update stage_history   set from_stage = substring(from_stage from 3) where left(from_stage, 2) = 't_';
update stage_history   set to_stage   = substring(to_stage from 3)   where left(to_stage, 2) = 't_';

-- O primeiro contato ainda movia o card para o slug legado
-- "em_atendimento". Usa a máquina de estados para que a troca também fique
-- registrada no histórico e nunca deixe o card fora do Kanban.
create or replace function fn_log_activity(
  p_opportunity_id uuid,
  p_kind           text,
  p_direction      text default 'outbound',
  p_body           text default null,
  p_actor          uuid default null,
  p_is_automated   boolean default false,
  p_outcome        text default null,
  p_meta           jsonb default '{}'
) returns bigint language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_id     bigint;
  v_person uuid;
  v_stage  text;
begin
  select person_id, stage into v_person, v_stage
    from opportunities
   where id = p_opportunity_id
   for update;

  insert into activities
    (opportunity_id, person_id, kind, direction, actor_id, is_automated, outcome, body, meta)
  values
    (p_opportunity_id, v_person, p_kind, p_direction, p_actor, p_is_automated, p_outcome, p_body, p_meta)
  returning id into v_id;

  if p_direction = 'outbound' then
    update opportunities
       set first_contact_at = coalesce(first_contact_at, now())
     where id = p_opportunity_id;

    if v_stage = 'novo' then
      perform fn_move_stage(
        p_opportunity_id,
        'primeiro_contato',
        p_actor,
        case when p_is_automated then 'ai' else 'user' end,
        null,
        coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('via', 'fn_log_activity')
      );
    end if;
  end if;

  return v_id;
end $$;

-- "Perdido" agora é status (lost_at), não etapa. A versão antiga desta
-- função procurava stage <> 'perdido' e por isso reutilizava um negócio
-- perdido ao receber um novo formulário da mesma pessoa. O novo toque/UTMs
-- deve criar um novo negócio quando o anterior foi perdido ou vendido.
create or replace function fn_ingest_lead(p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_person   uuid;
  v_company  uuid;
  v_tp       bigint;
  v_opp      uuid;
  v_existing uuid;
  v_channel  text;
begin
  v_person := fn_resolve_person(
    p_payload->>'email',
    p_payload->>'phone',
    p_payload->>'name',
    p_payload->>'wa_id',
    p_payload->>'fbclid',
    p_payload->>'gclid',
    p_payload->>'ga_client_id',
    p_payload->>'fbp'
  );

  if coalesce(p_payload->>'company_name', p_payload->>'cnpj') is not null then
    insert into companies (trade_name, cnpj, website, segment)
    values (p_payload->>'company_name', nullif(p_payload->>'cnpj',''),
            p_payload->>'website', p_payload->>'segment')
    on conflict (cnpj) do update
      set trade_name = coalesce(companies.trade_name, excluded.trade_name)
    returning id into v_company;

    insert into person_company (person_id, company_id)
    values (v_person, v_company) on conflict do nothing;
  end if;

  v_channel := coalesce(
    p_payload->>'channel',
    case
      when p_payload->>'fbclid' is not null then 'paid_social'
      when p_payload->>'gclid'  is not null then 'paid_search'
      when p_payload->>'utm_medium' in ('cpc','paid_social') then 'paid'
      when p_payload->>'utm_source' is not null then 'organic'
      else 'direct'
    end);

  insert into touchpoints (
    person_id, channel, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    campaign_external_id, adset_external_id, ad_external_id,
    gclid, fbclid, fbp, ga_client_id, landing_page, referrer, ip, user_agent, raw
  ) values (
    v_person, v_channel,
    p_payload->>'utm_source',  p_payload->>'utm_medium',   p_payload->>'utm_campaign',
    p_payload->>'utm_content', p_payload->>'utm_term',
    p_payload->>'campaign_id', p_payload->>'adset_id',     p_payload->>'ad_id',
    p_payload->>'gclid',       p_payload->>'fbclid',       p_payload->>'fbp',
    p_payload->>'ga_client_id',p_payload->>'landing_page', p_payload->>'referrer',
    p_payload->>'ip',          p_payload->>'user_agent',   p_payload
  ) returning id into v_tp;

  select id into v_existing
    from opportunities
   where person_id = v_person
     and lost_at is null
     and stage <> 'ganho'
   order by created_at desc
   limit 1;

  if v_existing is not null then
    update opportunities
       set last_touchpoint_id = v_tp
     where id = v_existing;

    insert into events (event_name, subject_type, subject_id, actor_type, payload, source)
    values ('lead.returned', 'opportunity', v_existing, 'external',
            jsonb_build_object('touchpoint_id', v_tp), 'api:ingest');

    return jsonb_build_object(
      'person_id', v_person,
      'opportunity_id', v_existing,
      'touchpoint_id', v_tp,
      'created', false
    );
  end if;

  insert into opportunities (
    person_id, company_id, stage, product, expected_value,
    first_touchpoint_id, last_touchpoint_id, source_channel
  ) values (
    v_person, v_company, 'novo', p_payload->>'product',
    nullif(p_payload->>'expected_value','')::numeric,
    v_tp, v_tp, v_channel
  ) returning id into v_opp;

  insert into events (event_name, subject_type, subject_id, actor_type, payload, source)
  values ('lead.created', 'opportunity', v_opp, 'external', p_payload, 'api:ingest');

  return jsonb_build_object(
    'person_id', v_person,
    'opportunity_id', v_opp,
    'touchpoint_id', v_tp,
    'created', true
  );
end $$;

-- Os eventos de conversão também precisam seguir a semântica dos slugs
-- novos; caso contrário reunião realizada e proposta enviada deixam de ser
-- enfileiradas para Meta/Google/GA4.
create or replace function fn_enqueue_conversion(p_opportunity_id uuid, p_stage text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_event_name text;
  v_value      numeric;
  v_opp        record;
  v_fbclid text; v_fbp text; v_gclid text; v_gaclient text;
begin
  v_event_name := case p_stage
    when 'qualificado'                then 'Lead_Qualificado'
    when 'reuniao_agendada'           then 'Reuniao_Agendada'
    when 'apresentacao_institucional' then 'Reuniao_Realizada'
    when 'envio_proposta'             then 'Proposta_Enviada'
    when 'ganho'                      then 'Purchase'
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

-- Contexto da Naia: considera aberto pelo status atual e devolve a origem
-- ligada ao toque mais recente daquele negócio, não o primeiro toque antigo
-- da pessoa.
create or replace function fn_sdr_context(p_phone text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_person uuid;
  v_result jsonb;
begin
  select person_id into v_person from identities
   where kind = 'phone' and value = fn_norm_phone(p_phone) limit 1;

  if v_person is null then
    select person_id into v_person from identities
     where kind = 'wa_id' and value = regexp_replace(p_phone,'[^0-9]','','g') limit 1;
  end if;

  if v_person is null then return jsonb_build_object('known', false); end if;

  select jsonb_build_object(
    'known', true,
    'person', to_jsonb(p) - 'consent_basis',
    'opportunity', (
      select to_jsonb(o) from opportunities o
       where o.person_id = v_person
         and o.lost_at is null
         and o.stage <> 'ganho'
       order by o.created_at desc limit 1),
    'origin', (
      select jsonb_build_object(
               'channel', t.channel, 'campaign', t.utm_campaign,
               'content', t.utm_content, 'landing', t.landing_page)
        from opportunities o
        join touchpoints t on t.id = o.last_touchpoint_id
       where o.person_id = v_person
         and o.lost_at is null
         and o.stage <> 'ganho'
       order by o.created_at desc limit 1),
    'last_activities', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', a.kind, 'direction', a.direction,
               'at', a.occurred_at, 'body', left(a.body, 500))
             order by a.occurred_at desc), '[]'::jsonb)
        from (select * from activities where person_id = v_person
              order by occurred_at desc limit 15) a),
    'next_meeting', (
      select jsonb_build_object('at', m.scheduled_at, 'kind', m.kind, 'status', m.status)
        from meetings m join opportunities o on o.id = m.opportunity_id
       where o.person_id = v_person and m.scheduled_at > now()
       order by m.scheduled_at limit 1)
  ) into v_result
  from people p where p.id = v_person;

  return v_result;
end $$;

-- Views operacionais que ainda tratavam "perdido" como etapa.
create or replace view v_stale_deals as
 select o.id, o.stage, o.owner_id, o.expected_value, p.full_name,
   round(extract(epoch from now() - o.stage_since) / 86400.0, 1) as dias_parado,
   o.next_step, o.next_step_due
 from opportunities o join people p on p.id = o.person_id
 where o.lost_at is null
   and o.stage <> all (array['ganho','nutricao'])
   and (o.next_step_due is null or o.next_step_due < now())
   and (now() - o.stage_since) > '3 days'::interval
 order by o.expected_value desc nulls last;

create or replace view v_sla_breaches as
 select o.id, o.created_at, o.source_channel, o.owner_id, o.sdr_id, p.full_name, p.phone_primary,
   round(extract(epoch from now() - o.created_at) / 60.0, 1) as minutos_esperando
 from opportunities o join people p on p.id = o.person_id
 where o.lost_at is null
   and o.first_contact_at is null
   and o.stage = 'novo'
   and (now() - o.created_at) > '00:05:00'::interval
 order by o.created_at;

-- Mantém os nomes das colunas analíticas por compatibilidade, mas passa a
-- calcular os marcos usando os slugs reais do pipeline atual.
create or replace view v_opp_journey as
 with h as (
   select stage_history.opportunity_id,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'qualificado')                as qualificado_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'reuniao_agendada')           as agendado_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'apresentacao_institucional') as diagnostico_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'envio_proposta')             as proposta_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'ganho')                       as ganho_at,
     min(stage_history.changed_at) filter (where stage_history.to_stage = 'perdido')                     as perdido_at
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
