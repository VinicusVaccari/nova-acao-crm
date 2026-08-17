'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  atualizarNegocio, atualizarContato, atualizarEmpresa,
  criarEmpresaNoDeal, desvincularEmpresa,
} from '@/lib/actions'
import { Avatar } from '@/components/ui'
import { brl, brlCurto, dur, num } from '@/lib/format'

/* ---------------- peças comuns ---------------- */

/* telefone: só dígitos com DDI 55 (para o wa.me) e versão formatada */
function telDigitosWa(tel: string): string {
  const d = tel.replace(/\D/g, '')
  return d.length <= 11 ? `55${d}` : d
}
function telFormatado(tel: string): string {
  const m = telDigitosWa(tel).match(/^55(\d{2})(\d{4,5})(\d{4})$/)
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : tel
}

const IconeTel = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 3.5 8 6.2 6.3 7.9a9 9 0 0 0 3.8 3.8L11.8 10l2.7 1.5v3A1.5 1.5 0 0 1 13 16 11 11 0 0 1 4 7a1.5 1.5 0 0 1 1.5-1.5z" /></svg>
)
const IconeMail = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="14" height="10" rx="2" /><path d="m3.5 6 6.5 4.5L16.5 6" /></svg>
)
const IconeWhats = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.148-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413" /></svg>
)
const IconeCopia = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M4 13V5a2 2 0 0 1 2-2h6" /></svg>
)
const IconeCheck = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m4 10.5 3.5 3.5L16 6" /></svg>
)

/** Botãozinho de copiar, com confirmação por 1,2s. */
function BotaoCopiar({ texto, label }: { texto: string; label: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      className="ct-ic"
      title={`Copiar ${label}`}
      aria-label={`Copiar ${label}`}
      onClick={async () => { try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1200) } catch { /* clipboard indisponível */ } }}
      style={ok ? { color: 'var(--good)' } : undefined}
    >
      {ok ? <IconeCheck /> : <IconeCopia />}
    </button>
  )
}

function BotaoEditar({ onClick, label = 'Editar' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="t-sm" style={{ color: 'var(--series-1)', fontWeight: 600 }}>{label}</button>
  )
}

/** Linha com o site como link clicável (abre em nova aba). */
function LinhaSite({ site }: { site: string | null }) {
  if (!site) return <LinhaLeitura rotulo="Site" valor={null} />
  const href = /^https?:\/\//i.test(site) ? site : `https://${site}`
  const label = site.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="t-body shrink-0" style={{ color: 'var(--ink-muted)' }}>Site</span>
      <a href={href} target="_blank" rel="noreferrer" className="link-ext t-body" style={{ fontWeight: 600 }}>
        <span className="truncate">{label}</span>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5V12" /><path d="M12 4h4v4M16 4l-7 7" />
        </svg>
      </a>
    </div>
  )
}

function LinhaLeitura({ rotulo, valor, alerta }: { rotulo: string; valor: React.ReactNode; alerta?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="t-body shrink-0" style={{ color: 'var(--ink-muted)' }}>{rotulo}</span>
      <span className="t-body text-right truncate" style={{ color: alerta ? 'var(--critical)' : 'var(--ink)', fontWeight: 600 }}>
        {valor || '—'}
      </span>
    </div>
  )
}

function CampoEdit({ nome, rotulo, valor, tipo = 'text', placeholder }: { nome: string; rotulo: string; valor?: string; tipo?: string; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="t-sm" style={{ color: 'var(--ink-2)' }}>{rotulo}</span>
      <input name={nome} type={tipo} defaultValue={valor ?? ''} placeholder={placeholder} className="field" />
    </label>
  )
}

function Estrelas({ valor, onSet, disabled }: { valor: number; onSet: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => {
        const on = n <= valor
        return (
          <button key={n} onClick={() => onSet(n === valor ? 0 : n)} disabled={disabled} aria-label={`${n} estrelas`} style={{ lineHeight: 0 }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill={on ? 'var(--accent)' : 'none'} stroke={on ? 'var(--accent)' : 'var(--ink-muted)'} strokeWidth="1.4" strokeLinejoin="round">
              <path d="M10 2.5l2.3 4.7 5.2.76-3.75 3.66.88 5.18L10 14.9l-4.63 2.4.88-5.18L2.5 7.96l5.2-.76z" />
            </svg>
          </button>
        )
      })}
    </div>
  )
}

