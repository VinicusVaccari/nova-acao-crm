import 'server-only'

/** Formata um erro do Supabase/Postgres com code+message (+details/hint
    quando existem) — nunca só `.message` sozinho, que já escondeu a causa
    real de um incidente (13/09/2026): um 504 do PostgREST virava só uma
    frase genérica nossa, sem nada que desse pra diagnosticar depois. */
export function detalharErroSupabase(e: { code?: string | null; message: string; details?: string | null; hint?: string | null }): string {
  const extra = [e.details, e.hint].filter((v): v is string => !!v)
  return `${e.code ? `${e.code}: ` : ''}${e.message}${extra.length ? ` (${extra.join('; ')})` : ''}`
}

type ErroComCodigo = { name?: unknown; message?: unknown; code?: unknown; cause?: unknown; errors?: unknown }

function comoObjeto(v: unknown): ErroComCodigo | null {
  return v && typeof v === 'object' ? (v as ErroComCodigo) : null
}

function codigoDe(e: ErroComCodigo): string | null {
  return typeof e.code === 'string' || typeof e.code === 'number' ? String(e.code) : null
}

/** Formata uma exceção JS com a cadeia inteira de `cause` (nome, código e
    mensagem de cada nível) — o `fetch` do Node/undici põe o motivo de
    verdade (ENOTFOUND, certificado recusado, "other side closed") só em
    `error.cause`, e `.message` sozinho costuma ser só "fetch failed".
    Mostrar só o código da causa também escondia a mensagem dela (achado
    MÉDIO da Sentinela, 3ª rodada). */
export function detalharExcecao(e: unknown): string {
  const niveis: string[] = []
  let atual: unknown = e
  for (let nivel = 0; atual != null && nivel < 5; nivel++) {
    const obj = comoObjeto(atual)
    if (!obj) { niveis.push(String(atual)); break }
    const codigo = codigoDe(obj)
    const nome = typeof obj.name === 'string' ? obj.name : 'Erro'
    const mensagem = typeof obj.message === 'string' ? obj.message : String(atual)
    let texto = `${nome}${codigo ? ` [${codigo}]` : ''}: ${mensagem}`
    if (Array.isArray(obj.errors) && obj.errors.length) {
      texto += ` {${obj.errors.map(sub => {
        const s = comoObjeto(sub)
        return s ? `${codigoDe(s) ?? (typeof s.name === 'string' ? s.name : 'Erro')}: ${typeof s.message === 'string' ? s.message : ''}` : String(sub)
      }).join(' | ')}}`
    }
    niveis.push(texto)
    atual = obj.cause
  }
  return niveis.join(' ← causa: ')
}

// Falhas em que a requisição HTTP COM CERTEZA não foi escrita no socket —
// a conexão nunca chegou a existir. Só entra aqui o que acontece antes de
// qualquer byte da requisição sair (achado ALTO da Sentinela, 3ª rodada:
// a lista anterior deixava de fora EAI_AGAIN, UND_ERR_CONNECT_TIMEOUT,
// ERR_INVALID_URL e handshake TLS). Na dúvida, fica DE FORA: fora da lista
// é "pode ter saído", e isso nunca reenvia sozinho.
const CODIGOS_ANTES_DE_CONECTAR = new Set([
  // URL inválida: lançado antes de qualquer I/O
  'ERR_INVALID_URL',
  // DNS: não descobriu nem o endereço
  'ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL',
  // TCP: a conexão nunca foi aceita
  'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ENETDOWN', 'EADDRNOTAVAIL',
  // undici: o prazo de conexão (TCP + handshake TLS) venceu — a requisição
  // só é escrita depois do socket conectado
  'UND_ERR_CONNECT_TIMEOUT',
  // TLS: certificado ou protocolo recusado DURANTE o handshake — nenhum
  // dado de aplicação sai antes de o handshake terminar
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'CERT_REVOKED', 'CERT_UNTRUSTED', 'CERT_REJECTED',
  'CERT_SIGNATURE_FAILURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE',
  'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION', 'ERR_SSL_UNSUPPORTED_PROTOCOL', 'ERR_SSL_NO_PROTOCOLS_AVAILABLE',
])
// De fora DE PROPÓSITO (ambíguos — a requisição pode ter sido escrita e
// processada antes de cair): ECONNRESET, EPIPE, ETIMEDOUT (também vem de
// conexão já estabelecida), UND_ERR_SOCKET ("other side closed"),
// UND_ERR_HEADERS_TIMEOUT/BODY_TIMEOUT, ERR_SSL_WRONG_VERSION_NUMBER e
// qualquer TimeoutError/AbortError do AbortSignal (pode vencer a meio da
// requisição).

