'use client'

import { createContext, useContext, useMemo } from 'react'
import { ESTAGIOS_PADRAO, corEstagio, labelEstagio, type Estagio } from '@/lib/estagios'

/* Compartilha a config das etapas (nomes/cores/ordem, editáveis no CRM)
   com toda a árvore cliente. Assim um rename aparece igual no kanban, no
   stepper, no inbox e na ficha — sem prop-drilling. */

const Ctx = createContext<Estagio[]>(ESTAGIOS_PADRAO)

export function EstagiosProvider({ value, children }: { value: Estagio[]; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useEstagios(): Estagio[] {
  return useContext(Ctx)
}

/** Só as etapas que são coluna no kanban, na ordem definida. */
export function useEstagiosBoard(): Estagio[] {
  const es = useEstagios()
  return useMemo(() => es.filter(e => !e.noBoard), [es])
}

function useMapa(): Record<string, Estagio> {
  const es = useEstagios()
  return useMemo(() => Object.fromEntries(es.map(e => [e.id, e])), [es])
}

/** Rótulo longo por id (com fallback para o padrão do código). */
export function useLabelEstagio(): (id: string) => string {
  const m = useMapa()
  return (id: string) => m[id]?.label ?? labelEstagio(id)
}

/** Rótulo curto por id. */
export function useCurtoEstagio(): (id: string) => string {
  const m = useMapa()
  return (id: string) => m[id]?.curto ?? m[id]?.label ?? labelEstagio(id)
}

/** Cor por id. */
export function useCorEstagio(): (id: string) => string {
  const m = useMapa()
  return (id: string) => m[id]?.cor ?? corEstagio(id)
}
