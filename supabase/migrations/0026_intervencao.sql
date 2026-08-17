-- =============================================================
-- 0026_intervencao — ação humana grava em "intervenção", não em "trava".
--   Semântica:
--     trava       = a Naia fechou o lead (tool de encerramento)
--     intervenção = um humano mandou mensagem no meio da execução
--   Quando o Rodrigues/Junior "assume" ou envia pelo sistema, é uma
--   INTERVENÇÃO humana → insere linha com intervenção=true (trava=false).
--   fn_trava_status já considera (trava OR intervenção), então a Naia
--   para de responder de qualquer forma.
-- =============================================================

create or replace function fn_intervencao(p_phone text, p_name text)
returns void language sql as $$
  insert into "CADASTRO N8N | NOVA AÇÃO" (phone, name, trava, "intervenção")
  values (p_phone, p_name, false, true);
$$;
