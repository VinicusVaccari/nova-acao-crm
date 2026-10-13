import 'server-only'
import { randomUUID } from 'node:crypto'
import { setTimeout as dormir } from 'node:timers/promises'
import { db } from '@/lib/db'
import { particionarMensagemLuna } from '@/lib/luna'
import { enviarComoNaia } from '@/lib/whatsapp'

type Envio = Awaited<ReturnType<typeof enviarComoNaia>>
type Resultado = { ok: boolean; envio: Envio; partesEnviadas: number; totalPartes: number; adiado?: boolean }

// Cada parte recebe timeout adaptativo, sem mudar delayTyping=5. Reservamos
// pelo menos 6s úteis para enviar e 1s para soltar a lease do telefone.
const MINIMO_PARTE_MS = 6000
const MARGEM_FINAL_MS = 1000
const MAX_ESPERA_MS = 20_000

function falha(erro: string, totalPartes: number, partesEnviadas = 0, adiado = false): Resultado {
  return {
    ok: false, adiado, partesEnviadas, totalPartes,
    envio: { ok: false, messageId: null, activityId: null, logErro: null, erro, podeTerSaido: partesEnviadas > 0 },
  }
}

function textoAtividadeParcial(partes: string[], partesEnviadas: number, ultimaPartePodeTerSaido: boolean) {
  const chegou = partes.slice(0, partesEnviadas).join(' ')
  const parteIncerta = ultimaPartePodeTerSaido ? partes[partesEnviadas] : null
  const naoChegou = partes.slice(partesEnviadas + (parteIncerta ? 1 : 0)).join(' ')
  if (!chegou && !parteIncerta) return `[Não chegou ao lead: ${naoChegou}]`

  const situacao = partes.length === 1
    ? `Envio não confirmado pela Z-API: ${parteIncerta}`
    : !chegou
      ? `Envio não confirmado pela Z-API: ${parteIncerta}`
      : `Envio parcial: ${partesEnviadas} de ${partes.length} partes confirmadas.${parteIncerta ? ` A parte ${partesEnviadas + 1} pode ter sido enviada, mas a Z-API não confirmou. Texto sem confirmação: ${parteIncerta}` : ''}`
  const faltou = naoChegou ? ` Não chegou ao lead: ${naoChegou}` : ''
  return `${chegou ? `${chegou}\n\n` : ''}[${situacao}${faltou}]`
}

async function corrigirAtividadeParcial(activityId: number | null, partes: string[], partesEnviadas: number, ultimaPartePodeTerSaido: boolean, limiteEnvioEm: number) {
  if (activityId === null) return 'atividade da primeira parte não retornou identificador para correção'
  try {
    const { data, error } = await db.from('activities')
      .update({ body: textoAtividadeParcial(partes, partesEnviadas, ultimaPartePodeTerSaido) })
      .eq('id', activityId)
      .select('id')
      .abortSignal(AbortSignal.timeout(Math.max(1, Math.min(2000, limiteEnvioEm - Date.now()))))
      .single()
    if (error) return error.message
    if (!data) return 'atividade da primeira parte não foi encontrada para correção'
    return null
  } catch (erro) {
    return erro instanceof Error ? erro.message : 'falha desconhecida ao corrigir atividade da primeira parte'
  }
}