const PainelCard = ({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) => (
  <div className="card" style={{ padding: 'var(--s-5)' }}>
    <div className="flex items-center justify-between" style={{ marginBottom: 'var(--s-4)' }}>
      <h3 className="t-h2">{titulo}</h3>
      {acao}
    </div>
    {children}
  </div>
)

/* ================= Negociação ================= */

export function PainelNegociacao({
  oppId,
  neg,
}: {
  oppId: string
  neg: {
    title: string | null
    nomePessoa: string
    qualificacao: number
    source: string | null
    campaign: string | null
    creative: string | null
    valorTotal: number
    valorMrr: number
    setup: number
    term: number
    responsavel: string
    criadaEm: string
    speedMin: number | null
    produtos: number
  }
}) {
  const [edit, setEdit] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()

  function setEstrelas(n: number) {
    start(async () => { await atualizarNegocio(oppId, { qualificacao: n }) })
  }

  function salvar(fd: FormData) {
    setErro(null)
    start(async () => {
      const r = await atualizarNegocio(oppId, {
        title: String(fd.get('title') || '') || null,
        source: String(fd.get('source') || '') || null,
        campaign: String(fd.get('campaign') || '') || null,
        creative: String(fd.get('creative') || '') || null,
      })
      if (r.ok) setEdit(false)
      else setErro(r.erro)
    })
  }

  return (
    <PainelCard titulo="Negociação" acao={!edit && <BotaoEditar onClick={() => setEdit(true)} />}>
      {edit ? (
        <form action={salvar} className="flex flex-col" style={{ gap: 'var(--s-3)' }}>
          <CampoEdit nome="title" rotulo="Nome da negociação" valor={neg.title ?? ''} placeholder={neg.nomePessoa} />
          <CampoEdit nome="source" rotulo="Fonte" valor={neg.source ?? ''} placeholder="Busca Orgânica | Google" />
          <CampoEdit nome="campaign" rotulo="Campanha" valor={neg.campaign ?? ''} />
          <CampoEdit nome="creative" rotulo="Criativo" valor={neg.creative ?? ''} />
          {erro && <p className="t-sm" style={{ color: 'var(--critical)' }}>{erro}</p>}
          <div className="flex gap-2" style={{ marginTop: 'var(--s-1)' }}>
            <button className="btn btn-primary btn-sm" disabled={pend}>{pend ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col" style={{ gap: 'var(--s-3)' }}>
          <LinhaLeitura rotulo="Nome" valor={neg.title || neg.nomePessoa} />
          <div className="flex items-center justify-between gap-3">
            <span className="t-body shrink-0" style={{ color: 'var(--ink-muted)' }}>Qualificação</span>
            <Estrelas valor={neg.qualificacao} onSet={setEstrelas} disabled={pend} />
          </div>
          <LinhaLeitura rotulo="Fonte" valor={neg.source} />
          <LinhaLeitura rotulo="Campanha" valor={neg.campaign} />
          <LinhaLeitura rotulo="Criativo" valor={neg.creative} />
          <div style={{ height: 1, background: 'var(--hairline)', margin: '2px 0' }} />
          <div className="flex items-baseline justify-between gap-3">
            <span className="t-body shrink-0" style={{ color: 'var(--ink-muted)' }}>Valor total</span>
            <span className="t-h3 tabular" style={{ fontWeight: 700 }}>{brlCurto(neg.valorTotal)}</span>
          </div>
          {neg.produtos > 0 && (
            <p className="t-xs muted" style={{ marginTop: -6 }}>
              {neg.valorMrr > 0 && `${brl(neg.valorMrr)}/mês`}
              {neg.valorMrr > 0 && neg.setup > 0 && ' · '}
              {neg.setup > 0 && `${brl(neg.setup)} único`}
              {' · '}{num(neg.produtos)} produto(s) — edite na aba Produtos
            </p>
          )}
          {neg.produtos === 0 && <p className="t-xs muted" style={{ marginTop: -6 }}>Adicione produtos na aba Produtos para compor o valor.</p>}
          <div style={{ height: 1, background: 'var(--hairline)', margin: '2px 0' }} />
          <LinhaLeitura rotulo="Responsável" valor={neg.responsavel} />
          <LinhaLeitura rotulo="Criada em" valor={new Date(neg.criadaEm).toLocaleDateString('pt-BR')} />
          <LinhaLeitura rotulo="Speed to lead" valor={neg.speedMin == null ? 'sem contato' : dur(neg.speedMin)} alerta={neg.speedMin == null || neg.speedMin > 5} />
        </div>
      )}
    </PainelCard>
  )
}

/* ================= Contato ================= */

export function PainelContato({
  oppId,
  personId,
  contato,
}: {
  oppId: string
  personId: string
  contato: { full_name: string; phone: string | null; email: string | null }
}) {
  const [edit, setEdit] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()

  function salvar(fd: FormData) {
    setErro(null)
    start(async () => {
      const r = await atualizarContato(personId, oppId, {
        full_name: String(fd.get('full_name') || ''),
        phone_primary: String(fd.get('phone') || '') || null,
        email_primary: String(fd.get('email') || '') || null,
      })
      if (r.ok) setEdit(false)
      else setErro(r.erro)
    })
  }

  return (
    <PainelCard titulo="Contato" acao={!edit && <BotaoEditar onClick={() => setEdit(true)} />}>
      {edit ? (
        <form action={salvar} className="flex flex-col" style={{ gap: 'var(--s-3)' }}>
          <CampoEdit nome="full_name" rotulo="Nome do contato" valor={contato.full_name} />
          <CampoEdit nome="phone" rotulo="Telefone" valor={contato.phone ?? ''} placeholder="(11) 98765-4321" />
          <CampoEdit nome="email" rotulo="E-mail" valor={contato.email ?? ''} tipo="email" />
          {erro && <p className="t-sm" style={{ color: 'var(--critical)' }}>{erro}</p>}
          <div className="flex gap-2" style={{ marginTop: 'var(--s-1)' }}>
            <button className="btn btn-primary btn-sm" disabled={pend}>{pend ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col" style={{ gap: 'var(--s-4)' }}>
          <div className="flex items-center gap-3">
            <Avatar nome={contato.full_name} tamanho={42} />
            <div className="t-body" style={{ fontWeight: 600 }}>{contato.full_name}</div>
          </div>

          {contato.phone && (
            <div className="ct-row">
              <span className="ct-lead"><IconeTel /></span>
              <Link href={`/mensagens?conversa=${oppId}`} className="ct-link" title="Abrir nas Mensagens">
                {telFormatado(contato.phone)}
              </Link>
              <div className="ct-acoes">
                <BotaoCopiar texto={telFormatado(contato.phone)} label="número" />
                <a
                  href={`https://wa.me/${telDigitosWa(contato.phone)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ct-ic ct-wa"
                  title="Abrir no WhatsApp Web"
                  aria-label="Abrir no WhatsApp"
                >
                  <IconeWhats />
                </a>
              </div>
            </div>
          )}

          {contato.email && (
            <div className="ct-row">
              <span className="ct-lead"><IconeMail /></span>
              <a href={`mailto:${contato.email}`} className="ct-link truncate" title="Enviar e-mail">{contato.email}</a>
              <div className="ct-acoes">
                <BotaoCopiar texto={contato.email} label="e-mail" />
              </div>
            </div>
          )}
        </div>
      )}
    </PainelCard>
  )
}

/* ================= Empresa ================= */

export function PainelEmpresa({
  oppId,
  personId,
  empresa,
}: {
  oppId: string
  personId: string
  empresa: { id: string; trade_name: string; cnpj: string | null; address: string | null; website: string | null; segment: string | null } | null
}) {
  const [edit, setEdit] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()

  function salvar(fd: FormData) {
    setErro(null)
    const dados = {
      trade_name: String(fd.get('trade_name') || ''),
      cnpj: String(fd.get('cnpj') || '') || null,
      address: String(fd.get('address') || '') || null,
      website: String(fd.get('website') || '') || null,
      segment: String(fd.get('segment') || '') || null,
    }
    start(async () => {
      const r = empresa
        ? await atualizarEmpresa(empresa.id, oppId, dados)
        : await criarEmpresaNoDeal(oppId, personId, { ...dados, trade_name: dados.trade_name })
      if (r.ok) setEdit(false)
      else setErro(r.erro)
    })
  }

  function remover() {
    start(async () => { await desvincularEmpresa(oppId); setEdit(false) })
  }

  // sem empresa e sem editar → convite para adicionar
  if (!empresa && !edit) {
    return (
      <PainelCard titulo="Empresa">
        <p className="t-sm muted" style={{ marginBottom: 'var(--s-3)' }}>Nenhuma empresa vinculada a este negócio.</p>
        <button className="btn btn-ghost btn-sm" onClick={() => setEdit(true)}>+ Adicionar empresa</button>
      </PainelCard>
    )
  }

  return (
    <PainelCard
      titulo="Empresa"
      acao={!edit && empresa && <BotaoEditar onClick={() => setEdit(true)} />}
    >
      {edit ? (
        <form action={salvar} className="flex flex-col" style={{ gap: 'var(--s-3)' }}>
          <CampoEdit nome="trade_name" rotulo="Nome da empresa" valor={empresa?.trade_name ?? ''} />
          <CampoEdit nome="cnpj" rotulo="CNPJ" valor={empresa?.cnpj ?? ''} placeholder="00.000.000/0001-00" />
          <CampoEdit nome="address" rotulo="Endereço" valor={empresa?.address ?? ''} />
          <CampoEdit nome="website" rotulo="Site" valor={empresa?.website ?? ''} placeholder="empresa.com.br" />
          <CampoEdit nome="segment" rotulo="Segmento" valor={empresa?.segment ?? ''} />
          {erro && <p className="t-sm" style={{ color: 'var(--critical)' }}>{erro}</p>}
          <div className="flex flex-wrap gap-2" style={{ marginTop: 'var(--s-1)' }}>
            <button className="btn btn-primary btn-sm" disabled={pend}>{pend ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>Cancelar</button>
            {empresa && <button type="button" className="btn btn-danger btn-sm" onClick={remover} style={{ marginLeft: 'auto' }}>Desvincular</button>}
          </div>
        </form>
      ) : (
        empresa && (
          <div className="flex flex-col" style={{ gap: 'var(--s-3)' }}>
            <LinhaLeitura rotulo="Nome" valor={empresa.trade_name} />
            <LinhaLeitura rotulo="CNPJ" valor={empresa.cnpj} />
            <LinhaLeitura rotulo="Endereço" valor={empresa.address} />
            <LinhaSite site={empresa.website} />
            {empresa.segment && <LinhaLeitura rotulo="Segmento" valor={empresa.segment} />}
          </div>
        )
      )}
    </PainelCard>
  )
}
