-- =============================================================
-- 0022_trava_normalizada — corrige o cálculo da trava.
--   Os telefones na tabela de cadastro vêm em formatos misturados
--   (com "+", só dígitos) e há linhas de cadastro (trava=false) além
--   das de handoff (trava=true). Regra correta:
--     TRAVADO = existe alguma linha com (trava OR intervenção) = true,
--               comparando por TELEFONE NORMALIZADO (só dígitos).
--   Destravar = zera essas flags nas linhas do telefone.
-- =============================================================

create or replace view v_trava_atual as
  select distinct regexp_replace(phone, '[^0-9]', '', 'g') as phone, true as travado
  from "CADASTRO N8N | NOVA AÇÃO"
  where phone is not null and (trava or "intervenção");

create or replace function fn_trava_status(p_phone text)
returns boolean language sql stable as $$
  select exists (
    select 1 from "CADASTRO N8N | NOVA AÇÃO"
    where (trava or "intervenção")
      and regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g')
  );
$$;

-- trava = insere uma linha travada; destrava = zera as flags do telefone
create or replace function fn_set_trava(p_phone text, p_name text, p_travado boolean)
returns void language plpgsql as $$
declare v_norm text := regexp_replace(p_phone, '[^0-9]', '', 'g');
begin
  if p_travado then
    insert into "CADASTRO N8N | NOVA AÇÃO" (phone, name, trava) values (p_phone, p_name, true);
  else
    update "CADASTRO N8N | NOVA AÇÃO"
       set trava = false, "intervenção" = false
     where (trava or "intervenção")
       and regexp_replace(phone, '[^0-9]', '', 'g') = v_norm;
  end if;
end $$;
