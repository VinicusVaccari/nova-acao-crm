-- =============================================================
-- 0003_spine — eventos, outbox, máquina de estados, ingestão
-- =============================================================

-- -------------------------------------------------------------
-- DIÁRIO DE BORDO — append-only, nunca UPDATE, nunca DELETE
-- -------------------------------------------------------------
create table if not exists events (
  id              bigserial primary key,
  occurred_at     timestamptz not null default now(),
  event_name      text not null,
  subject_type    text not null,     -- opportunity | person | meeting | proposal | account
  subject_id      uuid not null,
  actor_type      text not null default 'system',   -- user | ai | system | external
  actor_id        text,
  payload         jsonb not null default '{}',
  source          text,
  idempotency_key text unique
);

create index if not exists idx_events_subject on events (subject_type, subject_id, occurred_at desc);
create index if not exists idx_events_name    on events (event_name, occurred_at desc);

-- -------------------------------------------------------------
-- FILA DE SAÍDA — garante que nenhuma conversão se perde
-- Uma venda cuja conversão não subiu para o Meta/Google é sinal
-- perdido para sempre: a janela de importação fecha.
-- -------------------------------------------------------------
create table if not exists outbox (
  id              bigserial primary key,
  destination     text not null,     -- meta_capi | google_oci | ga4_mp | slack | whatsapp | email
  payload         jsonb not null,
  dedupe_key      text unique,
  status          text not null default 'pending'
                    check (status in ('pending','sent','failed','dead')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz
);

create index if not exists idx_outbox_ready on outbox (status, next_attempt_at)
  where status in ('pending','failed');

create table if not exists automation_runs (
  id          bigserial primary key,
  workflow    text not null,
  entity_type text,
  entity_id   uuid,
  status      text not null default 'running',
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  input       jsonb,
  output      jsonb,
  error       text
);

create index if not exists idx_autoruns on automation_runs (workflow, started_at desc);

-- -------------------------------------------------------------
-- MÁQUINA DE ESTADOS
-- -------------------------------------------------------------

-- Probabilidade por estágio. Usada no forecast e no valor
-- enviado como conversão offline para Meta/Google.
create or replace function fn_stage_probability(p_stage opp_stage)
returns numeric language sql immutable as $$
  select case p_stage
    when 'novo'                   then 2
    when 'em_atendimento'         then 5
    when 'qualificado'            then 15
    when 'reuniao_agendada'       then 25
    when 'diagnostico_realizado'  then 40
    when 'fechamento_agendado'    then 55
    when 'proposta_enviada'       then 65
    when 'negociacao'             then 80
    when 'ganho'                  then 100
    else 0
  end::numeric;
$$;

-- Ordem do funil, para detectar avanço vs. retrocesso.
create or replace function fn_stage_rank(p_stage opp_stage)
returns int language sql immutable as $$
  select case p_stage
    when 'novo' then 1
    when 'em_atendimento' then 2
    when 'qualificado' then 3
    when 'reuniao_agendada' then 4
    when 'diagnostico_realizado' then 5
    when 'fechamento_agendado' then 6
    when 'proposta_enviada' then 7
    when 'negociacao' then 8
    when 'ganho' then 9
    else 0
  end;
$$;

create or replace function fn_transition_allowed(p_from opp_stage, p_to opp_stage)
returns boolean language plpgsql immutable as $$
begin
  if p_from = p_to then return false; end if;
  -- de qualquer lugar dá para perder ou mandar para nutrição
  if p_to in ('perdido','nutricao') then return true; end if;
  -- de perdido/nutrição só se volta para o começo do atendimento
  if p_from in ('perdido','nutricao') then
    return p_to in ('novo','em_atendimento','qualificado');
  end if;
  -- avanço e retrocesso livres dentro do funil (retrocesso gera evento próprio)
  return true;
end $$;

-- -------------------------------------------------------------
-- A FUNÇÃO QUE SEGURA TUDO
-- Nunca fazer UPDATE opportunities SET stage. Sempre por aqui.
-- -------------------------------------------------------------
create or replace function fn_move_stage(
  p_opportunity_id uuid,
  p_to_stage       opp_stage,
  p_actor          uuid    default null,
  p_actor_type     text    default 'user',
  p_reason         text    default null,
  p_meta           jsonb   default '{}'
) returns opportunities language plpgsql security definer as $$
declare
  v_from   opp_stage;
  v_since  timestamptz;
  v_opp    opportunities;
begin
  select stage, stage_since into v_from, v_since
    from opportunities where id = p_opportunity_id for update;

  if not found then
    raise exception 'Oportunidade % não encontrada', p_opportunity_id;
  end if;

  if not fn_transition_allowed(v_from, p_to_stage) then
    raise exception 'Transição inválida: % -> %', v_from, p_to_stage;
  end if;

  if p_to_stage = 'perdido' and coalesce(p_reason,'') = '' then
    raise exception 'Motivo de perda é obrigatório';
  end if;

  if p_to_stage = 'perdido'
     and not exists (select 1 from lost_reasons where code = p_reason) then
    raise exception 'Motivo de perda inválido: %. Use a lista fechada.', p_reason;
  end if;

  update opportunities set
    stage        = p_to_stage,
    stage_since  = now(),
    probability  = fn_stage_probability(p_to_stage),
    closed_at    = case when p_to_stage in ('ganho','perdido') then now() else null end,
    lost_reason  = case when p_to_stage = 'perdido' then p_reason else lost_reason end
  where id = p_opportunity_id
  returning * into v_opp;

  insert into stage_history
    (opportunity_id, from_stage, to_stage, changed_by, actor_type, reason, duration_in_prev)
  values
    (p_opportunity_id, v_from, p_to_stage, p_actor, p_actor_type, p_reason, now() - v_since);

  insert into events (event_name, subject_type, subject_id, actor_type, actor_id, payload, source)
  values (
    case when fn_stage_rank(p_to_stage) < fn_stage_rank(v_from)
           and fn_stage_rank(p_to_stage) > 0
         then 'opportunity.regressed'
         else 'opportunity.stage_changed' end,
    'opportunity', p_opportunity_id, p_actor_type, p_actor::text,
    jsonb_build_object('from', v_from, 'to', p_to_stage, 'reason', p_reason) || p_meta,
    'db:fn_move_stage'
  );

  -- devolve o sinal para as plataformas de mídia
  perform fn_enqueue_conversion(p_opportunity_id, p_to_stage);

  return v_opp;
end $$;

-- -------------------------------------------------------------
-- CONVERSÃO OFFLINE (closed-loop)
-- Enfileira o evento para Meta CAPI / Google OCI / GA4 MP.
-- O valor enviado é o valor ESPERADO por estágio — é isso que
-- faz o algoritmo diferenciar um lead de 3k de um de 30k.
-- -------------------------------------------------------------
create or replace function fn_enqueue_conversion(
  p_opportunity_id uuid,
  p_stage          opp_stage
) returns void language plpgsql security definer as $$
declare
  v_event_name text;
  v_value      numeric;
  v_opp        record;
  v_tp         record;
begin
  v_event_name := case p_stage
    when 'qualificado'           then 'Lead_Qualificado'
    when 'reuniao_agendada'      then 'Reuniao_Agendada'
    when 'diagnostico_realizado' then 'Reuniao_Realizada'
    when 'proposta_enviada'      then 'Proposta_Enviada'
    when 'ganho'                 then 'Purchase'
    else null end;

  if v_event_name is null then return; end if;

  select o.*, p.email_primary, p.phone_primary
    into v_opp
    from opportunities o join people p on p.id = o.person_id
   where o.id = p_opportunity_id;

  -- último toque pago conhecido: é dele que saem os ids de clique
  select * into v_tp from touchpoints
   where person_id = v_opp.person_id
     and (fbclid is not null or gclid is not null or ga_client_id is not null)
   order by occurred_at desc limit 1;

  if p_stage = 'ganho' then
    v_value := coalesce(v_opp.expected_value,0) * coalesce(v_opp.term_months,12)
             + coalesce(v_opp.setup_value,0);
  else
    v_value := coalesce(v_opp.expected_value,0) * coalesce(v_opp.term_months,12)
             * (fn_stage_probability(p_stage) / 100.0);
  end if;

  insert into outbox (destination, payload, dedupe_key)
  select d, jsonb_build_object(
           'event_name',     v_event_name,
           'opportunity_id', p_opportunity_id,
           'person_id',      v_opp.person_id,
           'value',          round(v_value, 2),
           'currency',       'BRL',
           'email',          v_opp.email_primary,
           'phone',          v_opp.phone_primary,
           'fbclid',         v_tp.fbclid,
           'fbp',            v_tp.fbp,
           'gclid',          v_tp.gclid,
           'ga_client_id',   v_tp.ga_client_id,
           'occurred_at',    now()
         ),
         d || ':' || p_opportunity_id::text || ':' || v_event_name
    from unnest(array['meta_capi','google_oci','ga4_mp']) as d
  on conflict (dedupe_key) do nothing;
end $$;

-- -------------------------------------------------------------
-- REGISTRO DE ATIVIDADE
-- Usada pelo SDR do n8n, pelo painel e pelos agentes.
-- Marca o first_contact_at automaticamente -> speed to lead sem autodeclaração.
-- -------------------------------------------------------------
create or replace function fn_log_activity(
  p_opportunity_id uuid,
  p_kind           text,
  p_direction      text default 'outbound',
  p_body           text default null,
  p_actor          uuid default null,
  p_is_automated   boolean default false,
  p_outcome        text default null,
  p_meta           jsonb default '{}'
) returns bigint language plpgsql security definer as $$
declare
  v_id     bigint;
  v_person uuid;
begin
  select person_id into v_person from opportunities where id = p_opportunity_id;

  insert into activities
    (opportunity_id, person_id, kind, direction, actor_id, is_automated, outcome, body, meta)
  values
    (p_opportunity_id, v_person, p_kind, p_direction, p_actor, p_is_automated, p_outcome, p_body, p_meta)
  returning id into v_id;

  -- primeiro contato de saída define o speed to lead
  if p_direction = 'outbound' then
    update opportunities
       set first_contact_at = coalesce(first_contact_at, now())
     where id = p_opportunity_id;

    -- lead novo que recebeu contato entra automaticamente em atendimento
    update opportunities
       set stage = 'em_atendimento', stage_since = now(), probability = 5
     where id = p_opportunity_id and stage = 'novo';
  end if;

  return v_id;
end $$;

-- -------------------------------------------------------------
-- INGESTÃO DIRETA DE LEAD
-- Chamada pelo endpoint do app (formulário, LP, Meta Lead Ads,
-- indicação) sem passar por orquestrador. Resolve identidade,
-- grava o toque, cria a oportunidade e emite o evento — tudo
-- numa transação só.
-- -------------------------------------------------------------
create or replace function fn_ingest_lead(p_payload jsonb)
returns jsonb language plpgsql security definer as $$
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
    p_payload->>'ga_client_id'
  );

  -- empresa (opcional)
  if coalesce(p_payload->>'company_name', p_payload->>'cnpj') is not null then
    insert into companies (trade_name, cnpj, website, segment)
    values (p_payload->>'company_name', nullif(p_payload->>'cnpj',''),
            p_payload->>'website', p_payload->>'segment')
    on conflict (cnpj) do update set trade_name = coalesce(companies.trade_name, excluded.trade_name)
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

  -- Já existe oportunidade aberta para essa pessoa? Então é o mesmo lead
  -- voltando: registra o toque novo e não duplica o card.
  select id into v_existing from opportunities
   where person_id = v_person and stage not in ('ganho','perdido')
   order by created_at desc limit 1;

  if v_existing is not null then
    update opportunities
       set last_touchpoint_id = v_tp
     where id = v_existing;

    insert into events (event_name, subject_type, subject_id, actor_type, payload, source)
    values ('lead.returned','opportunity', v_existing,'external',
            jsonb_build_object('touchpoint_id', v_tp), 'api:ingest');

    return jsonb_build_object('person_id', v_person, 'opportunity_id', v_existing, 'created', false);
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
  values ('lead.created','opportunity', v_opp, 'external', p_payload, 'api:ingest');

  return jsonb_build_object('person_id', v_person, 'opportunity_id', v_opp, 'created', true);
end $$;

comment on function fn_ingest_lead is
  'Entrada única de lead. Chamada direto pelo app/LP, sem orquestrador.';

-- -------------------------------------------------------------
-- CONTEXTO PARA O SDR (n8n)
-- Devolve tudo que o agente precisa saber sobre quem está falando.
-- -------------------------------------------------------------
create or replace function fn_sdr_context(p_phone text)
returns jsonb language plpgsql security definer as $$
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
       where o.person_id = v_person and o.stage not in ('ganho','perdido')
       order by o.created_at desc limit 1),
    'origin', (
      select jsonb_build_object(
               'channel', t.channel, 'campaign', t.utm_campaign,
               'content', t.utm_content, 'landing', t.landing_page)
        from touchpoints t where t.person_id = v_person
       order by t.occurred_at asc limit 1),
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

comment on function fn_sdr_context is
  'Uma chamada só: o SDR do n8n descobre quem é a pessoa, de qual anúncio veio e o histórico.';
