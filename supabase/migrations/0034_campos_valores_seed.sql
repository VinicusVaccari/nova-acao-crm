-- =============================================================
-- 0034_campos_valores_seed — ativa os campos personalizados na ficha.
--   custom_field_values: guarda o VALOR de cada campo por entidade
--     (entity_id = company_id para campos de empresa, person_id para
--      campos de contato). 1 valor por (campo, entidade).
--   + semeia os campos pedidos (Empresa e Contato).
-- =============================================================

create table if not exists custom_field_values (
  id         serial primary key,
  field_id   int  not null references custom_fields(id) on delete cascade,
  entity_id  uuid not null,               -- company_id ou person_id
  value      text,
  updated_at timestamptz not null default now(),
  unique (field_id, entity_id)
);
alter table custom_field_values enable row level security;
create index if not exists idx_cfv_entity on custom_field_values (entity_id);

-- Campos de EMPRESA (Nome/Site já são nativos no painel; aqui os extras)
insert into custom_fields (entity, key, label, field_type, options, required, sort_order) values
  ('company', 'para_quem_vendem', 'Para quem eles vendem', 'text',   '{}', false, 1),
  ('company', 'o_que_vendem',     'O que eles vendem',     'text',   '{}', false, 2),
  ('company', 'porte',            'Porte',                 'select', '{Micro,Pequena,Média,Grande}', false, 3)
on conflict (entity, key) do nothing;

-- Campos de CONTATO
insert into custom_fields (entity, key, label, field_type, options, required, sort_order) values
  ('contact', 'score_bant',       'Score BANT',                     'text',   '{}', false, 1),
  ('contact', 'urgencia',         'Urgência',                       'select', '{Alta,Média,Baixa}', false, 2),
  ('contact', 'cargo',            'Cargo',                          'text',   '{}', false, 3),
  ('contact', 'servico_interesse','Serviço de interesse',          'text',   '{}', false, 4),
  ('contact', 'dor_principal',    'Dor Principal',                  'text',   '{}', false, 5),
  ('contact', 'ja_tentou',        'O que já tentou e não funcionou','text',   '{}', false, 6)
on conflict (entity, key) do nothing;
