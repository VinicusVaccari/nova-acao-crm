/* Papéis (roles) dos usuários — compartilhado entre server e client.
   Os valores batem com o enum app_role do banco. */
export const PAPEIS = [
  { v: 'admin', label: 'Administrador' },
  { v: 'gestor', label: 'Gestor' },
  { v: 'vendedor', label: 'Vendedor' },
  { v: 'sdr', label: 'SDR' },
  { v: 'csm', label: 'CS' },
  { v: 'analista', label: 'Analista' },
] as const

export type Papel = (typeof PAPEIS)[number]['v']

export const PAPEIS_VALIDOS = new Set(PAPEIS.map(p => p.v))

export function papelLabel(v: string) {
  if (v === 'ia') return 'Naia (IA)'
  return PAPEIS.find(p => p.v === v)?.label ?? v
}
