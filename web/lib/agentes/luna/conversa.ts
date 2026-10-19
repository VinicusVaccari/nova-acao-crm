import 'server-only'
import { setTimeout as dormir } from 'node:timers/promises'
import { db } from '@/lib/db'
import { listarEventosSeguro, atualizarEvento, cancelarEvento, type EventoAgenda } from '@/lib/google'
import { calcularSlotsLuna, calcularSlotsLunaNaData, diasComSlotsLuna, espalharSlotsLuna, extrairDiaSemanaLuna, motivoRegraAgendaLuna, resolverDataPedidoLuna, slotEstaDisponivelLuna, type SlotLuna } from '@/lib/luna-agenda'
import { dataHoraBrasilParaIso, formatarNoHorarioBrasil } from '@/lib/horario-brasil'
import { criarTarefaNaia, hoje9hBrasil } from '@/lib/naia-tarefa'
import { extrairLinksLuna, limparMensagemLuna, primeiroNomeLuna, respostaHorarioReuniaoSegura as respostaHorarioReuniaoSeguraLuna } from '@/lib/luna'
import { enviarMensagemLunaPartida } from './envio'
import { interpretarLuna, VERSAO } from './gerar'
import { criarOrcamentoLuna, prazoEtapaLuna, finalizarNoPrazoLuna, OrcamentoLunaEsgotado, type OrcamentoLuna } from './orcamento'
import { avisarGrupoLuna } from './avisos'

type Intencao = 'confirma' | 'remarcar' | 'cancelar' | 'duvida' | 'outro'
type Oferta = { id: number; slots: SlotLuna[]; rodada: number; validade: string; usada_em: string | null; criada_em?: string }
type Reuniao = { id: string; opportunity_id: string; scheduled_at: string; status: string; external_event_id: string | null; meeting_url: string | null; luna_passou_para_humano_em?: string | null; limiteEnvioEm?: number; orcamento?: OrcamentoLuna; opportunities?: { person_id?: string; lost_at: string | null; paused_at: string | null; atendimento?: string | null; people?: { full_name: string | null } | null; companies?: { trade_name: string | null } | null } | null }
type LembreteEnviado = { status: string; enviado_em: string | null; motivo: string | null }
type MensagemNossa = { is_automated: boolean | null; occurred_at: string }

const LIMITE_DIAS_AGENDA = 21
const EMAIL_RODRIGUES = 'rodrigues@agencianovaacao.com.br'

