import { userDatabase } from '@/lib/security/user-db'
import { ContatosLista, type ContatoRow } from '@/components/contatos-lista'

export const dynamic = 'force-dynamic'

export default async function ContatosPage() {
  const db = await userDatabase()
  const { data } = await db
    .from('v_contatos_lista')
    .select('*')
    .order('nome', { ascending: true })
    .limit(5000)

  const contatos = (data ?? []) as ContatoRow[]
  return <ContatosLista contatos={contatos} />
}
