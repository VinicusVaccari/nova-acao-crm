import { requireManager } from '@/lib/security/authorization'
import { userDatabase } from '@/lib/security/user-db'
import { FollowupAdmin } from '@/components/config/followup-admin'

export const dynamic = 'force-dynamic'

export default async function FollowUpPage() {
  await requireManager()
  const db = await userDatabase()

  const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0)
  const inicioMes = new Date(inicioHoje.getFullYear(), inicioHoje.getMonth(), 1)

  const [{ data: config }, { data: textos }, { data: disparosHoje }, { data: disparosMes }] = await Promise.all([
    db.from('followup_config').select('*').eq('id', 1).maybeSingle(),
    db.from('followup_textos').select('id, lote, toque, variante, texto, criado_em, criado_por, profiles:criado_por ( full_name )')
      .order('variante').order('lote').order('toque').order('id', { ascending: false }),
    db.from('followup_disparos').select('status, custo_usd').gte('criado_em', inicioHoje.toISOString()),
    db.from('followup_disparos').select('status, custo_usd').gte('criado_em', inicioMes.toISOString()),
  ])

  function resumo(rows: { status: string; custo_usd: number | null }[] | null) {
    const linhas = rows ?? []
    return {
      enviados: linhas.filter(r => r.status === 'enviado').length,
      sombra: linhas.filter(r => r.status === 'sombra').length,
      falhas: linhas.filter(r => r.status === 'falhou' || r.status === 'indeterminado').length,
      custo: linhas.reduce((s, r) => s + Number(r.custo_usd ?? 0), 0),
    }
  }

  type Texto = { id: number; lote: number; toque: number; variante: 'padrao' | 'sem_resposta'; texto: string; criado_em: string; autor: string | null }
  const porVariante: Record<'padrao' | 'sem_resposta', Record<number, Record<number, Texto[]>>> = {
    padrao: { 1: { 1: [], 2: [], 3: [] }, 2: { 1: [], 2: [], 3: [] } },
    sem_resposta: { 1: { 1: [], 2: [], 3: [] }, 2: { 1: [], 2: [], 3: [] } },
  }
  for (const t of textos ?? []) {
    const autor = (t.profiles as { full_name?: string } | null)?.full_name ?? null
    const variante = t.variante === 'sem_resposta' ? 'sem_resposta' : 'padrao'
    porVariante[variante][t.lote as number]?.[t.toque as number]?.push({
      id: t.id as number, lote: t.lote as number, toque: t.toque as number, variante, texto: t.texto as string,
      criado_em: t.criado_em as string, autor,
    })
  }

  return (
    <div>
      <h2 className="t-h2" style={{ marginBottom: 'var(--s-2)' }}>Follow-up</h2>
      <p className="t-sm muted" style={{ marginBottom: 'var(--s-5)' }}>
        A cadência da MEL: quando um lead deixa de responder, o sistema espera, manda até 3 toques
        com o texto que você escreve aqui, e registra tudo.
      </p>
      <FollowupAdmin
        config={config as Record<string, unknown>}
        textosPorVariante={porVariante}
        painelHoje={resumo(disparosHoje)}
        painelMes={resumo(disparosMes)}
      />
    </div>
  )
}
