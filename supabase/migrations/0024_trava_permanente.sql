-- =============================================================
-- 0024_trava_permanente — no modelo do n8n a trava é ONE-WAY: uma vez
--   travado (intervenção humana), a Naia nunca mais atende aquele lead.
--   Não existe "destravar". Regra:
--     TRAVADO = existe QUALQUER linha com (trava OR intervenção)=true
--               para o telefone (normalizado só por dígitos).
--   As linhas trava=false (cadastro / artefato do bug de +/dígitos) não
--   contam — só olhamos se ALGUMA vez travou.
-- =============================================================

create or replace view v_trava_atual as
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

-- trava (permanente): insere uma linha travada. Não há destrava.
create or replace function fn_set_trava(p_phone text, p_name text, p_travado boolean)
returns void language sql as $$
  insert into "CADASTRO N8N | NOVA AÇÃO" (phone, name, trava) values (p_phone, p_name, coalesce(p_travado, true));
$$;
