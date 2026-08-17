-- =============================================================
-- 0015_calendar — agenda linkada ao Google Calendar.
--   Guarda a conexão OAuth (tokens) da agenda. Um projeto = uma
--   conexão por usuário (hoje só o Rodrigues). Os tokens são
--   sensíveis: RLS ligado SEM policies → só a service_role (servidor)
--   lê/escreve; nenhum cliente enxerga.
--   A tabela `meetings` já tem `external_event_id` e `meeting_url`,
--   então o vínculo reunião↔evento não exige mudar o modelo.
-- =============================================================

create table if not exists calendar_accounts (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null default 'google',
  user_id       uuid references profiles(id) on delete set null,
  google_email  text,
  calendar_id   text not null default 'primary',
  access_token  text,
  refresh_token text,
  token_expiry  timestamptz,
  scope         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- uma conexão por (provedor, usuário); o UUID zero cobre conexão sem dono
create unique index if not exists calendar_accounts_provider_user
  on calendar_accounts (provider, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table calendar_accounts enable row level security;
-- (sem policies de propósito — tokens só via service_role)
