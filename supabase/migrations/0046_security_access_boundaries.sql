-- Segurança P0. Aplicar antes do deploy da aplicação que usa os novos RPCs.
-- Não altera dados de leads, etapas, mensagens, credenciais ou jobs existentes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Clientes públicos não devem acessar diretamente o CRM.
revoke all on all tables in schema public from public, anon;
revoke all on all sequences in schema public from public, anon;
revoke create on schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from public, anon;
alter default privileges in schema public revoke all on sequences from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
-- O navegador só lê via RLS. Mutações passam pelas Actions autorizadas ou
-- integrações service_role, evitando forjar vínculos/person_id/meta diretamente.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from authenticated;

create or replace function public.fn_my_role()
returns public.app_role language sql stable security definer
set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active = true;
$$;
create or replace function public.fn_is_manager()
returns boolean language sql stable security definer
set search_path = '' as $$
  select coalesce(public.fn_my_role() in ('admin', 'gestor'), false);
$$;

-- RLS não limita colunas. Grants por coluna impedem autoelevação de role.
-- Contas criadas pelo Auth não ganham acesso automaticamente. O aceite de
-- convite ativa o perfil explicitamente pelo backend. Usuários atuais intactos.
alter table public.profiles alter column is_active set default false;
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Tabelas operacionais nunca devem ser expostas a clientes do app.
do $$ declare t text; begin
  foreach t in array array['_migrations', 'automation_runs', 'identity_conflicts'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from authenticated, anon, public', t);
      execute format('grant all on public.%I to service_role', t);
    end if;
  end loop;
end $$;

-- INSERT valida a nova linha, não o USING. Reutiliza a expressão original
-- de acesso à oportunidade/conta para preservar a regra de carteira.
do $$ declare p record; begin
  for p in
    select c.relname, pol.polname, pg_get_expr(pol.polqual, pol.polrelid) as predicate
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and pol.polcmd = '*'
      and c.relname = any(array['activities','meetings','proposals','contracts',
        'stage_history','objection_occurrences','notes','tasks','opportunity_products',
        'deal_files','onboarding_tasks','deliverables','account_health','checkins',
        'nps_responses','invoices','testimonials']) and pol.polqual is not null
  loop
    execute format('alter policy %I on public.%I with check (%s)', p.polname, p.relname, p.predicate);
  end loop;
end $$;

-- Toda tabela com RLS exige perfil ativo, inclusive para policies antigas
-- que só verificavam auth.uid(). SECURITY DEFINER de fn_my_role evita recursão.
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists security_active_user on public.%I', t.relname);
    execute format('create policy security_active_user on public.%I as restrictive for all to authenticated using (public.fn_my_role() is not null) with check (public.fn_my_role() is not null)', t.relname);
  end loop;
end $$;

-- Views passam a respeitar as policies do chamador. service_role mantém bypass.
-- Cadastros sensíveis: escrita somente por backend autorizado. A leitura
-- segue os negócios acessíveis e inclui empresas avulsas criadas pelo usuário.
alter table public.companies add column if not exists created_by uuid references public.profiles(id);
create or replace function public.fn_can_read_person(p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.fn_my_role() is not null and (public.fn_is_manager() or exists (
    select 1 from public.opportunities where person_id=p_person and (owner_id=auth.uid() or sdr_id=auth.uid())
  ));
$$;
create or replace function public.fn_can_read_company(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.fn_my_role() is not null and (public.fn_is_manager() or exists (
    select 1 from public.opportunities where company_id=p_company and (owner_id=auth.uid() or sdr_id=auth.uid())
  ) or exists (select 1 from public.companies where id=p_company and created_by=auth.uid()));
$$;
do $$ declare t text; predicate text; begin
  foreach t in array array['people','identities','companies','person_company','touchpoints',
    'campaigns','objections','lost_reasons','content_assets','cases'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from authenticated', t);
    end if;
  end loop;
  foreach t in array array['people','identities','companies','person_company','touchpoints'] loop
    predicate := case t
      when 'people' then 'public.fn_can_read_person(id)'
      when 'companies' then 'public.fn_can_read_company(id)'
      when 'person_company' then 'public.fn_can_read_person(person_id) and public.fn_can_read_company(company_id)'
      else 'public.fn_can_read_person(person_id)' end;
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('drop policy if exists security_scoped_read on public.%I', t);
    execute format('create policy security_scoped_read on public.%I for select to authenticated using (%s)', t, predicate);
  end loop;
end $$;

-- Catálogos sem dados pessoais precisam continuar legíveis nas telas com RLS.
do $$ declare t text; begin
  foreach t in array array['pipeline_stages','segments','custom_fields'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists security_catalog_read on public.%I', t);
    execute format('create policy security_catalog_read on public.%I for select to authenticated using (public.fn_my_role() is not null)', t);
  end loop;
end $$;

do $$ declare v record; begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
  end loop;
end $$;

-- Funções de negócio: somente backend e scheduler. Helpers RLS/leitura
-- explicitamente liberados aos usuários continuam limitados por RLS.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature, p.proname from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,3)='fn_'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
    if f.proname = any(array['fn_my_role','fn_is_manager','fn_can_read_person','fn_can_read_company','fn_norm_phone','fn_norm_email',
      'fn_stage_probability','fn_stage_sla','fn_dash_comercial','fn_dash_por_vendedor','fn_funnel_series']) then
      execute format('grant execute on function %s to authenticated', f.signature);
    end if;
  end loop;
end $$;
alter function public.fn_leads_para_outreach(integer, integer) set search_path = public, pg_temp;
alter function public.fn_outreach_disparar() set search_path = public, pg_temp;

-- Entrada manual conserva a ingestão/atribuição e reentrada existentes, mas
-- autoriza o resultado na MESMA transação. Negar desfaz também identidade/toque.
create or replace function public.fn_create_lead_for_user(p_payload jsonb, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; result jsonb; deal public.opportunities;
begin
  select * into actor from public.profiles where id=p_user_id and is_active=true;
  if actor.id is null then raise exception 'Usuário indisponível' using errcode='42501'; end if;
  result := public.fn_ingest_lead(p_payload);
  select * into deal from public.opportunities where id=(result->>'opportunity_id')::uuid for update;
  if coalesce((result->>'created')::boolean, false) then
    update public.opportunities set owner_id=p_user_id where id=deal.id;
  elsif actor.role not in ('admin','gestor') and
    (deal.owner_id is distinct from p_user_id and deal.sdr_id is distinct from p_user_id) then
    raise exception 'Negócio indisponível ou sem permissão' using errcode='42501';
  end if;
  return result;
end $$;
revoke all on function public.fn_create_lead_for_user(jsonb,uuid) from public, anon, authenticated;
grant execute on function public.fn_create_lead_for_user(jsonb,uuid) to service_role;

-- Limite compartilhado entre instâncias serverless, sem confiar em memória local.
create table if not exists public.security_rate_limits (
  key text primary key,
  window_started_at timestamptz not null,
  hits integer not null,
  expires_at timestamptz not null
);
create index if not exists security_rate_limits_expiry on public.security_rate_limits(expires_at);
alter table public.security_rate_limits enable row level security;
revoke all on public.security_rate_limits from public, anon, authenticated;
grant all on public.security_rate_limits to service_role;
create or replace function public.fn_security_rate_limit(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare total integer; stamp timestamptz := clock_timestamp();
begin
  if length(p_key)>128 or p_limit<1 or p_limit>10000 or p_seconds<1 or p_seconds>3600 then
    raise exception 'Limite inválido';
  end if;
  delete from public.security_rate_limits where key in (
    select key from public.security_rate_limits where expires_at < stamp order by expires_at limit 100
  );
  insert into public.security_rate_limits as r(key,window_started_at,hits,expires_at)
    values(p_key,stamp,1,stamp+make_interval(secs=>p_seconds))
  on conflict(key) do update set
    hits=case when r.expires_at<=stamp then 1 else least(r.hits+1,p_limit+1) end,
    window_started_at=case when r.expires_at<=stamp then stamp else r.window_started_at end,
    expires_at=case when r.expires_at<=stamp then stamp+make_interval(secs=>p_seconds) else r.expires_at end
  returning hits into total;
  return total<=p_limit;
end $$;
revoke all on function public.fn_security_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.fn_security_rate_limit(text,integer,integer) to service_role;

-- Novo bucket privado: wa-media também contém a marca usada por e-mails
-- Deduplicação de callback no mesmo commit da atividade. Não depende de
-- memória da instância nem do conteúdo da mensagem (duas iguais são válidas).
create table if not exists public.security_webhook_receipts (
  message_id text not null,
  direction text not null check (direction in ('inbound','outbound')),
  created_at timestamptz not null default now(),
  primary key(message_id,direction)
);
alter table public.security_webhook_receipts enable row level security;
revoke all on public.security_webhook_receipts from public,anon,authenticated;
grant all on public.security_webhook_receipts to service_role;
create or replace function public.fn_log_whatsapp_once(
  p_opportunity_id uuid, p_message_id text, p_kind text, p_direction text, p_body text, p_meta jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('whatsapp','audio') or p_direction not in ('inbound','outbound') then
    raise exception 'Evento WhatsApp inválido'; end if;
  if p_message_id is not null and p_message_id <> '' then
    if length(p_message_id)>512 then raise exception 'MessageId inválido'; end if;
    insert into public.security_webhook_receipts(message_id,direction) values(p_message_id,p_direction) on conflict do nothing;
    if not found then return false; end if;
  end if;
  perform public.fn_log_activity(p_opportunity_id,p_kind,p_direction,p_body,null,false,null,
    coalesce(p_meta,'{}'::jsonb) || jsonb_build_object('messageId',p_message_id));
  return true;
end $$;
revoke all on function public.fn_log_whatsapp_once(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fn_log_whatsapp_once(uuid,text,text,text,text,jsonb) to service_role;

-- Novo bucket privado: wa-media também contém a marca usada por e-mails
-- já enviados. Áudios antigos serão migrados separadamente, preservando a marca.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('wa-audio','wa-audio',false,26214400,array['audio/ogg','audio/mpeg','audio/mp4','audio/wav'])
on conflict(id) do update set public=false,file_size_limit=26214400,
  allowed_mime_types=excluded.allowed_mime_types;

notify pgrst, 'reload schema';
commit;
