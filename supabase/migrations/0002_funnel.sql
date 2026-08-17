-- =============================================================
-- 0002_funnel — aquisição, funil comercial, reuniões
-- =============================================================

-- -------------------------------------------------------------
-- AQUISIÇÃO
-- -------------------------------------------------------------

create table if not exists campaigns (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null check (platform in
                 ('meta','google','linkedin','tiktok','organic','indicacao','outbound','outro')),
  external_id  text,
  name         text,
  objective    text,
  status       text,
  created_at   timestamptz not null default now(),
  unique (platform, external_id)
);

-- Custo de mídia dentro do banco. Sem isso, CAC real só sai em planilha.
create table if not exists ad_spend_daily (
  date                  date not null,
  platform              text not null,
  campaign_external_id  text not null default '-',
  adset_external_id     text not null default '-',
  ad_external_id        text not null default '-',
  campaign_name         text,
  adset_name            text,
  ad_name               text,
  impressions           bigint not null default 0,
  clicks                bigint not null default 0,
  spend                 numeric(12,2) not null default 0,
  platform_conversions  numeric not null default 0,
  synced_at             timestamptz not null default now(),
  primary key (date, platform, campaign_external_id, adset_external_id, ad_external_id)
);

create index if not exists idx_spend_date on ad_spend_daily (date desc, platform);

-- O rastro de migalhas. Uma linha por interação rastreável.
create table if not exists touchpoints (
  id                    bigserial primary key,
  person_id             uuid references people(id) on delete cascade,
  occurred_at           timestamptz not null default now(),
  channel               text,     -- paid_social | paid_search | organic | direct | referral | indicacao | outbound
  utm_source            text,
  utm_medium            text,
  utm_campaign          text,
  utm_content           text,
  utm_term              text,
  campaign_external_id  text,
  adset_external_id     text,
  ad_external_id        text,
  gclid                 text,
  fbclid                text,
  fbp                   text,
  ga_client_id          text,
  landing_page          text,
  referrer              text,
  ip                    text,
  user_agent            text,
  raw                   jsonb not null default '{}'
);

create index if not exists idx_touchpoints_person on touchpoints (person_id, occurred_at desc);
create index if not exists idx_touchpoints_campaign on touchpoints (campaign_external_id);

-- -------------------------------------------------------------
-- FUNIL
-- -------------------------------------------------------------

create table if not exists opportunities (
  id                   uuid primary key default gen_random_uuid(),
  person_id            uuid not null references people(id) on delete cascade,
  company_id           uuid references companies(id),
  owner_id             uuid references profiles(id),   -- closer
  sdr_id               uuid references profiles(id),   -- quem qualificou (humano ou robô)
  stage                opp_stage not null default 'novo',
  stage_since          timestamptz not null default now(),
  product              text,
  expected_value       numeric(12,2),                  -- MRR proposto
  setup_value          numeric(12,2) not null default 0,
  term_months          int not null default 12,
  probability          numeric(5,2) not null default 2,
  score                int not null default 0,         -- 0-100
  qualification        jsonb not null default '{}',    -- critérios atendidos/faltantes
  first_touchpoint_id  bigint references touchpoints(id),
  last_touchpoint_id   bigint references touchpoints(id),
  source_channel       text,                           -- desnormalizado p/ dashboard rápido
  lost_reason          text,
  lost_detail          text,
  next_step            text,
  next_step_due        timestamptz,
  first_contact_at     timestamptz,                    -- base do speed to lead
  created_at           timestamptz not null default now(),
  closed_at            timestamptz
);

create index if not exists idx_opp_stage      on opportunities (stage, created_at desc);
create index if not exists idx_opp_owner      on opportunities (owner_id, stage);
create index if not exists idx_opp_person     on opportunities (person_id);
create index if not exists idx_opp_created    on opportunities (created_at desc);
create index if not exists idx_opp_channel    on opportunities (source_channel);

comment on column opportunities.first_contact_at is
  'Preenchido pela primeira activity outbound. Speed to lead = first_contact_at - created_at.';

-- A fita cassete do card: sem isso não existe relatório de conversão por etapa.
create table if not exists stage_history (
  id               bigserial primary key,
  opportunity_id   uuid not null references opportunities(id) on delete cascade,
  from_stage       opp_stage,
  to_stage         opp_stage not null,
  changed_at       timestamptz not null default now(),
  changed_by       uuid references profiles(id),
  actor_type       text not null default 'user',   -- user | ai | system
  reason           text,
  duration_in_prev interval
);

create index if not exists idx_stage_hist_opp on stage_history (opportunity_id, changed_at);
create index if not exists idx_stage_hist_to  on stage_history (to_stage, changed_at desc);

-- Timeline: toda ligação, whatsapp, e-mail, áudio, nota.
create table if not exists activities (
  id             bigserial primary key,
  opportunity_id uuid references opportunities(id) on delete cascade,
  person_id      uuid references people(id) on delete cascade,
  kind           text not null check (kind in
                   ('whatsapp','ligacao','email','audio','reuniao','nota','sistema')),
  direction      text not null default 'outbound' check (direction in ('inbound','outbound')),
  occurred_at    timestamptz not null default now(),
  actor_id       uuid references profiles(id),
  is_automated   boolean not null default false,
  outcome        text,     -- atendeu | nao_atendeu | respondeu | sem_resposta | enviado
  body           text,
  meta           jsonb not null default '{}'
);

