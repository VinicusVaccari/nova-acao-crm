import 'server-only'
import { db } from './db'
import { ESTAGIOS_PADRAO, type Estagio } from './estagios'

/** Carrega a apresentação das etapas (rótulo/curto/cor/ordem) do banco.
    Cai no padrão do código se a tabela ainda não existir/estiver vazia. */
export async function carregarEstagios(): Promise<Estagio[]> {
  const { data } = await db
    .from('pipeline_stages')
    .select('stage, label, color, sort_order, on_board, won, lost, nurture')
    .order('sort_order')
  if (!data || !data.length) return ESTAGIOS_PADRAO
  return data.map(r => ({
    id: r.stage as string,
    label: r.label as string,
    curto: r.label as string, // nome único agora — sem "curto" separado
    cor: r.color as string,
    ordem: r.sort_order as number,
    noBoard: !(r.on_board as boolean),
    won: !!r.won,
    lost: !!r.lost,
    nurture: !!r.nurture,
  }))
}
