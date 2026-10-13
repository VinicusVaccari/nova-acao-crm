import type { Filtros } from '@/components/filtros-pipeline'

const vazio: Filtros = { status: '', criacao: '', qualMin: 0, busca: '', produtoId: 0, atendimento: '', followup: '' }

const status = new Set<Filtros['status']>(['', 'andamento', 'vendido', 'perdido', 'pausado'])
const criacao = new Set<Filtros['criacao']>(['', 'hoje', 'ontem', '7', '15', '30', '90', 'custom'])
const atendimento = new Set<Filtros['atendimento']>(['', 'naia', 'rodrigues'])
const followup = new Set<Filtros['followup']>(['', 'sim'])
const parametrosFiltro = new Set(['status', 'criacao', 'de', 'ate', 'qualMin', 'busca', 'produtoId', 'valorMin', 'valorMax', 'atendimento', 'followup'])

function numero(params: URLSearchParams, nome: string): number | undefined {
  const valor = Number(params.get(nome))
  return Number.isFinite(valor) && valor > 0 ? valor : undefined
}

export function serializarFiltros(f: Filtros): URLSearchParams {
  const params = new URLSearchParams()
  if (f.status) params.set('status', f.status)
  if (f.criacao) params.set('criacao', f.criacao)
  if (f.criacao === 'custom' && f.de) params.set('de', f.de)
  if (f.criacao === 'custom' && f.ate) params.set('ate', f.ate)
  if (f.qualMin) params.set('qualMin', String(f.qualMin))
  if (f.busca.trim()) params.set('busca', f.busca.trim())
  if (f.produtoId) params.set('produtoId', String(f.produtoId))
  if (f.valorMin) params.set('valorMin', String(f.valorMin))
  if (f.valorMax) params.set('valorMax', String(f.valorMax))
  if (f.atendimento) params.set('atendimento', f.atendimento)
  if (f.followup) params.set('followup', f.followup)
  return params
}

export function persistirFiltros(f: Filtros, href: string, sessao: Pick<Storage, 'setItem' | 'removeItem'>, chave: string): string {
  const params = serializarFiltros(f)
  if (params.size) sessao.setItem(chave, params.toString())
  else sessao.removeItem(chave)
  const url = new URL(href)
  url.search = params.toString()
  return `${url.pathname}${url.search}${url.hash}`
}

function filtrosDosParametros(params: URLSearchParams): Filtros {
  const qualMin = numero(params, 'qualMin')
  const produtoId = numero(params, 'produtoId')
  const valorMin = numero(params, 'valorMin')
  const valorMax = numero(params, 'valorMax')
  const data = params.get('criacao')
  const criacaoSelecionada = criacao.has(data as Filtros['criacao']) ? data as Filtros['criacao'] : ''
  const statusSelecionado = params.get('status')
  const atendimentoSelecionado = params.get('atendimento')
  const followupSelecionado = params.get('followup')
  return {
    ...vazio,
    status: status.has(statusSelecionado as Filtros['status']) ? statusSelecionado as Filtros['status'] : '',
    criacao: criacaoSelecionada,
    ...(criacaoSelecionada === 'custom' && params.get('de') ? { de: params.get('de')! } : {}),
    ...(criacaoSelecionada === 'custom' && params.get('ate') ? { ate: params.get('ate')! } : {}),
    qualMin: qualMin ?? 0,
    busca: params.get('busca') ?? '',
    produtoId: produtoId ?? 0,
    ...(valorMin ? { valorMin } : {}),
    ...(valorMax ? { valorMax } : {}),
    atendimento: atendimento.has(atendimentoSelecionado as Filtros['atendimento']) ? atendimentoSelecionado as Filtros['atendimento'] : '',
    followup: followup.has(followupSelecionado as Filtros['followup']) ? followupSelecionado as Filtros['followup'] : '',
  }
}

export function filtrosIniciais(buscaUrl: string, filtroSalvo: string | null): Filtros {
  const paramsUrl = new URLSearchParams(buscaUrl)
  const urlTemFiltro = [...paramsUrl.keys()].some(nome => parametrosFiltro.has(nome))
  return filtrosDosParametros(urlTemFiltro ? paramsUrl : new URLSearchParams(filtroSalvo ?? ''))
}
