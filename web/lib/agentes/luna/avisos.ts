import 'server-only'
import { db } from '@/lib/db'
import { formatarNoHorarioBrasil } from '@/lib/horario-brasil'
import { enviarWhatsappGrupo, ocultarSegredosZapi } from '@/lib/whatsapp'
import { detalharExcecao } from '@/lib/erros'

export type TipoAvisoLuna =
  | 'reuniao_remarcada'
  | 'reuniao_cancelada'
  | 'mensagem_fora_escopo'
  | 'luna_sem_resposta'
  | 'agenda_indisponivel'
  | 'lembrete_nao_saiu'
  | 'passou_para_humano'
  | 'presenca_confirmada'
  | 'lembrete_enviado'
  | 'slot_ocupado'

/** Uma única decisão para todos os caminhos: os demais ficam auditados como filtrados. */
export const TIPOS_ENVIADOS_AO_GRUPO_LUNA = new Set<TipoAvisoLuna>([
  'reuniao_remarcada',
  'reuniao_cancelada',
  'mensagem_fora_escopo',
  'luna_sem_resposta',
  'agenda_indisponivel',
  'lembrete_nao_saiu',
  'passou_para_humano',
])

type AvisoGrupoLuna = {
  tipo: TipoAvisoLuna
  meetingId?: string | null
  opportunityId: string
  lead: string | null
  empresa: string | null
  detalhe?: string | null
  de?: string | Date | null
  para?: string | Date | null
  lembreteTipo?: '1d' | '1h'
  lembreteStatus?: 'falhou' | 'indeterminado'
  scheduledAt?: string | Date | null
  limiteEm?: number
}

function nome(lead: string | null, empresa: string | null) {
  return `${lead?.trim() || 'Lead sem nome'} (${empresa?.trim() || 'Empresa não informada'})`
}

function quando(iso: string | Date) {
  return formatarNoHorarioBrasil(iso, {
    weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function textoAvisoGrupoLuna(params: AvisoGrupoLuna) {
  const pessoa = nome(params.lead, params.empresa)
  const link = `https://nova-acao-crm.vercel.app/lead/${params.opportunityId}`
  const titulo: Record<TipoAvisoLuna, string> = {
    reuniao_remarcada: 'REUNIÃO REMARCADA', reuniao_cancelada: 'REUNIÃO CANCELADA',
    mensagem_fora_escopo: 'MENSAGEM FORA DO ESCOPO', luna_sem_resposta: 'LUNA SEM RESPOSTA',
    agenda_indisponivel: 'AGENDA INDISPONÍVEL', lembrete_nao_saiu: params.lembreteStatus === 'indeterminado' ? 'LEMBRETE INDETERMINADO' : 'LEMBRETE FALHOU',
    passou_para_humano: 'REMARCAÇÃO PARA HUMANO', presenca_confirmada: 'PRESENÇA CONFIRMADA',
    lembrete_enviado: params.lembreteTipo === '1d' ? 'REUNIÃO AMANHÃ' : 'REUNIÃO EM 1 HORA',
    slot_ocupado: 'SLOT OFERECIDO FICOU OCUPADO',
  }
  const linhas = [`*LUNA — ${titulo[params.tipo]}* — ${pessoa}`]
  if (params.tipo === 'reuniao_remarcada' && params.de && params.para) linhas.push(`De: ${quando(params.de)} → Para: ${quando(params.para)}`)
  else if (params.tipo === 'lembrete_enviado' && params.scheduledAt) linhas[0] += ` — ${quando(params.scheduledAt)}`
  else if (params.tipo === 'lembrete_nao_saiu' && params.scheduledAt) linhas[0] += ` — ${params.lembreteTipo === '1d' ? '1 DIA' : '1 HORA'} — ${quando(params.scheduledAt)}`
  if (params.detalhe) linhas.push(params.tipo === 'lembrete_nao_saiu' ? `Motivo: ${params.detalhe}` : params.detalhe)
  linhas.push(`Acesse: ${link}`)
  return linhas.join('\n')
}

async function registrarAviso(params: AvisoGrupoLuna, texto: string, status: 'enviado' | 'filtrado' | 'falhou' | 'config_invalida', output: Record<string, unknown> | null, erro: string | null) {
  const { error } = await db.from('automation_runs').insert({
    workflow: 'luna_aviso_grupo', entity_type: 'meeting', entity_id: params.meetingId ?? null,
    status, started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    input: { tipo: params.tipo, texto }, output, error: erro,
  })
  if (error) console.error('luna: não foi possível auditar aviso ao grupo:', error.message)
}

/** Envia ou filtra um aviso e sempre deixa uma linha consultável em automation_runs. */
export async function avisarGrupoLuna(params: AvisoGrupoLuna) {
  const texto = textoAvisoGrupoLuna(params)
  if (!TIPOS_ENVIADOS_AO_GRUPO_LUNA.has(params.tipo)) {
    await registrarAviso(params, texto, 'filtrado', null, null)
    return { status: 'filtrado' as const }
  }
  let grupo: string | null = null
  try {
    const { data, error } = await db.rpc('fn_luna_grupo_whatsapp')
    if (error || typeof data !== 'string' || !data.trim()) {
      const erro = error?.message ?? 'segredo luna_grupo_whatsapp ausente'
      console.error(`luna: configuração inválida do grupo interno: ${erro}`)
      await registrarAviso(params, texto, 'config_invalida', null, erro)
      return { status: 'config_invalida' as const }
    }
    grupo = data.trim()
  } catch (erro) {
    const detalhe = ocultarSegredosZapi(detalharExcecao(erro))
    console.error('luna: configuração inválida do grupo interno:', detalhe)
    await registrarAviso(params, texto, 'config_invalida', null, detalhe)
    return { status: 'config_invalida' as const }
  }
  try {
    const envio = await enviarWhatsappGrupo(grupo, texto, 5, params.limiteEm)
    if (!envio.ok) {
      const erro = ocultarSegredosZapi(envio.erro ?? 'Z-API recusou o aviso interno')
      const status = envio.erro === 'identificador de grupo inválido' ? 'config_invalida' : 'falhou'
      if (status === 'config_invalida') console.error(`luna: configuração inválida do grupo interno: ${erro}`)
      else console.error(`luna: aviso ao grupo falhou: ${erro}`)
      await registrarAviso(params, texto, status, null, erro)
      return { status }
    }
    await registrarAviso(params, texto, 'enviado', { messageId: envio.messageId ?? null }, null)
    return { status: 'enviado' as const }
  } catch (erro) {
    const detalhe = ocultarSegredosZapi(detalharExcecao(erro))
    console.error('luna: aviso ao grupo falhou:', detalhe)
    await registrarAviso(params, texto, 'falhou', null, detalhe)
    return { status: 'falhou' as const }
  }
}
