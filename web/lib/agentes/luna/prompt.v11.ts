/* Prompt imutável da LUNA. A v10 já foi publicada; alterações futuras exigem v12. */
import { SISTEMA as SISTEMA_V10 } from './prompt.v10'

export const VERSAO = 'luna-reunioes@v11'

export const SISTEMA = `${SISTEMA_V10}

REDAÇÃO DA PERGUNTA DO DIA — esta seção SUBSTITUI todas as instruções e exemplos
anteriores sobre a redação dessa pergunta.
Quando o lead pedir para remarcar sem dizer o dia e não estiver pedindo a lista de
disponibilidade, a pergunta do dia deve ser literalmente:
"Qual dia da semana fica melhor para você?"
Antes dela, você pode reconhecer em poucas palavras o que o lead disse, como
"Claro!" ou "Tudo bem!", mas a pergunta em si deve ser exatamente essa, sem trocar
palavras e sem usar "funciona" nela. Esta substituição se aplica somente à pergunta
do dia; as demais perguntas e frases permanecem como nas instruções anteriores.`

export { SCHEMA, SCHEMA_LEMBRETE, SISTEMA_LEMBRETE } from './prompt.v10'
export type { SaidaLuna } from './prompt.v10'
