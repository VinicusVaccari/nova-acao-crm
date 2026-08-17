-- =============================================================
-- 0007_fix_attribution
--
-- Corrige duas falhas encontradas no teste de ponta a ponta:
--
-- 1. fn_enqueue_conversion pegava UM único toque (o mais recente
--    com qualquer id de clique) e lia todos os identificadores
--    dele. Se o lead veio do Meta e depois voltou pelo Google, o
--    último toque tinha gclid e fbclid nulo -> a venda subia para
--    o Meta sem fbclid e a conversão não casava.
--    Agora cada identificador vem do último toque que o possui.
--
-- 2. O fbp (cookie do Meta, melhora muito a taxa de match) era
--    gravado no toque mas não virava identidade da pessoa.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Resolução de identidade agora considera o fbp
-- (drop antes de recriar: mudar a assinatura criaria sobrecarga ambígua)
-- -------------------------------------------------------------
drop function if exists fn_resolve_person(text,text,text,text,text,text,text);

create or replace function fn_resolve_person(
  p_email     text default null,
  p_phone     text default null,
  p_name      text default null,
  p_wa_id     text default null,
  p_fbclid    text default null,
  p_gclid     text default null,
  p_ga_client text default null,
  p_fbp       text default null
) returns uuid language plpgsql security definer as $$
declare
  v_person uuid;
  v_email  text := fn_norm_email(p_email);
  v_phone  text := fn_norm_phone(p_phone);
begin
  -- ordem de confiança: telefone > e-mail > wa_id > ids de clique
  select person_id into v_person from identities
   where kind = 'phone' and value = v_phone and v_phone is not null
   limit 1;

  if v_person is null and v_email is not null then
    select person_id into v_person from identities
     where kind = 'email' and value = v_email limit 1;
  end if;

  if v_person is null and p_wa_id is not null then
    select person_id into v_person from identities
     where kind = 'wa_id' and value = p_wa_id limit 1;
  end if;

  if v_person is null and p_fbclid is not null then
    select person_id into v_person from identities
     where kind = 'fbclid' and value = p_fbclid limit 1;
  end if;

  if v_person is null and p_gclid is not null then
    select person_id into v_person from identities
     where kind = 'gclid' and value = p_gclid limit 1;
  end if;

  if v_person is null and p_fbp is not null then
    select person_id into v_person from identities
     where kind = 'fbp' and value = p_fbp limit 1;
  end if;

  if v_person is null and p_ga_client is not null then
    select person_id into v_person from identities
     where kind = 'ga_client_id' and value = p_ga_client limit 1;
  end if;

  if v_person is null then
    insert into people (full_name, email_primary, phone_primary)
    values (p_name, v_email, v_phone)
    returning id into v_person;
  else
    update people set
      full_name     = coalesce(full_name, p_name),
      email_primary = coalesce(email_primary, v_email::citext),
      phone_primary = coalesce(phone_primary, v_phone),
      updated_at    = now()
    where id = v_person;
  end if;

  insert into identities (person_id, kind, value)
  select v_person, k, v from (values
      ('email',        v_email),
      ('phone',        v_phone),
      ('wa_id',        p_wa_id),
      ('fbclid',       p_fbclid),
      ('fbp',          p_fbp),
      ('gclid',        p_gclid),
      ('ga_client_id', p_ga_client)
  ) as t(k, v)
  where v is not null and v <> ''
  on conflict (kind, value) do update set last_seen_at = now();

  return v_person;
end $$;

-- -------------------------------------------------------------
-- 2. Ingestão passa o fbp adiante
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
    p_payload->>'ga_client_id',
    p_payload->>'fbp'
  );

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

  select id into v_existing from opportunities
   where person_id = v_person and stage not in ('ganho','perdido')
   order by created_at desc limit 1;

  if v_existing is not null then
    update opportunities set last_touchpoint_id = v_tp where id = v_existing;

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

-- -------------------------------------------------------------
-- 3. A correção que importa:
--    cada identificador vem do último toque que REALMENTE o possui.
-- -------------------------------------------------------------
create or replace function fn_enqueue_conversion(
  p_opportunity_id uuid,
  p_stage          opp_stage
) returns void language plpgsql security definer as $$
declare
  v_event_name text;
  v_value      numeric;
  v_opp        record;
  v_fbclid     text;
  v_fbp        text;
  v_gclid      text;
  v_gaclient   text;
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

  -- Cada plataforma precisa do SEU identificador. Um lead que veio do
  -- Meta e voltou pelo Google tem os dois, em toques diferentes.
  select fbclid into v_fbclid from touchpoints
   where person_id = v_opp.person_id and fbclid is not null
   order by occurred_at desc limit 1;

  select fbp into v_fbp from touchpoints
   where person_id = v_opp.person_id and fbp is not null
   order by occurred_at desc limit 1;

  select gclid into v_gclid from touchpoints
   where person_id = v_opp.person_id and gclid is not null
   order by occurred_at desc limit 1;

  select ga_client_id into v_gaclient from touchpoints
   where person_id = v_opp.person_id and ga_client_id is not null
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
           'fbclid',         v_fbclid,
           'fbp',            v_fbp,
           'gclid',          v_gclid,
           'ga_client_id',   v_gaclient,
           'occurred_at',    now()
         ),
         d || ':' || p_opportunity_id::text || ':' || v_event_name
    from unnest(array['meta_capi','google_oci','ga4_mp']) as d
  on conflict (dedupe_key) do nothing;
end $$;
