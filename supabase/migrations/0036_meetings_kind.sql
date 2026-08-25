-- =============================================================
-- 0036_meetings_kind — novos tipos de reunião no card do deal.
--   Tipos oficiais: Entendimento, Apresentação de Proposta, Follow-up,
--   Briefing. Mantém os antigos no constraint pra não invalidar linhas
--   já existentes (o dropdown só oferece os novos).
-- =============================================================

alter table meetings drop constraint if exists meetings_kind_check;
alter table meetings add constraint meetings_kind_check check (kind in (
  'entendimento', 'apresentacao_proposta', 'followup', 'briefing',
  'diagnostico', 'fechamento', 'onboarding', 'checkin'  -- legado
));
alter table meetings alter column kind set default 'entendimento';
