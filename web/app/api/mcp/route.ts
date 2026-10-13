import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'
import { autenticarChaveMcp } from '@/lib/mcp/autenticacao'
import { registrarChamadaMcp } from '@/lib/mcp/auditoria'
import { db } from '@/lib/db'
import { integrationRateLimit } from '@/lib/security/integration'

export const maxDuration = 30

function ipDaRequisicao(req: Request) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
function erroDoIntervalo({ de, ate }: Record<string, unknown>) {
  if (typeof de !== 'string' || typeof ate !== 'string') return 'Informe datas válidas no formato AAAA-MM-DD.'
  const inicio = new Date(`${de}T00:00:00Z`)
  const fim = new Date(`${ate}T00:00:00Z`)
  if (!Number.isFinite(inicio.getTime()) || inicio.toISOString().slice(0, 10) !== de || !Number.isFinite(fim.getTime()) || fim.toISOString().slice(0, 10) !== ate) {
    return 'Informe datas válidas no formato AAAA-MM-DD.'
  }
  if (fim < inicio) {
    return '"ate" precisa ser igual ou posterior a "de".'
  }
  const maximo = new Date(inicio)
  maximo.setUTCFullYear(maximo.getUTCFullYear() + 2)
  return fim > maximo ? 'O período máximo é de 2 anos.' : null
}
const periodoSchema = z.object({ de: dataIso, ate: dataIso })
const funilSchema = z.object({ de: dataIso, ate: dataIso, granularidade: z.enum(['day', 'week', 'month']) })

const camposComercial = [
  'leads', 'speed_to_lead_min', 'qualificados', 'diagnosticos',
  'qualificados_por_avanco', 'agendados_por_avanco', 'diagnosticos_por_avanco', 'propostas_por_avanco',
  'tx_qualificacao', 'agendamentos', 'tx_agendamento', 'reunioes_realizadas', 'reunioes_no_show',
  'reunioes_pendentes', 'show_rate', 'propostas', 'tx_reuniao_proposta', 'vendas', 'perdidos',
  'win_rate', 'tx_lead_venda', 'ticket_medio_mrr', 'ticket_medio_contrato', 'receita_fechada',
  'ciclo_venda_dias', 'pipeline_bruto', 'pipeline_ponderado', 'deals_abertos',
] as const
const camposVendedor = ['nome', 'leads', 'reunioes', 'propostas', 'vendas', 'receita', 'win_rate', 'ticket_medio', 'ciclo_dias', 'speed_to_lead_min'] as const
const camposFollowup = ['leads_coorte', 'toques_enviados', 'responderam', 'qualificados', 'qualificados_venderam', 'qualificados_perderam', 'qualificados_em_andamento', 'perdidos_sumiu', 'custo_coorte_usd', 'custo_hoje_usd', 'teto_custo_dia_usd'] as const
const camposFunil = ['bucket', 'leads', 'qualificados', 'agendados', 'diagnosticos', 'propostas', 'vendas', 'receita'] as const

function recortarObjeto(valor: unknown, campos: readonly string[]) {
  const bruto = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : {}
  return Object.fromEntries(campos.filter(campo => campo in bruto).map(campo => [campo, bruto[campo]]))
}

function recortarComercial(valor: unknown) {
  const bruto = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : {}
  return { periodo: recortarObjeto(bruto.periodo, ['de', 'ate']), ...recortarObjeto(bruto, camposComercial) }
}

function recortarPerdas(valor: unknown) {
  const bruto = recortarObjeto(valor, ['total_perdidos', 'automaticas', 'vendedor', 'nao_identificado'])
  const motivos = valor && typeof valor === 'object' && Array.isArray((valor as Record<string, unknown>).motivos)
    ? (valor as Record<string, unknown>).motivos as unknown[]
    : []
  return { ...bruto, motivos: motivos.map(motivo => recortarObjeto(motivo, ['rotulo', 'quantidade'])) }
}

function recortarLista(valor: unknown, campos: readonly string[]) {
  return Array.isArray(valor) ? valor.map(item => recortarObjeto(item, campos)) : []
}

type ContextoMcp = { http?: { authInfo?: { extra?: unknown } } }

