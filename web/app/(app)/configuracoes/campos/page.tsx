import { db } from '@/lib/db'
import { CamposAdmin } from '@/components/config/campos-admin'

export const dynamic = 'force-dynamic'

export default async function CamposPage() {
  const { data } = await db
    .from('custom_fields')
    .select('id, entity, key, label, field_type, options, required, active')
    .order('entity').order('sort_order').order('id')

  return (
    <div>
      <h2 className="t-h2" style={{ marginBottom: 'var(--s-2)' }}>Campos personalizados</h2>
      <p className="t-sm muted" style={{ marginBottom: 'var(--s-5)' }}>
        Defina campos extras para negócios, empresas e contatos. (A exibição nos formulários entra na sequência.)
      </p>
      <CamposAdmin campos={data ?? []} />
    </div>
  )
}
