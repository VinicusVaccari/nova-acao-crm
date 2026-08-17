-- =============================================================
-- 0009_focus_comercial
--
-- Decisão do produto: focar 100% no comercial primeiro. Tudo de CS,
-- marketing e advocacy sai do banco agora e volta quando formos
-- construir cada área (as migrations 0004 e o catálogo de mídia
-- servem de base para recriar).
--
-- Fica de pé o núcleo comercial: identidade, funil, reuniões,
-- propostas, contratos, mapa de objeções, eventos, outbox e o
-- closed-loop de conversão.
-- =============================================================

-- ---- CS ----
drop table if exists invoices        cascade;
drop table if exists nps_responses   cascade;
drop table if exists checkins        cascade;
drop table if exists account_health  cascade;
drop table if exists deliverables    cascade;
drop table if exists onboarding_tasks cascade;
drop table if exists accounts        cascade;

-- ---- Advocacy ----
drop table if exists testimonials   cascade;
drop table if exists cases          cascade;
drop table if exists content_assets cascade;

-- ---- Marketing (catálogo e gasto de mídia) ----
-- touchpoints FICA: é a origem do lead, mostrada na ficha comercial
-- e usada no closed-loop. Só o gasto e o catálogo de campanha saem.
drop view  if exists v_dash_marketing cascade;
drop table if exists ad_spend_daily   cascade;
drop table if exists campaigns        cascade;

-- ---- Views de outras áreas ----
drop view if exists v_dash_cs cascade;

-- ---- Função de virada para cliente (CS) ----
drop function if exists fn_convert_to_account(uuid, uuid) cascade;
