-- =============================================================
-- 0020_whatsapp_travas — ponte de migração das travas do sistema antigo.
--   No projeto antigo (n8n) os leads "travados" (intervenção humana) já
--   não recebem a Naia. Importamos os telefones travados para cá; quando
--   um deles manda mensagem e vira lead novo, já entra com
--   atendimento='humano' (Naia não é acionada). Para leads que já existem,
--   um backfill único ajusta o atendimento.
--   Fonte única daqui pra frente: opportunities.atendimento.
-- =============================================================
create table if not exists whatsapp_travas (
  phone      text primary key,   -- só dígitos, ex.: 5511999999999
  name       text,
  created_at timestamptz not null default now()
);

alter table whatsapp_travas enable row level security;
-- (sem policies — só a service_role/servidor acessa)
