import { dataHoraBrasilParaIso, formatarNoHorarioBrasil, FUSO_BRASIL } from './horario-brasil'

export type EventoLuna = { inicio: string | null; fim: string | null; diaInteiro: boolean }
export type SlotLuna = { iso: string; rotulo: string }

const MIN = 60_000
const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
const HORIZONTE_DIAS_LUNA = 21

function ymdBrasil(data: Date) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_BRASIL, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(data)
  const campo = (tipo: string) => partes.find(p => p.type === tipo)!.value
  return `${campo('year')}-${campo('month')}-${campo('day')}`
}

function somaDias(ymd: string, dias: number) {
  const d = new Date(`${ymd}T12:00:00-03:00`)
  d.setUTCDate(d.getUTCDate() + dias)
  return ymdBrasil(d)
}

/** Datas sem hora do Google são dias civis de Brasília; `end.date` é exclusivo. */
function diaCivilEventoLuna(valor: string | null) {
  if (!valor) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor
  const data = new Date(valor)
  return Number.isNaN(data.getTime()) ? null : ymdBrasil(data)
}

function eventoDiaInteiroCobreDiaLuna(evento: EventoLuna, ymd: string) {
  if (!evento.diaInteiro) return false
  const inicio = diaCivilEventoLuna(evento.inicio)
  if (!inicio) return true
  const fim = diaCivilEventoLuna(evento.fim) ?? somaDias(inicio, 1)
  return ymd >= inicio && ymd < fim
}

/** Próxima ocorrência de um dia da semana, no mesmo calendário usado pela grade. */
export function dataDoProximoDiaSemanaLuna(diaPedido: string, agora = new Date()) {
  const indicePedido = DIAS.indexOf(diaPedido)
  if (indicePedido < 0) return null
  const hoje = ymdBrasil(agora)
  for (let deslocamento = 0; deslocamento < 7; deslocamento++) {
    const ymd = somaDias(hoje, deslocamento)
    const meioDia = new Date(`${ymd}T12:00:00-03:00`)
    const semana = Number(new Intl.DateTimeFormat('en-US', { timeZone: FUSO_BRASIL, weekday: 'short' }).format(meioDia) === 'Sun' ? 0 : meioDia.getUTCDay())
    if (semana === indicePedido) return ymd
  }
  return null
}

function correspondePreferencia(slot: SlotLuna, preferencia: string | null) {
  if (!preferencia?.trim()) return true
  const p = preferencia.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const rotulo = slot.rotulo.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const dias = new Set(p.match(/segunda|terca|quarta|quinta|sexta/g) ?? [])
  if (dias.size && ![...dias].some(dia => rotulo.includes(dia))) return false
  const hora = Number(formatarNoHorarioBrasil(slot.iso, { hour: '2-digit', hour12: false }))
  if (p.includes('manha') && hora >= 12) return false
  if (p.includes('tarde') && (hora < 12 || hora >= 18)) return false
  return true
}

export function extrairDiaSemanaLuna(texto: string | null | undefined) {
  const normalizado = texto?.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() ?? ''
  const encontrado = normalizado.match(/\b(?:segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo)\b/)
  return encontrado?.[0]?.replace(/-feira$/, '') ?? null
}

export type MotivoRegraAgendaLuna = 'fim_de_semana' | 'fora_do_expediente' | 'antecedencia'

/** Regra única da agenda para recusar um início, antes de consultar conflitos. */
export function motivoRegraAgendaLuna(slotIso: string, agora = new Date()): MotivoRegraAgendaLuna | null {
  const inicio = new Date(slotIso)
  if (Number.isNaN(inicio.getTime()) || inicio.getTime() < agora.getTime() + 60 * MIN) return 'antecedencia'
  const hora = Number(formatarNoHorarioBrasil(inicio, { hour: '2-digit', hour12: false }))
  const minuto = Number(formatarNoHorarioBrasil(inicio, { minute: '2-digit' }))
  const semana = new Intl.DateTimeFormat('en-US', { timeZone: FUSO_BRASIL, weekday: 'short' }).format(inicio)
  if (semana === 'Sat' || semana === 'Sun') return 'fim_de_semana'
  if (hora < 9 || hora > 17 || (hora === 17 && minuto > 30)) return 'fora_do_expediente'
  return null
}

