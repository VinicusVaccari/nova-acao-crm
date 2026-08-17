-- =============================================================
-- 0031_lid_cadastro — mapa LID↔telefone usando o CADASTRO existente.
--   O WhatsApp passou a identificar contatos por LID (privacidade), às
--   vezes SEM o telefone. O cadastro já guarda phone + chatlid (era assim
--   no n8n), então:
--     fn_phone_from_lid(lid)  → devolve o telefone real a partir do @lid
--     fn_set_chatlid(phone,…) → grava/atualiza o chatlid do telefone
--                                (cresce o mapa quando vêm os dois juntos)
-- =============================================================

-- LID → telefone (dígitos). Ignora linhas onde phone == lid (sem telefone
-- real, ex.: contatos que só têm @lid).
create or replace function fn_phone_from_lid(p_lid text)
returns text language sql stable as $$
  select regexp_replace(phone, '[^0-9]', '', 'g')
  from "CADASTRO N8N | NOVA AÇÃO"
  where regexp_replace(coalesce(chatlid, ''), '[^0-9]', '', 'g') = regexp_replace(p_lid, '[^0-9]', '', 'g')
    and phone is not null
    and regexp_replace(phone, '[^0-9]', '', 'g') <> ''
    and regexp_replace(phone, '[^0-9]', '', 'g') <> regexp_replace(p_lid, '[^0-9]', '', 'g')
  order by created_at desc
  limit 1;
$$;

-- grava o chatlid do telefone (idempotente): atualiza as linhas do telefone
-- que ainda não têm esse chatlid; se não existir NENHUMA linha do telefone,
-- insere uma (sem travar). Cresce o mapa conforme as mensagens chegam.
create or replace function fn_set_chatlid(p_phone text, p_lid text, p_name text)
returns void language plpgsql as $$
declare
  v_phone text := regexp_replace(p_phone, '[^0-9]', '', 'g');
  v_lid   text := regexp_replace(p_lid, '[^0-9]', '', 'g');
begin
  if v_phone = '' or v_lid = '' then return; end if;

  update "CADASTRO N8N | NOVA AÇÃO"
     set chatlid = v_lid || '@lid'
   where regexp_replace(phone, '[^0-9]', '', 'g') = v_phone
     and (chatlid is null or regexp_replace(chatlid, '[^0-9]', '', 'g') <> v_lid);

  if not found and not exists (
    select 1 from "CADASTRO N8N | NOVA AÇÃO"
    where regexp_replace(phone, '[^0-9]', '', 'g') = v_phone
  ) then
    insert into "CADASTRO N8N | NOVA AÇÃO" (phone, name, chatlid, trava, "intervenção")
    values (p_phone, p_name, v_lid || '@lid', false, false);
  end if;
end;
$$;
