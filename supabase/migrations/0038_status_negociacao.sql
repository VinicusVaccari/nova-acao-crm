-- Status da negociação desacoplado da etapa.
-- "Perdido" e "Pausado" deixam de ser ETAPA (que tirava o card do lugar) e
-- viram STATUS que MANTÉM a etapa real — assim sabemos EM QUE etapa perdemos.
alter table opportunities add column if not exists lost_at   timestamptz;
alter table opportunities add column if not exists paused_at timestamptz;

-- Converte os perdidos legados: recupera a etapa de onde foram perdidos
-- (última transição para 'perdido' no histórico) e marca lost_at, mantendo o
-- motivo. Fallback 'negociacao' quando não há histórico.
update opportunities o set
  lost_at = coalesce(o.stage_since, now()),
  stage = coalesce(
    (select h.from_stage from stage_history h
       where h.opportunity_id = o.id and h.to_stage = 'perdido'
       order by h.changed_at desc limit 1),
    'negociacao')
where o.stage = 'perdido';