/** Resolve somente referências temporais estáveis; a ação ainda exige ISO livre do servidor. */
export function resolverDataRelativaLuna(texto: string | null | undefined, agora = new Date()) {
  const normalizado = texto?.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() ?? ''
  const hoje = ymdBrasil(agora)
  if (/\bdepois de amanha\b/.test(normalizado)) return somaDias(hoje, 2)
  if (/\bamanha\b/.test(normalizado)) return somaDias(hoje, 1)
  if (/\bsemana que vem\b/.test(normalizado)) return somaDias(hoje, 7)
  const daquiHoras = normalizado.match(/\bdaqui a\s+(\d+|uma?|duas?|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+horas?\b/)
  if (daquiHoras) {
    const porExtenso: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 }
    const horas = Number(daquiHoras[1]) || porExtenso[daquiHoras[1]] || 0
    return horas > 0 ? ymdBrasil(new Date(agora.getTime() + horas * 60 * MIN)) : null
  }
  // Hora sem dia é hoje. O texto continua indo ao modelo; isto só define a agenda candidata.
  // Data absoluta ainda não é inferida por este resolvedor. Não a confundimos
  // com uma hora sem dia, pois isso deslocaria "dia 30 às 14" para hoje.
  if (/\bdia\s+\d{1,2}\b/.test(normalizado)) return null
  if (/\bhoje\b/.test(normalizado)) return hoje
  if (!extrairDiaSemanaLuna(normalizado) && /\b(?:[01]?\d|2[0-3])\s*(?::|h)\s*[0-5]?\d?\b|\b(?:as)\s+(?:[01]?\d|2[0-3])\b/.test(normalizado)) return hoje
  return null
}

/** Precedência única: dia explícito, referência relativa e, por fim, hora sem dia. */
export function resolverDataPedidoLuna(texto: string | null | undefined, agora = new Date()) {
  const diaPedido = extrairDiaSemanaLuna(texto)
  return {
    diaPedido,
    dataPedido: diaPedido ? dataDoProximoDiaSemanaLuna(diaPedido, agora) : resolverDataRelativaLuna(texto, agora),
  }
}

/** Escolha determinística só para o fallback: evita três horários grudados. */
export function espalharSlotsLuna(slots: SlotLuna[], limite = 3, prioridadeIso: string | null = null) {
  const escolhidos: SlotLuna[] = []
  const prioritario = prioridadeIso ? slots.find(slot => slot.iso === prioridadeIso) : null
  if (prioritario) escolhidos.push(prioritario)
  const faixas = [(hora: number) => hora < 12, (hora: number) => hora >= 12 && hora < 15, (hora: number) => hora >= 15]
  for (const faixa of faixas) {
    const slot = slots.find(candidato => !escolhidos.some(escolhido => escolhido.iso === candidato.iso) && faixa(Number(formatarNoHorarioBrasil(candidato.iso, { hour: '2-digit', hour12: false }))))
    if (slot) escolhidos.push(slot)
    if (escolhidos.length === limite) return escolhidos
  }
  for (const slot of slots) {
    if (!escolhidos.some(escolhido => escolhido.iso === slot.iso)) escolhidos.push(slot)
    if (escolhidos.length === limite) break
  }
  return escolhidos
}

/** Dias humanos distintos que o servidor encontrou com pelo menos um horário livre.
    Quando o horizonte contém o mesmo dia da semana duas vezes, inclui a data nos dois
    rótulos para o lead não escolher uma segunda-feira ambígua. */
export function diasComSlotsLuna(slots: SlotLuna[], limite = Number.POSITIVE_INFINITY) {
  const porData = new Map<string, SlotLuna>()
  for (const slot of slots) {
    const data = ymdBrasil(new Date(slot.iso))
    if (!porData.has(data)) porData.set(data, slot)
  }
  const dias = [...porData.values()].slice(0, limite).map(slot => ({
    slot,
    semana: formatarNoHorarioBrasil(slot.iso, { weekday: 'long' }),
  }))
  const repetidos = new Set(dias.filter(({ semana }) => dias.filter(dia => dia.semana === semana).length > 1).map(({ semana }) => semana))
  return dias.map(({ slot, semana }) => repetidos.has(semana)
    ? `${semana}, ${formatarNoHorarioBrasil(slot.iso, { day: '2-digit', month: 'long' })}`
    : semana)
}