create index if not exists idx_act_opp    on activities (opportunity_id, occurred_at desc);
create index if not exists idx_act_person on activities (person_id, occurred_at desc);

-- Reuniões: é daqui que sai o show rate.
create table if not exists meetings (
  id               uuid primary key default gen_random_uuid(),
  opportunity_id   uuid not null references opportunities(id) on delete cascade,
  kind             text not null default 'diagnostico'
                     check (kind in ('diagnostico','fechamento','followup','onboarding','checkin')),
  scheduled_at     timestamptz not null,
  status           text not null default 'agendada'
                     check (status in ('agendada','confirmada','realizada','no_show','remarcada','cancelada')),
  attended_at      timestamptz,
  duration_minutes int,
  host_id          uuid references profiles(id),
  booked_by        uuid references profiles(id),
  external_event_id text,
  meeting_url      text,
  recording_url    text,
  transcript       text,
  reschedule_count int not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists idx_meetings_sched  on meetings (scheduled_at desc);
create index if not exists idx_meetings_status on meetings (status, scheduled_at desc);
create index if not exists idx_meetings_opp    on meetings (opportunity_id);

-- Propostas: rastreáveis, não PDF cego.
create table if not exists proposals (
  id                  uuid primary key default gen_random_uuid(),
  opportunity_id      uuid not null references opportunities(id) on delete cascade,
  version             int not null default 1,
  scope               jsonb not null default '{}',
  mrr                 numeric(12,2),
  setup               numeric(12,2) not null default 0,
  term_months         int not null default 12,
  discount_pct        numeric(5,2) not null default 0,
  approved_by         uuid references profiles(id),   -- exigido acima do limite de desconto
  status              text not null default 'rascunho'
                        check (status in ('rascunho','enviada','vista','em_negociacao','aceita','recusada','expirada')),
  public_slug         text unique,
  sent_at             timestamptz,
  first_viewed_at     timestamptz,
  view_count          int not null default 0,
  total_view_seconds  int not null default 0,
  section_engagement  jsonb not null default '{}',
  valid_until         date,
  decided_at          timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists idx_proposals_opp on proposals (opportunity_id);

create table if not exists contracts (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid references proposals(id) on delete set null,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  provider      text,
  external_id   text,
  document_url  text,
  mrr           numeric(12,2),
  setup         numeric(12,2) not null default 0,
  term_months   int not null default 12,
  sent_at       timestamptz,
  signed_at     timestamptz,
  status        text not null default 'pendente',
  created_at    timestamptz not null default now()
);

-- -------------------------------------------------------------
-- MAPA DE OBJEÇÕES
-- -------------------------------------------------------------

create table if not exists objections (
  id                  serial primary key,
  code                text unique not null,
  label               text not null,
  playbook_answer     text,
  created_at          timestamptz not null default now()
);

insert into objections (code, label) values
  ('preco',              'Preço / está caro'),
  ('timing',             'Não é o momento'),
  ('autoridade',         'Preciso falar com o sócio'),
  ('confianca',          'Não confio que vai funcionar'),
  ('prioridade',         'Tenho outras prioridades agora'),
  ('concorrente',        'Estou avaliando outra agência'),
  ('resultado',          'Já tentei e não deu certo'),
  ('interno',            'Vou fazer com equipe interna'),
  ('verba',              'Não tenho verba de mídia')
on conflict (code) do nothing;

create table if not exists objection_occurrences (
  id             bigserial primary key,
  meeting_id     uuid references meetings(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  objection_id   int not null references objections(id),
  verbatim       text,      -- a frase exata que o lead falou
  handled_how    text,
  outcome        text check (outcome in ('superada','parcial','matou_o_deal')),
  detected_by    text not null default 'ai',
  detected_at    timestamptz not null default now()
);

create index if not exists idx_obj_occ_opp on objection_occurrences (opportunity_id);
create index if not exists idx_obj_occ_at  on objection_occurrences (detected_at desc);

-- -------------------------------------------------------------
-- MOTIVOS DE PERDA — lista fechada
-- -------------------------------------------------------------

create table if not exists lost_reasons (
  code   text primary key,
  label  text not null,
  active boolean not null default true
);

insert into lost_reasons (code, label) values
  ('preco',                     'Preço'),
  ('timing',                    'Timing'),
  ('escolheu_concorrente',      'Escolheu concorrente'),
  ('decidiu_fazer_interno',     'Decidiu fazer interno'),
  ('sem_verba',                 'Sem verba'),
  ('sem_autoridade',            'Não falamos com o decisor'),
  ('desqualificado',            'Desqualificado'),
  ('sumiu',                     'Sumiu / parou de responder'),
  ('problema_de_fit',           'Fit ruim'),
  ('resultado_esperado_irreal', 'Expectativa irreal de resultado')
on conflict (code) do nothing;
