-- =============================================================
-- 0023_trava_ultima_vence — regra final da trava: ÚLTIMA LINHA VENCE.
--   Havia uma trava em LOTE antiga (várias linhas no mesmo instante,
--   trava=true) que foi substituída pelas linhas de cadastro recentes
--   (trava=false). O estado atual é sempre a LINHA MAIS RECENTE do
--   telefone (normalizado só por dígitos).
--   Travar/destravar = inserir uma linha nova (append); a mais recente
--   define o estado — igual ao modelo do n8n.
-- =============================================================

create or replace view v_trava_atual as
  select distinct on (regexp_replace(phone, '[^0-9]', '', 'g'))
    regexp_replace(phone, '[^0-9]', '', 'g') as phone,
    (trava or "intervenção") as travado
  from "CADASTRO N8N | NOVA AÇÃO"
  where phone is not null and regexp_replace(phone, '[^0-9]', '', 'g') <> ''
  order by regexp_replace(phone, '[^0-9]', '', 'g'), created_at desc;

create or replace function fn_trava_status(p_phone text)
returns boolean language sql stable as $$
  select coalesce(
    (select travado from v_trava_atual where phone = regexp_replace(p_phone, '[^0-9]', '', 'g')),
    false);
$$;

create or replace function fn_set_trava(p_phone text, p_name text, p_travado boolean)
returns void language sql as $$
  insert into "CADASTRO N8N | NOVA AÇÃO" (phone, name, trava) values (p_phone, p_name, p_travado);
$$;
