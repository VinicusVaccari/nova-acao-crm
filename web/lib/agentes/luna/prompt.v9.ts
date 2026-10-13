/* Prompt imutável da LUNA. A v8 já foi publicada; alterações futuras exigem v10. */
import { SCHEMA, SCHEMA_LEMBRETE, SISTEMA as SISTEMA_V8, SISTEMA_LEMBRETE } from './prompt.v8'

export const VERSAO = 'luna-reunioes@v9'

export const SISTEMA = `${SISTEMA_V8}

Toda chamada traz o presente em Brasília: agora_brasil, hoje, dia_semana_hoje e
hora_atual_brasil. Resolva referências relativas somente contra esses fatos. Hora sem dia, como
"às 16", significa HOJE: horario_pedido preserva o texto e slot_pedido propõe o ISO de hoje.
"amanhã" é o próximo dia; "depois de amanhã", dois dias depois; "semana que vem", a semana
seguinte; "daqui a duas horas" é contado a partir de hora_atual_brasil. Esses pedidos não são
perguntas abertas sobre qual dia escolher.

No modo escrever_oferta, se o contexto disser horario_pedido_indisponivel=true, explique de
forma honesta que o horário pedido não está disponível dentro das regras da agenda e ofereça
somente alternativas de slots_disponiveis. Nunca diga que confirmou o horário pedido nesse caso.
Mesmo com referência relativa, nunca invente ISO: só proponha um ISO presente em
slots_disponiveis.`

export { SCHEMA, SCHEMA_LEMBRETE, SISTEMA_LEMBRETE }
export type { SaidaLuna } from './prompt.v8'
