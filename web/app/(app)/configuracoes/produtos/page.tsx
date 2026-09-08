import { requireManager } from '@/lib/security/authorization'
import { db } from '@/lib/db'
import { ProdutosAdmin } from '@/components/config/produtos-admin'

export const dynamic = 'force-dynamic'

export default async function ProdutosPage() {
  await requireManager()
  const { data } = await db
    .from('products')
    .select('id, name, active, default_price, recurrence, sort_order')
    .order('sort_order')
  const produtos = (data ?? []).map(p => ({
    id: String(p.id),
    name: p.name as string,
    active: !!p.active,
    default_price: p.default_price != null ? Number(p.default_price) : null,
    recurrence: (p.recurrence as string) ?? 'unico',
  }))
  return (
    <div>
      <h2 className="t-h2" style={{ marginBottom: 'var(--s-5)' }}>Produtos e serviços</h2>
      <ProdutosAdmin produtos={produtos} />
    </div>
  )
}
