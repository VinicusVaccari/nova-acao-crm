/* Prompt imutável da LUNA. A v9 já foi publicada; alterações futuras exigem v11. */
import { SCHEMA, SCHEMA_LEMBRETE, SISTEMA as SISTEMA_V9, SISTEMA_LEMBRETE as SISTEMA_LEMBRETE_V9 } from './prompt.v9'

export const VERSAO = 'luna-reunioes@v10'

const SEM_EMOJI = `

Nunca use emoji em nenhuma mensagem. Isso inclui caras, pictogramas, símbolos, transporte,
bandeiras, dingbats, setas decorativas, variações visuais e qualquer sequência com emoji. Também
não use emoticon de texto (como :) ou :-D) nem kaomoji. Escreva somente com texto e pontuação
comum.`

export const SISTEMA = `${SISTEMA_V9}${SEM_EMOJI}`
export const SISTEMA_LEMBRETE = `${SISTEMA_LEMBRETE_V9}

Esta orientação substitui qualquer instrução anterior sobre obrigatoriedade de hora. Quando o texto base não citar a hora, você pode dizer apenas "daqui a uma hora" e não precisa
incluir uma hora exata. Se citar hora, ela só pode ser exatamente a hora recebida nos fatos.
No lembrete de uma hora, o link do Meet continua obrigatório.${SEM_EMOJI}`

// Sem uso desde 25/09/2026: o coordenador determinou que lembrete sai literal
// da base cadastrada. Mantido junto ao schema para preservar o contrato antigo.

export { SCHEMA, SCHEMA_LEMBRETE }
export type { SaidaLuna } from './prompt.v9'
