-- Fixtures exclusivamente dentro da transação de ensaio; o runner sempre dá ROLLBACK.
-- Cobre a migração 20261019_lp_nova_atendimento_humano.

-- 1. Lead de LP nova: nasce 'humano', com o Rodrigues como responsável.
do $$ declare r jsonb; o record; begin
  r := public.fn_ingest_lead(jsonb_build_object(
    'name', 'Teste LP nova', 'phone', '+5511900000001', 'email', 'lp-nova@teste.invalid',
    'landing_page', 'https://novaa-orefazersite.vercel.app/lp/trafego-pago', 'utm_source', 'google'));
  if (r->>'created')::boolean is not true then raise exception 'LP nova: negócio não foi criado: %', r; end if;
  select atendimento, owner_id into o from public.opportunities where id = (r->>'opportunity_id')::uuid;
  if o.atendimento <> 'humano' then raise exception 'LP nova: atendimento % (esperado humano)', o.atendimento; end if;
  if o.owner_id <> '8e4d1d15-77b2-4808-9e90-7d4e92d41e0c' then raise exception 'LP nova: responsável não é o Rodrigues'; end if;
  if r->>'atendimento' <> 'humano' then raise exception 'LP nova: retorno sem atendimento humano: %', r; end if;
end $$;

-- 2. Caminho relativo também conta como LP nova.
do $$ declare r jsonb; begin
  r := public.fn_ingest_lead(jsonb_build_object(
    'name', 'Teste LP relativa', 'phone', '+5511900000002', 'landing_page', '/lp/sites?utm_source=x'));
  if (select atendimento from public.opportunities where id = (r->>'opportunity_id')::uuid) <> 'humano' then
    raise exception 'LP nova com caminho relativo não ficou humano'; end if;
end $$;

-- 3. Formulários de sempre (sem landing_page, ou fora de /lp/): seguem com a Naia.
do $$ declare r jsonb; begin
  r := public.fn_ingest_lead(jsonb_build_object('name', 'Teste antigo', 'phone', '+5511900000003'));
  if (select atendimento from public.opportunities where id = (r->>'opportunity_id')::uuid) <> 'naia'
     or (select owner_id from public.opportunities where id = (r->>'opportunity_id')::uuid) <> public.fn_id_da_naia() then
    raise exception 'Formulário sem landing_page deveria seguir com a Naia'; end if;
  r := public.fn_ingest_lead(jsonb_build_object(
    'name', 'Teste site', 'phone', '+5511900000004', 'landing_page', 'https://agencianovaacao.com.br/contato/'));
  if (select atendimento from public.opportunities where id = (r->>'opportunity_id')::uuid) <> 'naia' then
    raise exception 'Página fora de /lp/ deveria seguir com a Naia'; end if;
  r := public.fn_ingest_lead(jsonb_build_object(
    'name', 'Teste parecido', 'phone', '+5511900000005', 'landing_page', 'https://agencianovaacao.com.br/blog/lp/'));
  if (select atendimento from public.opportunities where id = (r->>'opportunity_id')::uuid) <> 'naia' then
    raise exception '/lp/ no meio do caminho não é LP nova'; end if;
end $$;

-- 3b. Teste de primeiro contato: os dois leads de LP nova acima caíram em
--     grupos diferentes, cada um com anotação e evento; o antigo não entra.
do $$ declare v_grupos text[]; begin
  select array_agg(e.payload->>'grupo' order by e.payload->>'grupo') into v_grupos
    from public.events e join public.opportunities o on o.id = e.subject_id
    join public.identities i on i.person_id = o.person_id
   where e.event_name = 'lead.teste_primeiro_contato'
     and i.value in ('+5511900000001', '+5511900000002', '+5511900000003');
  if v_grupos is distinct from array['ligacao', 'mensagem'] then
    raise exception 'Teste 50/50: grupos % (esperado um de cada, só nos leads de LP nova)', v_grupos; end if;
  if (select count(*) from public.notes n join public.opportunities o on o.id = n.opportunity_id
       join public.identities i on i.person_id = o.person_id
      where i.value in ('+5511900000001', '+5511900000002') and n.body like 'Teste de primeiro contato (50/50):%') <> 2 then
    raise exception 'Teste 50/50: cada lead de LP nova deveria ter a anotação do grupo'; end if;
end $$;

-- 3c. Lead de LP nova que volta: cai no mesmo negócio e não ganha outro sorteio.
do $$ declare r jsonb; begin
  r := public.fn_ingest_lead(jsonb_build_object(
    'name', 'Teste LP nova', 'phone', '+5511900000001', 'landing_page', '/lp/seo'));
  if (r->>'created')::boolean or r ? 'primeiro_contato' then
    raise exception 'Lead que voltou não deveria ganhar negócio nem sorteio novo: %', r; end if;
end $$;

-- 4. 1º contato da Naia: depois dos 5 minutos, só o negócio 'naia' entra na fila.
update public.opportunities set created_at = now() - interval '10 minutes'
 where person_id in (select person_id from public.identities where value in ('+5511900000001', '+5511900000003'));
do $$ begin
  if exists (select 1 from public.fn_leads_para_outreach(5, 24) where phone = '+5511900000001') then
    raise exception 'Negócio de LP nova entrou na fila do 1º contato da Naia'; end if;
  if not exists (select 1 from public.fn_leads_para_outreach(5, 24) where phone = '+5511900000003') then
    raise exception 'Negócio dos formulários de sempre saiu da fila do 1º contato da Naia'; end if;
end $$;