function presenteBrasil(agora = new Date()) {
  return {
    agora_brasil: formatarNoHorarioBrasil(agora, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
    hoje: formatarNoHorarioBrasil(agora, { day: '2-digit', month: '2-digit', year: 'numeric' }),
    dia_semana_hoje: formatarNoHorarioBrasil(agora, { weekday: 'long' }),
    hora_atual_brasil: formatarNoHorarioBrasil(agora, { hour: '2-digit', minute: '2-digit', hour12: false }),
  }
}

const VARIACOES_FIXAS_LUNA = {
  falha_agenda: ['Não consegui confirmar os horários agora. Vou pedir para o Rodrigues verificar e voltar com você.', 'Não consegui consultar a agenda agora. Vou pedir ao Rodrigues para conferir e te responder por aqui.', 'Tive um problema para ver os horários agora. O Rodrigues vai verificar e volta a falar com você.'],
  terceira_rodada: ['Vou confirmar um horário com o Rodrigues e ele volta com você por aqui.', 'Vou alinhar um horário com o Rodrigues, e ele te responde por aqui.', 'Deixa eu ver com o Rodrigues o melhor horário. Ele volta a falar com você por aqui.'],
  repeticao: ['O Rodrigues vai continuar por aqui para encontrar o melhor horário.', 'O Rodrigues vai seguir com você por aqui para acertarmos o horário.', 'A partir daqui, o Rodrigues continua com você para achar o melhor horário.'],
  pergunta_dia: ['Qual dia da semana fica melhor para você?', 'Que dia da semana seria melhor para você?', 'Qual dia da semana você prefere?'],
  dias_disponiveis: ['Na {dias}, tenho horários. Qual dia você prefere?', 'Tenho horários na {dias}. Qual deles fica melhor para você?', 'Os dias com horário livre são {dias}. Qual você prefere?'],
  fim_de_semana: ['Como {dia} é fim de semana, não temos horário disponível nesse dia.', 'Não atendemos no fim de semana, então {dia} não tem horário.', '{Dia} cai no fim de semana, e nesse dia não temos atendimento.'],
  fora_do_expediente: ['Atendemos de segunda a sexta, das 9h até 17h30.', 'Nosso horário de atendimento é de segunda a sexta, das 9h às 17h30.', 'As reuniões acontecem de segunda a sexta, entre 9h e 17h30.'],
  antecedencia: ['Esse horário já passou ou está muito em cima.', 'Esse horário está em cima da hora ou já passou.', 'Para esse horário já não dá tempo de organizar.'],
  ocupado: ['Esse horário não está livre.', 'Esse horário já está ocupado.', 'Nesse horário a agenda já está tomada.'],
  confirmacao: ['Perfeito, sua presença está confirmada.', 'Combinado, presença confirmada.', 'Ótimo, sua presença está confirmada.'],
  cancelamento: ['Tudo certo, sua reunião foi cancelada.', 'Pronto, a nossa reunião foi cancelada.', 'Combinado, cancelei a nossa reunião.'],
  remarcacao: ['Perfeito, sua reunião foi remarcada para {quando}.', 'Combinado, reagendei nossa reunião para {quando}.', 'Pronto, nosso encontro ficou para {quando}.'],
  oferta: ['', '', ''],
} as const
type PontoVariacaoLuna = keyof typeof VARIACOES_FIXAS_LUNA | 'oferta'
type VariacaoFixaLuna = { ponto: PontoVariacaoLuna; variante: number } | null

export function indiceVariacaoLuna(ultima: number | null, aleatorio = Math.random) {
  const opcoes = [1, 2, 3].filter(variante => variante !== ultima)
  return opcoes[Math.min(opcoes.length - 1, Math.floor(aleatorio() * opcoes.length))]!
}

async function escolherTextoFixoLuna(reuniao: Reuniao, ponto: PontoVariacaoLuna, preencher: (texto: string) => string) {
  const personId = reuniao.opportunities?.person_id
  let ultima: number | null = null
  if (personId) {
    const { data, error } = await db.from('luna_variacoes_lead').select('variante').eq('person_id', personId).eq('ponto', ponto).order('enviado_em', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle()
    if (error) console.error('luna: não foi possível ler a última variação fixa:', error.message)
    else if (typeof data?.variante === 'number') ultima = data.variante
  }
  const variante = indiceVariacaoLuna(ultima)
  return { texto: preencher(VARIACOES_FIXAS_LUNA[ponto][variante - 1]), variacao: personId ? { ponto, variante } as VariacaoFixaLuna : null }
}

async function registrarVariacaoFixaLuna(reuniao: Reuniao, variacao: VariacaoFixaLuna) {
  const personId = reuniao.opportunities?.person_id
  if (!personId || !variacao) return
  const { error } = await db.from('luna_variacoes_lead').insert({ person_id: personId, ponto: variacao.ponto, variante: variacao.variante })
  if (error) console.error('luna: não foi possível registrar a variação enviada:', error.message)
}

function quandoDaRemarcacaoLuna(inicio: Date) {
  return formatarNoHorarioBrasil(inicio, { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false })
}

async function escolherTextoRemarcacaoLuna(reuniao: Reuniao, inicio: Date) {
  const quando = quandoDaRemarcacaoLuna(inicio)
  return escolherTextoFixoLuna(reuniao, 'remarcacao', texto => texto.replace('{quando}', quando))
}

async function escolherTextoOfertaLuna(reuniao: Reuniao, slots: SlotLuna[], motivo: MotivoIndisponivelLuna | null, diaPedido: string | null) {
  const escolha = await escolherTextoFixoLuna(reuniao, 'oferta', () => '')
  return { texto: textoOferta(slots, motivo, diaPedido, escolha.variacao?.variante ?? 1), variacao: escolha.variacao }
}
export type MotivoIndisponivelLuna = 'fim_de_semana' | 'fora_do_expediente' | 'antecedencia' | 'ocupado'
type ReferenciaPedidoLuna = { diaPedido: string | null; dataPedido?: string | null; horaPedida: string | null; motivoIndisponivel: MotivoIndisponivelLuna | null }

function nomeDiaLuna(dia: string | null) {
  return ({ segunda: 'segunda-feira', terca: 'terça-feira', quarta: 'quarta-feira', quinta: 'quinta-feira', sexta: 'sexta-feira', sabado: 'sábado', domingo: 'domingo' } as Record<string, string>)[dia ?? ''] ?? null
}

function aberturaOfertaIndisponivel(motivo: MotivoIndisponivelLuna, diaPedido: string | null, variante: number) {
  const texto = VARIACOES_FIXAS_LUNA[motivo][variante - 1] ?? VARIACOES_FIXAS_LUNA[motivo][0]
  const dia = nomeDiaLuna(diaPedido) ?? 'o dia pedido'
  return texto.replaceAll('{dia}', dia).replaceAll('{Dia}', dia.charAt(0).toUpperCase() + dia.slice(1))
}

function horaCurtaDoSlot(slot: SlotLuna) {
  const [hora, minuto] = horaDoSlot(slot).split(':')
  return minuto === '00' ? `${Number(hora)}h` : `${Number(hora)}h${minuto}`
}

function listaNaturalLuna(itens: string[], separador = ', ') {
  if (itens.length <= 1) return itens[0] ?? ''
  if (itens.length === 2) return `${itens[0]} ou ${itens[1]}`
  return `${itens.slice(0, -1).join(separador)} ou ${itens.at(-1)}`
}

export function textoOferta(slots: SlotLuna[], motivoIndisponivel: MotivoIndisponivelLuna | null = null, diaPedido: string | null = null, variante = 1) {
  const diaOferta = slots[0] ? formatarNoHorarioBrasil(slots[0].iso, { weekday: 'long' }) : null
  const abertura = motivoIndisponivel ? `${aberturaOfertaIndisponivel(motivoIndisponivel, diaPedido, variante)} ` : ''
  const horas = listaNaturalLuna(slots.map(horaCurtaDoSlot))
  if (variante === 2) return `${abertura}Na ${diaOferta ?? 'agenda disponível'}, consigo às ${horas}. Qual horário você prefere?`
  if (variante === 3) return `${abertura}Tenho ${horas} na ${diaOferta ?? 'agenda disponível'}. Qual deles fica melhor para você?`
  return `${abertura}Na ${diaOferta ?? 'agenda disponível'}, tenho ${horas}. Qual fica melhor para você?`
}
/** Rede de segurança: o modelo decide pelo campo estruturado; esta heurística
    cobre uma classificação excepcionalmente errada sem voltar a ser a regra. */
function pedeDisponibilidadePorRegexLuna(texto: string) {
  const normalizado = normalizarTexto(texto)
  const comercial = /\b(?:precos?|propostas?|servicos?|contratos?|qualificacao|cobranca)\b/.test(normalizado)
  return !comercial && (/\b(?:quais?|que)\s+(?:dias?|horarios?)\b/.test(normalizado) || /\b(?:dias?|horarios?)\b[\s\S]*\b(?:disponiveis?|livres?|tem|ha|existem)\b/.test(normalizado) || /\bquais?\b[\s\S]*\b(?:tem|disponiveis?|livres?)\b/.test(normalizado))
}
export function respostaSegura(texto: string, meetUrl: string | null) {
  const t = limparMensagemLuna(texto)
  const links = extrairLinksLuna(t)
  const assuntoProibido = /\b(preços?|propostas?|qualifica(?:ção|ções|r)|contratos?|serviços?)\b/i.test(t)
  return t.length >= 2 && t.length <= 600 && !assuntoProibido && links.every(({ url }) => url === meetUrl?.trim()) ? t : null
}

function horaDoSlot(slot: SlotLuna) {
  return formatarNoHorarioBrasil(slot.iso, { hour: '2-digit', minute: '2-digit', hour12: false })
}

function normalizarTexto(texto: string) {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function fatosDeHorarioNoTexto(texto: string) {
  const horas = [...texto.matchAll(/\b([01]?\d|2[0-3])\s*(?::|h(?!\p{L}))\s*([0-5]\d)?\b/giu)]
    .map(match => `${match[1].padStart(2, '0')}:${match[2] ?? '00'}`)
  const horasCurtas = [...texto.matchAll(/\b(?:\u00e0s|as)\s+([01]?\d|2[0-3])\b(?!\s*(?::|h))/gi)].map(match => `${match[1].padStart(2, '0')}:00`)
  const normalizado = normalizarTexto(texto)
  const dias = normalizado.match(/segunda|terca|quarta|quinta|sexta|sabado|domingo/g) ?? []
  const meses = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro'
  const datas = normalizado.match(new RegExp(`\\b\\d{1,2} de (?:${meses})`, 'g')) ?? []
  return { horas, horasCurtas, dias, datas, meses }
}

/** Remove somente a explicação canônica de expediente antes de conferir fatos ofertados. */
function neutralizarExpedienteLuna(texto: string) {
  return normalizarTexto(texto)
    .replace(/\bde segunda(?:-feira)? a sexta(?:-feira)?\b/gu, '')
    .replace(/\bdas\s+0?9(?:h(?:00)?|:00)?\s+(?:ate|as|a)\s+17(?:h30|:30)\b/gu, '')
    .replace(/\bentre\s+0?9(?:h(?:00)?|:00)?\s+e\s+17(?:h30|:30)\b/gu, '')
}

function diaSemanaDaDataPedidoLuna(dataPedido: string | null | undefined) {
  const iso = dataPedido ? dataHoraBrasilParaIso(`${dataPedido}T12:00`) : null
  return iso ? extrairDiaSemanaLuna(formatarNoHorarioBrasil(iso, { weekday: 'long' })) : null
}

function textoSoCitaHorariosPermitidos(texto: string, slots: SlotLuna[]) {
  const { horas, horasCurtas, dias, datas, meses } = fatosDeHorarioNoTexto(texto)
  const horasPermitidas = new Set(slots.map(horaDoSlot))
  if (horas.some(hora => !horasPermitidas.has(hora)) || horasCurtas.some(hora => !horasPermitidas.has(hora))) return false
  const diasPermitidos = new Set(slots.map(slot => normalizarTexto(slot.rotulo).match(/segunda|terca|quarta|quinta|sexta|sabado|domingo/)?.[0]).filter(Boolean))
  if (dias.some(dia => !diasPermitidos.has(dia))) return false
  const datasPermitidas = slots.map(slot => normalizarTexto(slot.rotulo).match(new RegExp(`\\d{2} de (?:${meses})`))?.[0]).filter(Boolean)
  return !datas.some(data => !datasPermitidas.includes(data.padStart(2, '0')))
}

/** Confirmação/cancelamento não pode prometer data ou hora diferente da reunião. */
export function respostaHorarioReuniaoSegura(texto: string, meetUrl: string | null, scheduledAt: string) {
  return respostaHorarioReuniaoSeguraLuna(texto, meetUrl, scheduledAt)
}

/** Oferta é texto do modelo, mas cada data e hora continua sendo do servidor. */
export function validarOfertaLuna(resposta: string, isosEscolhidos: unknown, candidatos: SlotLuna[], meetUrl: string | null, referenciaPedido: ReferenciaPedidoLuna | null = null) {
  const segura = respostaSegura(resposta, meetUrl)
  if (!segura || !Array.isArray(isosEscolhidos) || !isosEscolhidos.length || !isosEscolhidos.every(iso => typeof iso === 'string')) return null
  if (referenciaPedido?.diaPedido && /^(segunda|terca|quarta|quinta|sexta)$/.test(referenciaPedido.diaPedido)) {
    const dia = referenciaPedido.diaPedido
    const chamaDiaUtilDeFimDeSemana = new RegExp(`\\b${dia}(?:-feira)?\\b[\\s\\S]{0,40}\\b(?:e|é)\\s+(?:um )?fim de semana\\b|\\bfim de semana\\b[\\s\\S]{0,40}\\b${dia}(?:-feira)?\\b`, 'i')
    if (chamaDiaUtilDeFimDeSemana.test(normalizarTexto(segura))) return null
  }
  // Structured Outputs não garante uniqueItems. Repetição não muda a oferta;
  // removemos o ruído e continuamos limitando o conjunto real a três slots.
  const isos = [...new Set(isosEscolhidos)]
  if (isos.length > 3) return null
  const escolhidos = isos.map(iso => candidatos.find(slot => slot.iso === iso)).filter((slot): slot is SlotLuna => !!slot)
  if (escolhidos.length !== isos.length) return null

  const horaPedida = referenciaPedido?.horaPedida ? fatosDeHorarioNoTexto(referenciaPedido.horaPedida) : { horas: [], horasCurtas: [] }
  const horasPermitidas = new Set([...escolhidos.map(horaDoSlot), ...horaPedida.horas, ...horaPedida.horasCurtas])
  const textoValidado = neutralizarExpedienteLuna(segura)
  const horasCitadas = [...textoValidado.matchAll(/\b([01]?\d|2[0-3])\s*(?::|h(?!\p{L}))\s*([0-5]\d)?\b/giu)]
    .map(match => `${match[1].padStart(2, '0')}:${match[2] ?? '00'}`)
  if (horasCitadas.some(hora => !horasPermitidas.has(hora))) return null
  const horasCurtas = [...textoValidado.matchAll(/\b(?:às|as)\s+([01]?\d|2[0-3])\b(?!\s*(?::|h))/gi)].map(match => `${match[1].padStart(2, '0')}:00`)
  if (horasCurtas.some(hora => !horasPermitidas.has(hora))) return null

  const texto = textoValidado
  const diasPermitidos = new Set(escolhidos.map(slot => normalizarTexto(slot.rotulo).match(/segunda|terca|quarta|quinta|sexta|sabado|domingo/)?.[0]).filter(Boolean))
  const diaFimDeSemana = referenciaPedido?.motivoIndisponivel === 'fim_de_semana'
    ? diaSemanaDaDataPedidoLuna(referenciaPedido.dataPedido) ?? referenciaPedido.diaPedido
    : null
  if (diaFimDeSemana && /^(sabado|domingo)$/.test(diaFimDeSemana)) diasPermitidos.add(diaFimDeSemana)
  else if (referenciaPedido?.diaPedido && referenciaPedido.motivoIndisponivel !== 'fim_de_semana') diasPermitidos.add(referenciaPedido.diaPedido)
  const diasCitados = texto.match(/segunda|terca|quarta|quinta|sexta|sabado|domingo/g) ?? []
  if (diasCitados.some(dia => !diasPermitidos.has(dia))) return null
  const meses = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro'
  const datasPermitidas = escolhidos.map(slot => normalizarTexto(slot.rotulo).match(new RegExp(`\\d{2} de (?:${meses})`))?.[0]).filter(Boolean)
  const datasCitadas = texto.match(new RegExp(`\\b\\d{1,2} de (?:${meses})`, 'g')) ?? []
  if (datasCitadas.some(data => !datasPermitidas.includes(data.padStart(2, '0')))) return null
  const mesmoDia = new Set(datasPermitidas).size === 1
  if (mesmoDia) {
    const horasMencionadas = new Set([...horasCitadas, ...horasCurtas])
    if (!escolhidos.every(slot => horasMencionadas.has(horaDoSlot(slot)))) return null
  } else if (!escolhidos.every(slot => segura.includes(slot.rotulo))) return null
  return escolhidos
}

function slotsEstruturadosLuna(isosEscolhidos: unknown, candidatos: SlotLuna[]) {
  if (!Array.isArray(isosEscolhidos) || !isosEscolhidos.length || !isosEscolhidos.every(iso => typeof iso === 'string')) return null
  const isos = [...new Set(isosEscolhidos)]
  if (isos.length > 3) return null
  const escolhidos = isos.map(iso => candidatos.find(slot => slot.iso === iso)).filter((slot): slot is SlotLuna => !!slot)
  return escolhidos.length === isos.length ? escolhidos : null
}

function isoDoPedidoRelativo(texto: string, dataRelativa: string | null) {
  if (!dataRelativa) return null
  const fatos = fatosDeHorarioNoTexto(texto)
  const hora = fatos.horas[0] ?? fatos.horasCurtas[0]
  return hora ? dataHoraBrasilParaIso(`${dataRelativa}T${hora}`) : null
}

function horaHumanaLuna(hora: string | null) {
  if (!hora) return null
  const [h, m] = hora.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

export function motivoIndisponivelLuna(params: { horarioPedido: string | null; textoLead: string; slotPedido: string | null; candidatos: SlotLuna[]; agora?: Date }): MotivoIndisponivelLuna | null {
  const textoPedido = `${params.horarioPedido ?? ''} ${params.textoLead}`
  const fatos = fatosDeHorarioNoTexto(textoPedido)
  const horaPedida = fatos.horas[0] ?? fatos.horasCurtas[0] ?? null
  const agora = params.agora ?? new Date()
  const { diaPedido, dataPedido } = resolverDataPedidoLuna(textoPedido, agora)
  if (diaPedido === 'sabado' || diaPedido === 'domingo') return 'fim_de_semana'
  const isoRelativo = isoDoPedidoRelativo(textoPedido, dataPedido)
  const motivoRegra = isoRelativo ? motivoRegraAgendaLuna(isoRelativo, agora) : null
  if (motivoRegra) return motivoRegra
  if (isoRelativo && !params.candidatos.some(slot => slot.iso === isoRelativo)) return 'ocupado'
  if (params.slotPedido && !params.candidatos.some(slot => slot.iso === params.slotPedido)) {
    const motivoDoSlot = motivoRegraAgendaLuna(params.slotPedido, agora)
    return motivoDoSlot ?? 'ocupado'
  }
  return null
}

function motivoIndisponivelCoerenteLuna(motivo: MotivoIndisponivelLuna | null, diaPedido: string | null, textoPedido: string, dataPedido: string | null, agora = new Date()) {
  if (motivo !== 'fim_de_semana' || !diaPedido || !/^(segunda|terca|quarta|quinta|sexta)$/.test(diaPedido)) return motivo
  console.error(`luna: motivo incoerente para ${diaPedido}; recalculando`)
  const iso = isoDoPedidoRelativo(textoPedido, dataPedido)
  const recalculado = iso ? motivoRegraAgendaLuna(iso, agora) : null
  return recalculado && recalculado !== 'fim_de_semana' ? recalculado : 'ocupado'
}

/** Disponibilidade nomeia dias autorizados, sem antecipar uma oferta de horários. */
export function validarDiasDisponiveisLuna(resposta: string, diasEscolhidos: unknown, diasDisponiveis: string[], meetUrl: string | null) {
  const segura = respostaSegura(resposta, meetUrl)
  if (!segura || !Array.isArray(diasEscolhidos) || !diasEscolhidos.length || !diasEscolhidos.every(dia => typeof dia === 'string')) return null
  const diasDoModelo = diasEscolhidos as string[]
  if (diasDoModelo.length !== diasDisponiveis.length || diasDoModelo.some((dia, indice) => normalizarTexto(dia) !== normalizarTexto(diasDisponiveis[indice]))) return null
  const esperados = diasDisponiveis.map(dia => extrairDiaSemanaLuna(dia)).filter((dia): dia is string => !!dia)
  if (esperados.length !== diasDisponiveis.length) return null
  const fatos = fatosDeHorarioNoTexto(segura)
  const diasMencionados: string[] = fatos.dias
  const datasEsperadas = diasDisponiveis.map(dia => normalizarTexto(dia).match(/\b\d{1,2} de \p{L}+/u)?.[0]).filter((dia): dia is string => !!dia)
  if (fatos.horas.length || fatos.horasCurtas.length || fatos.datas.some(data => !datasEsperadas.includes(data)) ||
    diasMencionados.length !== esperados.length || diasMencionados.some((dia, indice) => dia !== esperados[indice]) ||
    datasEsperadas.some(data => !normalizarTexto(segura).includes(data))) return null
  return diasDoModelo
}

/** A conversa só é nossa quando a última mensagem de saída foi automatizada.
    `is_automated` é a marca gravada por enviarComoNaia nos disparos da MEL e
    nos lembretes; uma saída humana a posteriori faz a Luna sair de cena. */
export function fronteiraConversaLuna(params: {
  modo: string
  lembretes: LembreteEnviado[]
  ultimaMensagemNossa: MensagemNossa | null
  houveMensagemHumanaAposLembrete: boolean
  houvePassagemParaHumanoAposLembrete: boolean
}) {
  if (params.modo === 'sombra') return { permite: false, motivo: 'modo_sombra' as const }
  const lembreteReal = params.lembretes.find(lembrete =>
    lembrete.status === 'enviado' && !!lembrete.enviado_em && !String(lembrete.motivo ?? '').startsWith('modo_sombra:'),
  )
  if (!lembreteReal) return { permite: false, motivo: 'sem_lembrete_real' as const }
  if (params.houveMensagemHumanaAposLembrete) return { permite: false, motivo: 'intervencao_humana' as const }
  if (params.houvePassagemParaHumanoAposLembrete) return { permite: false, motivo: 'passagem_humano' as const }
  if (!params.ultimaMensagemNossa?.is_automated) return { permite: false, motivo: 'intervencao_humana' as const }
  return { permite: true, motivo: 'lembrete_ultima_palavra' as const }
}
function inicioDoDia() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }
function fimAgenda() { return new Date(Date.now() + LIMITE_DIAS_AGENDA * 24 * 60 * 60 * 1000).toISOString() }
function eventosLuna(eventos: EventoAgenda[]) { return eventos.map(e => ({ inicio: e.inicio, fim: e.fim, diaInteiro: e.diaInteiro })) }

function destinoAvisoLuna(reuniao: Reuniao) {
  const o = reuniao.opportunities
  return {
    meetingId: reuniao.id, opportunityId: reuniao.opportunity_id,
    lead: o?.people?.full_name ?? null, empresa: o?.companies?.trade_name ?? null,
    limiteEm: reuniao.orcamento ? reuniao.orcamento.limiteEm - 2000 : undefined,
  }
}

async function registrarPassagemParaHumano(reuniao: Reuniao) {
  const { error } = await db.from('meetings')
    .update({ luna_passou_para_humano_em: new Date().toISOString() }).eq('id', reuniao.id)
  if (error) console.error('luna: não foi possível registrar a passagem para o Rodrigues:', error.message)
}

async function criarTarefa(reuniao: Reuniao, assunto: string, descricao: string) {
  const criacao = criarTarefaNaia({ oppId: reuniao.opportunity_id, assunto, descricao, prazo: hoje9hBrasil(), responsavel: EMAIL_RODRIGUES, tipo: 'reuniao' })
  try {
    const tarefa = await (reuniao.orcamento ? finalizarNoPrazoLuna(criacao, reuniao.orcamento.limiteEm - 2000, 'criação de tarefa') : criacao)
    if (!tarefa.ok) console.error('luna: tarefa não criada:', tarefa.erro)
  } catch (erro) { console.error('luna: tarefa não confirmada antes do prazo:', erro) }
}

async function registrar(params: { reuniao: Reuniao; intencao: Intencao; horario?: string | null; slotPedido?: string | null; slot?: string | null; resposta?: string; respondeu?: boolean; modelo: string; tokensEntrada: number | null; tokensSaida: number | null; custo: number | null; erro?: string | null }) {
  const { error } = await db.from('luna_interacoes').insert({
    meeting_id: params.reuniao.id, opportunity_id: params.reuniao.opportunity_id, prompt_versao: VERSAO,
    modelo: params.modelo, intencao: params.intencao, horario_pedido: params.horario ?? null, slot_pedido: params.slotPedido ?? null,
    slot_escolhido: params.slot ?? null, resposta: params.resposta ?? null, respondeu: params.respondeu ?? false,
    tokens_entrada: params.tokensEntrada, tokens_saida: params.tokensSaida, custo_usd: params.custo, erro: params.erro ?? null,
  })
  if (error) console.error('luna: interação não registrada:', error.message)
}

export function respostasPraticamenteIguaisLuna(anterior: string | null | undefined, proxima: string) {
  const normalizar = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
  return !!anterior && normalizar(anterior) === normalizar(proxima)
}

async function enviarResposta(reuniao: Reuniao, telefone: string, resposta: string, variacao: VariacaoFixaLuna = null) {
  prazoEtapaLuna(reuniao.orcamento, 'espera da lease de telefone', 20_000, 250)
  const mensagem = limparMensagemLuna(resposta)
  if (mensagem.length < 2) {
    console.warn('luna: resposta ficou vazia após remover emoji')
    await avisarGrupoLuna({ tipo: 'luna_sem_resposta', ...destinoAvisoLuna(reuniao), detalhe: 'A resposta ficou sem conteúdo após remover emoji.' })
    return false
  }
  const { data: ultimaAutomatica, error: ultimaAutomaticaErro } = await db.from('activities').select('body')
    .eq('opportunity_id', reuniao.opportunity_id).eq('direction', 'outbound').eq('is_automated', true)
    .order('occurred_at', { ascending: false }).limit(1).maybeSingle()
  if (ultimaAutomaticaErro) console.error('luna: não foi possível ler a última resposta automática:', ultimaAutomaticaErro.message)
  if (respostasPraticamenteIguaisLuna(ultimaAutomatica?.body, mensagem)) {
    const escolhida = await escolherTextoFixoLuna(reuniao, 'repeticao', texto => texto)
    const escalacao = limparMensagemLuna(escolhida.texto)
    await avisarGrupoLuna({ tipo: 'passou_para_humano', ...destinoAvisoLuna(reuniao), detalhe: 'A resposta automática foi bloqueada para evitar repetição.' })
    await criarTarefa(reuniao, 'Luna repetiu resposta — continuar reunião', 'A Luna tentou repetir a última mensagem automática e foi escalada para evitar loop.')
    const maxEsperaMs = prazoEtapaLuna(reuniao.orcamento, 'espera da lease de telefone', 20_000, 250) - Date.now()
    const envioEscalacao = await enviarMensagemLunaPartida({ telefone, mensagem: escalacao, opportunityId: reuniao.opportunity_id, limiteEnvioEm: reuniao.limiteEnvioEm, maxEsperaMs })
    if (envioEscalacao.ok) {
      await registrarPassagemParaHumano(reuniao)
      await registrarVariacaoFixaLuna(reuniao, escolhida.variacao)
    }
    if (!envioEscalacao.ok) {
      console.warn('luna: escalonamento por repetição recusado:', envioEscalacao.envio.erro)
      await avisarGrupoLuna({ tipo: 'luna_sem_resposta', ...destinoAvisoLuna(reuniao), detalhe: envioEscalacao.envio.erro ?? 'Z-API recusou o envio' })
    }
    return envioEscalacao.ok
  }
  // Emoji e a trava de repetição já foram aplicados acima ao texto inteiro.
  // Só agora ele pode ser dividido para o transporte sem furar essas travas.
  const maxEsperaMs = prazoEtapaLuna(reuniao.orcamento, 'espera da lease de telefone', 20_000, 250) - Date.now()
  const envio = await enviarMensagemLunaPartida({ telefone, mensagem, opportunityId: reuniao.opportunity_id, limiteEnvioEm: reuniao.limiteEnvioEm, maxEsperaMs })
  if (envio.adiado && reuniao.orcamento) throw new OrcamentoLunaEsgotado('lease de telefone indisponível no orçamento')
  if (!envio.ok) {
    console.warn('luna: resposta ao lead recusada:', envio.envio.erro)
    await avisarGrupoLuna({ tipo: 'luna_sem_resposta', ...destinoAvisoLuna(reuniao), detalhe: envio.envio.erro ?? 'Z-API recusou o envio' })
  }
  if (envio.ok) await registrarVariacaoFixaLuna(reuniao, variacao)
  return envio.ok
}

/** Uma segunda tentativa só pode ajustar as palavras; a ação permanece do servidor. */
async function respostaAcaoComHorarioSeguro(params: {
  reuniao: Reuniao
  modelo: string
  intencao: 'confirma' | 'cancelar'
  resposta: string
  precoEntrada: number | null
  precoSaida: number | null
  fallback: { texto: string; variacao: VariacaoFixaLuna }
}) {
  const primeira = respostaHorarioReuniaoSegura(params.resposta, params.reuniao.meeting_url, params.reuniao.scheduled_at)
  if (primeira) return { texto: primeira, variacao: null }

  const corrigida = await interpretarComOrcamento(params.reuniao, {
    modo: 'corrigir_resposta', acao: params.intencao, resposta_reprovada: params.resposta,
    reuniao: { quando: params.reuniao.scheduled_at, meet: params.reuniao.meeting_url },
    ...presenteBrasil(),
  }, params.modelo)
  const custo = corrigida.tokensEntrada != null && corrigida.tokensSaida != null && params.precoEntrada != null && params.precoSaida != null
    ? (corrigida.tokensEntrada / 1_000_000) * params.precoEntrada + (corrigida.tokensSaida / 1_000_000) * params.precoSaida : null
  const resposta = !corrigida.erro
    ? respostaHorarioReuniaoSegura(corrigida.resposta, params.reuniao.meeting_url, params.reuniao.scheduled_at)
    : null
  await registrar({ reuniao: params.reuniao, intencao: params.intencao, slotPedido: corrigida.slot_pedido, resposta: corrigida.resposta, respondeu: false, modelo: params.modelo, tokensEntrada: corrigida.tokensEntrada, tokensSaida: corrigida.tokensSaida, custo, erro: corrigida.erro ?? (resposta ? null : 'resposta_horario_invalida') })
  return resposta ? { texto: resposta, variacao: null } : params.fallback
}

async function escalarAgenda(reuniao: Reuniao, telefone: string, motivo: string) {
  const texto = await escolherTextoFixoLuna(reuniao, 'falha_agenda', texto => texto)
  const respondeu = await enviarResposta(reuniao, telefone, texto.texto, texto.variacao)
  if (respondeu) await registrarPassagemParaHumano(reuniao)
  await avisarGrupoLuna({ tipo: 'agenda_indisponivel', ...destinoAvisoLuna(reuniao), detalhe: motivo })
  await criarTarefa(reuniao, 'Remarcar reunião — Luna não conseguiu ler a agenda', motivo)
}

async function avisarSilencio(reuniao: Reuniao, motivo: string) {
  await avisarGrupoLuna({ tipo: 'luna_sem_resposta', ...destinoAvisoLuna(reuniao), detalhe: motivo })
}

export type ResultadoConversaLuna = { assumiu: boolean; respondeu: boolean; motivo?: string }

async function interpretarComOrcamento(reuniao: Reuniao, contexto: unknown, modelo: string) {
  const limiteEm = prazoEtapaLuna(reuniao.orcamento, 'chamada ao modelo', 12_000)
  const resultado = await interpretarLuna(contexto, modelo, limiteEm)
  if (resultado.erro === 'openai_timeout' || Date.now() >= limiteEm) throw new OrcamentoLunaEsgotado('prazo do modelo')
  return resultado
}

async function agendaComOrcamento<T>(reuniao: Reuniao, executar: (limiteEm: number) => Promise<T>): Promise<T> {
  const limiteEm = prazoEtapaLuna(reuniao.orcamento, 'leitura ou escrita na agenda', 15_000)
  try { return await executar(limiteEm) } catch (erro) {
    if (Date.now() >= limiteEm || (erro instanceof Error && ['TimeoutError', 'AbortError'].includes(erro.name))) {
      throw new OrcamentoLunaEsgotado('prazo da agenda')
    }
    throw erro
  }
}

async function escalarOrcamento(reuniao: Reuniao, telefone: string): Promise<ResultadoConversaLuna> {
  const limiteEm = reuniao.orcamento!.limiteEm - 2000
  const motivo = 'Orçamento de tempo insuficiente para continuar a conversa com segurança.'
  // O texto é o mesmo aprovado para o limite de rodadas. Não passa pelo modelo
  // nem pela troca de texto da trava de repetição. A lease do telefone continua obrigatória.
  const texto = await escolherTextoFixoLuna(reuniao, 'terceira_rodada', texto => texto)
  const resultados = await Promise.allSettled([
    finalizarNoPrazoLuna(enviarMensagemLunaPartida({ telefone, mensagem: texto.texto, opportunityId: reuniao.opportunity_id, limiteEnvioEm: limiteEm, maxEsperaMs: 0 }), limiteEm, 'envio do escalonamento'),
    finalizarNoPrazoLuna(avisarGrupoLuna({ tipo: 'passou_para_humano', ...destinoAvisoLuna(reuniao), detalhe: motivo }), limiteEm, 'aviso de escalonamento'),
    finalizarNoPrazoLuna(criarTarefa(reuniao, 'Remarcar reunião — orçamento da Luna esgotado', motivo), limiteEm, 'tarefa de escalonamento'),
  ] as const)
  resultados.forEach((resultado, i) => { if (resultado.status === 'rejected') console.error(`luna: escalonamento incompleto (${i}):`, resultado.reason) })
  const envio = resultados[0]
  if (envio.status === 'fulfilled' && envio.value.ok) {
    await registrarPassagemParaHumano(reuniao)
    await registrarVariacaoFixaLuna(reuniao, texto.variacao)
  }
  return { assumiu: true, respondeu: envio.status === 'fulfilled' && envio.value.ok, motivo: 'orcamento_esgotado' }
}

type AtividadeEntradaLuna = { id?: number; body: string | null; occurred_at: string; meta: { messageId?: string | null } | null }

/** Junta somente as entradas posteriores à última fala automática. Exportada
    para a prova do relógio, sem modelo, agenda ou transporte. */
export function juntarMensagensEntradaLuna(atividades: AtividadeEntradaLuna[]) {
  return atividades.map(atividade => atividade.body?.trim() ?? '').filter(Boolean).join('\n')
}

export function selecionarEntradaAgrupadaLuna(atividades: AtividadeEntradaLuna[], messageId: string | null | undefined, texto: string, activityId?: number | null) {
  const ultima = atividades.at(-1)
  if (!ultima) return { texto: null, maisRecente: false }
  const maisRecente = activityId != null
    ? ultima.id === activityId
    : messageId
    ? ultima.meta?.messageId === messageId
    : ultima.body?.trim() === texto.trim()
  return { texto: maisRecente ? juntarMensagensEntradaLuna(atividades) : null, maisRecente }
}

export function resgatePodeEstarEmAndamentoLuna(ocorridaEm: string | null | undefined, janelaSegundos: number, agora = Date.now()) {
  const instante = ocorridaEm ? new Date(ocorridaEm).getTime() : Number.NaN
  return Number.isFinite(instante) && agora - instante < (janelaSegundos + 75) * 1000
}

export async function agruparEntradaLuna(params: {
  opportunityId: string
  messageId?: string | null
  activityId?: number | null
  texto: string
  janelaSegundos: number
  esperar: boolean
  incluirUltimaOcorridaEm?: boolean
  incluirAtividades?: boolean
  dormir?: (milissegundos: number) => Promise<void>
  database?: { from: typeof db.from }
}): Promise<{ texto: string | null; maisRecente: boolean; erro: string | null; ultimaEntradaEm?: string; atividades?: AtividadeEntradaLuna[] }> {
  if (params.esperar) await (params.dormir ?? dormir)(params.janelaSegundos * 1000)
  const database = params.database ?? db
  const { data: ultimaAutomatica, error: automaticaErro } = await database.from('activities').select('occurred_at')
    .eq('opportunity_id', params.opportunityId).eq('direction', 'outbound').eq('is_automated', true)
    .order('occurred_at', { ascending: false }).limit(1).maybeSingle()
  if (automaticaErro) return { texto: null, maisRecente: false, erro: automaticaErro.message }
  const { data: entradas, error } = await database.from('activities').select('id, body, occurred_at, meta')
    .eq('opportunity_id', params.opportunityId).eq('direction', 'inbound').in('kind', ['whatsapp'])
    .gt('occurred_at', ultimaAutomatica?.occurred_at ?? '1970-01-01T00:00:00.000Z')
    .order('occurred_at', { ascending: true }).limit(30)
  if (error || !entradas?.length) return { texto: null, maisRecente: false, erro: error?.message ?? 'nenhuma entrada pendente' }
  const ordenadas = entradas as unknown as AtividadeEntradaLuna[]
  // Com messageId, a decisão é exata. Sem ele, o webhook não nos dá outra
  // identidade estável; a última atividade ainda é segura pelo lease.
  const agrupada = { ...selecionarEntradaAgrupadaLuna(ordenadas, params.messageId, params.texto, params.activityId), erro: null }
  return {
    ...agrupada,
    ...(params.incluirUltimaOcorridaEm ? { ultimaEntradaEm: ordenadas.at(-1)!.occurred_at } : {}),
    ...(params.incluirAtividades ? { atividades: ordenadas } : {}),
  }
}

async function entradasAindaPendentesLuna(activityIds: number[]) {
  if (!activityIds.length) return []
  const { data, error } = await db.from('luna_entradas_tratadas').select('activity_id').in('activity_id', activityIds)
  if (error) throw new Error(error.message)
  const tratadas = new Set((data ?? []).map(linha => Number(linha.activity_id)))
  return activityIds.filter(id => !tratadas.has(id))
}

async function registrarEntradasTratadasLuna(reuniao: Reuniao, activityIds: number[], origem: 'normal' | 'resgate', status: 'tratada' | 'falhou', detalhe: string | null = null) {
  if (!activityIds.length) return { ok: true, inseridas: 0 }
  const { data, error } = await db.from('luna_entradas_tratadas').upsert(
    activityIds.map(activity_id => ({ activity_id, meeting_id: reuniao.id, origem, status, detalhe })),
    { onConflict: 'activity_id', ignoreDuplicates: true },
  ).select('activity_id')
  if (error) console.error('luna: não foi possível registrar entradas tratadas:', error.message)
  return { ok: !error, inseridas: data?.length ?? 0 }
}

/** Única porta da LUNA no inbound. Sem reunião futura ativa, devolve assumiu=false
    e deixa o fluxo atual (inclusive Naia) intacto. */
export async function responderLeadLuna(entrada: {
  opportunityId: string
  telefone: string
  texto: string
  tipo: string
  messageId?: string | null
  activityId?: number | null
  aguardarAgrupamento?: boolean
  resgate?: boolean
}): Promise<ResultadoConversaLuna> {
  const orcamento = criarOrcamentoLuna()
  if (entrada.tipo !== 'text') return { assumiu: false, respondeu: false }
  const { data: config, error: configErro } = await db.from('luna_config')
    .select('ativo, modo, somente_numeros_teste, modelo, preco_entrada_1m_usd, preco_saida_1m_usd, teto_custo_dia_usd, teto_mensagens_reuniao, max_rodadas_oferta, janela_agrupamento_segundos').eq('id', 1).maybeSingle()
  if (configErro || !config || !config.ativo) return { assumiu: false, respondeu: false }
  if (config.somente_numeros_teste) {
    const { data: teste, error } = await db.rpc('fn_numero_teste', { p_phone: entrada.telefone })
    if (error || !teste) return { assumiu: false, respondeu: false }
  }
  const { data: bruto, error: reuniaoErro } = await db.from('meetings').select('id, opportunity_id, scheduled_at, status, external_event_id, meeting_url, luna_passou_para_humano_em, opportunities!inner(person_id, lost_at, paused_at, atendimento, people(full_name), companies(trade_name))')
    .eq('opportunity_id', entrada.opportunityId).in('status', ['agendada', 'confirmada']).gt('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(1).maybeSingle()
  const reuniao = bruto as unknown as Reuniao | null
  // atendimento 'humano' = negócio de LP nova: a LUNA não entra (call de 19/10/2026).
  if (reuniaoErro || !reuniao || reuniao.opportunities?.lost_at || reuniao.opportunities?.paused_at || reuniao.opportunities?.atendimento === 'humano') return { assumiu: false, respondeu: false }
  reuniao.orcamento = orcamento
  reuniao.limiteEnvioEm = orcamento.limiteEm - 2000
  let activityIdsTrataveis: number[] = []
  let entradaMaisRecenteEm: string | null = null
  let atividadesAgrupadas: AtividadeEntradaLuna[] = []

  if (entrada.aguardarAgrupamento || entrada.resgate) {
    const janelaSegundos = Math.max(1, Math.min(30, Number(config.janela_agrupamento_segundos ?? 15)))
    const agrupada = await agruparEntradaLuna({
      opportunityId: entrada.opportunityId,
      messageId: entrada.messageId,
      activityId: entrada.activityId,
      texto: entrada.texto,
      janelaSegundos,
      esperar: !!entrada.aguardarAgrupamento,
      incluirUltimaOcorridaEm: !!entrada.resgate,
      incluirAtividades: true,
    })
    if (entrada.resgate && agrupada.erro === 'nenhuma entrada pendente') {
      return { assumiu: true, respondeu: false, motivo: 'resgate_sem_entrada' }
    }
    if (agrupada.erro) {
      const detalhe = `Não foi possível agrupar as mensagens do lead: ${agrupada.erro}`
      if (!entrada.resgate || (await registrarEntradasTratadasLuna(reuniao, Number.isSafeInteger(entrada.activityId) ? [entrada.activityId as number] : [], 'resgate', 'falhou', detalhe)).inseridas) await avisarSilencio(reuniao, detalhe)
      return { assumiu: true, respondeu: false, motivo: 'agrupamento_indisponivel' }
    }
    if (entrada.resgate && resgatePodeEstarEmAndamentoLuna(agrupada.ultimaEntradaEm, janelaSegundos)) {
      return { assumiu: true, respondeu: false, motivo: 'resgate_aguardando_fluxo_normal' }
    }
    if (!agrupada.maisRecente) return { assumiu: true, respondeu: false, motivo: 'agrupada_por_mais_recente' }
    atividadesAgrupadas = agrupada.atividades ?? []
    const activityIds = atividadesAgrupadas.map(atividade => atividade.id).filter((id): id is number => Number.isSafeInteger(id))
    activityIdsTrataveis = activityIds
    try {
      activityIdsTrataveis = await entradasAindaPendentesLuna(activityIds)
    } catch (erro) {
      const detalhe = `Não foi possível verificar entradas já tratadas: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`
      if (!entrada.resgate || (await registrarEntradasTratadasLuna(reuniao, activityIdsTrataveis, 'resgate', 'falhou', detalhe)).inseridas) await avisarSilencio(reuniao, detalhe)
      return { assumiu: true, respondeu: false, motivo: 'entradas_tratadas_indisponivel' }
    }
    if (!activityIdsTrataveis.length) return { assumiu: true, respondeu: false, motivo: 'entrada_ja_tratada' }
    const pendentes = atividadesAgrupadas.filter(atividade => atividade.id != null && activityIdsTrataveis.includes(atividade.id))
    entradaMaisRecenteEm = agrupada.ultimaEntradaEm ?? atividadesAgrupadas.at(-1)?.occurred_at ?? null
    entrada = { ...entrada, texto: juntarMensagensEntradaLuna(pendentes) }
  }

  const { data: reserva, error: reservaErro } = await db.rpc('fn_luna_conversa_reservar', { p_meeting_id: reuniao.id })
  if (reservaErro || typeof reserva !== 'string') {
    if (reservaErro) console.error('luna: não foi possível reservar a conversa:', reservaErro.message)
    if (entrada.resgate && !reservaErro) return { assumiu: true, respondeu: false, motivo: 'resgate_reserva_ocupada' }
    await avisarSilencio(reuniao, reservaErro ? 'Não foi possível reservar a conversa da reunião' : 'Outra mensagem desta reunião já está sendo tratada pela Luna')
    return { assumiu: true, respondeu: false, motivo: reservaErro ? 'reserva_indisponivel' : 'reserva_ocupada' }
  }

  let trabalhoFalhou = false
  let statusEntrada: 'tratada' | 'falhou' = 'tratada'
  let detalheEntrada: string | null = null
  try {

  if (activityIdsTrataveis.length) {
    activityIdsTrataveis = await entradasAindaPendentesLuna(activityIdsTrataveis)
    if (!activityIdsTrataveis.length) return { assumiu: true, respondeu: false, motivo: 'entrada_ja_tratada' }
    entrada = { ...entrada, texto: juntarMensagensEntradaLuna(atividadesAgrupadas.filter(atividade => atividade.id != null && activityIdsTrataveis.includes(atividade.id))) }
  }

  if (entrada.resgate && entradaMaisRecenteEm && Date.now() - new Date(entradaMaisRecenteEm).getTime() > 10 * 60 * 1000) {
    statusEntrada = 'falhou'
    detalheEntrada = 'Resgate não respondeu: entrada com mais de 10 minutos'
    await avisarSilencio(reuniao, detalheEntrada)
    return { assumiu: true, respondeu: false, motivo: 'resgate_expirado' }
  }

  const [{ data: anteriores }, { data: gastos }, { data: atividades }, { data: ofertasBrutas }, { data: lembretes }, { data: ultimaMensagemNossa }] = await Promise.all([
    db.from('luna_interacoes').select('id').eq('meeting_id', reuniao.id).eq('respondeu', true),
    db.from('luna_interacoes').select('custo_usd').gte('ocorrido_em', inicioDoDia()),
    db.from('activities').select('direction, is_automated, body, occurred_at').eq('opportunity_id', reuniao.opportunity_id).order('occurred_at', { ascending: false }).limit(15),
    db.from('luna_ofertas').select('id, slots, rodada, validade, usada_em, criada_em').eq('meeting_id', reuniao.id).order('criada_em', { ascending: false }).limit(20),
    db.from('luna_lembretes').select('status, enviado_em, motivo').eq('meeting_id', reuniao.id).eq('status', 'enviado').order('enviado_em', { ascending: false }),
    db.from('activities').select('is_automated, occurred_at').eq('opportunity_id', reuniao.opportunity_id).in('kind', ['whatsapp', 'audio']).eq('direction', 'outbound').order('occurred_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const lembretesReais = (lembretes ?? []) as LembreteEnviado[]
  const ultimasMensagensLuna = (Array.isArray(atividades) ? atividades : [])
    .filter((atividade: { direction?: string; is_automated?: boolean | null; body?: string | null }) => atividade.direction === 'outbound' && atividade.is_automated === true && !!atividade.body?.trim())
    .map((atividade: { body?: string | null }) => atividade.body!.trim()).slice(0, 5)
  const lembreteReal = lembretesReais.find(lembrete =>
    lembrete.status === 'enviado' && !!lembrete.enviado_em && !String(lembrete.motivo ?? '').startsWith('modo_sombra:'),
  )
  const { data: humanaPosterior, error: humanaPosteriorErro } = lembreteReal?.enviado_em
    ? await db.from('activities').select('id').eq('opportunity_id', reuniao.opportunity_id).in('kind', ['whatsapp', 'audio'])
      .eq('direction', 'outbound').eq('is_automated', false).gt('occurred_at', lembreteReal.enviado_em)
      .order('occurred_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null, error: null }
  if (humanaPosteriorErro) {
    await avisarSilencio(reuniao, 'Não foi possível verificar se houve intervenção humana após o lembrete')
    return { assumiu: true, respondeu: false, motivo: 'intervencao_indisponivel' }
  }
  const fronteira = fronteiraConversaLuna({
    modo: String(config.modo),
    lembretes: lembretesReais,
    ultimaMensagemNossa: ultimaMensagemNossa as MensagemNossa | null,
    houveMensagemHumanaAposLembrete: !!humanaPosterior,
    houvePassagemParaHumanoAposLembrete: !!(reuniao.luna_passou_para_humano_em && lembreteReal?.enviado_em && new Date(reuniao.luna_passou_para_humano_em) > new Date(lembreteReal.enviado_em)),
  })
  if (!fronteira.permite) {
    const motivo = fronteira.motivo === 'intervencao_humana'
      ? 'Lead respondeu depois de uma mensagem humana; a Luna não entrou.'
      : fronteira.motivo === 'passagem_humano'
        ? 'A Luna já passou esta reunião para o Rodrigues depois do último lembrete; ela ficou calada.'
      : fronteira.motivo === 'modo_sombra'
        ? 'Luna está em modo sombra; nenhuma conversa automática foi iniciada.'
        : 'Não há lembrete real enviado como última mensagem automática.'
    await avisarSilencio(reuniao, motivo)
    return { assumiu: true, respondeu: false, motivo: fronteira.motivo }
  }
  if ((anteriores ?? []).length >= Number(config.teto_mensagens_reuniao)) {
    await avisarSilencio(reuniao, 'Teto de mensagens da reunião atingido')
    return { assumiu: true, respondeu: false, motivo: 'teto_mensagens' }
  }
  const gastoHoje = (gastos ?? []).reduce((s, linha) => s + Number(linha.custo_usd ?? 0), 0)
  if (gastoHoje >= Number(config.teto_custo_dia_usd)) {
    await avisarSilencio(reuniao, 'Teto diário de custo atingido')
    return { assumiu: true, respondeu: false, motivo: 'teto_custo' }
  }
  const ofertas = (Array.isArray(ofertasBrutas) ? ofertasBrutas : ofertasBrutas ? [ofertasBrutas] : []) as unknown as Oferta[]
  const inicioLembrete = lembreteReal?.enviado_em ? new Date(lembreteReal.enviado_em).getTime() : Number.NEGATIVE_INFINITY
  const ultimaOfertaUsada = ofertas
    .filter(ofertaAnterior => ofertaAnterior.usada_em && new Date(ofertaAnterior.usada_em).getTime() >= inicioLembrete)
    .map(ofertaAnterior => new Date(ofertaAnterior.usada_em!).getTime())
    .reduce((maisRecente, usadaEm) => Math.max(maisRecente, usadaEm), Number.NEGATIVE_INFINITY)
  const inicioNegociacao = Math.max(inicioLembrete, ultimaOfertaUsada)
  const ofertasNegociacao = ofertas.filter(ofertaAnterior => !ofertaAnterior.criada_em || new Date(ofertaAnterior.criada_em).getTime() >= inicioNegociacao)
  const oferta = ofertasNegociacao[0] ?? null
  const ofertaViva = ofertasNegociacao.find(candidata => !candidata.usada_em && new Date(candidata.validade) > new Date()) ?? null
  const slotsJaOfertados = new Set(ofertasNegociacao
    .flatMap(ofertaAnterior => ofertaAnterior.slots.map(slot => slot.iso)))
  const modelo = String(config.modelo || 'gpt-5.6-luna')
  const primeiroNome = primeiroNomeLuna(reuniao.opportunities?.people?.full_name)
  const saida = await interpretarComOrcamento(reuniao, {
    modo: 'classificar', mensagem_lead: entrada.texto, reuniao: { quando: reuniao.scheduled_at, meet: reuniao.meeting_url },
    ...presenteBrasil(),
    lembrete_enviado: true, ultimas_mensagens_luna: ultimasMensagensLuna,
    slots_ofertados: ofertaViva?.slots ?? [], slots_disponiveis: [], primeiro_nome: primeiroNome,
  }, modelo)
  const custo = saida.tokensEntrada != null && saida.tokensSaida != null && config.preco_entrada_1m_usd != null && config.preco_saida_1m_usd != null
    ? (saida.tokensEntrada / 1_000_000) * Number(config.preco_entrada_1m_usd) + (saida.tokensSaida / 1_000_000) * Number(config.preco_saida_1m_usd) : null
  await registrar({ reuniao, intencao: saida.intencao, horario: saida.horario_pedido, slotPedido: saida.slot_pedido, slot: saida.slot_escolhido, resposta: saida.resposta, modelo, tokensEntrada: saida.tokensEntrada, tokensSaida: saida.tokensSaida, custo, erro: saida.erro })
  if (saida.erro) {
    await avisarSilencio(reuniao, `Modelo indisponível: ${saida.erro}`)
    return { assumiu: true, respondeu: false, motivo: 'modelo_indisponivel' }
  }
  // O dia explícito do lead sempre vence a intenção ampla de "quais horários".
  // Assim "tem outro horário na quinta?" segue para a oferta da própria quinta.
  const textoTemporal = `${saida.horario_pedido ?? ''} ${entrada.texto}`
  const { diaPedido, dataPedido } = resolverDataPedidoLuna(textoTemporal)
  // O slot persistido é fato do servidor. Se o lead o escolheu, remarcação
  // vence o rótulo semântico que o modelo deu para a frase de concordância.
  // Perguntar os dias livres é parte da remarcação, mesmo se a classificação
  // do modelo a chamar de "duvida". Ainda não há oferta nem rodada aqui.
  // O campo do modelo entende redações abertas. A regex fica em OU somente como
  // rede de segurança para uma saída inválida ou classificação excepcionalmente errada.
  if (!diaPedido && !dataPedido && (saida.pediu_disponibilidade || pedeDisponibilidadePorRegexLuna(entrada.texto))) {
    const eventos = await agendaComOrcamento(reuniao, limiteEm => listarEventosSeguro(new Date().toISOString(), fimAgenda(), limiteEm))
    if (!eventos) { await escalarAgenda(reuniao, entrada.telefone, 'Não foi possível ler a agenda para informar os dias livres'); return { assumiu: true, respondeu: true, motivo: 'agenda_indisponivel' } }
    const candidatos = calcularSlotsLuna(eventosLuna(eventos), new Date(), null, 270)
    const dias = diasComSlotsLuna(candidatos, 5)
    if (!dias.length) { await escalarAgenda(reuniao, entrada.telefone, 'Não há dias úteis livres para informar'); return { assumiu: true, respondeu: true, motivo: 'sem_slots' } }

    let texto: string | null = null
    for (let tentativa = 1; tentativa <= 2 && !texto; tentativa++) {
      const disponibilidade = await interpretarComOrcamento(reuniao, {
        modo: 'escrever_disponibilidade', mensagem_lead: entrada.texto, reuniao: { quando: reuniao.scheduled_at, meet: reuniao.meeting_url },
        ...presenteBrasil(),
        lembrete_enviado: true, ultimas_mensagens_luna: ultimasMensagensLuna, slots_ofertados: ofertaViva?.slots ?? [],
        slots_disponiveis: [], dias_disponiveis: dias, tentativa_disponibilidade: tentativa,
      }, modelo)
      const custoDisponibilidade = disponibilidade.tokensEntrada != null && disponibilidade.tokensSaida != null && config.preco_entrada_1m_usd != null && config.preco_saida_1m_usd != null
        ? (disponibilidade.tokensEntrada / 1_000_000) * Number(config.preco_entrada_1m_usd) + (disponibilidade.tokensSaida / 1_000_000) * Number(config.preco_saida_1m_usd) : null
      const validada = !disponibilidade.erro && disponibilidade.intencao === 'remarcar'
        ? validarDiasDisponiveisLuna(disponibilidade.resposta, disponibilidade.dias_para_disponibilidade, dias, reuniao.meeting_url) : null
      await registrar({ reuniao, intencao: 'remarcar', resposta: disponibilidade.resposta, respondeu: false, modelo, tokensEntrada: disponibilidade.tokensEntrada, tokensSaida: disponibilidade.tokensSaida, custo: custoDisponibilidade, erro: disponibilidade.erro ?? (validada ? null : 'dias_reprovados') })
      if (disponibilidade.erro) {
        await avisarSilencio(reuniao, `Modelo indisponível ao informar disponibilidade: ${disponibilidade.erro}`)
        return { assumiu: true, respondeu: false, motivo: 'modelo_indisponivel' }
      }
      if (validada) texto = disponibilidade.resposta
    }
    const fallback = texto ? null : await escolherTextoFixoLuna(reuniao, 'dias_disponiveis', modelo => modelo.replace('{dias}', listaNaturalLuna(dias, dias.some(dia => dia.includes(',')) ? '; ' : ', ')))
    const resposta = texto ?? fallback!.texto
    const respondeu = await enviarResposta(reuniao, entrada.telefone, resposta, fallback?.variacao)
    await registrar({ reuniao, intencao: 'remarcar', resposta, respondeu, modelo, tokensEntrada: null, tokensSaida: null, custo: null })
    return { assumiu: true, respondeu, motivo: 'dias_disponiveis' }
  }

  const slotEscolhidoDaOferta = !!(ofertaViva && saida.slot_escolhido && ofertaViva.slots.some(slot => slot.iso === saida.slot_escolhido))
  const temSlotPedido = typeof saida.slot_pedido === 'string'

  if (!slotEscolhidoDaOferta && !temSlotPedido && !diaPedido && !dataPedido && (saida.intencao === 'duvida' || saida.intencao === 'outro')) {
    await avisarGrupoLuna({ tipo: 'mensagem_fora_escopo', ...destinoAvisoLuna(reuniao), detalhe: entrada.texto.slice(0, 300) })
    return { assumiu: true, respondeu: false, motivo: saida.intencao }
  }
  if (!slotEscolhidoDaOferta && !temSlotPedido && saida.intencao === 'confirma') {
    const fallback = await escolherTextoFixoLuna(reuniao, 'confirmacao', texto => texto)
    const resposta = await respostaAcaoComHorarioSeguro({
      reuniao, modelo, intencao: 'confirma', resposta: saida.resposta,
      precoEntrada: config.preco_entrada_1m_usd, precoSaida: config.preco_saida_1m_usd,
      fallback,
    })
    const { error } = await db.from('meetings').update({ status: 'confirmada' }).eq('id', reuniao.id).in('status', ['agendada', 'confirmada']).gt('scheduled_at', new Date().toISOString())
    if (error) {
      await avisarSilencio(reuniao, 'CRM não confirmou a presença')
      return { assumiu: true, respondeu: false, motivo: 'confirmacao_falhou' }
    }
    const respondeu = await enviarResposta(reuniao, entrada.telefone, resposta.texto, resposta.variacao)
    await registrar({ reuniao, intencao: saida.intencao, resposta: resposta.texto, respondeu, modelo, tokensEntrada: null, tokensSaida: null, custo: null })
    await avisarGrupoLuna({ tipo: 'presenca_confirmada', ...destinoAvisoLuna(reuniao) })
    return { assumiu: true, respondeu }
  }
  if (!slotEscolhidoDaOferta && !temSlotPedido && saida.intencao === 'cancelar') {
    const fallback = await escolherTextoFixoLuna(reuniao, 'cancelamento', texto => texto)
    const resposta = await respostaAcaoComHorarioSeguro({
      reuniao, modelo, intencao: 'cancelar', resposta: saida.resposta,
      precoEntrada: config.preco_entrada_1m_usd, precoSaida: config.preco_saida_1m_usd,
      fallback,
    })
    if (reuniao.external_event_id && !await agendaComOrcamento(reuniao, limiteEm => cancelarEvento(reuniao.external_event_id!, limiteEm))) { await escalarAgenda(reuniao, entrada.telefone, 'Google recusou o cancelamento'); return { assumiu: true, respondeu: true, motivo: 'cancelamento_google' } }
    const { error } = await db.from('meetings').update({ status: 'cancelada' }).eq('id', reuniao.id).gt('scheduled_at', new Date().toISOString())
    if (error) {
      await escalarAgenda(reuniao, entrada.telefone, 'Google cancelou o evento, mas o CRM não confirmou o cancelamento')
      return { assumiu: true, respondeu: true, motivo: 'cancelamento_banco' }
    }
    const respondeu = await enviarResposta(reuniao, entrada.telefone, resposta.texto, resposta.variacao)
    await registrar({ reuniao, intencao: saida.intencao, resposta: resposta.texto, respondeu, modelo, tokensEntrada: null, tokensSaida: null, custo: null })
    await avisarGrupoLuna({ tipo: 'reuniao_cancelada', ...destinoAvisoLuna(reuniao) })
    await criarTarefa(reuniao, 'Reunião cancelada — retorno da Luna', 'Lead cancelou a reunião pelo WhatsApp.')
    return { assumiu: true, respondeu }
  }

  // Só move por ISO que saiu da oferta persistida e continua vivo.
  if (slotEscolhidoDaOferta && ofertaViva && saida.slot_escolhido) {
    const resposta = respostaSegura(saida.resposta, reuniao.meeting_url)
    if (!resposta) { await avisarSilencio(reuniao, 'Resposta do modelo reprovada pelo guardrail'); return { assumiu: true, respondeu: false, motivo: 'resposta_invalida' } }
    const eventos = await agendaComOrcamento(reuniao, limiteEm => listarEventosSeguro(new Date().toISOString(), fimAgenda(), limiteEm))
    if (!eventos) { await escalarAgenda(reuniao, entrada.telefone, 'Não foi possível ler a agenda antes de mover'); return { assumiu: true, respondeu: true, motivo: 'agenda_indisponivel' } }
    if (!slotEstaDisponivelLuna(saida.slot_escolhido, eventosLuna(eventos))) {
      await avisarGrupoLuna({ tipo: 'slot_ocupado', ...destinoAvisoLuna(reuniao), detalhe: 'A Luna calculará nova oferta.' })
    } else {
    if (!reuniao.external_event_id) { await escalarAgenda(reuniao, entrada.telefone, 'Reunião sem evento Google vinculado'); return { assumiu: true, respondeu: true, motivo: 'sem_evento' } }
    const inicio = new Date(saida.slot_escolhido)
    const moveu = await agendaComOrcamento(reuniao, limiteEm => atualizarEvento(reuniao.external_event_id!, { inicioISO: inicio.toISOString(), fimISO: new Date(inicio.getTime() + 60 * 60 * 1000).toISOString() }, limiteEm))
    if (!moveu) { await escalarAgenda(reuniao, entrada.telefone, 'Google recusou a mudança do evento'); return { assumiu: true, respondeu: true, motivo: 'move_falhou' } }
    const { error } = await db.from('meetings').update({ scheduled_at: inicio.toISOString(), status: 'agendada' }).eq('id', reuniao.id).gt('scheduled_at', new Date().toISOString())
    if (error) { await escalarAgenda(reuniao, entrada.telefone, 'Evento moveu, mas o CRM não confirmou a atualização'); return { assumiu: true, respondeu: true, motivo: 'crm_move_falhou' } }
    await db.from('luna_ofertas').update({ usada_em: new Date().toISOString() }).eq('id', ofertaViva.id).is('usada_em', null)
    const respondeu = await enviarResposta(reuniao, entrada.telefone, resposta)
    await registrar({ reuniao, intencao: 'remarcar', slot: inicio.toISOString(), resposta, respondeu, modelo, tokensEntrada: null, tokensSaida: null, custo: null })
    await avisarGrupoLuna({ tipo: 'reuniao_remarcada', ...destinoAvisoLuna(reuniao), de: reuniao.scheduled_at, para: inicio })
      return { assumiu: true, respondeu }
    }
  }

  if (!diaPedido && !dataPedido) {
    const respostaModelo = respostaSegura(saida.resposta, reuniao.meeting_url)
    const fallback = respostaModelo ? null : await escolherTextoFixoLuna(reuniao, 'pergunta_dia', texto => texto)
    const resposta = respostaModelo ?? fallback!.texto
    const respondeu = await enviarResposta(reuniao, entrada.telefone, resposta, fallback?.variacao)
    await registrar({ reuniao, intencao: 'remarcar', resposta, respondeu, modelo, tokensEntrada: null, tokensSaida: null, custo: null })
    return { assumiu: true, respondeu, motivo: 'aguardando_dia' }
  }

  const rodada = (oferta?.rodada ?? 0) + 1
  if (rodada > Number(config.max_rodadas_oferta)) {
    const texto = await escolherTextoFixoLuna(reuniao, 'terceira_rodada', texto => texto)
    const respondeu = await enviarResposta(reuniao, entrada.telefone, texto.texto, texto.variacao)
    if (respondeu) await registrarPassagemParaHumano(reuniao)
    await registrar({ reuniao, intencao: 'remarcar', resposta: texto.texto, respondeu, modelo, tokensEntrada: null, tokensSaida: null, custo: null })
    await avisarGrupoLuna({ tipo: 'passou_para_humano', ...destinoAvisoLuna(reuniao), detalhe: 'Limite de duas rodadas de oferta atingido' })
    await criarTarefa(reuniao, 'Remarcar reunião — limite de ofertas da Luna', 'A Luna atingiu o limite de duas rodadas de oferta.')
    return { assumiu: true, respondeu }
  }
  const eventos = await agendaComOrcamento(reuniao, limiteEm => listarEventosSeguro(new Date().toISOString(), fimAgenda(), limiteEm))
  if (!eventos) { await escalarAgenda(reuniao, entrada.telefone, 'Não foi possível ler a agenda para criar oferta'); return { assumiu: true, respondeu: true, motivo: 'agenda_indisponivel' } }
  let candidatos = diaPedido
    ? calcularSlotsLuna(eventosLuna(eventos), new Date(), diaPedido, 24)
    : calcularSlotsLunaNaData(eventosLuna(eventos), new Date(), dataPedido!, 24)
  const referenciaIndisponivel = !!dataPedido && !candidatos.length
  const isoPedido = typeof saida.slot_pedido === 'string' ? saida.slot_pedido : null
  candidatos = candidatos.filter(slot => !slotsJaOfertados.has(slot.iso) || slot.iso === isoPedido)
  if (!candidatos.length) candidatos = calcularSlotsLuna(eventosLuna(eventos), new Date(), null, 54)
    .filter(slot => !slotsJaOfertados.has(slot.iso) || slot.iso === isoPedido)
  if (!candidatos.length) { await escalarAgenda(reuniao, entrada.telefone, 'Todos os horários livres dos próximos 21 dias já foram oferecidos nesta negociação'); return { assumiu: true, respondeu: true, motivo: 'sem_slots_novos' } }
  // O ISO do modelo só vale se o servidor acabou de calculá-lo como livre.
  // Nenhuma interpretação de hora em português chega a decidir a agenda.
  const slotPedido = typeof saida.slot_pedido === 'string' ? candidatos.find(slot => slot.iso === saida.slot_pedido) ?? null : null
  const motivoPeloPedido = motivoIndisponivelCoerenteLuna(motivoIndisponivelLuna({
    horarioPedido: saida.horario_pedido, textoLead: entrada.texto,
    slotPedido: typeof saida.slot_pedido === 'string' ? saida.slot_pedido : null, candidatos,
  }), diaPedido, textoTemporal, dataPedido)
  const horarioPedidoIndisponivel = !!motivoPeloPedido || referenciaIndisponivel || (typeof saida.slot_pedido === 'string' && !slotPedido)
  const motivoIndisponivel = horarioPedidoIndisponivel ? motivoPeloPedido ?? 'ocupado' : null
  const fatosPedido = fatosDeHorarioNoTexto(`${saida.horario_pedido ?? ''} ${entrada.texto}`)
  const horaPedida = horaHumanaLuna(fatosPedido.horas[0] ?? fatosPedido.horasCurtas[0] ?? null)
  const diaOferta = candidatos[0] ? formatarNoHorarioBrasil(candidatos[0].iso, { weekday: 'long' }) : null
  if (slotPedido) {
    if (!reuniao.external_event_id) { await escalarAgenda(reuniao, entrada.telefone, 'Reunião sem evento Google vinculado'); return { assumiu: true, respondeu: true, motivo: 'sem_evento' } }
    const inicio = new Date(slotPedido.iso)
    const moveu = await agendaComOrcamento(reuniao, limiteEm => atualizarEvento(reuniao.external_event_id!, { inicioISO: inicio.toISOString(), fimISO: new Date(inicio.getTime() + 60 * 60 * 1000).toISOString() }, limiteEm))
    if (!moveu) { await escalarAgenda(reuniao, entrada.telefone, 'Google recusou a mudança do horário pedido'); return { assumiu: true, respondeu: true, motivo: 'move_falhou' } }
    const { error } = await db.from('meetings').update({ scheduled_at: inicio.toISOString(), status: 'agendada' }).eq('id', reuniao.id).gt('scheduled_at', new Date().toISOString())
    if (error) { await escalarAgenda(reuniao, entrada.telefone, 'Evento moveu, mas o CRM não confirmou a atualização'); return { assumiu: true, respondeu: true, motivo: 'crm_move_falhou' } }
    const resposta = await escolherTextoRemarcacaoLuna(reuniao, inicio)
    const respondeu = await enviarResposta(reuniao, entrada.telefone, resposta.texto, resposta.variacao)
    await registrar({ reuniao, intencao: 'remarcar', horario: saida.horario_pedido, slot: inicio.toISOString(), resposta: resposta.texto, respondeu, modelo, tokensEntrada: null, tokensSaida: null, custo: null })
    await avisarGrupoLuna({ tipo: 'reuniao_remarcada', ...destinoAvisoLuna(reuniao), de: reuniao.scheduled_at, para: inicio })
    return { assumiu: true, respondeu, motivo: 'remarcacao_direta' }
  }

  let slots: SlotLuna[] | null = null
  let slotsEstruturados: SlotLuna[] | null = null
  let texto: string | null = null
  let variacaoOferta: VariacaoFixaLuna = null
  for (let tentativa = 1; tentativa <= 2 && !slots; tentativa++) {
    const ofertaModelo = await interpretarComOrcamento(reuniao, {
      modo: 'escrever_oferta', mensagem_lead: entrada.texto, reuniao: { quando: reuniao.scheduled_at, meet: reuniao.meeting_url },
      ...presenteBrasil(),
      lembrete_enviado: true, ultimas_mensagens_luna: ultimasMensagensLuna, slots_ofertados: ofertaViva?.slots ?? [],
      slots_disponiveis: candidatos, horario_pedido: saida.horario_pedido, horario_pedido_completo: saida.horario_pedido, horario_pedido_indisponivel: horarioPedidoIndisponivel,
      motivo_indisponivel: motivoIndisponivel, dia_pedido: nomeDiaLuna(diaPedido), hora_pedida: horaPedida, dia_oferta: diaOferta, primeiro_nome: primeiroNome, tentativa_oferta: tentativa,
    }, modelo)
    const custoOferta = ofertaModelo.tokensEntrada != null && ofertaModelo.tokensSaida != null && config.preco_entrada_1m_usd != null && config.preco_saida_1m_usd != null
      ? (ofertaModelo.tokensEntrada / 1_000_000) * Number(config.preco_entrada_1m_usd) + (ofertaModelo.tokensSaida / 1_000_000) * Number(config.preco_saida_1m_usd) : null
    const slotPedidoDaOferta = !ofertaModelo.erro && typeof ofertaModelo.slot_pedido === 'string'
      ? candidatos.find(slot => slot.iso === ofertaModelo.slot_pedido) ?? null : null
    if (slotPedidoDaOferta) {
      const inicio = new Date(slotPedidoDaOferta.iso)
      const respostaModelo = respostaHorarioReuniaoSegura(ofertaModelo.resposta, reuniao.meeting_url, inicio.toISOString())
      const fallback = respostaModelo ? null : await escolherTextoRemarcacaoLuna(reuniao, inicio)
      const resposta = respostaModelo ?? fallback!.texto
      await registrar({ reuniao, intencao: 'remarcar', horario: saida.horario_pedido, slotPedido: slotPedidoDaOferta.iso, slot: slotPedidoDaOferta.iso, resposta, respondeu: false, modelo, tokensEntrada: ofertaModelo.tokensEntrada, tokensSaida: ofertaModelo.tokensSaida, custo: custoOferta, erro: ofertaModelo.erro })
      if (!reuniao.external_event_id) { await escalarAgenda(reuniao, entrada.telefone, 'Reunião sem evento Google vinculado'); return { assumiu: true, respondeu: true, motivo: 'sem_evento' } }
      const moveu = await agendaComOrcamento(reuniao, limiteEm => atualizarEvento(reuniao.external_event_id!, { inicioISO: inicio.toISOString(), fimISO: new Date(inicio.getTime() + 60 * 60 * 1000).toISOString() }, limiteEm))
      if (!moveu) { await escalarAgenda(reuniao, entrada.telefone, 'Google recusou a mudança do horário pedido'); return { assumiu: true, respondeu: true, motivo: 'move_falhou' } }
      const { error } = await db.from('meetings').update({ scheduled_at: inicio.toISOString(), status: 'agendada' }).eq('id', reuniao.id).gt('scheduled_at', new Date().toISOString())
      if (error) { await escalarAgenda(reuniao, entrada.telefone, 'Evento moveu, mas o CRM não confirmou a atualização'); return { assumiu: true, respondeu: true, motivo: 'crm_move_falhou' } }
      const respondeu = await enviarResposta(reuniao, entrada.telefone, resposta, fallback?.variacao)
      await avisarGrupoLuna({ tipo: 'reuniao_remarcada', ...destinoAvisoLuna(reuniao), de: reuniao.scheduled_at, para: inicio })
      return { assumiu: true, respondeu, motivo: 'remarcacao_direta' }
    }
    const validada = !ofertaModelo.erro && ofertaModelo.intencao === 'remarcar'
      ? validarOfertaLuna(ofertaModelo.resposta, ofertaModelo.slots_para_oferta, candidatos, reuniao.meeting_url, { diaPedido, dataPedido, horaPedida, motivoIndisponivel }) : null
    const estruturados = !ofertaModelo.erro && ofertaModelo.intencao === 'remarcar'
      ? slotsEstruturadosLuna(ofertaModelo.slots_para_oferta, candidatos) : null
    if (estruturados) slotsEstruturados = estruturados
    await registrar({ reuniao, intencao: 'remarcar', horario: saida.horario_pedido, slotPedido: ofertaModelo.slot_pedido, resposta: ofertaModelo.resposta, respondeu: false, modelo, tokensEntrada: ofertaModelo.tokensEntrada, tokensSaida: ofertaModelo.tokensSaida, custo: custoOferta, erro: ofertaModelo.erro ?? (validada ? null : 'oferta_reprovada') })
    if (validada) { slots = validada; texto = ofertaModelo.resposta }
  }
  if (!slots || !texto) {
    slots = slotsEstruturados ?? espalharSlotsLuna(candidatos, 3, saida.slot_pedido)
    const fallback = await escolherTextoOfertaLuna(reuniao, slots, motivoIndisponivel, diaPedido)
    texto = fallback.texto
    variacaoOferta = fallback.variacao
  }
  const { error: ofertaErro } = await db.from('luna_ofertas').insert({ meeting_id: reuniao.id, slots, rodada, validade: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() })
  if (ofertaErro) {
    await avisarSilencio(reuniao, 'Não foi possível gravar a nova oferta de horários')
    return { assumiu: true, respondeu: false, motivo: 'oferta_nao_gravada' }
  }
  const respondeu = await enviarResposta(reuniao, entrada.telefone, texto, variacaoOferta)
  await registrar({ reuniao, intencao: 'remarcar', horario: diaPedido, resposta: texto, respondeu, modelo, tokensEntrada: null, tokensSaida: null, custo: null })
  return { assumiu: true, respondeu }
  } catch (erro) {
    if (erro instanceof OrcamentoLunaEsgotado) return await escalarOrcamento(reuniao, entrada.telefone)
    if (entrada.resgate) {
      statusEntrada = 'falhou'
      detalheEntrada = `Resgate falhou: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`
      await avisarSilencio(reuniao, detalheEntrada)
      return { assumiu: true, respondeu: false, motivo: 'resgate_falhou' }
    }
    trabalhoFalhou = true
    throw erro
  } finally {
    if (!trabalhoFalhou) await registrarEntradasTratadasLuna(reuniao, activityIdsTrataveis, entrada.resgate ? 'resgate' : 'normal', statusEntrada, detalheEntrada)
    try {
      const { error } = await finalizarNoPrazoLuna(db.rpc('fn_luna_conversa_liberar', { p_meeting_id: reuniao.id, p_token: reserva }), orcamento.limiteEm, 'liberação da lease da reunião')
      if (error) console.error('luna: não foi possível liberar a conversa:', error.message)
    } catch (erro) { console.error('luna: falha ao liberar a conversa:', erro) }
  }
}
