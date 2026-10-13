/* Prompt imutável da LUNA. A v6 já foi publicada; alterações futuras exigem v8. */
import { SCHEMA_LEMBRETE, SISTEMA as SISTEMA_V6, SISTEMA_LEMBRETE } from './prompt.v6'

export const VERSAO = 'luna-reunioes@v7'

export const SISTEMA = `${SISTEMA_V6}

Delimitação de intenção: "duvida" e "outro" são SOMENTE assuntos fora da reunião:
preço, proposta, serviço, contrato, qualificação ou cobrança. Perguntas sobre a reunião são
assunto da Luna e nunca viram silêncio: disponibilidade de dias ou horários, horário marcado,
link do Meet, confirmação, local, duração ou participantes. Pergunta sobre dias ou horários
livres é intencao="remarcar".

No modo escrever_disponibilidade, dias_disponiveis é a única lista autorizada pelo servidor.
Devolva intencao="remarcar", escolha de um a três desses dias em
dias_para_disponibilidade e escreva perguntando qual dia o lead prefere. Não mencione hora,
data, ISO ou disponibilidade fora da lista; não crie slots_para_oferta e não diga que a reunião
foi remarcada. Os dias servem apenas para preparar a próxima oferta de horários.

Exemplo de tom e decisão: Lead: "quais dias vocês têm disponíveis?". Saída:
intencao="remarcar", dias_para_disponibilidade com até três dias de dias_disponiveis,
slots_para_oferta=[], slot_pedido=null, slot_escolhido=null; resposta natural que nomeia só
esses dias e pergunta qual ele prefere. Este exemplo nunca é fonte de dia, data, hora ou
disponibilidade: use exclusivamente o contexto da conversa.`

export const SCHEMA = {
  name: 'luna_interacao', strict: true,
  schema: {
    type: 'object',
    properties: {
      intencao: { type: 'string', enum: ['confirma', 'remarcar', 'cancelar', 'duvida', 'outro'] },
      horario_pedido: { type: ['string', 'null'] },
      slot_pedido: { type: ['string', 'null'] },
      slot_escolhido: { type: ['string', 'null'] },
      slots_para_oferta: { type: 'array', items: { type: 'string' } },
      dias_para_disponibilidade: { type: 'array', items: { type: 'string' } },
      resposta: { type: 'string' },
    },
    required: ['intencao', 'horario_pedido', 'slot_pedido', 'slot_escolhido', 'slots_para_oferta', 'dias_para_disponibilidade', 'resposta'],
    additionalProperties: false,
  },
} as const

export { SCHEMA_LEMBRETE, SISTEMA_LEMBRETE }

export type SaidaLuna = {
  intencao: 'confirma' | 'remarcar' | 'cancelar' | 'duvida' | 'outro'
  horario_pedido: string | null
  slot_pedido: string | null
  slot_escolhido: string | null
  slots_para_oferta: string[]
  dias_para_disponibilidade: string[]
  resposta: string
}
