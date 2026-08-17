-- =============================================================
-- 0027_remover_isencao — remove a isenção de trava por completo.
--   O número de teste (e qualquer outro) DEVE travar como todo mundo:
--   badge aparece, e o /inbound só deixa passar pro n8n QUANDO NÃO está
--   travado. Não há mais exceção. Reverte fn_trava_status e v_trava_atual
--   às versões simples (0024) e derruba a tabela trava_isentos.
-- =============================================================

drop view if exists v_trava_atual;

create view v_trava_atual as
  select distinct regexp_replace(phone, '[^0-9]', '', 'g') as phone, true as travado
  from "CADASTRO N8N | NOVA AÇÃO"
  where phone is not null and (trava or "intervenção")
    and regexp_replace(phone, '[^0-9]', '', 'g') <> '';

create or replace function fn_trava_status(p_phone text)
returns boolean language sql stable as $$
  select exists (
    select 1 from "CADASTRO N8N | NOVA AÇÃO"
    where (trava or "intervenção")
      and regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g')
  );
$$;

drop table if exists trava_isentos;
