-- Fixtures exclusivamente dentro da transação de ensaio; o runner sempre dá ROLLBACK.
select set_config('security_test.user_a',gen_random_uuid()::text,true);
select set_config('security_test.user_b',gen_random_uuid()::text,true);
select set_config('security_test.person_a',gen_random_uuid()::text,true);
select set_config('security_test.person_b',gen_random_uuid()::text,true);
select set_config('security_test.deal_a',gen_random_uuid()::text,true);
select set_config('security_test.deal_b',gen_random_uuid()::text,true);

insert into auth.users(id,email,raw_user_meta_data)
values(current_setting('security_test.user_a')::uuid,current_setting('security_test.user_a') || '@security.invalid','{}'),
      (current_setting('security_test.user_b')::uuid,current_setting('security_test.user_b') || '@security.invalid','{}');
do $$ begin
  if (select count(*) from public.profiles where id in
    (current_setting('security_test.user_a')::uuid,current_setting('security_test.user_b')::uuid) and is_active=false)<>2 then
    raise exception 'Conta nova recebeu acesso automático ou trigger não criou perfil'; end if;
end $$;
-- Simula a ativação explícita já realizada pelo aceite de convite no backend.
update public.profiles set is_active=true where id in
  (current_setting('security_test.user_a')::uuid,current_setting('security_test.user_b')::uuid);
insert into public.people(id,full_name)
values(current_setting('security_test.person_a')::uuid,'Security test A'),
      (current_setting('security_test.person_b')::uuid,'Security test B');
insert into public.opportunities(id,person_id,owner_id,stage)
values(current_setting('security_test.deal_a')::uuid,current_setting('security_test.person_a')::uuid,current_setting('security_test.user_a')::uuid,'novo'),
      (current_setting('security_test.deal_b')::uuid,current_setting('security_test.person_b')::uuid,current_setting('security_test.user_b')::uuid,'novo');

