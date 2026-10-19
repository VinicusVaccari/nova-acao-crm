/* Constantes e tipos compartilhados entre servidor e cliente.
   Este módulo NÃO importa o banco — é o que permite o kanban e os
   formulários usarem os estágios sem arrastar a service_role para o
   bundle do navegador. */

/* Cada estágio ganha uma cor própria: a jornada vai do teal da marca,
   passa pelo roxo, chega ao âmbar (proposta/negociação) e fecha no verde.
   Tons médios, legíveis nos dois temas sobre superfície clara e escura. */
export const ESTAGIOS = [
  { id: 'novo',                       label: 'Lead Aguardando Contato',    curto: 'Aguardando',   cor: '#7c7595' },
  { id: 'primeiro_contato',           label: 'Primeiro Contato Feito',     curto: 'Contato',      cor: '#01aaaf' },
  { id: 'qualificado',                label: 'Qualificado',                curto: 'Qualificado',  cor: '#0e8ecf' },
  { id: 'desqualificado',             label: 'Desqualificado',             curto: 'Desqualif.',   cor: '#e0685f' },
  { id: 'reuniao_agendada',           label: 'Reunião agendada',           curto: 'Reunião',      cor: '#6366f1' },
  { id: 'apresentacao_institucional', label: 'Apresentação Institucional', curto: 'Apres. Inst.', cor: '#8b5cf6' },
  { id: 'envio_proposta',             label: 'Envio da Proposta',          curto: 'Proposta',     cor: '#a855f7' },
  { id: 'apresentacao_proposta',      label: 'Apresentação da Proposta',   curto: 'Apres. Prop.', cor: '#fdb92e' },
  { id: 'negociacao',                 label: 'Negociação',                 curto: 'Negociação',   cor: '#f97316' },
  { id: 'ganho',                      label: 'Venda',                      curto: 'Venda',        cor: '#0d8f52' },
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
  /* Mesma regra que a tela de Mensagens usa: a trava (fn_trava_status/
     v_trava_atual) ou opportunities.atendimento = 'humano' (negócio de LP
     nova, que já nasce com o Rodrigues). `null` = sem telefone e sem dono
     humano, o indicador não se aplica a este negócio. */
  atendimento: 'naia' | 'travado' | 'voce' | null
  /* Cadência de qualificação (followup_disparos) — `null` = nenhum toque
     SAIU ainda, ou o lead respondeu depois do último envio. `toque` é o
     toque do último ENVIADO de verdade (status 'enviado'), 1 a 3 — nunca
     um toque reservado ou gerado em sombra. */
  followup: { toque: number; total: number } | null
}
