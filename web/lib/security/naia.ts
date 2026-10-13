import 'server-only'
import { db } from '../db'

/** Só existe durante o deploy anterior à 0082; depois dela Naia é explícita. */
export async function naiaAtivaId(): Promise<string | null> {
  const { data, error } = await db.from('profiles')
    .select('id')
    .eq('role', 'ia')
    .eq('is_active', true)
    .maybeSingle()
  if (error?.code === '22P02' || error?.message.includes('invalid input value for enum')) return null
  if (error) throw new Error(`Naia indisponível: ${error.message}`)
  return (data?.id as string | undefined) ?? null
}