select set_config('request.jwt.claims',json_build_object('sub',current_setting('security_test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare visible integer; begin
  if public.fn_my_role() is distinct from 'vendedor'::public.app_role then raise exception 'Perfil vendedor não reconhecido'; end if;
  select count(*) into visible from public.opportunities where id=current_setting('security_test.deal_a')::uuid;
  if visible<>1 then raise exception 'Vendedor não consegue ler próprio negócio'; end if;
  select count(*) into visible from public.opportunities where id=current_setting('security_test.deal_b')::uuid;
  if visible<>0 then raise exception 'Vendedor leu negócio de outro usuário'; end if;
  select count(*) into visible from public.v_contatos_lista where id=current_setting('security_test.person_b')::uuid;
  if visible<>0 then raise exception 'View vazou pessoa de outra carteira'; end if;
  begin
    update public.profiles set role='admin' where id=auth.uid();
    raise exception 'Autoelevação de role foi permitida';
  exception when insufficient_privilege then null; end;
  begin
    update public.opportunities set person_id=current_setting('security_test.person_b')::uuid
      where id=current_setting('security_test.deal_a')::uuid;
    raise exception 'Cliente adulterou vínculo de pessoa diretamente';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Privilégio temporário, só neste ensaio, para testar WITH CHECK como segunda
-- barreira. A migration real não permite escrita direta em notes pelo cliente.
grant insert,update on public.notes to authenticated;
set local role authenticated;
do $$ begin
  begin
    insert into public.notes(opportunity_id,body) values(current_setting('security_test.deal_b')::uuid,'forbidden');
    raise exception 'Inserção de nota em outra carteira foi permitida';
  exception when insufficient_privilege then null; end;
  insert into public.notes(opportunity_id,body) values(current_setting('security_test.deal_a')::uuid,'allowed');
  begin
    update public.notes set opportunity_id=current_setting('security_test.deal_b')::uuid
      where opportunity_id=current_setting('security_test.deal_a')::uuid;
    raise exception 'Reparenting de nota para outra carteira foi permitido';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
revoke insert,update on public.notes from authenticated;
-- As Actions autorizadas escrevem com service_role, não com a chave pública.
set local role service_role;
do $$ begin
  update public.opportunities set title='security test edit' where id=current_setting('security_test.deal_a')::uuid;
  if not found then raise exception 'Edição pelo backend foi bloqueada'; end if;
end $$;
reset role;

-- Mensagem repetida não duplica a timeline nem aciona novamente o chamador.
do $$ declare key text := gen_random_uuid()::text; begin
  if not public.fn_log_whatsapp_once(current_setting('security_test.deal_a')::uuid,key,'whatsapp','inbound','Security test','{}') then
    raise exception 'Primeira mensagem rejeitada'; end if;
  if public.fn_log_whatsapp_once(current_setting('security_test.deal_a')::uuid,key,'whatsapp','inbound','Security test','{}') then
    raise exception 'Mensagem duplicada foi aceita'; end if;
  if (select count(*) from public.activities where meta->>'messageId'=key)<>1 then
    raise exception 'Timeline não contém exatamente uma mensagem'; end if;
end $$;

-- Contador de não lidas: só mensagem do lead conta, a leitura zera, e ninguém
-- marca leitura em conversa de outra carteira.
--
-- O ensaio reaplica a 0046, que revoga escrita de TODAS as tabelas do schema.
-- Em produção a 0051 roda depois dela e reconcede; aqui repomos o mesmo grant
-- para o ensaio enxergar o estado real.
grant select, insert, update on public.inbox_leituras to authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('security_test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare antes bigint; begin
  select nao_lidas into antes from public.v_conversas
    where opportunity_id=current_setting('security_test.deal_a')::uuid;
  if coalesce(antes,0)<1 then raise exception 'Mensagem do lead não contou como não lida'; end if;
  perform set_config('security_test.nao_lidas',antes::text,true);
end $$;
-- O envio é do backend (service_role); authenticated não executa a RPC.
reset role;
select public.fn_log_whatsapp_once(current_setting('security_test.deal_a')::uuid,
  gen_random_uuid()::text,'whatsapp','outbound','Security test resposta','{}');
set local role authenticated;
do $$ declare depois bigint; begin
  select nao_lidas into depois from public.v_conversas
    where opportunity_id=current_setting('security_test.deal_a')::uuid;
  if depois is distinct from current_setting('security_test.nao_lidas')::bigint then
    raise exception 'Resposta do time mexeu no contador de não lidas'; end if;

  insert into public.inbox_leituras(opportunity_id,lida_ate,lida_por)
  values(current_setting('security_test.deal_a')::uuid,now(),current_setting('security_test.user_a')::uuid);
  select nao_lidas into depois from public.v_conversas
    where opportunity_id=current_setting('security_test.deal_a')::uuid;
  if depois<>0 then raise exception 'Leitura não zerou o contador'; end if;

  begin
    insert into public.inbox_leituras(opportunity_id,lida_ate)
    values(current_setting('security_test.deal_b')::uuid,now());
    raise exception 'Leitura foi marcada em negócio de outra carteira';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- O wrapper manual atribui o lead ao criador e desfaz toda a ingestão quando
-- a pessoa retorna para um negócio que pertence a outro vendedor.
do $$ declare result jsonb; before_count bigint; email text; begin
  email := gen_random_uuid()::text || '@security.invalid';
  result := public.fn_create_lead_for_user(jsonb_build_object('email',email,'name','Security manual'),current_setting('security_test.user_a')::uuid);
  if not exists(select 1 from public.opportunities where id=(result->>'opportunity_id')::uuid and owner_id=current_setting('security_test.user_a')::uuid) then
    raise exception 'Lead manual não foi atribuído ao criador'; end if;
  select count(*) into before_count from public.touchpoints where person_id=(result->>'person_id')::uuid;
  begin
    perform public.fn_create_lead_for_user(jsonb_build_object('email',email,'name','Security manual'),current_setting('security_test.user_b')::uuid);
    raise exception 'Vendedor alterou atribuição de outro vendedor';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.touchpoints where person_id=(result->>'person_id')::uuid)<>before_count then
    raise exception 'Ingestão negada deixou touchpoint persistido'; end if;
end $$;

update public.profiles set is_active=false where id=current_setting('security_test.user_a')::uuid;
set local role authenticated;
do $$ begin
  if public.fn_my_role() is not null then raise exception 'Usuário desativado ainda tem role'; end if;
  if exists(select 1 from public.opportunities where id=current_setting('security_test.deal_a')::uuid) then
    raise exception 'Usuário desativado ainda tem acesso'; end if;
end $$;
reset role;