async function executarAgregado(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ContextoMcp,
  consultar: () => Promise<unknown>,
  recortar: (valor: unknown) => unknown,
) {
  const inicio = Date.now()
  const extra = ctx.http?.authInfo?.extra as { agentKeyId?: string; requestedIp?: string | null } | undefined
  if (!extra?.agentKeyId) return { isError: true, content: [{ type: 'text' as const, text: 'Autenticação MCP inválida.' }] }
  try {
    const erroIntervalo = ('de' in args || 'ate' in args) ? erroDoIntervalo(args) : null
    if (erroIntervalo) {
      const auditada = await registrarChamadaMcp({ agentKeyId: extra.agentKeyId, toolName, toolGroup: 'agregado', args, status: 'negado', errorDetail: erroIntervalo, requestedIp: extra.requestedIp ?? null, durationMs: Date.now() - inicio })
      if (!auditada) return { isError: true, content: [{ type: 'text' as const, text: 'Auditoria MCP indisponível.' }] }
      return { isError: true, content: [{ type: 'text' as const, text: erroIntervalo }] }
    }
    const resultado = recortar(await consultar())
    const auditada = await registrarChamadaMcp({ agentKeyId: extra.agentKeyId, toolName, toolGroup: 'agregado', args, status: 'ok', requestedIp: extra.requestedIp ?? null, durationMs: Date.now() - inicio })
    if (!auditada) return { isError: true, content: [{ type: 'text' as const, text: 'Auditoria MCP indisponível.' }] }
    return { content: [{ type: 'text' as const, text: JSON.stringify(resultado) }] }
  } catch (erro) {
    console.error(`mcp: ${toolName} falhou:`, erro)
    await registrarChamadaMcp({ agentKeyId: extra.agentKeyId, toolName, toolGroup: 'agregado', args, status: 'erro', errorDetail: 'Consulta indisponível.', requestedIp: extra.requestedIp ?? null, durationMs: Date.now() - inicio })
    return { isError: true, content: [{ type: 'text' as const, text: 'Consulta temporariamente indisponível.' }] }
  }
}

const handler = createMcpHandler((server) => {
  server.registerTool(
    'ping',
    {
      title: 'Verificar conexão',
      description: 'Confirma que a chave MCP está ativa, sem ler dados do CRM.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) => {
      const extra = ctx.http?.authInfo?.extra as { agentKeyId?: string; agentName?: string; requestedIp?: string | null } | undefined
      const agentName = extra?.agentName
      if (!extra?.agentKeyId || !agentName) {
        return { isError: true, content: [{ type: 'text' as const, text: 'Autenticação MCP inválida.' }] }
      }
      return executarAgregado('ping', {}, ctx, async () => ({ ok: true, agente: agentName }), valor => valor)
    },
  )
  server.registerTool('dash_comercial', {
    title: 'Dashboard comercial',
    description: 'Indicadores agregados do funil comercial no período.',
    inputSchema: periodoSchema,
    annotations: { readOnlyHint: true },
  }, async (args, ctx) => executarAgregado('dash_comercial', args, ctx, async () => {
    const { data, error } = await db.rpc('fn_dash_comercial', { p_from: args.de, p_to: args.ate })
    if (error) throw error
    return data
  }, recortarComercial))
  server.registerTool('dash_perdas', {
    title: 'Dashboard de perdas',
    description: 'Motivos e totais agregados de perdas no período.',
    inputSchema: periodoSchema,
    annotations: { readOnlyHint: true },
  }, async (args, ctx) => executarAgregado('dash_perdas', args, ctx, async () => {
    const { data, error } = await db.rpc('fn_dash_perdas', { p_from: args.de, p_to: args.ate })
    if (error) throw error
    return data
  }, recortarPerdas))
  server.registerTool('dash_por_vendedor', {
    title: 'Dashboard por vendedor',
    description: 'Indicadores agregados por integrante interno da equipe.',
    inputSchema: periodoSchema,
    annotations: { readOnlyHint: true },
  }, async (args, ctx) => executarAgregado('dash_por_vendedor', args, ctx, async () => {
    const { data, error } = await db.rpc('fn_dash_por_vendedor', { p_from: args.de, p_to: args.ate })
    if (error) throw error
    return data
  }, valor => recortarLista(valor, camposVendedor)))
  server.registerTool('dash_followup', {
    title: 'Dashboard de follow-up',
    description: 'Indicadores agregados da coorte de follow-up no período.',
    inputSchema: periodoSchema,
    annotations: { readOnlyHint: true },
  }, async (args, ctx) => executarAgregado('dash_followup', args, ctx, async () => {
    const { data, error } = await db.rpc('fn_dash_followup', { p_from: args.de, p_to: args.ate })
    if (error) throw error
    return data
  }, valor => recortarObjeto(valor, camposFollowup)))
  server.registerTool('funil_no_tempo', {
    title: 'Funil no tempo',
    description: 'Série temporal agregada do funil comercial.',
    inputSchema: funilSchema,
    annotations: { readOnlyHint: true },
  }, async (args, ctx) => executarAgregado('funil_no_tempo', args, ctx, async () => {
    const { data, error } = await db.rpc('fn_funnel_series', { p_from: args.de, p_to: args.ate, p_grain: args.granularidade })
    if (error) throw error
    return data
  }, valor => recortarLista(valor, camposFunil)))
}, { serverInfo: { name: 'nova-acao-mcp', version: '1.0.0' } })

