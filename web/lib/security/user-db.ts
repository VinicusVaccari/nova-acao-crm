import 'server-only'
import { supabaseServer } from '../supabase/server'
import { requireActiveUser } from './authorization'

export async function userDatabase() {
  await requireActiveUser()
  return supabaseServer()
}
