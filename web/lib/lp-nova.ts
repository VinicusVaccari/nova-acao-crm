import 'server-only'
import { db } from '@/lib/db'
import { enviarWhatsappGrupo, ocultarSegredosZapi } from '@/lib/whatsapp'
import { detalharExcecao } from '@/lib/erros'

/* Aviso do lead de LP nova no grupo "Aviso de Lead (LPs novas)". Nenhum
   agente atende esse lead, então é por aqui que o Rodrigues fica sabendo.
   Mesmo desenho do aviso da LUNA (lib/agentes/luna/avisos.ts): o grupo vem
   do cofre e toda tentativa deixa uma linha em automation_runs. */

export type PrimeiroContato = 'ligacao' | 'mensagem'

export type AvisoLpNova = {
  opportunityId: string
  nome: string | null
  telefone: string | null
  empresa: string | null
  site: string | null
  mensagem: string | null       // respostas do formulário, uma por linha
  landingPage: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  primeiroContato: PrimeiroContato | null
}

const NOMES_LP: Record<string, string> = { 'trafego-pago': 'Tráfego Pago', sites: 'Sites', seo: 'SEO' }

function nomeLp(landingPage: string | null) {
  const slug = landingPage?.match(/\/lp\/([^/?#]+)/i)?.[1]?.toLowerCase()
  if (!slug) return 'LP nova'
  return `LP ${NOMES_LP[slug] ?? slug.replace(/-/g, ' ').replace(/^./, l => l.toUpperCase())}`
}

function telefoneLegivel(telefone: string | null) {
  const d = (telefone ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return telefone?.trim() || 'não informado'
}

/* O site manda as respostas como "Pergunta: resposta", uma por linha. As
   conhecidas ganham rótulo curto; o resto vai como veio. */
const RESPOSTAS: [RegExp, string][] = [
  [/^investe hoje$/i, 'Investe hoje'],
  [/^orçamento mensal/i, 'Orçamento mensal'],
  [/^dor principal$/i, 'Dor principal'],
]

function respostas(mensagem: string | null) {
  return (mensagem ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(linha => {
    const [, pergunta, resposta] = linha.match(/^([^:]+):\s*(.*)$/) ?? []
    const rotulo = pergunta && RESPOSTAS.find(([re]) => re.test(pergunta.trim()))?.[1]
    return rotulo ? `*${rotulo}:* ${resposta || '—'}` : linha
  })
}

export function textoAvisoLpNova(a: AvisoLpNova) {
  const empresa = [a.empresa?.trim(), a.site?.trim()].filter(Boolean).join(' · ') || 'não informada'
  const origem = [a.utmSource, a.utmMedium, a.utmCampaign].map(v => v?.trim()).filter(Boolean).join(' / ') || 'direto (sem UTM)'
  const linhas = [
    `🔔 *NOVO LEAD — ${nomeLp(a.landingPage)}*`,
    `*Nome:* ${a.nome?.trim() || 'não informado'}`,
    `*WhatsApp:* ${telefoneLegivel(a.telefone)}`,
    `*Empresa:* ${empresa}`,
    ...respostas(a.mensagem),
    `*Origem:* ${origem}`,
  ]
  if (a.primeiroContato) {
    linhas.push(`*Primeiro contato (teste 50/50):* ${a.primeiroContato === 'ligacao' ? '📞 LIGAÇÃO' : '💬 MENSAGEM'}`)
  }
  linhas.push(`Acesse: https://nova-acao-crm.vercel.app/lead/${a.opportunityId}`)
  return linhas.join('\n')
}

async function registrar(a: AvisoLpNova, texto: string, status: 'enviado' | 'falhou' | 'config_invalida', output: Record<string, unknown> | null, erro: string | null) {
  try {
    const { error } = await db.from('automation_runs').insert({
      workflow: 'lp_nova_aviso_grupo', entity_type: 'opportunity', entity_id: a.opportunityId,
      status, started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      input: { texto }, output, error: erro,
    })
    if (error) console.error('lp nova: não foi possível auditar aviso ao grupo:', error.message)
  } catch (e) {
    console.error('lp nova: não foi possível auditar aviso ao grupo:', detalharExcecao(e))
  }
}

/** Envia o aviso ao grupo. Nunca lança: o lead já está gravado, e uma falha
    aqui só fica registrada para conferir. */
export async function avisarGrupoLpNova(a: AvisoLpNova) {
  const texto = textoAvisoLpNova(a)
  try {
    const { data, error } = await db.rpc('fn_lp_aviso_grupo_whatsapp')
    if (error || typeof data !== 'string' || !data.trim()) {
      const erro = error?.message ?? 'segredo lp_aviso_grupo_whatsapp ausente'
      console.error(`lp nova: configuração inválida do grupo de aviso: ${erro}`)
      await registrar(a, texto, 'config_invalida', null, erro)
      return { status: 'config_invalida' as const }
    }
    const envio = await enviarWhatsappGrupo(data.trim(), texto)
    if (!envio.ok) {
      const erro = ocultarSegredosZapi(envio.erro ?? 'Z-API recusou o aviso')
      const status = envio.erro === 'identificador de grupo inválido' ? 'config_invalida' : 'falhou'
      console.error(`lp nova: aviso ao grupo não saiu: ${erro}`)
      await registrar(a, texto, status, null, erro)
      return { status }
    }
    await registrar(a, texto, 'enviado', { messageId: envio.messageId ?? null }, null)
    return { status: 'enviado' as const }
  } catch (e) {
    const detalhe = ocultarSegredosZapi(detalharExcecao(e))
    console.error('lp nova: aviso ao grupo falhou:', detalhe)
    await registrar(a, texto, 'falhou', null, detalhe)
    return { status: 'falhou' as const }
  }
}
