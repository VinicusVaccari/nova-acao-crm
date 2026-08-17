-- =============================================================
-- 0012_editaveis — campos editáveis do card
--   Negócio: nome (title), qualificacao (0-5), fonte, campanha, criativo
--   Empresa: endereço
--   Produtos: quantidade, recorrência, desconto (valor unitário = mrr)
--
-- Obs.: já existe opportunities.qualification (jsonb, critérios de SQL).
-- A nota 0-5 do card usa a coluna nova "qualificacao".
-- =============================================================

alter table opportunities add column if not exists title       text;
alter table opportunities add column if not exists qualificacao smallint not null default 0
  check (qualificacao between 0 and 5);
alter table opportunities add column if not exists source      text;
alter table opportunities add column if not exists campaign    text;
alter table opportunities add column if not exists creative    text;

-- nota inicial a partir do score (0-100 -> 0-5)
update opportunities set qualificacao = least(5, round(score / 20.0))::smallint where qualificacao = 0;

alter table companies add column if not exists address text;

alter table opportunity_products add column if not exists quantity   int not null default 1;
alter table opportunity_products add column if not exists recurrence text not null default 'unico'
  check (recurrence in ('unico', 'mensal'));
alter table opportunity_products add column if not exists discount   numeric(12,2) not null default 0;
