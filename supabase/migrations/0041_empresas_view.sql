-- Lista de Empresas (página estilo RD): agrega por empresa o nº de
-- negociações, o último contato e o responsável (dono do deal mais recente).
create or replace view v_empresas_lista as
select c.id,
  coalesce(nullif(c.trade_name,''), c.legal_name, '—') as nome,
  c.segment, c.city, c.state, c.created_at,
  coalesce(cnt.negociacoes,0) as negociacoes, cnt.ultimo_contato,
  own.full_name as responsavel_nome, own.avatar_url as responsavel_avatar
from companies c
left join lateral (
  select count(*)::int as negociacoes,
    (select max(a.occurred_at) from activities a join opportunities o2 on o2.id=a.opportunity_id
       where o2.company_id=c.id
         and a.kind in ('whatsapp','audio','ligacao','email','reuniao')) as ultimo_contato  -- só contato real (ignora nota/sistema)
  from opportunities o where o.company_id=c.id
) cnt on true
left join lateral (
  select pr.full_name, pr.avatar_url from opportunities o join profiles pr on pr.id=o.owner_id
  where o.company_id=c.id and o.owner_id is not null order by o.created_at desc limit 1
) own on true;
