/* Prompt imutável da LUNA. A v5 já foi publicada; alterações futuras exigem v7. */
import { SISTEMA as SISTEMA_V5 } from './prompt.v5'

export const VERSAO = 'luna-reunioes@v6'

export const SISTEMA = `${SISTEMA_V5}

Regra prioritária para modo escrever_oferta: se o horário pedido pelo lead estiver em
slots_disponiveis, devolva esse ISO em slot_pedido, deixe slots_para_oferta=[] e escreva que a
reunião ficou remarcada nesse horário. Não ofereça alternativas nesse caso. Só ofereça
alternativas quando o horário pedido não estiver em slots_disponiveis; nesse caso slot_pedido
continua sendo o ISO proposto pelo lead quando conhecido, para o servidor conferir.`

export { SCHEMA, SCHEMA_LEMBRETE, SISTEMA_LEMBRETE } from './prompt.v5'
export type { SaidaLuna } from './prompt.v5'
