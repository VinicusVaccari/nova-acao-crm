'use client'

import { useState, useTransition } from 'react'
import { agendarReuniao, marcarReuniao } from '@/lib/actions'

function Botao({
  children,
  onClick,
  tipo = 'normal',
  disabled,
  submit,
}: {
  children: React.ReactNode
  onClick?: () => void
  tipo?: 'normal' | 'primario' | 'perigo'
  disabled?: boolean
  submit?: boolean
}) {
  const cls = tipo === 'primario' ? 'btn btn-primary btn-sm' : tipo === 'perigo' ? 'btn btn-danger btn-sm' : 'btn btn-ghost btn-sm'
  return (
    <button type={submit ? 'submit' : 'button'} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  )
}

/* ---------------- Agendar reunião ---------------- */

export function AgendarReuniao({ oppId }: { oppId: string }) {
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, startTransition] = useTransition()

  function enviar(fd: FormData) {
    setErro(null)
    startTransition(async () => {
      const r = await agendarReuniao(oppId, { kind: String(fd.get('kind')), quando: String(fd.get('quando')) })
      if (!r.ok) setErro(r.erro)
    })
  }

  return (
    <form action={enviar} className="card" style={{ padding: 'var(--s-4)' }}>
      <h3 className="t-h3" style={{ marginBottom: 'var(--s-3)' }}>Agendar reunião</h3>
      <div className="flex flex-wrap gap-2 mb-3">
        <select name="kind" className="field" defaultValue="entendimento">
          <option value="entendimento">Reunião de Entendimento</option>
          <option value="apresentacao_proposta">Apresentação de Proposta</option>
          <option value="followup">Follow-up</option>
          <option value="briefing">Briefing</option>
        </select>
        <input name="quando" type="datetime-local" required className="field" />
      </div>
      {erro && <p className="mb-2 t-sm" style={{ color: 'var(--critical)' }}>{erro}</p>}
      <Botao submit tipo="primario" disabled={pendente}>{pendente ? 'Agendando…' : 'Agendar'}</Botao>
    </form>
  )
}

/* ---------------- Marcar presença ---------------- */

export function PresencaReuniao({ meetingId }: { meetingId: string }) {
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, startTransition] = useTransition()
  const marcar = (s: 'realizada' | 'no_show' | 'cancelada') => {
    setAviso(null)
    setErro(null)
    startTransition(async () => {
      const r = await marcarReuniao(meetingId, s)
      if (r.ok) setAviso(r.aviso ?? null)
      else setErro(r.erro)
    })
  }

  return (
    <div className="flex flex-col items-end" style={{ gap: 'var(--s-1)' }}>
      <div className="flex gap-1.5">
        <Botao tipo="primario" onClick={() => marcar('realizada')} disabled={pendente}>Aconteceu</Botao>
        <Botao tipo="perigo" onClick={() => marcar('no_show')} disabled={pendente}>No-show</Botao>
        <Botao onClick={() => marcar('cancelada')} disabled={pendente}>Cancelar</Botao>
      </div>
      <p className="t-xs" role="status" aria-live="polite" style={{ color: erro ? 'var(--critical)' : 'var(--warning)', minHeight: '1.25rem', visibility: aviso || erro ? 'visible' : 'hidden' }}>
        {erro ?? aviso ?? 'Aviso'}
      </p>
    </div>
  )
}