/** Gera slots em Brasília. Cada candidato dura 1h e reserva 15 min em cada lado. */
export function calcularSlotsLuna(eventos: EventoLuna[], agora = new Date(), preferencia: string | null = null, limite = 3): SlotLuna[] {
  const ocupados = eventos.map(evento => ({
    inicio: evento.inicio ? new Date(evento.inicio).getTime() : Number.NEGATIVE_INFINITY,
    fim: evento.fim ? new Date(evento.fim).getTime() : Number.POSITIVE_INFINITY,
    diaInteiro: evento.diaInteiro,
  }))
  const minimo = agora.getTime() + 60 * MIN
  const todos: SlotLuna[] = []
  const diaPedido = extrairDiaSemanaLuna(preferencia)
  for (let dia = 0; dia < HORIZONTE_DIAS_LUNA && (diaPedido || todos.length < limite); dia++) {
    const ymd = somaDias(ymdBrasil(agora), dia)
    const meioDia = new Date(`${ymd}T12:00:00-03:00`)
    const semana = Number(new Intl.DateTimeFormat('en-US', { timeZone: FUSO_BRASIL, weekday: 'short' }).format(meioDia) === 'Sun' ? 0 : meioDia.getUTCDay())
    if (semana === 0 || semana === 6) continue
    if (diaPedido && DIAS[semana] !== diaPedido) continue
    const temDiaInteiro = eventos.some(evento => eventoDiaInteiroCobreDiaLuna(evento, ymd))
    if (temDiaInteiro) {
      if (diaPedido) break
      continue
    }
    for (let minutos = 9 * 60; minutos <= 17 * 60 + 30; minutos += 30) {
      const hh = String(Math.floor(minutos / 60)).padStart(2, '0')
      const mm = String(minutos % 60).padStart(2, '0')
      const iso = dataHoraBrasilParaIso(`${ymd}T${hh}:${mm}`)
      if (!iso) continue
      const inicio = new Date(iso).getTime()
      const fim = inicio + 60 * MIN
      if (inicio < minimo) continue
      const livre = ocupados.every(e => e.diaInteiro || fim + 15 * MIN <= e.inicio || inicio - 15 * MIN >= e.fim)
      if (!livre) continue
      todos.push({ iso, rotulo: formatarNoHorarioBrasil(iso, { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false }) })
    }
    if (diaPedido) break
  }
  const preferidos = todos.filter(slot => correspondePreferencia(slot, preferencia))
  return (preferidos.length || diaPedido ? preferidos : todos).slice(0, limite)
}

/** Grade real de uma data específica em Brasília, para referências como hoje e amanhã. */
export function calcularSlotsLunaNaData(eventos: EventoLuna[], agora: Date, ymd: string, limite = 24) {
  return calcularSlotsLuna(eventos, agora, null, 270)
    .filter(slot => ymdBrasil(new Date(slot.iso)) === ymd)
    .slice(0, limite)
}

export function slotEstaDisponivelLuna(slotIso: string, eventos: EventoLuna[], agora = new Date()) {
  const inicio = new Date(slotIso)
  if (motivoRegraAgendaLuna(slotIso, agora)) return false
  const fim = inicio.getTime() + 60 * MIN
  return eventos.every(evento => {
    if (evento.diaInteiro) return !eventoDiaInteiroCobreDiaLuna(evento, ymdBrasil(inicio))
    const ocupadoInicio = evento.inicio ? new Date(evento.inicio).getTime() : Number.NEGATIVE_INFINITY
    const ocupadoFim = evento.fim ? new Date(evento.fim).getTime() : Number.POSITIVE_INFINITY
    return fim + 15 * MIN <= ocupadoInicio || inicio.getTime() - 15 * MIN >= ocupadoFim
  })
}
