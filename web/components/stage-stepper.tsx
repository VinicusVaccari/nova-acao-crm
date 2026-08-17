'use client'

import { useState, useTransition } from 'react'
import { moverEstagio } from '@/lib/actions'
import { useEstagiosBoard } from '@/components/estagios-context'

/* Stepper em chevron, estilo RD: cada etapa é um segmento clicável.
   Clicar move o deal (otimista). Perda/nutrição ficam ao lado, com
   a lista fechada de motivos para a perda. */
export function StageStepper({
  oppId,
  atual,
  dias,
  motivos,
}: {
  oppId: string
  atual: string
  dias: number
  motivos: { code: string; label: string }[]
}) {
  const [otim, setOtim] = useState(atual)
  const [erro, setErro] = useState<string | null>(null)
  const [perdendo, setPerdendo] = useState(false)
  const [pendente, start] = useTransition()

  const ESTAGIOS = useEstagiosBoard()
  const idx = ESTAGIOS.findIndex(e => e.id === otim)
  const encerrado = otim === 'ganho' || otim === 'perdido'

  function mover(stage: string, motivo?: string) {
    if (stage === otim) return
    setErro(null)
    const prev = otim
    setOtim(stage)
    start(async () => {
      const r = await moverEstagio(oppId, stage, motivo)
      if (!r.ok) {
        setOtim(prev)
        setErro(r.erro)
      } else {
        setPerdendo(false)
      }
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
              style={{ ['--sc' as string]: e.cor }}
              onClick={() => mover(e.id)}
              disabled={pendente}
              title={e.label}
            >
              <span>{e.curto}{estado === 'atual' ? ` · ${dias}d` : ''}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 'var(--s-3)' }}>
        <span className="t-sm muted" style={{ marginRight: 'auto' }}>
          {encerrado
            ? otim === 'ganho' ? 'Negócio ganho' : 'Negócio perdido'
            : `Etapa ${idx + 1} de ${ESTAGIOS.length} · clique para avançar`}
        </span>
        {!encerrado && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => mover('nutricao')} disabled={pendente}>Nutrição</button>
            <button className="btn btn-danger btn-sm" onClick={() => setPerdendo(v => !v)} disabled={pendente}>Marcar perdido</button>
          </>
        )}
        {erro && <span className="t-sm" style={{ color: 'var(--critical)', width: '100%' }}>{erro}</span>}
      </div>

      {perdendo && (
        <div style={{ marginTop: 'var(--s-3)', paddingTop: 'var(--s-3)', borderTop: '1px solid var(--hairline)' }}>
          <p className="t-sm muted" style={{ marginBottom: 'var(--s-2)' }}>
            O motivo é obrigatório e alimenta o mapa de objeções.
          </p>
          <div className="flex flex-wrap gap-2">
            {motivos.map(m => (
              <button key={m.code} className="btn btn-ghost btn-sm" onClick={() => mover('perdido', m.code)} disabled={pendente}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