/** true SÓ quando a exceção de um `fetch` prova que a conexão nunca
    existiu — portanto nada foi enviado. Percorre a cadeia de `cause` e os
    `errors` de AggregateError (o Node junta as tentativas IPv4/IPv6 assim):
    exige pelo menos um código e que TODOS os códigos achados estejam na
    lista; qualquer código fora dela, ou nenhum código, é "pode ter saído". */
export function fetchFalhouAntesDeConectar(e: unknown): boolean {
  const codigos: string[] = []
  let ambiguo = false
  const visitar = (v: unknown, profundidade: number) => {
    const obj = comoObjeto(v)
    if (!obj || profundidade > 5) return
    if (obj.name === 'TimeoutError' || obj.name === 'AbortError') ambiguo = true
    const codigo = codigoDe(obj)
    if (codigo) codigos.push(codigo)
    if (Array.isArray(obj.errors)) for (const sub of obj.errors) visitar(sub, profundidade + 1)
    visitar(obj.cause, profundidade + 1)
  }
  visitar(e, 0)
  return !ambiguo && codigos.length > 0 && codigos.every(c => CODIGOS_ANTES_DE_CONECTAR.has(c))
}

// HTTP transitório do GATEWAY REST do Supabase — não do Postgres. Achado do
// teste real do coordenador (14/09/2026): o Postgres respondia perfeito
// (pg_cron a cada minuto em 50-140ms, sem erro, sem lock, sem statement
// timeout), mas o GATEWAY REST devolvia 504 isolados em menos de 1,5s —
// sete vezes em 45 min, inclusive fora do follow-up (um GET /profiles de
// tela comum também 504). 408/429 entram pela mesma lógica: prazo do lado
// do gateway, ou limite momentâneo — nenhum dos dois diz que a chamada é
// impossível, só que ESTA tentativa não coube. Um erro de negócio do
// Postgres (constraint, exceção `raise` de função, qualquer outro 4xx)
// não entra aqui: retentar não resolve o que já é definitivo.
const HTTP_TRANSITORIO_GATEWAY = new Set([408, 429, 502, 503, 504])

function statusTransitorio(status: number | undefined): boolean {
  // status 0 (ou ausente) é o que o postgrest-js devolve quando o fetch
  // nem chega a receber resposta (falha de rede) — nunca lança exceção
  // pra isso, nem em PATCH/POST/RPC (só relança AbortError, que a
  // camada acima já trata via AbortSignal.timeout do próprio chamador).
  return status === undefined || status === 0 || HTTP_TRANSITORIO_GATEWAY.has(status)
}

/** Timestamp ISO com resolução de MICROSSEGUNDO — o `Date` do JS só tem
    milissegundo (3 dígitos); os 3 dígitos extras aqui são um nonce
    aleatório, não uma medida real de tempo mais fina. Existe pra dar a
    cada carimbo uma chance de colisão ~1000x menor entre duas invocações
    que caiam no mesmo milissegundo — achado MÉDIO da Sentinela
    (14/09/2026): sem isso, `reivindicado_em`/`zapi_iniciado_em` são só
    "quando", não um token exclusivo desta chamada, e duas entregas
    concorrentes do mesmo disparo_id que colidissem no MESMO milissegundo
    poderiam se confundir uma pela outra na reconferência de "foi a minha
    escrita" (ver reivindicação e marca em web/app/api/followup/executar/
    route.ts). Não elimina a colisão matematicamente — reduz — um token
    de posse à prova d'água (UUID numa coluna própria) exigiria migration,
    fora do escopo desta tarefa; sinalizado ao coordenador. */
export function carimboUnico(): string {
  const base = new Date().toISOString() // AAAA-MM-DDTHH:mm:ss.mmmZ
  const nonce = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `${base.slice(0, -1)}${nonce}Z` // ...mmmnnnZ
}

/** Normaliza um timestamp ISO (só UTC — "Z" ou "+00:00", o único que este
    app grava) pra uma forma comparável por string, com precisão de
    microssegundo preservada — sem isso, `Date.parse` (resolução de
    milissegundo) enxergaria dois carimboUnico() diferentes que só
    variam no nonce como o MESMO instante, e a reconferência por
    "igualdade exata" (comRetentativa e reivindicação/marca em route.ts)
    adotaria a escrita ERRADA. `padEnd` reconstitui os zeros à direita que
    o Postgres/PostgREST corta ao serializar — nunca perde dígito
    significativo, porque só zero à direita é cortado. */
