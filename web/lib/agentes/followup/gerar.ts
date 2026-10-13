import 'server-only'
import { SISTEMA, SCHEMA, VERSAO, type SaidaFollowup } from './prompt.v3'
import { normalizarSaidaFollowup } from './saida'
import { deveBloquearConversaSemResposta, MOTIVO_CONVERSA_SEM_RESPOSTA } from './guardrail-sem-resposta'
import { detalharExcecao } from '@/lib/erros'

export type ResultadoGeracao = {
  mensagem: string
  personalizou: boolean
  usouContexto: boolean
  referencia: string
  tokensEntrada: number | null
  tokensSaida: number | null
  erro: string | null
}

const TIMEOUT_MS = 12_000

function trecho(texto: string, limite = 1000): string {
  const t = texto.trim()
  return t.length > limite ? `${t.slice(0, limite)}…(+${t.length - limite} caracteres)` : t
}

/** Erro HTTP da OpenAI com a razão de verdade: a OpenAI manda
    { error: { message, type, code, param } } no corpo e um x-request-id no
    header (é o que o suporte deles pede). Só o status ("openai_http_400")
    não distingue "modelo inexistente" de "chave inválida" (achado MÉDIO da
    Sentinela, 3ª rodada). Corpo fora desse formato vai cru, recortado. */
function descreverErroHttp(res: Response, corpo: string): string {
  let detalhe = ''
  try {
    const e = (JSON.parse(corpo) as { error?: { message?: unknown; type?: unknown; code?: unknown; param?: unknown } })?.error
    if (e && typeof e === 'object') {
      const tags = [e.code, e.type, e.param ? `param=${String(e.param)}` : null].filter((v): v is string => typeof v === 'string' && !!v)
      detalhe = `${tags.length ? `[${tags.join(' / ')}] ` : ''}${typeof e.message === 'string' ? e.message : ''}`.trim()
    }
  } catch { /* corpo não é JSON — vai cru abaixo */ }
  if (!detalhe) detalhe = corpo.trim() ? trecho(corpo) : '(corpo vazio)'
  const requestId = res.headers.get('x-request-id')
  return `openai_http_${res.status}: ${detalhe}${requestId ? ` (x-request-id ${requestId})` : ''}`
}

/** Guarda-corpo depois do schema (doc 07): a saída pode ser bem-formada
    e ainda assim inútil ou perigosa de mandar pro cliente. */
function guardrail(mensagem: string): string | null {
  const m = mensagem.trim()
  if (m.length < 10 || m.length > 600) return 'guardrail:tamanho'
  if (/https?:\/\//i.test(m)) return 'guardrail:link'
  if ((m.match(/\n/g) ?? []).length > 4) return 'guardrail:quebra_linha_excessiva'
  return null
}

/** Personaliza o texto base com o contexto da conversa. NUNCA lança —
    qualquer falha (sem chave, timeout, schema, guardrail) devolve o
    texto base puro com o motivo em `erro`. O valor do toque é a hora
    certa: adiar por causa do modelo é perder o toque (decisão
    registrada no desenho, doc 07 critério 14). */
export async function gerarMensagemFollowup(params: {
  textoBase: string
  contexto: unknown
  modelo: string
  leadRespondeu: boolean
}): Promise<ResultadoGeracao> {
  const { textoBase, contexto, modelo, leadRespondeu } = params
  const base: ResultadoGeracao = {
    mensagem: textoBase, personalizou: false, usouContexto: false, referencia: '', tokensEntrada: null, tokensSaida: null, erro: null,
  }

  if (!process.env.OPENAI_API_KEY) {
    return { ...base, erro: 'sem_chave' }
  }

  let saida: SaidaFollowup | null = null
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined
  // O motivo de CADA tentativa, não só o da última: uma segunda tentativa
  // que estoura o prazo apagava o corpo do 400 da primeira.
  const falhas: string[] = []

  for (let tentativa = 1; tentativa <= 2 && !saida; tentativa++) {
    let falha: string | null = null
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: modelo,
          messages: [
            { role: 'system', content: SISTEMA },
            { role: 'user', content: JSON.stringify({ texto_base: textoBase, contexto }) },
          ],
          response_format: { type: 'json_schema', json_schema: SCHEMA },
        }),
      })
      const corpo = await res.text()
      if (!res.ok) {
        falha = descreverErroHttp(res, corpo)
      } else {
        let json: {
          choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        } | null = null
        try { json = JSON.parse(corpo) } catch (e) { falha = `openai_resposta_nao_json: ${detalharExcecao(e)}; corpo: ${trecho(corpo, 300)}` }
        const escolha = json?.choices?.[0]
        const conteudo = escolha?.message?.content
        if (json && !conteudo) {
          const recusa = escolha?.message?.refusal
          falha = `openai_sem_conteudo (finish_reason=${escolha?.finish_reason ?? 'ausente'}${recusa ? `; refusal: ${trecho(recusa, 300)}` : ''})`
        } else if (json && conteudo) {
          let parsed: SaidaFollowup | null = null
          try { parsed = JSON.parse(conteudo) as SaidaFollowup } catch (e) { falha = `openai_conteudo_nao_json: ${detalharExcecao(e)}; conteúdo: ${trecho(conteudo, 300)}` }
          if (!falha && (!parsed || typeof parsed.mensagem !== 'string' || !parsed.mensagem.trim()
            || typeof parsed.usou_contexto !== 'boolean' || typeof parsed.referencia !== 'string')) {
            falha = `openai_schema_invalido: conteúdo: ${trecho(conteudo, 300)}`
          } else if (!falha) {
            const valida = parsed as SaidaFollowup
            const candidata = normalizarSaidaFollowup({
              textoBase,
              mensagem: valida.mensagem,
              usouContexto: valida.usou_contexto,
              referencia: valida.referencia,
            })
            if (deveBloquearConversaSemResposta({ mensagem: candidata.mensagem, leadRespondeu })) {
              falha = MOTIVO_CONVERSA_SEM_RESPOSTA
            } else {
              saida = valida
              usage = json.usage
            }
          }
        }
      }
    } catch (e) {
      falha = e instanceof Error && e.name === 'TimeoutError'
        ? `openai_timeout: sem resposta completa em ${TIMEOUT_MS}ms (${detalharExcecao(e)})`
        : `openai_falhou: ${detalharExcecao(e)}`
    }
    if (falha) {
      falhas.push(`tentativa ${tentativa}: ${falha}`)
      console.error(`gerarMensagemFollowup (modelo ${modelo}) tentativa ${tentativa} falhou —`, falha)
    }
  }

  if (!saida) return { ...base, erro: falhas.join(' | ') || 'openai_falhou: sem motivo registrado' }

  const saidaNormalizada = normalizarSaidaFollowup({
    textoBase,
    mensagem: saida.mensagem,
    usouContexto: saida.usou_contexto,
    referencia: saida.referencia,
  })
  const motivoGuardrail = guardrail(saidaNormalizada.mensagem)
  if (motivoGuardrail) {
    return { ...base, tokensEntrada: usage?.prompt_tokens ?? null, tokensSaida: usage?.completion_tokens ?? null, erro: motivoGuardrail }
  }

  return {
    ...saidaNormalizada,
    tokensEntrada: usage?.prompt_tokens ?? null,
    tokensSaida: usage?.completion_tokens ?? null,
    erro: null,
  }
}

export { VERSAO }
