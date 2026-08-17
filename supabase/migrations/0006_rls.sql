-- =============================================================
-- 0006_rls — segurança em nível de linha
-- Nota: a service_role (usada pelo n8n) ignora RLS por padrão.
-- Estas políticas valem para usuários autenticados no painel.
-- =============================================================

create or replace function fn_my_role()
returns app_role language sql stable security definer as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function fn_is_manager()
returns boolean language sql stable security definer as $$
  select coalesce(fn_my_role() in ('admin','gestor'), false);
$$;

-- -------------------------------------------------------------
alter table profiles              enable row level security;
alter table people                enable row level security;
alter table identities            enable row level security;
alter table companies             enable row level security;
alter table person_company        enable row level security;
alter table touchpoints           enable row level security;
alter table campaigns             enable row level security;
alter table ad_spend_daily        enable row level security;
alter table opportunities         enable row level security;
alter table stage_history         enable row level security;
alter table activities            enable row level security;
alter table meetings              enable row level security;
alter table proposals             enable row level security;
alter table contracts             enable row level security;
alter table objections            enable row level security;
alter table objection_occurrences enable row level security;
alter table lost_reasons          enable row level security;
alter table events                enable row level security;
alter table outbox                enable row level security;
alter table accounts              enable row level security;
alter table onboarding_tasks      enable row level security;
alter table deliverables          enable row level security;
alter table account_health        enable row level security;
alter table checkins              enable row level security;
alter table nps_responses         enable row level security;
alter table invoices              enable row level security;
alter table testimonials          enable row level security;
alter table cases                 enable row level security;
alter table content_assets        enable row level security;

-- -------------------------------------------------------------
-- PERFIS
-- -------------------------------------------------------------
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles
  for select to authenticated using (true);

drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles
  for update to authenticated using (id = auth.uid() or fn_is_manager());

-- -------------------------------------------------------------
-- OPORTUNIDADES — vendedor vê as suas, gestor vê todas
-- -------------------------------------------------------------
drop policy if exists opp_read on opportunities;
create policy opp_read on opportunities
  for select to authenticated
  using (fn_is_manager() or owner_id = auth.uid() or sdr_id = auth.uid());

drop policy if exists opp_write on opportunities;
create policy opp_write on opportunities
  for all to authenticated
  using (fn_is_manager() or owner_id = auth.uid() or sdr_id = auth.uid())
  with check (fn_is_manager() or owner_id = auth.uid() or sdr_id = auth.uid());

-- -------------------------------------------------------------
-- Tabelas ligadas à oportunidade herdam a mesma regra
-- -------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['activities','meetings','proposals','contracts',
                           'stage_history','objection_occurrences']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format($p$
      create policy %1$I_read on %1$I for select to authenticated
      using (fn_is_manager() or exists (
        select 1 from opportunities o
         where o.id = %1$I.opportunity_id
           and (o.owner_id = auth.uid() or o.sdr_id = auth.uid())))
    $p$, t);

    execute format('drop policy if exists %I_write on %I', t, t);
    execute format($p$
      create policy %1$I_write on %1$I for all to authenticated
      using (fn_is_manager() or exists (
        select 1 from opportunities o
         where o.id = %1$I.opportunity_id
           and (o.owner_id = auth.uid() or o.sdr_id = auth.uid())))
      with check (true)
    $p$, t);
  end loop;
end $$;

-- -------------------------------------------------------------
-- Cadastros compartilhados: todo mundo lê, todo mundo escreve
-- -------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['people','identities','companies','person_company',
                           'touchpoints','campaigns','objections','lost_reasons',
                           'content_assets','cases']
  loop
    execute format('drop policy if exists %I_all on %I', t, t);
    execute format($p$
      create policy %1$I_all on %1$I for all to authenticated
      using (true) with check (true)
    $p$, t);
  end loop;
end $$;

-- -------------------------------------------------------------
-- CS: CSM vê a própria carteira, gestor vê tudo
-- -------------------------------------------------------------
drop policy if exists accounts_read on accounts;
create policy accounts_read on accounts
  for select to authenticated
  using (fn_is_manager() or csm_id = auth.uid());

drop policy if exists accounts_write on accounts;
create policy accounts_write on accounts
  for all to authenticated
  using (fn_is_manager() or csm_id = auth.uid())
  with check (fn_is_manager() or csm_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['onboarding_tasks','deliverables','account_health',
                           'checkins','nps_responses','invoices','testimonials']
  loop
    execute format('drop policy if exists %I_all on %I', t, t);
    execute format($p$
      create policy %1$I_all on %1$I for all to authenticated
      using (fn_is_manager() or exists (
        select 1 from accounts a where a.id = %1$I.account_id and a.csm_id = auth.uid()))
      with check (true)
    $p$, t);
  end loop;
end $$;

-- -------------------------------------------------------------
-- Dados sensíveis de mídia e infra: só gestão
-- -------------------------------------------------------------
drop policy if exists spend_read on ad_spend_daily;
create policy spend_read on ad_spend_daily
  for select to authenticated using (fn_is_manager() or fn_my_role() = 'analista');

drop policy if exists events_read on events;
create policy events_read on events
  for select to authenticated using (fn_is_manager());

drop policy if exists outbox_read on outbox;
create policy outbox_read on outbox
  for select to authenticated using (fn_is_manager());

-- -------------------------------------------------------------
-- Novo usuário do Auth ganha perfil automaticamente
-- -------------------------------------------------------------
create or replace function fn_handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, full_name, email)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_new_user on auth.users;
create trigger trg_new_user
  after insert on auth.users
  for each row execute function fn_handle_new_user();
