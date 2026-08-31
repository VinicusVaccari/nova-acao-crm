'use client'

import { useState, useTransition } from 'react'
import { moverEstagio } from '@/lib/actions'
import { useEstagiosBoard } from '@/components/estagios-context'

/* Stepper em chevron, estilo RD: cada etapa é um segmento clicável (move o
   deal, otimista). Perdido/pausado mantêm a etapa — o chevron segue mostrando
   onde está, esmaecido. As ações (marcar perda/venda, retomar, pausar, etc.)
   vivem no menu do banner (ver AcoesNegocio). */
export function StageStepper({
  oppId,
  atual,
  dias,
  perdido = false,
  pausado = false,
}: {
  oppId: string
  atual: string
  dias: number
  perdido?: boolean
  pausado?: boolean
}) {
  const [otim, setOtim] = useState(atual)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, start] = useTransition()

  const ESTAGIOS = useEstagiosBoard()
  const idx = ESTAGIOS.findIndex(e => e.id === otim)
  const fechado = perdido || pausado

  function mover(stage: string) {
    if (stage === otim) return
    setErro(null)
    const prev = otim
    setOtim(stage)
    start(async () => {
      const r = await moverEstagio(oppId, stage)
      if (!r.ok) { setOtim(prev); setErro(r.erro) }
    })
  }

  return (
    <div className="card" style={{ padding: 'var(--s-4)' }}>
      <div className="stage-flow">
        {ESTAGIOS.map((e, i) => {
          const estado = i < idx ? 'feito' : i === idx ? 'atual' : 'futuro'
          return (
            <button
              key={e.id}
              className="stage-seg"
              data-estado={estado}
              style={{ ['--sc' as string]: e.cor, opacity: fechado ? 0.55 : 1 }}
              onClick={() => mover(e.id)}
              disabled={pendente || fechado}
              title={e.label}
            >
              <span>{e.curto}{estado === 'atual' ? ` · ${dias}d` : ''}</span>
            </button>
          )
        })}
      </div>
      {erro && <p className="t-sm" style={{ color: 'var(--critical)', marginTop: 'var(--s-2)' }}>{erro}</p>}
    </div>
  )
}
