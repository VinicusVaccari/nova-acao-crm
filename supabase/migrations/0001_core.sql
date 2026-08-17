-- =============================================================
-- 0001_core — extensões, tipos, usuários, identidade, empresas
-- Sistema Operacional Nova Ação
-- =============================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- -------------------------------------------------------------
-- TIPOS
-- -------------------------------------------------------------

-- estágios do funil (espelham o diagrama comercial)
do $$ begin
  create type opp_stage as enum (
    'novo',
    'em_atendimento',
    'qualificado',
    'reuniao_agendada',
    'diagnostico_realizado',
    'fechamento_agendado',
    'proposta_enviada',
    'negociacao',
    'ganho',
    'perdido',
    'nutricao'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app_role as enum ('admin','gestor','vendedor','sdr','csm','analista');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------
-- USUÁRIOS DO SISTEMA
-- -------------------------------------------------------------

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       citext,
  role        app_role not null default 'vendedor',
  avatar_url  text,
  is_active   boolean not null default true,
  -- capacidade de leads simultâneos, usada no round-robin balanceado
  lead_capacity int not null default 30,
  created_at  timestamptz not null default now()
);

comment on table profiles is 'Usuários internos. Espelha auth.users com papel e capacidade.';

-- -------------------------------------------------------------
-- IDENTIDADE — o alicerce da unificação
-- -------------------------------------------------------------

