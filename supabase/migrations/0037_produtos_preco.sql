-- =============================================================
-- 0037_produtos_preco — preço padrão + recorrência por produto.
--   Ao adicionar um produto ao deal (via POST ou pelo sistema), ele já
--   sobe com esse preço e recorrência, refletindo no valor do negócio.
--   Recorrência: 'mensal' | 'unico' (padrão do sistema).
-- =============================================================

alter table products add column if not exists default_price numeric(12,2);
alter table products add column if not exists recurrence   text;

update products set default_price = 3632.40, recurrence = 'unico'  where code = 'sites';
update products set default_price = 1710.00, recurrence = 'mensal' where code = 'seo';
update products set default_price = 2108.00, recurrence = 'mensal' where code = 'trafego_pago';
update products set default_price = 328.50,  recurrence = 'mensal' where code = 'email';
update products set default_price = 213.75,  recurrence = 'mensal' where code = 'hospedagem';
update products set default_price = 315.00,  recurrence = 'mensal' where code = 'gmn';
update products set default_price = 2011.50, recurrence = 'unico'  where code = 'identidade';

insert into products (code, name, description, sort_order, active, default_price, recurrence)
values ('lojas_virtuais', 'Lojas Virtuais', 'Lojas virtuais / e-commerce.', 8, true, 5377.50, 'unico')
on conflict (code) do nothing;
