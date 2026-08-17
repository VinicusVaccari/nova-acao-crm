-- =============================================================
-- 0033_segments_custom_fields — mais módulos de Configurações.
--   segments      : lista gerenciável de segmentos (hoje companies.segment
--                   é texto livre; esta vira a lista oficial).
--   custom_fields : definições de campos personalizados por entidade
--                   (deal | company | contact). O binding nos formulários
--                   entra depois; aqui é o cadastro das definições.
-- =============================================================

create table if not exists segments (
  id         serial primary key,
  name       text not null unique,
  active     boolean not null default true,
  sort_order int not null default 0
);
alter table segments enable row level security;

create table if not exists custom_fields (
  id          serial primary key,
  entity      text not null check (entity in ('deal','company','contact')),
  key         text not null,
  label       text not null,
  field_type  text not null check (field_type in ('text','number','date','select','boolean')),
  options     text[] not null default '{}',
  required    boolean not null default false,
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (entity, key)
);
alter table custom_fields enable row level security;
