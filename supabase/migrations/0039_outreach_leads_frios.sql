-- Outbound-first: lead que entrou por formulário mas NUNCA mandou mensagem
-- é puxado pela Naia após alguns minutos de silêncio.

-- marca a tentativa de outreach (dedup entre varreduras)
alter table opportunities add column if not exists outreach_at timestamptz;

-- Lista os leads elegíveis para a Naia puxar:
--  • ninguém falou com ele (sem first_contact_at, sem NENHUMA atividade)
--  • ainda não puxamos (outreach_at null) e não está fechado
--  • tem telefone, não está travado
--  • esperou p_min de silêncio, e não é velho demais (p_max_horas)
create or replace function fn_leads_para_outreach(p_min int default 3, p_max_horas int default 24)
returns table(opportunity_id uuid, phone text, nome text)
language sql security definer as $$
  select o.id, ph.value, p.full_name
  from opportunities o
  join people p on p.id = o.person_id
  join lateral (
    select value from identities
    where person_id = o.person_id and kind in ('phone', 'wa_id')
    order by (kind = 'phone') desc
    limit 1
  ) ph on true
  where o.first_contact_at is null
    and o.outreach_at is null
    and o.lost_at is null
    and o.stage not in ('ganho', 'perdido')
    and o.created_at <= now() - make_interval(mins => p_min)
    and o.created_at >= now() - make_interval(hours => p_max_horas)
    and not exists (select 1 from activities a where a.opportunity_id = o.id)
    and not fn_trava_status(ph.value)
$$;
