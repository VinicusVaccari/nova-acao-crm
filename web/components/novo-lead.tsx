'use client'

import { useState, useTransition } from 'react'
import { criarLead } from '@/lib/actions'

/** Entrada manual de lead (indicação, outbound). Passa pela mesma
 *  fn_ingest_lead do formulário — uma porta de entrada só. */
export function NovoLead({ naiaId, userId, userName }: { naiaId: string | null; userId: string; userName: string }) {
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, startTransition] = useTransition()

  function enviar(fd: FormData) {
    const payload: Record<string, unknown> = {
      name: fd.get('name'),
      phone: fd.get('phone'),
      email: fd.get('email') || null,
      company_name: fd.get('company_name') || null,
      product: fd.get('product') || null,
      expected_value: fd.get('expected_value') || null,
      channel: fd.get('channel'),
      utm_source: fd.get('channel'),
      ...(naiaId ? { owner_id: fd.get('owner_id') } : {}),
    }
    setErro(null)
    startTransition(async () => {
      const r = await criarLead(payload)
      if (r.ok) setAberto(false)
      else setErro(r.erro)
    })
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="btn btn-primary"
      >
        Novo lead
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <form action={enviar} className="card w-full surgir" style={{ maxWidth: 440, padding: 'var(--s-6)', boxShadow: 'var(--shadow-lg)' }}>
        <h2 className="t-h2">Novo lead</h2>
        <p className="t-sm mb-4" style={{ color: 'var(--ink-muted)' }}>
          Entra pela mesma porta do formulário do site: resolve identidade e não duplica quem já existe.
        </p>

        <div className="flex flex-col gap-3">
          <Campo nome="name" rotulo="Nome" obrigatorio />
          <Campo nome="phone" rotulo="Telefone" placeholder="(11) 98765-4321" obrigatorio />
          <Campo nome="email" rotulo="E-mail" tipo="email" />
          <Campo nome="company_name" rotulo="Empresa" />

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="t-sm" style={{ color: 'var(--ink-2)' }}>Origem</span>
              <select name="channel" className="field" defaultValue="indicacao">
                <option value="indicacao">Indicação</option>
                <option value="outbound">Outbound</option>
                <option value="organic">Orgânico</option>
                <option value="direct">Direto</option>
              </select>
            </label>
            <Campo nome="expected_value" rotulo="MRR estimado" tipo="number" placeholder="4500" />
          </div>

          <Campo nome="product" rotulo="Produto" placeholder="Gestão de Tráfego" />

          {naiaId && (
            <label className="flex flex-col gap-1">
              <span className="t-sm" style={{ color: 'var(--ink-2)' }}>Responsável</span>
              <select name="owner_id" className="field" defaultValue={naiaId}>
                <option value={naiaId}>Naia (IA)</option>
                <option value={userId}>{userName}</option>
              </select>
            </label>
          )}
        </div>

        {erro && <p className="mt-3 t-sm" style={{ color: 'var(--critical)' }}>{erro}</p>}

        <div className="flex gap-2 mt-5">
          <button
            type="submit"
            disabled={pendente}
            className="btn btn-primary"
          >
            {pendente ? 'Criando…' : 'Criar lead'}
          </button>
          <button
            type="button"
            onClick={() => setAberto(false)}
            className="btn btn-ghost"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

const campoEstilo = {
  background: 'var(--plane)',
  border: '1px solid var(--hairline)',
  color: 'var(--ink)',
}

function Campo({
  nome,
  rotulo,
  tipo = 'text',
  placeholder,
  obrigatorio,
}: {
  nome: string
  rotulo: string
  tipo?: string
  placeholder?: string
  obrigatorio?: boolean
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="t-sm" style={{ color: 'var(--ink-2)' }}>{rotulo}</span>
      <input
        name={nome}
        type={tipo}
        placeholder={placeholder}
        required={obrigatorio}
        className="field"
      />
    </label>
  )
}
