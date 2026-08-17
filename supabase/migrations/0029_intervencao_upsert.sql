-- =============================================================
-- 0029_intervencao_upsert — "Assumir"/envio humano deve ATUALIZAR o
--   cadastro existente do telefone, não inserir linha nova a cada clique.
--   Regra: UPDATE intervenção=true em toda linha do telefone (normalizado
--   por dígitos); se não existir nenhuma, INSERE uma. Idempotente.
-- =============================================================

create or replace function fn_intervencao(p_phone text, p_name text)
returns void language plpgsql as $$
declare
  v_digits text := regexp_replace(p_phone, '[^0-9]', '', 'g');
begin
  update "CADASTRO N8N | NOVA AÇÃO"
     set "intervenção" = true
   where regexp_replace(phone, '[^0-9]', '', 'g') = v_digits;

  if not found then
    insert into "CADASTRO N8N | NOVA AÇÃO" (phone, name, trava, "intervenção")
    values (p_phone, p_name, false, true);
  end if;
end;
$$;
