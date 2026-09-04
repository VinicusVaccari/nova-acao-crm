-- Mantém os campos comerciais visíveis do deal preenchidos a partir do
-- touchpoint atribuído. As UTMs continuam sendo preservadas integralmente em
-- touchpoints; source/campaign/creative são uma projeção para a ficha.

create or replace function fn_sync_opp_attribution()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
declare
  v_touch touchpoints%rowtype;
begin
  if new.last_touchpoint_id is null then return new; end if;

  select * into v_touch
    from touchpoints
   where id = new.last_touchpoint_id;

  if found then
    new.source := coalesce(nullif(new.source, ''), nullif(v_touch.utm_source, ''));
    new.campaign := coalesce(nullif(new.campaign, ''), nullif(v_touch.utm_campaign, ''));
    new.creative := coalesce(nullif(new.creative, ''), nullif(v_touch.utm_content, ''));
    new.source_channel := coalesce(nullif(new.source_channel, ''), nullif(v_touch.channel, ''));
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_opp_attribution on opportunities;
create trigger trg_sync_opp_attribution
before insert or update of last_touchpoint_id on opportunities
for each row execute function fn_sync_opp_attribution();

-- Corrige os deals já existentes sem sobrescrever valores preenchidos.
update opportunities o
   set source = coalesce(nullif(o.source, ''), nullif(t.utm_source, '')),
       campaign = coalesce(nullif(o.campaign, ''), nullif(t.utm_campaign, '')),
       creative = coalesce(nullif(o.creative, ''), nullif(t.utm_content, '')),
       source_channel = coalesce(nullif(o.source_channel, ''), nullif(t.channel, ''))
  from touchpoints t
 where t.id = o.last_touchpoint_id
   and (
     (nullif(o.source, '') is null and nullif(t.utm_source, '') is not null)
     or (nullif(o.campaign, '') is null and nullif(t.utm_campaign, '') is not null)
     or (nullif(o.creative, '') is null and nullif(t.utm_content, '') is not null)
     or (nullif(o.source_channel, '') is null and nullif(t.channel, '') is not null)
   );
