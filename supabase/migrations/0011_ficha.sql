-- =============================================================
-- 0011_ficha — recursos dentro do card do lead
--   anotações · tarefas · produtos · arquivos
--   (propostas e reuniões já existiam)
-- =============================================================

-- ---------- Anotações livres no deal ----------
create table if not exists notes (
  id          bigserial primary key,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  body        text not null,
  author_id   uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_notes_opp on notes (opportunity_id, created_at desc);

-- ---------- Tarefas (substituem o "próxima ação" de campo único) ----------
create table if not exists tasks (
  id          bigserial primary key,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  title       text not null,
  kind        text not null default 'geral'
                check (kind in ('geral','ligacao','whatsapp','email','reuniao','proposta')),
  due_at      timestamptz,
  done_at     timestamptz,
  owner_id    uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_tasks_opp on tasks (opportunity_id, due_at);

-- ---------- Catálogo de produtos (serviços da agência) ----------
create table if not exists products (
  id          serial primary key,
  code        text unique not null,
  name        text not null,
  description text,
  sort_order  int not null default 0,
  active      boolean not null default true
);

insert into products (code, name, description, sort_order) values
  ('sites',        'Sites e Páginas',
   'Sites, Sites Otimizados, One Page, Landing Pages, Lojas Virtuais, Catálogos Virtuais, Blogs, Sites Institucionais.', 1),
  ('seo',          'SEO e Tráfego Orgânico',
   'Otimização para Google, Posicionamento Orgânico, Produção de Conteúdo para Blog.', 2),
  ('trafego_pago', 'Tráfego Pago',
   'Meta Ads, Google Ads, LinkedIn Ads, Remarketing com Segmentação e Foco em Performance.', 3),
  ('email',        'E-mail Marketing',
   'Relacionamento com Leads e Clientes, Comunicação Promocional e Estratégica.', 4),
  ('hospedagem',   'Hospedagem, Manutenção e Suporte',
   'Hospedagem, Manutenção e Suporte de Sites.', 5),
  ('gmn',          'Google Meu Negócio',
   'Criação, Configuração, Otimização Contínua, Presença Local.', 6),
  ('identidade',   'Identidade Visual',
   'Logotipo, Manual da Marca (Branding Book), Papelaria, Brand Kit, Templates.', 7)
on conflict (code) do nothing;

-- ---------- Produtos associados a um deal ----------
create table if not exists opportunity_products (
  id          bigserial primary key,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  product_id  int not null references products(id),
  mrr         numeric(12,2),
  note        text,
  created_at  timestamptz not null default now(),
  unique (opportunity_id, product_id)
);
create index if not exists idx_opp_prod on opportunity_products (opportunity_id);

-- ---------- Arquivos do deal (binário no Storage) ----------
create table if not exists deal_files (
  id          bigserial primary key,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  name        text not null,
  path        text not null,          -- caminho no bucket
  mime        text,
  size        bigint,
  uploaded_by uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_files_opp on deal_files (opportunity_id, created_at desc);

-- bucket privado (o app usa service role para subir/baixar)
insert into storage.buckets (id, name, public)
values ('deal-files', 'deal-files', false)
on conflict (id) do nothing;

-- ---------- RLS: mesma regra das demais tabelas ligadas ao deal ----------
alter table notes                enable row level security;
alter table tasks                enable row level security;
alter table opportunity_products enable row level security;
alter table deal_files           enable row level security;
alter table products             enable row level security;

do $$
declare t text;
begin
  foreach t in array array['notes','tasks','opportunity_products','deal_files']
  loop
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format($p$
      create policy %1$I_rw on %1$I for all to authenticated
      using (fn_is_manager() or exists (
        select 1 from opportunities o
         where o.id = %1$I.opportunity_id
           and (o.owner_id = auth.uid() or o.sdr_id = auth.uid())))
      with check (true)
    $p$, t);
  end loop;
end $$;

drop policy if exists products_read on products;
create policy products_read on products for select to authenticated using (true);