create table if not exists people (
  id             uuid primary key default gen_random_uuid(),
  full_name      text,
  email_primary  citext,
  phone_primary  text,                       -- sempre E.164: +5511987654321
  consent_basis  text,                       -- LGPD: legitimo_interesse | consentimento | contrato
  consent_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table people is 'Uma linha por pessoa física. A ficha do prontuário.';

create index if not exists idx_people_email on people (email_primary);
create index if not exists idx_people_phone on people (phone_primary);

-- Os "documentos" da pessoa: todo jeito de reconhecê-la em qualquer canal.
-- É esta tabela que liga um clique em anúncio de 40 dias atrás a um contrato de hoje.
create table if not exists identities (
  id            bigserial primary key,
  person_id     uuid not null references people(id) on delete cascade,
  kind          text not null check (kind in (
                  'email','phone','wa_id','fbclid','fbp','gclid',
                  'ga_client_id','instagram','cpf','external')),
  value         text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (kind, value)
);

create index if not exists idx_identities_person on identities (person_id);

-- Quando dois identificadores apontam para pessoas diferentes, não se funde cegamente:
-- vai para revisão humana.
create table if not exists identity_conflicts (
  id           bigserial primary key,
  person_a     uuid references people(id),
  person_b     uuid references people(id),
  reason       text,
  payload      jsonb,
  resolved_at  timestamptz,
  resolved_by  uuid references profiles(id),
  created_at   timestamptz not null default now()
);

-- -------------------------------------------------------------
-- EMPRESAS
-- -------------------------------------------------------------

create table if not exists companies (
  id           uuid primary key default gen_random_uuid(),
  legal_name   text,
  trade_name   text,
  cnpj         text unique,
  segment      text,
  size_band    text,                         -- faixa de faturamento estimado
  website      text,
  instagram    text,
  city         text,
  state        text,
  enrichment   jsonb not null default '{}',  -- dossiê do agente enriquecedor
  created_at   timestamptz not null default now()
);

create index if not exists idx_companies_segment on companies (segment);

create table if not exists person_company (
  person_id         uuid references people(id) on delete cascade,
  company_id        uuid references companies(id) on delete cascade,
  role_title        text,
  is_decision_maker boolean not null default false,
  primary key (person_id, company_id)
);

-- -------------------------------------------------------------
-- HELPERS DE NORMALIZAÇÃO
-- Dado sujo na entrada é duplicata garantida depois.
-- -------------------------------------------------------------

-- Telefone brasileiro -> E.164. Aceita (11) 98765-4321, 11987654321, +5511987654321
create or replace function fn_norm_phone(p_raw text)
returns text language plpgsql immutable as $$
declare d text;
begin
  if p_raw is null then return null; end if;

  d := regexp_replace(p_raw, '[^0-9]', '', 'g');
  if d = '' then return null; end if;

  -- remove zeros de operadora à esquerda
  d := regexp_replace(d, '^0+', '');

  -- já veio com DDI 55
  if length(d) in (12, 13) and left(d, 2) = '55' then
    return '+' || d;
  end if;

  -- DDD + número (10 ou 11 dígitos) -> assume Brasil
  if length(d) in (10, 11) then
    return '+55' || d;
  end if;

  -- outros formatos internacionais: devolve como veio, só com +
  return '+' || d;
end $$;

-- E-mail -> minúsculo, sem espaços, sem +alias no Gmail
create or replace function fn_norm_email(p_raw text)
returns text language plpgsql immutable as $$
declare e text; local_part text; domain_part text;
begin
  if p_raw is null then return null; end if;
  e := lower(btrim(p_raw));
  if position('@' in e) = 0 then return null; end if;

  local_part  := split_part(e, '@', 1);
  domain_part := split_part(e, '@', 2);

  if domain_part in ('gmail.com', 'googlemail.com') then
    local_part := split_part(local_part, '+', 1);
    local_part := replace(local_part, '.', '');
  else
    local_part := split_part(local_part, '+', 1);
  end if;

  return local_part || '@' || domain_part;
end $$;

-- -------------------------------------------------------------
-- RESOLUÇÃO DE IDENTIDADE
-- Recebe qualquer combinação de identificadores e devolve UMA pessoa.
-- É o coração da unificação: chamado por toda entrada de lead.
-- -------------------------------------------------------------
create or replace function fn_resolve_person(
  p_email     text default null,
  p_phone     text default null,
  p_name      text default null,
  p_wa_id     text default null,
  p_fbclid    text default null,
  p_gclid     text default null,
  p_ga_client text default null
) returns uuid language plpgsql security definer as $$
declare
  v_person uuid;
  v_email  text := fn_norm_email(p_email);
  v_phone  text := fn_norm_phone(p_phone);
begin
  -- ordem de confiança: telefone > e-mail > wa_id > ids de clique
  select person_id into v_person from identities
   where (kind = 'phone' and value = v_phone and v_phone is not null)
   limit 1;

  if v_person is null and v_email is not null then
    select person_id into v_person from identities
     where kind = 'email' and value = v_email limit 1;
  end if;

  if v_person is null and p_wa_id is not null then
    select person_id into v_person from identities
     where kind = 'wa_id' and value = p_wa_id limit 1;
  end if;

  if v_person is null and p_fbclid is not null then
    select person_id into v_person from identities
     where kind = 'fbclid' and value = p_fbclid limit 1;
  end if;

  if v_person is null and p_gclid is not null then
    select person_id into v_person from identities
     where kind = 'gclid' and value = p_gclid limit 1;
  end if;

  if v_person is null and p_ga_client is not null then
    select person_id into v_person from identities
     where kind = 'ga_client_id' and value = p_ga_client limit 1;
  end if;

  -- não achou ninguém: cria a pessoa
  if v_person is null then
    insert into people (full_name, email_primary, phone_primary)
    values (p_name, v_email, v_phone)
    returning id into v_person;
  else
    -- achou: completa os campos que ainda estavam vazios (nunca sobrescreve)
    update people set
      full_name     = coalesce(full_name, p_name),
      email_primary = coalesce(email_primary, v_email::citext),
      phone_primary = coalesce(phone_primary, v_phone),
      updated_at    = now()
    where id = v_person;
  end if;

  -- registra/atualiza cada identificador recebido
  insert into identities (person_id, kind, value)
  select v_person, k, v from (values
      ('email',        v_email),
      ('phone',        v_phone),
      ('wa_id',        p_wa_id),
      ('fbclid',       p_fbclid),
      ('gclid',        p_gclid),
      ('ga_client_id', p_ga_client)
  ) as t(k, v)
  where v is not null and v <> ''
  on conflict (kind, value) do update set last_seen_at = now();

  return v_person;
end $$;

comment on function fn_resolve_person is
  'Recebe identificadores de qualquer canal e devolve uma única person_id. Nunca duplica lead.';
