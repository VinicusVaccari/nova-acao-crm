-- =============================================================
-- 0013_task_desc — descrição da tarefa (assunto já é o title)
-- =============================================================
alter table tasks add column if not exists description text;
