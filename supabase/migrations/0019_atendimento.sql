-- =============================================================
-- 0019_atendimento — quem responde a conversa: Naia (IA) ou humano.
--   Quando o Rodrigues "assume" no inbox, vira 'humano' e a Naia
--   para de responder automaticamente. Volta pra 'naia' quando ele
--   devolve. Default: 'naia'.
-- =============================================================
alter table opportunities
  add column if not exists atendimento text not null default 'naia'
  check (atendimento in ('naia', 'humano'));
