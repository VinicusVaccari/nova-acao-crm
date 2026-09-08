import { requireManager } from '@/lib/security/authorization'
import { db } from '@/lib/db'
import { ListaConfig } from '@/components/config/lista-config'

export const dynamic = 'force-dynamic'

export default async function MotivosPerdaPage() {
  await requireManager()
  const { data } = await db.from('lost_reasons').select('code, label, active').order('label')
  const itens = (data ?? []).map(m => ({ id: m.code as string, label: m.label as string, ativo: !!m.active }))
  return (
    <div>
      <h2 className="t-h2" style={{ marginBottom: 'var(--s-5)' }}>Motivos de perda</h2>
      <ListaConfig
        entidade="lost_reasons"
        itens={itens}
        placeholder="Novo motivo (ex.: Preço)"
        ajuda="Motivos escolhidos ao marcar um negócio como perdido."
      />
    </div>
  )
}
