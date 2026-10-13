import { formatarNoHorarioBrasil } from './horario-brasil'

export type TipoLembreteLuna = '1d' | '1h'

// Remove sequências emoji inteiras (inclusive bandeiras, keycaps, ZWJ e seletores)
// sem tocar no asterisco usado para negrito do WhatsApp fora de uma keycap.
const EMOJI_LUNA = /(?:[#*0-9]\uFE0F?\u20E3|[\p{Regional_Indicator}]{1,2}|[\p{Extended_Pictographic}\p{Emoji_Modifier}](?:\uFE0E|\uFE0F)?(?:\u200D[\p{Extended_Pictographic}\p{Emoji_Modifier}](?:\uFE0E|\uFE0F)?)*|[\uFE0E\uFE0F\u200D\u{E0020}-\u{E007F}])/gu
const EMOTICON_LUNA = /(?<![\p{L}\p{N}])(?::[-^']?[)(DPdpOo]|;[-^']?[)(DPdpOo]|=[)(]|[xX]-?[dD]|\^_?\^)(?=$|[^\p{L}\p{N}])/gu

/** Última barreira textual da Luna: mensagem ao lead não leva emoji nem sobra de formatação. */
export function limparMensagemLuna(texto: string) {
  return texto.replace(EMOJI_LUNA, '').replace(EMOTICON_LUNA, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Extrai URLs e seus limites no texto original, excluindo pontuação de fechamento. */
export function extrairLinksLuna(texto: string) {
  return [...texto.matchAll(/https?:\/\/\S+/gi)].map(match => {
    const url = match[0].replace(/[.,;:!?)\]"']+$/, '')
    const inicio = match.index!
    return { url, inicio, fim: inicio + url.length }
  })
}

/**
 * Separa somente nos limites que uma pessoa usaria no WhatsApp. O conteúdo
 * continua idêntico: links, horários e abreviações não são reescritos nem
 * cortados. Listas são uma estrutura única, mesmo que tenham várias frases.
 */
export function particionarMensagemLuna(texto: string) {
  const abreviacao = /(?:\b(?:sr|sra|dr|dra|prof|profa|etc|ex|av|art|p\.ex)|\b[A-ZÀ-Ú])\.$/i
  const frases = (trecho: string) => {
    const saida: string[] = []
    const links = extrairLinksLuna(trecho)
    const dentroDeLink = (indice: number) => links.some(({ inicio, fim }) => indice >= inicio && indice < fim)
    let inicio = 0
    for (let i = 0; i < trecho.length; i++) {
      const caractere = trecho[i]
      if (!/[.?!]/.test(caractere) || dentroDeLink(i)) continue
      if (caractere === '.' && !links.some(({ fim }) => fim === i) && (abreviacao.test(trecho.slice(inicio, i + 1)) || (/\d/.test(trecho[i - 1] ?? '') && /\d/.test(trecho[i + 1] ?? '')))) continue
      let fim = i + 1
      // Consome o separador no corte; cada parte é uma mensagem WhatsApp
      // independente, então espaço de borda não pode virar bolha vazia.
      while (/\s/.test(trecho[fim] ?? '')) fim++
      const frase = trecho.slice(inicio, fim)
      if (frase.trim()) saida.push(frase)
      inicio = fim
      i = fim - 1
    }
    const resto = trecho.slice(inicio)
    if (resto.trim()) saida.push(resto)
    return saida
  }
  const blocos: Array<{ texto: string; lista: boolean }> = []
  const linhas = texto.split('\n')
  let normal: string[] = []
  let lista: string[] = []
  const descarregarNormal = () => {
    const unido = normal.join('\n').trim()
    if (unido) blocos.push({ texto: unido, lista: false })
    normal = []
  }
  const descarregarLista = () => {
    const unida = lista.join('\n').trim()
    if (unida) blocos.push({ texto: unida, lista: true })
    lista = []
  }
  for (const linha of linhas) {
    const bullet = /^\s*(?:[-•*]|\d+[.)])\s+\S/.test(linha)
    if (bullet) {
      descarregarNormal()
      lista.push(linha)
    } else {
      descarregarLista()
      normal.push(linha)
    }
  }
  descarregarLista()
  descarregarNormal()

  const partes: string[] = []
  let atual: string[] = []
  const fechar = () => {
    const parte = atual.join('').trim()
    if (parte) partes.push(parte)
    atual = []
  }
  for (const bloco of blocos) {
    if (bloco.lista) {
      fechar()
      partes.push(bloco.texto)
      continue
    }
    for (const frase of frases(bloco.texto)) {
      const pergunta = /\?\s*$/.test(frase.trim())
      if (pergunta) {
        fechar()
        atual.push(frase)
        fechar()
        continue
      }
      atual.push(frase)
      if (atual.length === 2) fechar()
    }
  }
  fechar()
  return partes
}

/** Nome de tratamento usado nos textos e fatos entregues ao modelo da Luna. */
export function primeiroNomeLuna(nome: string | null | undefined) {
  return nome?.trim().split(/\s+/)[0] || null
}

function dadosDaReuniao(data: string | Date) {
  return {
    dia: formatarNoHorarioBrasil(data, { weekday: 'long', day: '2-digit', month: 'long' }),
    hora: formatarNoHorarioBrasil(data, { hour: '2-digit', minute: '2-digit', hour12: false }),
  }
}

export function saudacaoLuna(agora = new Date()) {
  const hora = Number(formatarNoHorarioBrasil(agora, { hour: '2-digit', hour12: false }))
  return hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
}

/** Substitui marcadores editáveis do lembrete com os fatos de Brasília no envio. */
export function preencherTextoLembreteLuna(texto: string, params: {
  nome: string | null | undefined
  scheduledAt: string | Date
  meetUrl: string | null | undefined
  agora?: Date
}) {
  const nome = primeiroNomeLuna(params.nome) ?? ''
  const { dia, hora } = dadosDaReuniao(params.scheduledAt)
  return texto
    .replaceAll('{primeiro_nome}', nome).replaceAll('{nome}', nome)
    .replaceAll('{saudacao}', saudacaoLuna(params.agora))
    .replaceAll('{dia}', dia).replaceAll('{hora}', hora)
    .replaceAll('{meet}', params.meetUrl?.trim() ?? '')
}

function normalizarHorarioLuna(texto: string) {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function respostaBasicaSeguraLuna(texto: string, meetUrl: string | null) {
  const limpa = limparMensagemLuna(texto)
  const links = extrairLinksLuna(limpa)
  const assuntoProibido = /\b(preços?|propostas?|qualifica(?:ção|ções|r)|contratos?|serviços?)\b/i.test(limpa)
  return limpa.length >= 2 && limpa.length <= 600 && !assuntoProibido && links.every(({ url }) => url === meetUrl?.trim()) ? limpa : null
}

/** Uma mensagem pode omitir horário; se citar, só pode citar o horário da reunião. */
export function respostaHorarioReuniaoSegura(texto: string, meetUrl: string | null, scheduledAt: string | Date) {
  const segura = respostaBasicaSeguraLuna(texto, meetUrl)
  if (!segura) return null
  const horaPermitida = formatarNoHorarioBrasil(scheduledAt, { hour: '2-digit', minute: '2-digit', hour12: false })
  const diaPermitido = normalizarHorarioLuna(formatarNoHorarioBrasil(scheduledAt, { weekday: 'long' })).match(/segunda|terca|quarta|quinta|sexta/)?.[0]
  const meses = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro'
  const dataPermitida = normalizarHorarioLuna(formatarNoHorarioBrasil(scheduledAt, { day: '2-digit', month: 'long' })).match(new RegExp(`\\d{2} de (?:${meses})`))?.[0]
  const horas = [...segura.matchAll(/\b([01]?\d|2[0-3])\s*(?::|h(?!\p{L}))\s*([0-5]\d)?\b/giu)]
    .map(match => `${match[1].padStart(2, '0')}:${match[2] ?? '00'}`)
  const horasCurtas = [...segura.matchAll(/\b(?:às|as)\s+([01]?\d|2[0-3])\b/gi)].map(match => `${match[1].padStart(2, '0')}:00`)
  if ([...horas, ...horasCurtas].some(hora => hora !== horaPermitida)) return null
  const normalizada = normalizarHorarioLuna(segura)
  const dias = normalizada.match(/segunda|terca|quarta|quinta|sexta/g) ?? []
  if (dias.some(dia => dia !== diaPermitido)) return null
  const datas = normalizada.match(new RegExp(`\\b\\d{1,2} de (?:${meses})`, 'g')) ?? []
  if (datas.some(data => data.padStart(2, '0') !== dataPermitida)) return null
  return segura
}

/** Fallback factual para falha do modelo ou do texto editável. */
export const TEXTOS_LEMBRETE_LUNA: Record<TipoLembreteLuna, readonly [string, string, string]> = {
  '1d': [
    'Olá {primeiro_nome}! {saudacao}. Amanhã temos nosso encontro marcado às {hora}. Se precisar remarcar ou de qualquer coisa, me avise.',
    'Oi, {primeiro_nome}! {saudacao}. Passando para lembrar do nosso encontro amanhã, às {hora}. Se precisar remarcar ou tiver alguma dúvida, é só me falar.',
    '{saudacao}, {primeiro_nome}! Amanhã, às {hora}, temos o nosso encontro. Se precisar mudar o horário ou de qualquer outra coisa, me avise por aqui.',
  ],
  '1h': [
    'Olá {primeiro_nome}! {saudacao}. Nosso encontro é daqui a 1 hora. Esse é o link da nossa reunião: {meet}. Se precisar de alguma coisa, me avise.',
    'Oi, {primeiro_nome}! {saudacao}. Falta 1 hora para o nosso encontro. O link da reunião é este: {meet}. Qualquer coisa, é só me chamar.',
    '{saudacao}, {primeiro_nome}! Daqui a 1 hora começa a nossa reunião. Para entrar, é só usar este link: {meet}. Se precisar de algo, me avise por aqui.',
  ],
}

/** Fallback literal: usa a mesma variante aprovada que o texto vigente. */
export function textoLembreteLuna(tipo: TipoLembreteLuna, params: {
  nome: string | null
  scheduledAt: string | Date
  meetUrl: string | null
  variante?: number
  agora?: Date
}) {
  const indice = Math.max(0, Math.min(2, (params.variante ?? 1) - 1))
  return preencherTextoLembreteLuna(TEXTOS_LEMBRETE_LUNA[tipo][indice], params)
}

/** Guarda-corpo determinístico do lembrete escrito pelo modelo. */
export function validarLembreteLuna(mensagem: string, params: { tipo: TipoLembreteLuna; scheduledAt: string | Date; meetUrl: string | null }) {
  const m = respostaHorarioReuniaoSegura(mensagem, params.meetUrl, params.scheduledAt)
  if (!m || m.length < 10 || m.length > 600) return false
  if (params.tipo === '1h' && params.meetUrl?.trim() && !m.includes(params.meetUrl.trim())) return false
  const links = extrairLinksLuna(m)
  return !links.some(({ url }) => url !== params.meetUrl?.trim()) && !/\b(preço|proposta|qualifica(?:ção|r)|contrato)\b/i.test(m)
}

export function textoAvisoInternoLuna(tipo: TipoLembreteLuna, params: {
  lead: string | null
  empresa: string | null
  scheduledAt: string | Date
  opportunityId: string
}) {
  const { dia, hora } = dadosDaReuniao(params.scheduledAt)
  const pessoa = params.lead?.trim() || 'Lead sem nome'
  const empresa = params.empresa?.trim() || 'Empresa não informada'
  const cabecalho = tipo === '1d'
    ? `*REUNIÃO AMANHÃ* — ${pessoa} (${empresa}) ${dia} às ${hora}`
    : `*REUNIÃO EM 1 HORA* — ${pessoa} (${empresa}) às ${hora}`
  return `${cabecalho}\nAcesse: https://nova-acao-crm.vercel.app/lead/${params.opportunityId}`
}

export function textoAlertaLuna(status: 'falhou' | 'indeterminado', params: {
  tipo: TipoLembreteLuna
  lead: string | null
  empresa: string | null
  scheduledAt: string | Date
  opportunityId: string
  motivo: string
}) {
  const { hora } = dadosDaReuniao(params.scheduledAt)
  const pessoa = params.lead?.trim() || 'Lead sem nome'
  const empresa = params.empresa?.trim() || 'Empresa não informada'
  const quando = params.tipo === '1d' ? '1 DIA' : '1 HORA'
  const titulo = status === 'indeterminado' ? '*LEMBRETE INDETERMINADO*' : '*LEMBRETE FALHOU*'
  return `${titulo} — ${quando} — ${pessoa} (${empresa}) às ${hora}\nMotivo: ${params.motivo}\nAcesse: https://nova-acao-crm.vercel.app/lead/${params.opportunityId}`
}
