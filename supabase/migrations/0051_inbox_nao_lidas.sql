-- Contador de mensagens não lidas no inbox, no padrão do WhatsApp.
--
-- A leitura é do TIME, não de cada pessoa: uma linha por negócio. Quando
-- alguém abre a conversa, ela fica lida para todos. É a escolha certa para
-- uma caixa compartilhada — o que importa é se o cliente já foi atendido,
-- não quem olhou. O custo é conhecido: um colega pode "zerar" o aviso de
-- uma mensagem que ninguém tratou.
--
-- Só mensagem do lead (inbound) conta. Resposta da Naia ou do time não
-- acende badge, senão o aviso ficaria permanentemente ligado nas conversas
-- que a IA atende sozinha.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.inbox_leituras (
  opportunity_id uuid primary key references public.opportunities(id) on delete cascade,
  lida_ate       timestamptz not null,
  lida_por       uuid references public.profiles(id),
  lida_em        timestamptz not null default now()
);

alter table public.inbox_leituras enable row level security;

-- Mesmo alcance do negócio: quem enxerga a conversa enxerga e marca a leitura.
drop policy if exists inbox_leituras_scoped on public.inbox_leituras;
create policy inbox_leituras_scoped on public.inbox_leituras for all to authenticated
  using (
    public.fn_is_manager() or exists (
      select 1 from public.opportunities o
       where o.id = inbox_leituras.opportunity_id
         and (o.owner_id = auth.uid() or o.sdr_id = auth.uid())
    )
  )
  with check (
    public.fn_is_manager() or exists (
      select 1 from public.opportunities o
       where o.id = inbox_leituras.opportunity_id
         and (o.owner_id = auth.uid() or o.sdr_id = auth.uid())
    )
  );

-- Trava de 0046: usuário desativado não passa, por mais que a policy acima permita.
drop policy if exists security_active_user on public.inbox_leituras;
create policy security_active_user on public.inbox_leituras as restrictive for all to authenticated
  using (public.fn_my_role() is not null) with check (public.fn_my_role() is not null);

grant select, insert, update on public.inbox_leituras to authenticated;

-- A view ganha `nao_lidas`. O restante é igual a 0050. Precisa de drop: o
-- `create or replace` do Postgres só aceita colunas novas no fim da lista.
drop view if exists public.v_conversas;
create view public.v_conversas with (security_invoker = true) as
with msg as (
  select a.opportunity_id,
         count(*)                as mensagens,
         max(a.occurred_at)      as ultima_at,
         bool_or(a.direction = 'outbound' and not coalesce(a.is_automated, false)) as humano_respondeu,
         count(*) filter (
           where a.direction = 'inbound'
             and a.occurred_at > coalesce(l.lida_ate, '-infinity'::timestamptz)
         )                       as nao_lidas
    from activities a
    left join public.inbox_leituras l on l.opportunity_id = a.opportunity_id
   where a.kind in ('whatsapp', 'audio')
   group by a.opportunity_id
)
select o.id                 as opportunity_id,
       p.full_name          as nome,
       p.phone_primary      as telefone,
       c.trade_name         as empresa,
       o.stage,
       o.atendimento,
       m.ultima_at,
       m.mensagens,
       m.nao_lidas,
       m.humano_respondeu,
       u.body               as ultima,
       u.kind               as ultima_kind
  from msg m
  join opportunities o on o.id = m.opportunity_id
  left join people    p on p.id = o.person_id
  left join companies c on c.id = o.company_id
  left join lateral (
    select a.body, a.kind
      from activities a
     where a.opportunity_id = m.opportunity_id
       and a.kind in ('whatsapp', 'audio')
     order by a.occurred_at desc, a.id desc
     limit 1
  ) u on true;

grant select on public.v_conversas to authenticated;

commit;
