import { db } from '@/lib/db'
import { EmpresasLista, type EmpresaRow } from '@/components/empresas-lista'

export const dynamic = 'force-dynamic'

export default async function EmpresasPage() {
  const [{ data }, seg] = await Promise.all([
    db.from('v_empresas_lista').select('*').order('nome', { ascending: true }).limit(2000),
    db.from('segments').select('name').eq('active', true).order('name'),
  ])
  const empresas = (data ?? []) as EmpresaRow[]
  const segmentos = (seg.data ?? []).map(s => s.name as string)
  return <EmpresasLista empresas={empresas} segmentos={segmentos} />
}
