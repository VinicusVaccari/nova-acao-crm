import Link from 'next/link'
import { carregarPipeline } from '@/lib/crm'
import { db } from '@/lib/db'
import { Kanban } from '@/components/kanban'
import { NovoLead } from '@/components/novo-lead'
import { brlCurto, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function Pipeline() {
  const [cards, cat] = await Promise.all([
    carregarPipeline(),
    db.from('products').select('id, name').eq('active', true).order('sort_order'),
  ])
  const catalogo = (cat.data ?? []) as { id: number; name: string }[]

  const abertos = cards.filter(c => c.status === 'andamento')
  const bruto = abertos.reduce((s, c) => s + c.contractValue, 0)
  const semContato = abertos.filter(c => !c.first_contact_at && c.stage === 'novo').length

  return (
    // sangra até as bordas do painel (cancela o padding do layout) e trava
    // na altura da tela: o board vai até a base e até a direita, então a
    // barra horizontal alcança as laterais e não sobra vão/linha.
    <div
      className="flex flex-col"
      style={{
        margin: 'calc(var(--s-8) * -1) calc(var(--s-6) * -1)',
        height: 'calc(100dvh - var(--topbar-h))',
        overflow: 'hidden',
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-4 shrink-0" style={{ padding: 'var(--s-6) var(--s-6) var(--s-4)' }}>
        <div>
          <h1 className="t-h1">Pipeline</h1>
          <p className="t-sm muted" style={{ marginTop: 2 }}>
            {num(abertos.length)} negócios abertos · {brlCurto(bruto)} em jogo
            {semContato > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--critical)' }}>{semContato} sem primeiro contato</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/pipeline/etapas" className="btn btn-ghost btn-sm">Editar etapas</Link>
          <NovoLead />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <Kanban cards={cards} catalogo={catalogo} />
      </div>
    </div>
  )
}
