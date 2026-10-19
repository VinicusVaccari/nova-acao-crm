-- 20261019_lp_nova_atendimento_humano — leads das LPs novas sem agente.
--
-- Decisão da call de 19/10/2026: o formulário das LPs novas (/lp/trafego-pago,
-- /lp/sites, /lp/seo…) já qualifica, então o lead vai direto para o Rodrigues
-- e nenhum agente entra (Naia, MEL, LUNA). Os formulários antigos não mandam
-- landing_page em /lp/ e seguem exatamente como hoje.
--
-- A marca é a coluna que já existe para isso: opportunities.atendimento
-- ('naia' | 'humano', migração 0019). Ela é gravada no MESMO insert que cria
-- o negócio — se fosse um update depois, uma falha no meio deixaria o lead sem
-- marca e a Naia faria o 1º contato em 5 minutos.
--
-- Nota: as migrações posteriores à 0051 ficaram só no computador antigo; o
-- corpo de fn_ingest_lead abaixo é o que estava em produção em 19/10/2026,
-- com as únicas mudanças marcadas "LP nova".

create or replace function public.fn_ingest_lead(p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_person uuid; v_company uuid; v_tp bigint; v_opp uuid; v_existing uuid;
  v_channel text; v_naia uuid; v_clique_em timestamptz;
  v_lp_nova boolean; v_responsavel_lp uuid; -- LP nova
  v_utm_source text := nullif(btrim(p_payload->>'utm_source'), '');
  v_utm_medium text := nullif(btrim(p_payload->>'utm_medium'), '');
  v_utm_campaign text := nullif(btrim(p_payload->>'utm_campaign'), '');
  v_utm_content text := nullif(btrim(p_payload->>'utm_content'), '');
  v_utm_term text := nullif(btrim(p_payload->>'utm_term'), '');
  v_landing_page text := nullif(btrim(p_payload->>'landing_page'), '');
  v_referrer text := nullif(btrim(p_payload->>'referrer'), '');
  v_gclid text := nullif(btrim(p_payload->>'gclid'), '');
  v_gbraid text := nullif(btrim(p_payload->>'gbraid'), '');
  v_wbraid text := nullif(btrim(p_payload->>'wbraid'), '');
  v_fbclid text := nullif(btrim(p_payload->>'fbclid'), '');
  v_fbc text := nullif(btrim(p_payload->>'fbc'), '');
  v_fbp text := nullif(btrim(p_payload->>'fbp'), '');
  v_ga_client_id text := nullif(btrim(p_payload->>'ga_client_id'), '');
begin
  if nullif(btrim(p_payload->>'clique_em'), '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$' then
    begin
      v_clique_em := (p_payload->>'clique_em')::timestamptz;
    exception when others then
      v_clique_em := null;
    end;
  end if;

  v_naia := public.fn_id_da_naia();
  if v_naia is null then raise exception 'Naia indisponível para receber novos leads'; end if;

  -- LP nova: caminho começando em /lp/, com ou sem domínio na frente.
  v_lp_nova := coalesce(v_landing_page ~* '^(https?://[^/?#]+)?/lp/', false);
  if v_lp_nova then
    -- Rodrigues. Se o perfil estiver inativo, o negócio fica sem dono humano
    -- definido (cai na Naia como responsável), mas continua 'humano': nenhum
    -- agente entra de qualquer jeito.
    select id into v_responsavel_lp from public.profiles
     where id = '8e4d1d15-77b2-4808-9e90-7d4e92d41e0c' and is_active = true;
  end if;

  if lower(btrim(coalesce(p_payload->>'channel', ''))) = 'whatsapp'
     and (fn_trava_status(fn_norm_phone(p_payload->>'phone')) or fn_trava_status(p_payload->>'wa_id')) then
    select i.person_id into v_person from identities i
     where i.kind in ('phone', 'wa_id') and (
       i.value = fn_norm_phone(p_payload->>'phone') or i.value = regexp_replace(p_payload->>'phone', '[^0-9]', '', 'g')
       or i.value = p_payload->>'wa_id' or i.value = '+' || (p_payload->>'wa_id')
     ) order by (i.kind = 'phone') desc, i.id limit 1;
    select id into v_existing from opportunities
     where person_id = v_person and lost_at is null and stage <> 'ganho'
     order by created_at desc limit 1;
    return jsonb_build_object('person_id', v_person, 'opportunity_id', v_existing,
      'created', false, 'travado', true, 'blocked', case when v_existing is null then 'whatsapp_travado' else null end);
  end if;

  v_person := fn_resolve_person(
    p_payload->>'email', p_payload->>'phone', p_payload->>'name', p_payload->>'wa_id',
    v_fbclid, v_gclid, v_ga_client_id, v_fbp
  );
  if coalesce(p_payload->>'company_name', p_payload->>'cnpj') is not null then
    insert into companies (trade_name, cnpj, website, segment)
    values (p_payload->>'company_name', nullif(p_payload->>'cnpj',''), p_payload->>'website', p_payload->>'segment')
    on conflict (cnpj) do update set trade_name = coalesce(companies.trade_name, excluded.trade_name)
    returning id into v_company;
    insert into person_company (person_id, company_id) values (v_person, v_company) on conflict do nothing;
  end if;
  v_channel := coalesce(nullif(btrim(p_payload->>'channel'), ''), case
    when v_fbclid is not null or v_fbc is not null then 'paid_social'
    when v_gclid is not null or v_gbraid is not null or v_wbraid is not null then 'paid_search'
    when v_utm_medium in ('cpc','paid_social') then 'paid'
    when v_utm_source is not null then 'organic' else 'direct' end);
  insert into touchpoints (
    person_id, channel, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    campaign_external_id, adset_external_id, ad_external_id, gclid, gbraid, wbraid, fbclid, fbc, fbp, ga_client_id,
    clique_em, landing_page, referrer, ip, user_agent, raw
  ) values (
    v_person, v_channel, v_utm_source, v_utm_medium, v_utm_campaign, v_utm_content, v_utm_term,
    p_payload->>'campaign_id', p_payload->>'adset_id', p_payload->>'ad_id', v_gclid, v_gbraid, v_wbraid,
    v_fbclid, v_fbc, v_fbp, v_ga_client_id, v_clique_em, v_landing_page, v_referrer,
    p_payload->>'ip', p_payload->>'user_agent', p_payload
  ) returning id into v_tp;
  select id into v_existing from opportunities
   where person_id = v_person and lost_at is null and stage <> 'ganho'
   order by created_at desc limit 1;
  if v_existing is not null then
    -- Lead que voltou: cai no negócio que já existe, que segue com quem já
    -- está atendendo (inclusive se veio de LP nova).
    if v_utm_source is not null or v_landing_page is not null
       or v_gclid is not null or v_gbraid is not null or v_wbraid is not null or v_fbclid is not null or v_fbc is not null then
      update opportunities set last_touchpoint_id = v_tp where id = v_existing;
    end if;
    insert into events (event_name, subject_type, subject_id, actor_type, payload, source)
    values ('lead.returned', 'opportunity', v_existing, 'external', jsonb_build_object('touchpoint_id', v_tp), 'api:ingest');
    return jsonb_build_object('person_id', v_person, 'opportunity_id', v_existing, 'touchpoint_id', v_tp, 'created', false);
  end if;
  insert into opportunities (
    person_id, company_id, stage, product, expected_value, first_touchpoint_id, last_touchpoint_id, source_channel, owner_id,
    atendimento -- LP nova
  ) values (
    v_person, v_company, 'novo', p_payload->>'product', nullif(p_payload->>'expected_value','')::numeric,
    v_tp, v_tp, v_channel,
    case when v_lp_nova then coalesce(v_responsavel_lp, v_naia) else v_naia end, -- LP nova
    case when v_lp_nova then 'humano' else 'naia' end -- LP nova
  ) returning id into v_opp;
  insert into events (event_name, subject_type, subject_id, actor_type, payload, source)
  values ('lead.created', 'opportunity', v_opp, 'external', p_payload, 'api:ingest');
  return jsonb_build_object('person_id', v_person, 'opportunity_id', v_opp, 'touchpoint_id', v_tp, 'created', true,
    'atendimento', case when v_lp_nova then 'humano' else 'naia' end); -- LP nova
end;
$function$;

-- 1º contato da Naia: só negócio com atendimento 'naia'. Igual ao que estava
-- em produção, mais a última condição.
create or replace function public.fn_leads_para_outreach(p_min integer default 3, p_max_horas integer default 24)
 returns table(opportunity_id uuid, phone text, nome text)
 language sql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select o.id, ph.value, p.full_name
  from opportunities o
  join people p on p.id = o.person_id
  join lateral (
    select value from identities
    where person_id = o.person_id and kind in ('phone', 'wa_id')
    order by (kind = 'phone') desc
    limit 1
  ) ph on true
  where o.first_contact_at is null
    and o.outreach_at is null
    and o.lost_at is null
    and o.stage not in ('ganho', 'perdido')
    and o.created_at <= now() - make_interval(mins => p_min)
    and o.created_at >= now() - make_interval(hours => p_max_horas)
    and not exists (select 1 from activities a where a.opportunity_id = o.id)
    and not fn_trava_status(ph.value)
    and o.atendimento = 'naia' -- LP nova
$function$;
