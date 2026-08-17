import { db } from '@/lib/db'
import { ListaConfig } from '@/components/config/lista-config'

export const dynamic = 'force-dynamic'

export default async function SegmentosPage() {
  const { data } = await db.from('segments').select('id, name, active').order('sort_order').order('name')
  const itens = (data ?? []).map(s => ({ id: String(s.id), label: s.name as string, ativo: !!s.active }))
  return (
    <div>
      <h2 className="t-h2" style={{ marginBottom: 'var(--s-5)' }}>Segmentos</h2>
      <ListaConfig
        entidade="segments"
        itens={itens}
        placeholder="Novo segmento (ex.: Clínicas)"
        ajuda="Segmentos usados para classificar as empresas."
      />
    </div>
  )
}
