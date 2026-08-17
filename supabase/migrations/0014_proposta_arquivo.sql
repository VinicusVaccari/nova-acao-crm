-- =============================================================
-- 0014_proposta_arquivo — a proposta passa a ser um documento
--   (arquivo no Storage), não mais campos digitados.
-- =============================================================
alter table proposals add column if not exists file_name text;
alter table proposals add column if not exists file_path text;
alter table proposals add column if not exists file_mime text;
alter table proposals add column if not exists file_size bigint;
