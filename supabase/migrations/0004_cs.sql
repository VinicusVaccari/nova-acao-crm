-- =============================================================
-- 0004_cs — cliente, onboarding, entregas, saúde, advocacy
-- =============================================================

create table if not exists accounts (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid references companies(id),
  origin_opportunity_id  uuid references opportunities(id),
  name                   text not null,
  csm_id                 uuid references profiles(id),
  status                 text not null default 'onboarding'
                           check (status in ('onboarding','ativo','risco','pausado','churn')),
  mrr                    numeric(12,2) not null default 0,
  product                text,
  started_at             date not null default current_date,
  contract_end           date,
  churned_at             date,
  churn_reason           text,
  created_at             timestamptz not null default now()
);

create index if not exists idx_accounts_status on accounts (status);
create index if not exists idx_accounts_csm    on accounts (csm_id);

-- Os 7 marcos. blocked_by encerra a discussão de quem atrasou.
create table if not exists onboarding_tasks (
  id          bigserial primary key,
  account_id  uuid not null references accounts(id) on delete cascade,
  milestone   text not null,
  sort_order  int not null default 0,
  due_at      date,
  done_at     timestamptz,
  blocked_by  text check (blocked_by in ('cliente','agencia')),
  owner_id    uuid references profiles(id),
  notes       text
);

create index if not exists idx_onb_account on onboarding_tasks (account_id);

-- Meta vs. realizado. Componente mais pesado do health score.
create table if not exists deliverables (
  id          bigserial primary key,
  account_id  uuid not null references accounts(id) on delete cascade,
  period      date not null,               -- primeiro dia do mês de referência
  metric      text not null,               -- leads | cpl | roas | reunioes | receita
  target      numeric,
  actual      numeric,
  unit        text,
  created_at  timestamptz not null default now(),
  unique (account_id, period, metric)
);

create index if not exists idx_deliv_account on deliverables (account_id, period desc);

create table if not exists account_health (
  account_id  uuid not null references accounts(id) on delete cascade,
  date        date not null default current_date,
  score       int not null check (score between 0 and 100),
  components  jsonb not null default '{}',
  trend       text,
  reason      text,
  primary key (account_id, date)
);

create table if not exists checkins (
  id           bigserial primary key,
  account_id   uuid not null references accounts(id) on delete cascade,
  kind         text not null default 'mensal' check (kind in ('semanal','mensal','qbr')),
  occurred_at  timestamptz not null default now(),
  transcript   text,
  summary      text,
  risks        jsonb not null default '[]',
  decisions    jsonb not null default '[]',
  upsell_signals jsonb not null default '[]'
);

create table if not exists nps_responses (
  id           bigserial primary key,
  account_id   uuid not null references accounts(id) on delete cascade,
  person_id    uuid references people(id),
  score        int check (score between 0 and 10),
  comment      text,
  responded_at timestamptz not null default now()
);

create table if not exists invoices (
  id          bigserial primary key,
  account_id  uuid not null references accounts(id) on delete cascade,
  competence  date not null,
  amount      numeric(12,2) not null,
  due_date    date,
  paid_at     timestamptz,
  status      text not null default 'aberta'
                check (status in ('aberta','paga','atrasada','cancelada'))
);

create index if not exists idx_invoices_account on invoices (account_id, competence desc);

-- -------------------------------------------------------------
-- ADVOCACY — onde o ciclo fecha
-- -------------------------------------------------------------

create table if not exists testimonials (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references accounts(id) on delete cascade,
  person_id      uuid references people(id),
  kind           text check (kind in ('nota','print','texto','video','case','indicacao')),
  status         text not null default 'solicitado'
                   check (status in ('solicitado','agendado','coletado','aprovado','publicado','recusado')),
  trigger_reason text,
  asset_url      text,
  usage_authorized boolean not null default false,
  collected_at   timestamptz,
  published_at   timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists cases (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid references accounts(id),
  title               text,
  segment             text,
  problem             text,
  approach            text,
  result_metrics      jsonb not null default '{}',
  objections_answered int[] not null default '{}',
  status              text not null default 'rascunho',
  published_url       text,
  created_at          timestamptz not null default now()
);

-- A ponte de volta para o marketing.
create table if not exists content_assets (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text check (kind in ('criativo','post','artigo','vsl','email','landing')),
  source_kind          text check (source_kind in ('objection','case','testimonial','meeting_insight','manual')),
  source_id            text,
  title                text,
  brief                text,
  hook                 text,
  status               text not null default 'ideia',
  campaign_external_id text,
  created_at           timestamptz not null default now()
);

-- -------------------------------------------------------------
-- GANHO -> CLIENTE (a passagem de bastão)
-- -------------------------------------------------------------
create or replace function fn_convert_to_account(p_opportunity_id uuid, p_csm uuid default null)
returns uuid language plpgsql security definer as $$
declare
  v_opp     opportunities;
  v_account uuid;
  v_name    text;
begin
  select * into v_opp from opportunities where id = p_opportunity_id;
  if not found then raise exception 'Oportunidade não encontrada'; end if;

  select coalesce(c.trade_name, c.legal_name, p.full_name)
    into v_name
    from people p left join companies c on c.id = v_opp.company_id
   where p.id = v_opp.person_id;

  insert into accounts (company_id, origin_opportunity_id, name, csm_id, mrr, product, contract_end)
  values (v_opp.company_id, p_opportunity_id, coalesce(v_name,'Cliente'), p_csm,
          coalesce(v_opp.expected_value,0), v_opp.product,
          (current_date + (coalesce(v_opp.term_months,12) || ' months')::interval)::date)
  returning id into v_account;

  -- os 7 marcos de onboarding com prazos
  insert into onboarding_tasks (account_id, milestone, sort_order, due_at) values
    (v_account, 'Kickoff realizado',                      1, current_date + 3),
    (v_account, 'Acessos concedidos (BM, Ads, GA4, site)', 2, current_date + 5),
    (v_account, 'Brand kit e materiais recebidos',        3, current_date + 7),
    (v_account, 'ICP e oferta validados',                 4, current_date + 7),
    (v_account, 'Tracking instalado e validado',          5, current_date + 10),
    (v_account, 'Primeiro criativo aprovado',             6, current_date + 12),
    (v_account, 'Primeira campanha no ar',                7, current_date + 15);

  insert into events (event_name, subject_type, subject_id, actor_type, payload, source)
  values ('account.created','account', v_account,'system',
          jsonb_build_object('opportunity_id', p_opportunity_id, 'mrr', v_opp.expected_value),
          'db:fn_convert_to_account');

  return v_account;
end $$;
