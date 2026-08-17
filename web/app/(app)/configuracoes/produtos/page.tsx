import { db } from '@/lib/db'
import { ListaConfig } from '@/components/config/lista-config'

export const dynamic = 'force-dynamic'

export default async function ProdutosPage() {
  const { data } = await db.from('products').select('id, name, description, active, sort_order').order('sort_order')
  const itens = (data ?? []).map(p => ({
    id: String(p.id), label: p.name as string, sub: (p.description as string) ?? null, ativo: !!p.active,
  }))
  return (
    <div>
      <h2 className="t-h2" style={{ marginBottom: 'var(--s-5)' }}>Produtos e serviços</h2>
      <ListaConfig
        entidade="products"
        itens={itens}
        placeholder="Novo produto/serviço (ex.: Consultoria)"
        ajuda="Produtos e serviços que entram nos negócios."
      />
    </div>
  )
}
