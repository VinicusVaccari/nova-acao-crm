-- =============================================================
-- 0016_pipeline_stages — rótulos/cores/ordem das etapas editáveis.
--   Os VALORES do funil continuam no enum `opp_stage` (as regras de
--   transição/probabilidade dependem deles). Esta tabela guarda só a
--   APRESENTAÇÃO de cada etapa — nome, nome curto, cor e ordem no
--   kanban — que o usuário pode alterar pelo CRM.
--   RLS ligado sem policies: leitura/escrita só via service_role (o
--   servidor). O app entrega os rótulos ao cliente já renderizados.
-- =============================================================

create table if not exists pipeline_stages (
  stage      opp_stage primary key,
  label      text not null,
  short      text not null,
  color      text not null,
  sort_order int  not null,
  on_board   boolean not null default true,   -- aparece como coluna do kanban
  updated_at timestamptz not null default now()
);

insert into pipeline_stages (stage, label, short, color, sort_order, on_board) values
  ('novo',                  'Novo',               'Novo',        '#7c7595', 1,  true),
  ('em_atendimento',        'Em atendimento',     'Atendimento', '#01aaaf', 2,  true),
  ('qualificado',           'Qualificado',        'Qualificado', '#0e8ecf', 3,  true),
  ('reuniao_agendada',      'Reunião agendada',   'Agendada',    '#6366f1', 4,  true),
  ('diagnostico_realizado', 'Diagnóstico feito',  'Diagnóstico', '#8b5cf6', 5,  true),
  ('fechamento_agendado',   'Fechamento marcado', 'Fechamento',  '#a855f7', 6,  true),
  ('proposta_enviada',      'Proposta enviada',   'Proposta',    '#fdb92e', 7,  true),
  ('negociacao',            'Negociação',         'Negociação',  '#f97316', 8,  true),
  ('ganho',                 'Ganho',              'Ganho',       '#0d8f52', 9,  true),
  ('perdido',               'Perdido',            'Perdido',     '#cf3b4e', 10, false),
  ('nutricao',              'Nutrição',           'Nutrição',    '#7c7595', 11, false)
on conflict (stage) do nothing;

alter table pipeline_stages enable row level security;
-- (sem policies de propósito — só o servidor lê/escreve)
