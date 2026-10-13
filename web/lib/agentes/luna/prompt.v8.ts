/* Prompt imutável da LUNA. A v7 já foi publicada; alterações futuras exigem v9. */
import { SCHEMA_LEMBRETE, SISTEMA as SISTEMA_V7, SISTEMA_LEMBRETE } from './prompt.v7'

export const VERSAO = 'luna-reunioes@v8'

export const SISTEMA = `${SISTEMA_V7}

Na classificação, pediu_disponibilidade é true quando o lead quer saber quais dias ou horários
existem, sem escolher um dia específico. Isso é diferente de "preciso remarcar", que só pede
remarcação e não pede a lista. Entenda o sentido, não palavras isoladas. Exemplos que devolvem
intencao="remarcar" e pediu_disponibilidade=true: "quais dias vocês têm?", "quando vocês
podem?", "o que tem pra semana que vem?", "me manda os horários" e "que horas dá?". Para
"preciso remarcar", pediu_disponibilidade=false e pergunte qual dia. Para preço, proposta,
serviço, contrato, qualificação ou cobrança, pediu_disponibilidade=false, intencao="duvida" ou
"outro" e resposta vazia. Em modos diferentes de classificar, mantenha pediu_disponibilidade=false.`

export const SCHEMA = {
  name: 'luna_interacao', strict: true,
  schema: {
    type: 'object',
    properties: {
      intencao: { type: 'string', enum: ['confirma', 'remarcar', 'cancelar', 'duvida', 'outro'] },
      pediu_disponibilidade: { type: 'boolean' },
      horario_pedido: { type: ['string', 'null'] },
      slot_pedido: { type: ['string', 'null'] },
      slot_escolhido: { type: ['string', 'null'] },
      slots_para_oferta: { type: 'array', items: { type: 'string' } },
      dias_para_disponibilidade: { type: 'array', items: { type: 'string' } },
      resposta: { type: 'string' },
    },
    required: ['intencao', 'pediu_disponibilidade', 'horario_pedido', 'slot_pedido', 'slot_escolhido', 'slots_para_oferta', 'dias_para_disponibilidade', 'resposta'],
    additionalProperties: false,
  },
} as const

export { SCHEMA_LEMBRETE, SISTEMA_LEMBRETE }

export type SaidaLuna = {
  intencao: 'confirma' | 'remarcar' | 'cancelar' | 'duvida' | 'outro'
  pediu_disponibilidade: boolean
  horario_pedido: string | null
  slot_pedido: string | null
  slot_escolhido: string | null
  slots_para_oferta: string[]
  dias_para_disponibilidade: string[]
  resposta: string
}
