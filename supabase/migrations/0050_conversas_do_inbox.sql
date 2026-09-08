-- Lista de conversas do inbox, uma linha por negócio.
--
-- Antes o inbox lia as 1.000 mensagens mais recentes do sistema inteiro e
-- deduzia as conversas daí. O corte era por quantidade de MENSAGEM, global:
-- uma conversa longa expulsava as outras, e campos derivados (já respondeu
-- alguém do time?) saíam errados por serem calculados sobre histórico parcial.
--
-- Aqui o resumo é agregado sobre o histórico inteiro, no banco. O fio de cada
-- conversa é buscado à parte, paginado, só para a que está aberta na tela.
--
-- security_invoker mantém o RLS de 0046: a view enxerga o que o usuário enxerga.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace view public.v_conversas with (security_invoker = true) as
with msg as (
  select a.opportunity_id,
         count(*)                as mensagens,
         max(a.occurred_at)      as ultima_at,
         bool_or(a.direction = 'outbound' and not coalesce(a.is_automated, false)) as humano_respondeu
    from activities a
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
