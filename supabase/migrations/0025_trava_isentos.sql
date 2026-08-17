-- =============================================================
-- 0025_trava_isentos — números que NUNCA travam (ex.: testes).
--   fn_trava_status devolve false para eles mesmo que existam linhas
--   de trava na tabela de cadastro. Assim a Naia sempre atende esses
--   números (o /inbound sempre aciona o n8n).
-- =============================================================

create table if not exists trava_isentos (
  phone text primary key,   -- só dígitos
  nota  text
);
alter table trava_isentos enable row level security;

insert into trava_isentos (phone, nota)
values ('5511989369538', 'número de teste do Vinicius')
on conflict (phone) do nothing;

create or replace function fn_trava_status(p_phone text)
returns boolean language sql stable as $$
  select case
    when exists (select 1 from trava_isentos where phone = regexp_replace(p_phone, '[^0-9]', '', 'g'))
      then false
    else exists (
      select 1 from "CADASTRO N8N | NOVA AÇÃO"
      where (trava or "intervenção")
        and regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g')
    )
  end;
$$;

create or replace view v_trava_atual as
  select distinct regexp_replace(c.phone, '[^0-9]', '', 'g') as phone, true as travado
  from "CADASTRO N8N | NOVA AÇÃO" c
  where c.phone is not null and (c.trava or c."intervenção")
    and regexp_replace(c.phone, '[^0-9]', '', 'g') <> ''
    and not exists (
      select 1 from trava_isentos i where i.phone = regexp_replace(c.phone, '[^0-9]', '', 'g')
    );
