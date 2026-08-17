-- =============================================================
-- 0032_users_teams_invites — base do módulo Configurações → Users.
--   teams   : equipes (1 usuário pertence a 1 equipe via profiles.team_id)
--   invites : convites por e-mail com token/status. O envio (Resend) e a
--             página de aceite entram no próximo passo.
-- =============================================================

create table if not exists teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
alter table teams enable row level security;

alter table profiles add column if not exists team_id uuid references teams(id) on delete set null;

create table if not exists invites (
  id          uuid primary key default gen_random_uuid(),
  email       citext not null,
  role        app_role not null default 'vendedor',
  team_id     uuid references teams(id) on delete set null,
  token       text not null unique,
  status      text not null default 'pendente'
              check (status in ('pendente','aceito','cancelado','expirado')),
  invited_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz
);
alter table invites enable row level security;
create index if not exists idx_invites_email on invites (email);
create index if not exists idx_invites_status on invites (status);
