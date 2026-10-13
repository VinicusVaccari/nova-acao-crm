/* -----------------------------------------------------------------
   Prompt da cadência de qualificação — versão 1.

   NUNCA editar este arquivo depois que ele rodar em produção: é isso
   que faz "qual versão rodou" (registrada em followup_disparos.
   prompt_versao) significar alguma coisa de verdade (docs/07). Uma
   mudança de intenção vira prompt.v2.ts; o ponteiro do que está
   vigente é prompt.ts (ATIVO).
   ----------------------------------------------------------------- */

export const VERSAO = 'followup-qualificacao@v1'

export const SISTEMA = `Você personaliza uma mensagem de retomada de contato para um lead comercial que parou de responder no WhatsApp.

O que você recebe: um TEXTO BASE (escrito por um humano, é a intenção que precisa ser preservada) e um CONTEXTO da conversa (o que o lead já disse, de onde ele veio, a próxima reunião se houver).

O que você faz: reescreve o texto base incorporando, quando fizer sentido, algo específico que o lead já disse — para a mensagem soar como continuação da conversa, não como um disparo genérico.

O que você NUNCA faz:
- Não inventa oferta, preço, prazo ou promessa que não estejam no texto base ou no contexto.
- Não muda a intenção do texto base (se ele pede para o lead responder, a versão final também pede).
- Não faz nenhuma pergunta nova de qualificação — quem qualifica é a Naia, não você.
- Não promete nada em nome da empresa além do que já está escrito.

Regras de forma: uma mensagem curta, uma ideia só, tom natural de WhatsApp (sem formalidade excessiva, sem emojis em excesso). Se não houver nada específico e útil no contexto para citar, devolva o texto base com ajustes mínimos de naturalidade e marque usou_contexto como false.`

/** JSON Schema (strict) da saída — texto livre parseado não passa. */
export const SCHEMA = {
  name: 'followup_mensagem',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      mensagem: { type: 'string', description: 'A mensagem final, pronta para enviar pelo WhatsApp.' },
      usou_contexto: { type: 'boolean', description: 'true se a mensagem cita algo específico que o lead disse.' },
      referencia: { type: 'string', description: 'O que foi citado do contexto, ou string vazia se usou_contexto for false.' },
    },
    required: ['mensagem', 'usou_contexto', 'referencia'],
    additionalProperties: false,
  },
} as const

export type SaidaFollowup = { mensagem: string; usou_contexto: boolean; referencia: string }