/** Envia em ritmo de WhatsApp e corrige a atividade se apenas parte das bolhas saiu. */
export async function enviarMensagemLunaPartida(params: {
  telefone: string
  mensagem: string
  opportunityId: string
  /** Prazo absoluto, contado desde a entrada do executor, antes de modelo/agrupamento. */
  limiteEnvioEm?: number
  /** Zero ainda tenta adquirir uma vez, mas nunca espera outro dono. */
  maxEsperaMs?: number
}): Promise<Resultado> {
  const partes = particionarMensagemLuna(params.mensagem)
  if (!partes.length) {
    return {
      ok: false,
      envio: { ok: false, messageId: null, activityId: null, logErro: null, erro: 'mensagem sem partes enviáveis', podeTerSaido: false },
      partesEnviadas: 0,
      totalPartes: 0,
    }
  }
  const telefone = params.telefone.replace(/\D/g, '')
  if (!/^\d{10,15}$/.test(telefone)) return falha('telefone inválido para reservar envio', partes.length)
  const limiteEnvioEm = Math.min(params.limiteEnvioEm ?? Infinity, Date.now() + 50_000)
  const limiteEspera = Math.min(Date.now() + Math.max(0, Math.min(params.maxEsperaMs ?? MAX_ESPERA_MS, MAX_ESPERA_MS)), limiteEnvioEm - MINIMO_PARTE_MS - MARGEM_FINAL_MS)
  const token = randomUUID()
  const argumentos = { p_telefone: telefone, p_token: token }
  let reservou = false
  let recuo = 250
  let primeiraTentativa = true
  try {
    while ((primeiraTentativa || Date.now() < limiteEspera) && Date.now() + MINIMO_PARTE_MS + MARGEM_FINAL_MS < limiteEnvioEm) {
      primeiraTentativa = false
      const { data, error } = await db.rpc('fn_luna_envio_reservar', argumentos)
        .abortSignal(AbortSignal.timeout(Math.max(1, Math.min(2000, limiteEnvioEm - Date.now() - MINIMO_PARTE_MS - MARGEM_FINAL_MS))))
      if (error) throw new Error(error.message)
      if (data === true) { reservou = true; break }
      if (data !== false) throw new Error('resposta inválida ao reservar envio')
      const pausa = Math.min(recuo, limiteEspera - Date.now())
      if (pausa > 0) await dormir(pausa)
      recuo = Math.min(recuo * 2, 1000)
    }
  } catch {
    console.error('luna: envio adiado — reserva por telefone indisponível')
    return falha('envio_adiado: reserva por telefone indisponível; nenhuma parte enviada', partes.length, 0, true)
  }
  if (!reservou) {
    console.warn('luna: envio adiado — telefone ocupado ou prazo do executor insuficiente')
    return falha('envio_adiado: telefone ocupado ou prazo insuficiente; nenhuma parte enviada', partes.length, 0, true)
  }

  let liberar = true
  let ultimo: Envio | null = null
  let atividadeInicial: Envio | null = null
  let partesEnviadas = 0
  const registrarFalhaParcial = async (envio: Envio, ultimaPartePodeTerSaido: boolean) => {
    const activityId = atividadeInicial?.activityId ?? envio.activityId
    const erroCorrecao = await corrigirAtividadeParcial(activityId, partes, partesEnviadas, ultimaPartePodeTerSaido, limiteEnvioEm)
    const logErro = [atividadeInicial?.logErro, envio.logErro, erroCorrecao].filter((erro): erro is string => !!erro).join('; ') || null
    if (erroCorrecao) console.error('luna: não foi possível corrigir a atividade de envio parcial:', erroCorrecao)
    return {
      ...envio,
      activityId,
      logErro,
      erro: erroCorrecao ? `${envio.erro ?? 'envio parcial'}; atividade parcialmente enviada não pôde ser corrigida: ${erroCorrecao}` : envio.erro,
      podeTerSaido: partesEnviadas > 0 || envio.podeTerSaido,
    }
  }
  try {
    for (let indice = 0; indice < partes.length; indice++) {
      if (Date.now() + MINIMO_PARTE_MS + MARGEM_FINAL_MS > limiteEnvioEm) {
        if (indice === 0) return falha('prazo do executor insuficiente para a próxima parte', partes.length, 0, true)
        const envio = await registrarFalhaParcial(falha('prazo do executor insuficiente para a próxima parte', partes.length, indice, indice === 0).envio, false)
        return { ok: false, envio, partesEnviadas: indice, totalPartes: partes.length, adiado: indice === 0 }
      }
      const envio = await enviarComoNaia({
        telefone,
        mensagem: partes[indice],
        opportunityId: params.opportunityId,
        delayTyping: 5,
        registrarAtividade: indice === 0,
        textoAtividade: params.mensagem,
        limiteEm: Math.min(Date.now() + 20_000, limiteEnvioEm - MARGEM_FINAL_MS),
      })
      ultimo = envio
      if (indice === 0) atividadeInicial = envio
      if (!envio.ok) {
        // Se a Z-API pode ainda estar processando, só a expiração libera o telefone.
        liberar = !envio.podeTerSaido
        return { ok: false, envio: await registrarFalhaParcial(envio, envio.podeTerSaido), partesEnviadas: indice, totalPartes: partes.length }
      }
      partesEnviadas++
    }
    return { ok: true, envio: ultimo!, partesEnviadas: partes.length, totalPartes: partes.length }
  } catch {
    liberar = false
    // Não repetir uma mensagem inteira se alguma parte ou requisição pode ter saído.
    const resultado = falha('envio interrompido; a Z-API pode ter enviado uma parte', partes.length, partesEnviadas)
    resultado.envio.podeTerSaido = true
    if (atividadeInicial || partesEnviadas > 0) resultado.envio = await registrarFalhaParcial(resultado.envio, true)
    return resultado
  } finally {
    if (liberar) {
      try {
        const { data, error } = await db.rpc('fn_luna_envio_liberar', argumentos)
          .abortSignal(AbortSignal.timeout(Math.max(1, Math.min(2000, limiteEnvioEm - Date.now()))))
        if (error || data !== true) console.error('luna: lease do envio não liberada; aguardará expiração')
      } catch { console.error('luna: falha ao liberar lease do envio; aguardará expiração') }
    }
  }
}
