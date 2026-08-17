-- =============================================================
-- 0018_deal_parado — "parado há": tempo desde a última interação.
--   Última interação = a data mais recente entre TUDO que mexe no
--   negócio (só eventos passados): mudança de etapa, mensagem/atividade,
--   nota, tarefa e reunião. Se nada disso, cai no created_at.
--   O kanban usa isso para mostrar há quanto tempo o lead está parado.
-- =============================================================

create or replace view v_deal_parado as
select o.id as opportunity_id,
  greatest(
    o.stage_since,
    o.created_at,
    coalesce((select max(a.occurred_at) from activities a where a.opportunity_id = o.id), o.created_at),
    coalesce((select max(n.created_at) from notes n where n.opportunity_id = o.id), o.created_at),
    coalesce((select max(greatest(t.created_at, coalesce(t.done_at, t.created_at))) from tasks t where t.opportunity_id = o.id), o.created_at),
    coalesce((select max(greatest(m.created_at, coalesce(m.attended_at, m.created_at))) from meetings m where m.opportunity_id = o.id), o.created_at)
  ) as ultima_interacao
from opportunities o;
