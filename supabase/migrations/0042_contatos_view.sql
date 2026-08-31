-- Lista de Contatos (página estilo RD): agrega por pessoa a empresa, o cargo,
-- o nº de negociações, o último contato real e o responsável.
create or replace view v_contatos_lista as
select p.id,
  coalesce(nullif(p.full_name,''),'—') as nome,
  p.email_primary, p.phone_primary, p.created_at,
  (select v.value from custom_field_values v join custom_fields cf on cf.id=v.field_id where v.entity_id=p.id and cf.key='cargo' limit 1) as cargo,
  comp.trade_name as empresa,
  coalesce(cnt.negociacoes,0) as negociacoes, cnt.ultimo_contato,
  own.full_name as responsavel_nome, own.avatar_url as responsavel_avatar
from people p
left join lateral (
  select c.trade_name from opportunities o join companies c on c.id=o.company_id
  where o.person_id=p.id and o.company_id is not null order by o.created_at desc limit 1
) comp on true
left join lateral (
  select count(*)::int as negociacoes,
    (select max(a.occurred_at) from activities a join opportunities o2 on o2.id=a.opportunity_id
       where o2.person_id=p.id and a.kind in ('whatsapp','audio','ligacao','email','reuniao')) as ultimo_contato
  from opportunities o where o.person_id=p.id
) cnt on true
left join lateral (
  select pr.full_name, pr.avatar_url from opportunities o join profiles pr on pr.id=o.owner_id
  where o.person_id=p.id and o.owner_id is not null order by o.created_at desc limit 1
) own on true;
