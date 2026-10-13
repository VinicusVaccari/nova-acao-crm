import 'server-only'
import { SCHEMA, SCHEMA_LEMBRETE, SISTEMA, SISTEMA_LEMBRETE, VERSAO, type SaidaLuna } from './prompt'
import { detalharExcecao } from '@/lib/erros'

const TIMEOUT_MS = 12_000
const INTENCOES = new Set<SaidaLuna['intencao']>(['confirma', 'remarcar', 'cancelar', 'duvida', 'outro'])

export type ResultadoLuna = SaidaLuna & { tokensEntrada: number | null; tokensSaida: number | null; erro: string | null }

function erroHttp(res: Response, corpo: string) {
  const requestId = res.headers.get('x-request-id')
  return `openai_http_${res.status}: ${corpo.slice(0, 600) || '(corpo vazio)'}${requestId ? ` (x-request-id ${requestId})` : ''}`
}

/** Falha fechada: quem chama não responde nem altera reunião sem uma saída válida. */
export async function interpretarLuna(contexto: unknown, modelo: string, limiteEm?: number): Promise<ResultadoLuna> {
  const vazio: ResultadoLuna = { intencao: 'outro', pediu_disponibilidade: false, horario_pedido: null, slot_pedido: null, slot_escolhido: null, slots_para_oferta: [], dias_para_disponibilidade: [], resposta: '', tokensEntrada: null, tokensSaida: null, erro: 'sem_chave' }
  if (!process.env.OPENAI_API_KEY) return vazio
  const timeoutMs = Math.min(TIMEOUT_MS, limiteEm === undefined ? TIMEOUT_MS : limiteEm - Date.now())
  if (timeoutMs <= 0) return { ...vazio, erro: 'openai_timeout' }
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: 'system', content: SISTEMA }, { role: 'user', content: JSON.stringify(contexto) }],
        response_format: { type: 'json_schema', json_schema: SCHEMA },
      }),
    })
    const corpo = await res.text()
    if (!res.ok) return { ...vazio, erro: erroHttp(res, corpo) }
    let bruto: { choices?: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    try { bruto = JSON.parse(corpo) } catch (erro) { return { ...vazio, erro: `openai_resposta_nao_json: ${detalharExcecao(erro)}` } }
    const conteudo = bruto.choices?.[0]?.message?.content
    if (!conteudo) return { ...vazio, erro: 'openai_sem_conteudo' }
    let saida: SaidaLuna
    try { saida = JSON.parse(conteudo) as SaidaLuna } catch { return { ...vazio, erro: 'openai_conteudo_nao_json' } }
    if (!INTENCOES.has(saida.intencao) || typeof saida.pediu_disponibilidade !== 'boolean' || (saida.horario_pedido !== null && typeof saida.horario_pedido !== 'string') ||
      (saida.slot_pedido !== null && typeof saida.slot_pedido !== 'string') ||
      (saida.slot_escolhido !== null && typeof saida.slot_escolhido !== 'string') || !Array.isArray(saida.slots_para_oferta) ||
      saida.slots_para_oferta.length > 3 || !saida.slots_para_oferta.every(slot => typeof slot === 'string') ||
      !Array.isArray(saida.dias_para_disponibilidade) ||
      !saida.dias_para_disponibilidade.every(dia => typeof dia === 'string') || typeof saida.resposta !== 'string') {
      return { ...vazio, erro: 'openai_schema_invalido' }
    }
    return { ...saida, tokensEntrada: bruto.usage?.prompt_tokens ?? null, tokensSaida: bruto.usage?.completion_tokens ?? null, erro: null }
  } catch (erro) {
    return { ...vazio, erro: (erro instanceof Error && erro.name === 'TimeoutError') || (limiteEm !== undefined && Date.now() >= limiteEm) ? 'openai_timeout' : `openai_falhou: ${detalharExcecao(erro)}` }
  }
}

export async function gerarLembreteLuna(params: { textoBase: string; fatos: unknown; modelo: string }): Promise<{ mensagem: string; tokensEntrada: number | null; tokensSaida: number | null; erro: string | null }> {
  // Sem uso desde 25/09/2026: por decisão do coordenador, lembretes são
  // literais após preencher marcadores. Mantido para não reintroduzir a
  // reescrita por engano nem apagar o histórico do contrato de prompt.
  const base = { mensagem: params.textoBase, tokensEntrada: null, tokensSaida: null, erro: null as string | null }
  if (!process.env.OPENAI_API_KEY) return { ...base, erro: 'sem_chave' }
  const falhas: string[] = []
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: params.modelo, messages: [{ role: 'system', content: SISTEMA_LEMBRETE }, { role: 'user', content: JSON.stringify({ texto_base: params.textoBase, fatos: params.fatos }) }], response_format: { type: 'json_schema', json_schema: SCHEMA_LEMBRETE } }),
      })
      const corpo = await res.text()
      if (!res.ok) { falhas.push(erroHttp(res, corpo)); continue }
      const bruto = JSON.parse(corpo) as { choices?: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      const conteudo = bruto.choices?.[0]?.message?.content
      const saida = conteudo ? JSON.parse(conteudo) as { mensagem?: unknown } : null
      if (!saida || typeof saida.mensagem !== 'string') { falhas.push('openai_schema_invalido'); continue }
      return { mensagem: saida.mensagem, tokensEntrada: bruto.usage?.prompt_tokens ?? null, tokensSaida: bruto.usage?.completion_tokens ?? null, erro: null }
    } catch (erro) { falhas.push(`openai_falhou: ${detalharExcecao(erro)}`) }
  }
  return { ...base, erro: falhas.join(' | ') || 'openai_falhou' }
}

export { VERSAO }