async function responder(req: Request) {
  const inicio = Date.now()
  const bodyClonado = await req.clone().json().catch(() => null)
  const corpoComMetodo = Array.isArray(bodyClonado) ? bodyClonado.find(item => item?.method) : bodyClonado
  const metodo = typeof corpoComMetodo?.method === 'string' ? corpoComMetodo.method : 'desconhecido'
  const authorization = req.headers.get('authorization')?.trim()
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined
  // Desvio de integrationAuthorizedHeaderOnly: cliente MCP pode reservar Authorization; sem Bearer, tenta x-api-key.
  const segredo = bearer || req.headers.get('x-api-key')?.trim()
  const autenticacao = await autenticarChaveMcp(segredo)
  const requestedIp = ipDaRequisicao(req)

  if (autenticacao.tipo === 'indisponivel') {
    await registrarChamadaMcp({ agentKeyId: null, toolName: metodo, toolGroup: 'agregado', status: 'erro', errorDetail: autenticacao.motivo, requestedIp, durationMs: Date.now() - inicio })
    return Response.json({ erro: 'erro interno' }, { status: 500 })
  }
  if (autenticacao.tipo === 'negado') {
    const auditada = await registrarChamadaMcp({ agentKeyId: autenticacao.chaveId, toolName: metodo, toolGroup: 'agregado', status: 'negado', errorDetail: autenticacao.motivo, requestedIp, durationMs: Date.now() - inicio })
    if (!auditada) return Response.json({ erro: 'erro interno' }, { status: 500 })
    return Response.json({ erro: autenticacao.motivo }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
  }

  const limitado = await integrationRateLimit(`mcp:${autenticacao.chave.id}`, 60)
  if (limitado) {
    const erro = limitado.status === 429 ? 'Limite de requisições atingido.' : 'Proteção temporariamente indisponível.'
    const auditada = await registrarChamadaMcp({ agentKeyId: autenticacao.chave.id, toolName: metodo, toolGroup: 'agregado', status: 'erro', errorDetail: erro, requestedIp, durationMs: Date.now() - inicio })
    if (!auditada) return Response.json({ erro: 'erro interno' }, { status: 500 })
    return limitado
  }

  req.auth = {
    token: segredo!,
    clientId: autenticacao.chave.id,
    scopes: ['mcp:leitura'],
    extra: { agentKeyId: autenticacao.chave.id, agentName: autenticacao.chave.agentName, requestedIp },
  }
  if (metodo === 'initialize') {
    const auditada = await registrarChamadaMcp({ agentKeyId: autenticacao.chave.id, toolName: 'initialize', toolGroup: 'agregado', status: 'ok', args: {}, requestedIp, durationMs: Date.now() - inicio })
    if (!auditada) return Response.json({ erro: 'erro interno' }, { status: 500 })
  }
  return handler(req)
}

export { responder as GET, responder as POST }