function normalizarTimestampUtc(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(?:Z|\+00:00)$/)
  if (!m) return null
  const [, base, fracao = ''] = m
  return `${base}.${fracao.padEnd(6, '0').slice(0, 6)}`
}

/** Compara dois timestamps ISO pelo INSTANTE (com precisão de
    microssegundo, ver normalizarTimestampUtc), nunca por igualdade de
    string crua nem por `Date.parse` puro. Achado da Sentinela
    (14/09/2026, confirmado por leitura em produção): `new Date().
    toISOString()` no app produz milissegundos + "Z" (ex.:
    2026-09-14T16:22:04.209Z), mas o PostgREST devolve `timestamptz` como
    microssegundos + "+00:00" (confirmado: 3 casas fracionárias,
    terminaZ=false, terminaOffsetUtc=true) — MESMO instante, string
    DIFERENTE. Uma comparação `===` nunca bateria, e a reconferência por
    "igualdade exata" (comRetentativa acima, e reivindicação/marca em
    web/app/api/followup/executar/route.ts) nunca adotaria nada —
    silenciosamente inofensivo (cai no comportamento conservador de
    sempre), mas nulificava o conserto. */
export function mesmoInstante(a: unknown, b: unknown): boolean {
  const na = normalizarTimestampUtc(a)
  const nb = normalizarTimestampUtc(b)
  return na !== null && na === nb
}

type RespostaSupabase = {
  data: unknown
  error: { code?: string | null; message: string; details?: string | null; hint?: string | null } | null
  status?: number
}

/** Repete uma chamada ao Supabase (select/update/rpc do supabase-js) só
    quando a falha é claramente transitória do GATEWAY REST (ver
    HTTP_TRANSITORIO_GATEWAY acima) ou falha de rede — nunca um erro de
    negócio do Postgres. Sem isto, o executor do follow-up desistia do
    ciclo inteiro na PRIMEIRA falha de rede/gateway e só voltava quando o
    lease vencia (até 17 min de atraso no teste real, 14/09/2026).

    Poucas tentativas (padrão 3) com espera CRESCENTE em segundos — 1s,
    depois 2s — bem abaixo do maxDuration=120s do executor.

    `retentou` no resultado diz se alguma tentativa ANTERIOR à última
    falhou transitoriamente. Serve pra quem grava por compare-and-set
    (reivindicação e marca de envio em web/app/api/followup/executar/
    route.ts) saber se vale a pena reconferir se a PRÓPRIA escrita de uma
    tentativa anterior já aplicou e só a confirmação se perdeu no
    gateway — sem isso, um "nenhuma linha" causado pela PRÓPRIA
    retentativa seria confundido com "outro processo já pegou", e o
    disparo ficaria abandonado (a marca ou a reivindicação gravadas, mas
    ninguém chamando o resto do trabalho) até o lease vencer sozinho —
    exatamente o atraso que esta função existe pra evitar.

    REGRA DE OURO: NUNCA chamar isto depois de zapi_iniciado_em gravado —
    reenviar a própria chamada à Z-API quebraria a garantia da 0060.
    Esta função é só para chamadas ao Supabase; enviarComoNaia nunca
    passa por aqui. */
export async function comRetentativa<
  T extends RespostaSupabase,
>(chamar: () => PromiseLike<T>, opcoes: { contexto: string; tentativas?: number }): Promise<T & { retentou: boolean }> {
  const tentativas = opcoes.tentativas ?? 3
  let retentou = false
  for (let tentativa = 1; ; tentativa++) {
    let resultado: T
    try {
      resultado = await chamar()
    } catch (e) {
      // Blindagem: supabase-js não deveria lançar pra isto (network error
      // em PATCH/POST/RPC volta como status 0 + error, não como exceção),
      // mas "não deveria" não é "não acontece nunca" — trata como
      // transitório, a mesma régua de erro de rede.
      resultado = { data: null, error: { message: `exceção inesperada: ${detalharExcecao(e)}` }, status: 0 } as T
    }
    if (!resultado.error || !statusTransitorio(resultado.status) || tentativa >= tentativas) {
      return { ...resultado, retentou }
    }
    retentou = true
    const esperaMs = tentativa * 1000
    console.error(`${opcoes.contexto}: tentativa ${tentativa}/${tentativas} falhou transitoriamente (status ${resultado.status ?? 'sem resposta'}) — nova tentativa em ${esperaMs / 1000}s:`, detalharErroSupabase(resultado.error))
    await new Promise(resolve => setTimeout(resolve, esperaMs))
  }
}
