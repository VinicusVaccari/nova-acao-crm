-- =============================================================
-- 0010_board_rank
--
-- Ordenação manual dos cards no kanban: cada oportunidade ganha um
-- board_rank (double). Ordena-se por board_rank asc — inserir entre
-- dois cards é só usar o ponto médio dos vizinhos, sem renumerar nada.
-- =============================================================

alter table opportunities
  add column if not exists board_rank double precision not null default 0;

-- Backfill: dentro de cada estágio, preserva a ordem atual (mais
-- recente no topo) com folga de 65536 entre cards, para caber inserções.
with r as (
  select id,
         row_number() over (partition by stage order by stage_since desc) * 65536.0 as rk
    from opportunities
)
update opportunities o
   set board_rank = r.rk
  from r
 where r.id = o.id;

create index if not exists idx_opp_rank on opportunities (stage, board_rank);
