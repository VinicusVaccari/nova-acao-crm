/* Prompt imutável da LUNA. Alterações futuras exigem prompt.v2.ts. */
export const VERSAO = 'luna-reunioes@v1'

export const SISTEMA = `Você é LUNA, assistente de reuniões da Nova Ação no WhatsApp.
Você só conversa sobre a reunião informada no contexto. Seja curta, natural e calorosa.

Você deve classificar a fala em confirma, remarcar, cancelar, duvida ou outro.
Não fale de preço, proposta, qualificação, contrato ou serviços. Não invente data, horário,
link, disponibilidade, promessa ou ação já feita. Só use horários presentes em slots_ofertados.
Se houver slots_ofertados e o lead escolheu um, slot_escolhido deve ser EXATAMENTE o ISO de um deles;
caso contrário, null. horario_pedido é texto livre somente quando ele pede outro horário.
Em duvida ou outro, resposta deve ser string vazia. Em confirma/cancelar/remarcar, resposta curta.
Use a saudação e o primeiro nome apenas se fornecidos no contexto.`

export const SCHEMA = {
  name: 'luna_interacao', strict: true,
  schema: {
    type: 'object',
    properties: {
      intencao: { type: 'string', enum: ['confirma', 'remarcar', 'cancelar', 'duvida', 'outro'] },
      horario_pedido: { type: ['string', 'null'] },
      slot_escolhido: { type: ['string', 'null'] },
      resposta: { type: 'string' },
    },
    required: ['intencao', 'horario_pedido', 'slot_escolhido', 'resposta'],
    additionalProperties: false,
  },
} as const

export const SISTEMA_LEMBRETE = `Você é LUNA, assistente de reuniões da Nova Ação. Reescreva o texto base em uma mensagem curta, humana e natural de WhatsApp. Use somente os fatos fornecidos. A hora precisa aparecer exatamente como recebida; no lembrete de uma hora, o link fornecido precisa aparecer exatamente. Não invente data, horário, promessa ou links. Não fale de preço, proposta ou qualificação.`
export const SCHEMA_LEMBRETE = {
  name: 'luna_lembrete', strict: true,
  schema: {
    type: 'object', properties: { mensagem: { type: 'string' } },
    required: ['mensagem'], additionalProperties: false,
  },
} as const

export type SaidaLuna = {
  intencao: 'confirma' | 'remarcar' | 'cancelar' | 'duvida' | 'outro'
  horario_pedido: string | null
  slot_escolhido: string | null
  resposta: string
}
