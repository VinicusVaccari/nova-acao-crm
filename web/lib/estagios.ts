/* Constantes e tipos compartilhados entre servidor e cliente.
   Este módulo NÃO importa o banco — é o que permite o kanban e os
   formulários usarem os estágios sem arrastar a service_role para o
   bundle do navegador. */

/* Cada estágio ganha uma cor própria: a jornada vai do teal da marca,
   passa pelo roxo, chega ao âmbar (proposta/negociação) e fecha no verde.
   Tons médios, legíveis nos dois temas sobre superfície clara e escura. */
export const ESTAGIOS = [
  { id: 'novo',                  label: 'Novo',               curto: 'Novo',        cor: '#7c7595' },
  { id: 'em_atendimento',        label: 'Em atendimento',     curto: 'Atendimento', cor: '#01aaaf' },
  { id: 'qualificado',           label: 'Qualificado',        curto: 'Qualificado', cor: '#0e8ecf' },
  { id: 'reuniao_agendada',      label: 'Reunião agendada',   curto: 'Agendada',    cor: '#6366f1' },
  { id: 'diagnostico_realizado', label: 'Diagnóstico feito',  curto: 'Diagnóstico', cor: '#8b5cf6' },
  { id: 'fechamento_agendado',   label: 'Fechamento marcado', curto: 'Fechamento',  cor: '#a855f7' },
  { id: 'proposta_enviada',      label: 'Proposta enviada',   curto: 'Proposta',    cor: '#fdb92e' },
  { id: 'negociacao',            label: 'Negociação',         curto: 'Negociação',  cor: '#f97316' },
  { id: 'ganho',                 label: 'Ganho',              curto: 'Ganho',       cor: '#0d8f52' },
] as const

export type EstagioId = (typeof ESTAGIOS)[number]['id']

/** Etapa com apresentação editável (rótulo/cor/ordem vêm do banco).
    `won`/`lost`/`nurture` marcam as etapas de função fixa (Venda/Perdido/
    Nutrição) — dá para mover/renomear, mas não remover nem trocar o papel. */
export type Estagio = {
  id: string; label: string; curto: string; cor: string; ordem: number; noBoard: boolean
  won: boolean; lost: boolean; nurture: boolean
}

/** Config padrão (fallback quando o banco ainda não respondeu). */
export const ESTAGIOS_PADRAO: Estagio[] = ESTAGIOS.map((e, i) => ({
  id: e.id, label: e.label, curto: e.curto, cor: e.cor, ordem: i + 1, noBoard: false,
  won: e.id === 'ganho', lost: false, nurture: false,
}))

const POR_ID = Object.fromEntries(ESTAGIOS.map(e => [e.id, e]))

/** Cor da marca associada ao estágio (fallback cinza para perdido/nutrição). */
export const corEstagio = (id: string): string => POR_ID[id]?.cor ?? '#7c7595'

/** Rótulo curto do estágio. */
export const labelEstagio = (id: string): string =>
  POR_ID[id]?.label ?? (id === 'perdido' ? 'Perdido' : id === 'nutricao' ? 'Nutrição' : id)

export type StatusNeg = 'andamento' | 'vendido' | 'perdido' | 'pausado'

export type CardPipeline = {
  id: string
  stage: string
  stage_since: string
  board_rank: number
  expected_value: number | null
  term_months: number | null
  score: number
  qualificacao: number
  title: string | null
  status: StatusNeg
  product: string | null
  source_channel: string | null
  next_step: string | null
  next_step_due: string | null
  created_at: string
  first_contact_at: string | null
  ultima_interacao: string | null
  lost_reason: string | null
  lost_at: string | null
  paused_at: string | null
  contractValue: number
  produtoIds: number[]
  produtoNomes: string[]
  nome: string
  empresa: string | null
  dono: string | null
  proxima_reuniao: string | null
}
