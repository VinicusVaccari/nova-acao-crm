'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  adicionarNota, removerNota,
  adicionarTarefa, alternarTarefa,
  subirProposta, removerProposta, definirStatusProposta,
  adicionarProduto, removerProduto,
  subirArquivo, removerArquivo,
} from '@/lib/actions'
import { AgendarReuniao, PresencaReuniao } from '@/components/ficha-acoes'
import { Drawer } from '@/components/drawer'
import { Selo } from '@/components/ui'
import { useLabelEstagio } from '@/components/estagios-context'
import { brl } from '@/lib/format'

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' })

/* ícones das abas — traço fino, 20px grid */
const svg = (p: React.ReactNode) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{p}</svg>
)
const ICO: Record<string, React.ReactNode> = {
  historico: svg(<><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 1.5" /></>),
  anotacoes: svg(<><path d="M5 3.5h7L15.5 7v9.5H5z" /><path d="M12 3.5V7h3.5M7.5 10.5h5M7.5 13h3" /></>),
  tarefas: svg(<><path d="M4 6.5l1.5 1.5L8 5.5M4 13l1.5 1.5L8 12" /><path d="M11 7h5M11 13h5" /></>),
  reunioes: svg(<><rect x="3.5" y="4.5" width="13" height="12" rx="2" /><path d="M3.5 8h13M7 3v3M13 3v3" /></>),
  propostas: svg(<><path d="M6 3.5h5L15 7.5v9H6z" /><path d="M11 3.5V7.5h4M8 11h5M8 13.5h3" /></>),
  produtos: svg(<><path d="M10 3l6 3.2v7.6L10 17l-6-3.2V6.2z" /><path d="M4 6.4l6 3.2 6-3.2M10 9.6V17" /></>),
  arquivos: svg(<><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h3l1.5 2h4.5A1.5 1.5 0 0 1 16 7.5v7A1.5 1.5 0 0 1 14.5 16h-9A1.5 1.5 0 0 1 4 14.5z" /></>),
}

type Dados = {
  oppId: string
  criadoEm?: string
  donoNome?: string
  donoId?: string
  negNome: string
  empresaNome?: string
  usuarios: { id: string; full_name: string }[]
  atividades: any[]; atividadesTruncadas?: boolean; historico: any[]; reunioes: any[]; propostas: any[]
  notas: any[]; tarefas: any[]; produtos: any[]; catalogo: any[]; arquivos: any[]
}

const FUNIL = 'Nova Ação | Funil'
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const ABAS = [
  ['historico', 'Histórico'],
  ['anotacoes', 'Anotações'],
  ['tarefas', 'Tarefas'],
  ['reunioes', 'Reuniões'],
  ['propostas', 'Propostas'],
  ['produtos', 'Produtos'],
  ['arquivos', 'Arquivos'],
] as const

function Vazio({ texto, icone }: { texto: string; icone: React.ReactNode }) {
  return (
    <div className="vazio">
      {icone}
      <span className="t-sm">{texto}</span>
    </div>
  )
}

export function FichaTabs(d: Dados) {
  const [aba, setAba] = useState<string>('historico')

  const contagem: Record<string, number> = {
    tarefas: d.tarefas.filter(t => !t.done_at).length,
    anotacoes: d.notas.length,
    reunioes: d.reunioes.length,
    propostas: d.propostas.length,
    produtos: d.produtos.length,
    arquivos: d.arquivos.length,
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="tabbar">
        {ABAS.map(([id, label]) => (
          <button key={id} className="tab" data-on={aba === id} onClick={() => setAba(id)}>
            {ICO[id]}
            {label}
            {contagem[id] ? <span className="tab-count">{contagem[id]}</span> : null}
          </button>
        ))}
      </div>

      <div style={{ padding: `var(--s-5)` }}>
        {aba === 'historico' && <Historico d={d} />}
        {aba === 'anotacoes' && <Anotacoes oppId={d.oppId} notas={d.notas} />}
        {aba === 'tarefas' && (
          <Tarefas
            oppId={d.oppId}
            tarefas={d.tarefas}
            usuarios={d.usuarios}
            donoId={d.donoId}
            negNome={d.negNome}
            empresaNome={d.empresaNome}
          />
        )}
        {aba === 'reunioes' && <Reunioes oppId={d.oppId} reunioes={d.reunioes} />}
        {aba === 'propostas' && <Propostas oppId={d.oppId} propostas={d.propostas} />}
        {aba === 'produtos' && <Produtos oppId={d.oppId} produtos={d.produtos} catalogo={d.catalogo} />}
        {aba === 'arquivos' && <Arquivos oppId={d.oppId} arquivos={d.arquivos} />}
      </div>
    </div>
  )
}

/* ---------------- Histórico ---------------- */

const kindLabel: Record<string, string> = {
  whatsapp: 'WhatsApp', ligacao: 'Ligação', email: 'E-mail', audio: 'Áudio', nota: 'Nota', reuniao: 'Reunião', sistema: 'Sistema',
}

function Historico({ d }: { d: Dados }) {
  // frase no formato RD: "{ator} {ação}", com o ator em negrito
  type Ev = { at: string; especial?: boolean; ator?: string; texto: React.ReactNode }
  const ator = d.donoNome ?? 'Nova Ação'
  const labelEstagio = useLabelEstagio()

  const ev: Ev[] = [
    ...d.historico.map((h: any): Ev => {
      const nome = h.autor?.full_name ?? ator
      if (h.to_stage === 'perdido')
        return { at: h.changed_at, ator: nome, texto: <>marcou como <b>Perdido</b>{h.reason ? ` (${h.reason})` : ''} no funil {FUNIL}</> }
      if (h.to_stage === 'nutricao')
        return { at: h.changed_at, ator: nome, texto: <>moveu para <b>Nutrição</b> no funil {FUNIL}</> }
      return { at: h.changed_at, ator: nome, texto: <>alterou a etapa para <b>{labelEstagio(h.to_stage)}</b> a partir do funil {FUNIL}</> }
    }),
    ...d.atividades.map((a: any): Ev => ({
      at: a.occurred_at,
      ator: a.is_automated ? 'SDR (IA)' : ator,
      texto: a.kind === 'sistema'
        ? <>{a.body}</>
        : <>registrou {kindLabel[a.kind] ?? a.kind} {a.direction === 'inbound' ? 'recebido' : 'enviado'}{a.outcome ? ` — ${a.outcome}` : ''}{a.body ? `: ${a.body}` : ''}</>,
    })),
    ...d.reunioes.map((m: any): Ev => ({
      at: m.scheduled_at, ator,
      texto: <>{m.status === 'realizada' ? 'realizou' : m.status === 'no_show' ? 'registrou no-show da' : 'agendou'} <b>reunião de {m.kind}</b> no funil {FUNIL}</>,
    })),
    ...d.propostas.map((p: any): Ev => ({
      at: p.sent_at ?? p.created_at, ator,
      texto: <>anexou a <b>proposta v{p.version}</b>{p.status !== 'enviada' ? ` — ${p.status}` : ''} no funil {FUNIL}</>,
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)))

  if (d.criadoEm) ev.push({ at: d.criadoEm, especial: true, texto: <b>Negócio criado</b> })

  if (!ev.length) return <Vazio texto="Nada registrado ainda." icone={ICO.historico} />

  return (
    <div className="tl">
      {ev.map((e, i) => (
        <div key={i} className="tl-item">
          <span className="tl-mark">
            {e.especial ? (
              <span className="tl-badge" style={{ background: '#d6409f' }}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 17V3.5M5.5 4h8l-1.8 3 1.8 3h-8" /></svg>
              </span>
            ) : (
              <span className="tl-dot" />
            )}
          </span>
          <div className="min-w-0 flex-1" style={{ paddingBottom: 'var(--s-2)' }}>
            <p className="t-body">
              {e.ator && <b>{e.ator} </b>}{e.texto}
            </p>
            <p className="t-sm muted" style={{ marginTop: 3 }}>{dataHora(e.at)}</p>
          </div>
        </div>
      ))}
      {d.atividadesTruncadas && (
        <p className="t-sm muted" style={{ paddingTop: 'var(--s-3)' }}>
          Esta linha do tempo mostra os registros mais recentes. O histórico completo da
          conversa está em <Link href={`/mensagens?conversa=${d.oppId}`}>Mensagens</Link>.
        </p>
      )}
    </div>
  )
}

/* ---------------- Anotações ---------------- */

function Anotacoes({ oppId, notas }: { oppId: string; notas: any[] }) {
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, start] = useTransition()

  function enviar(fd: FormData) {
    setErro(null)
    const body = String(fd.get('body') || '')
    start(async () => {
      const r = await adicionarNota(oppId, body)
      if (!r.ok) setErro(r.erro)
      else (document.getElementById('nota-body') as HTMLTextAreaElement).value = ''
    })
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--s-4)' }}>
      <form action={enviar} className="composer">
        <textarea id="nota-body" name="body" rows={3} placeholder="Escreva uma anotação sobre este lead…" className="field" required />
        {erro && <p className="t-sm" style={{ color: 'var(--critical)', marginTop: 'var(--s-2)' }}>{erro}</p>}
        <div className="flex justify-end" style={{ marginTop: 'var(--s-2)' }}>
          <button className="btn btn-primary btn-sm" disabled={pendente}>{pendente ? 'Salvando…' : 'Adicionar anotação'}</button>
        </div>
      </form>

      {notas.length ? (
        <div className="flex flex-col" style={{ gap: 'var(--s-2)' }}>
          {notas.map(n => <NotaItem key={n.id} n={n} oppId={oppId} />)}
        </div>
      ) : (
        <Vazio texto="Nenhuma anotação ainda." icone={ICO.anotacoes} />
      )}
    </div>
  )
}

function NotaItem({ n, oppId }: { n: any; oppId: string }) {
  const [pendente, start] = useTransition()
  return (
    <div className="linha-ficha" style={{ background: 'color-mix(in srgb, var(--warning) 6%, var(--surface))' }}>
      <div className="flex items-start justify-between gap-2">
        <p className="t-body" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
        <button className="remover-x shrink-0" onClick={() => start(async () => { await removerNota(n.id, oppId) })} disabled={pendente}>remover</button>
      </div>
      <div className="t-xs muted" style={{ marginTop: 'var(--s-2)' }}>{quando(n.created_at)}</div>
    </div>
  )
}

/* ---------------- Tarefas ---------------- */

function Tarefas({
  oppId, tarefas, usuarios, donoId, negNome, empresaNome,
}: {
  oppId: string; tarefas: any[]; usuarios: { id: string; full_name: string }[]
  donoId?: string; negNome: string; empresaNome?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, start] = useTransition()

  const hoje = new Date()
  const dataPadrao = hoje.toISOString().slice(0, 10)
  const horaPadrao = hoje.toTimeString().slice(0, 5)

  function enviar(fd: FormData) {
    setErro(null)
    start(async () => {
      const r = await adicionarTarefa(oppId, {
        title: String(fd.get('title') || ''),
        description: String(fd.get('description') || '') || undefined,
        kind: String(fd.get('kind') || 'geral'),
        date: String(fd.get('date') || '') || undefined,
        time: String(fd.get('time') || '') || undefined,
        ownerId: String(fd.get('owner') || '') || null,
        concluida: fd.get('concluida') === 'on',
      })
      if (r.ok) setAberto(false)
      else setErro(r.erro)
    })
  }

  const abertas = tarefas.filter(t => !t.done_at)
  const feitas = tarefas.filter(t => t.done_at)

  const Leitura = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
    <label className="flex flex-col gap-1">
      <span className="campo-label">{rotulo}</span>
      <input value={valor} disabled className="field" style={{ opacity: 0.7 }} />
    </label>
  )

  return (
    <div className="flex flex-col" style={{ gap: 'var(--s-4)' }}>
      <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAberto(true)}>+ Criar tarefa</button>

      {abertas.length ? (
        <div className="flex flex-col" style={{ gap: 'var(--s-1)' }}>
          {abertas.map(t => <TarefaItem key={t.id} t={t} oppId={oppId} />)}
        </div>
      ) : (
        <Vazio texto="Sem tarefas pendentes." icone={ICO.tarefas} />
      )}

      {feitas.length > 0 && (
        <div>
          <div className="t-label" style={{ marginBottom: 'var(--s-2)' }}>Concluídas</div>
          <div className="flex flex-col" style={{ gap: 'var(--s-1)' }}>
            {feitas.map(t => <TarefaItem key={t.id} t={t} oppId={oppId} />)}
          </div>
        </div>
      )}

      <Drawer
        titulo="Criar tarefa"
        aberto={aberto}
        onClose={() => setAberto(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setAberto(false)}>Cancelar</button>
            <button type="submit" form="form-tarefa" className="btn btn-primary" disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar'}</button>
          </>
        }
      >
        <form id="form-tarefa" action={enviar} className="flex flex-col" style={{ gap: 'var(--s-4)' }}>
          {empresaNome && <Leitura rotulo="Empresa da negociação" valor={empresaNome} />}
          <Leitura rotulo="Negociação" valor={negNome} />

          <label className="flex flex-col gap-1">
            <span className="campo-label campo-req">Assunto da tarefa</span>
            <input name="title" className="field" placeholder="Ex.: Ligar para confirmar a proposta" required autoFocus />
          </label>

          <label className="flex flex-col gap-1">
            <span className="campo-label">Descrição da tarefa</span>
            <textarea name="description" rows={3} className="field" placeholder="Detalhes da tarefa…" />
          </label>

          <label className="flex flex-col gap-1">
            <span className="campo-label campo-req">Responsável</span>
            <select name="owner" className="field" defaultValue={donoId ?? ''} required>
              <option value="" disabled>Selecione…</option>
              {usuarios.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="campo-label campo-req">Tipo de tarefa</span>
            <select name="kind" className="field" defaultValue="ligacao">
              <option value="geral">Tarefa</option>
              <option value="ligacao">Ligação</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
              <option value="reuniao">Reunião</option>
              <option value="proposta">Proposta</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="campo-label campo-req">Data do agendamento</span>
              <input name="date" type="date" className="field" defaultValue={dataPadrao} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="campo-label campo-req">Horário</span>
              <input name="time" type="time" className="field" defaultValue={horaPadrao} />
            </label>
          </div>

          <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
            <input name="concluida" type="checkbox" />
            <span className="t-sm">Marcar como concluída ao criar</span>
          </label>

          {erro && <p className="t-sm" style={{ color: 'var(--critical)' }}>{erro}</p>}
        </form>
      </Drawer>
    </div>
  )
}

function TarefaItem({ t, oppId }: { t: any; oppId: string }) {
  const [pendente, start] = useTransition()
  const feita = !!t.done_at
  const atrasada = !feita && t.due_at && new Date(t.due_at) < new Date()
  return (
    <div className="flex items-center gap-3" style={{ padding: `10px var(--s-2)`, borderBottom: '1px solid var(--hairline)', opacity: feita ? 0.55 : 1 }}>
      <button
        onClick={() => start(async () => { await alternarTarefa(t.id, oppId, !feita) })}
        disabled={pendente}
        aria-label={feita ? 'Reabrir' : 'Concluir'}
        className="grid place-items-center shrink-0"
        style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${feita ? 'var(--good)' : 'var(--hairline-2)'}`, background: feita ? 'var(--good)' : 'transparent', color: '#fff', transition: 'all var(--fast) var(--ease)' }}
      >
        {feita && <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5l4 4 8-9" /></svg>}
      </button>
      <div className="min-w-0 flex-1">
        <div className="t-body" style={{ textDecoration: feita ? 'line-through' : 'none' }}>{t.title}</div>
        <div className="t-xs" style={{ color: atrasada ? 'var(--critical)' : 'var(--ink-muted)' }}>
          {t.kind}{t.due_at ? ` · ${quando(t.due_at)}${atrasada ? ' (atrasada)' : ''}` : ''}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Reuniões ---------------- */

function Reunioes({ oppId, reunioes }: { oppId: string; reunioes: any[] }) {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--s-4)' }}>
      <AgendarReuniao oppId={oppId} />
      {reunioes.length ? (
        <div className="flex flex-col" style={{ gap: 'var(--s-2)' }}>
          {reunioes.map(m => (
            <div key={m.id} className="linha-ficha flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="t-body" style={{ fontWeight: 600 }}>{m.kind} · {quando(m.scheduled_at)}</div>
                <div className="t-sm muted">{m.status}{m.reschedule_count > 0 ? ` · remarcada ${m.reschedule_count}x` : ''}</div>
              </div>
              {['agendada', 'confirmada'].includes(m.status) && <PresencaReuniao meetingId={m.id} />}
            </div>
          ))}
        </div>
      ) : (
        <Vazio texto="Nenhuma reunião ainda." icone={ICO.reunioes} />
      )}
    </div>
  )
}

/* ---------------- Propostas ---------------- */

function Propostas({ oppId, propostas }: { oppId: string; propostas: any[] }) {
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, start] = useTransition()

  function enviar(fd: FormData) {
    setErro(null)
    start(async () => {
      const r = await subirProposta(oppId, fd)
      if (!r.ok) setErro(r.erro)
    })
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--s-4)' }}>
      <form action={enviar} className="composer flex flex-wrap items-center gap-2">
        <input name="file" type="file" className="field" style={{ width: 'auto', padding: '6px 8px', flex: 1, minWidth: 200 }} required />
        <button className="btn btn-primary btn-sm" disabled={pendente}>{pendente ? 'Enviando…' : 'Anexar proposta'}</button>
        {erro && <p className="t-sm" style={{ color: 'var(--critical)', width: '100%' }}>{erro}</p>}
      </form>

      {propostas.length ? (
        <div className="flex flex-col" style={{ gap: 'var(--s-2)' }}>
          {propostas.map(p => <PropostaItem key={p.id} p={p} oppId={oppId} />)}
        </div>
      ) : (
        <Vazio texto="Nenhuma proposta anexada." icone={ICO.propostas} />
      )}
    </div>
  )
}

function PropostaItem({ p, oppId }: { p: any; oppId: string }) {
  const [pendente, start] = useTransition()
  const tipo = p.status === 'aceita' ? 'good' : p.status === 'recusada' ? 'critical' : 'neutro'
  const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
  return (
    <div className="linha-ficha">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span aria-hidden className="grid place-items-center shrink-0" style={{ width: 36, height: 36, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', color: 'var(--series-2)' }}>
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M11 3v4h4M6 3h6l3 3v11H6z" /></svg>
          </span>
          <div className="min-w-0">
            <a href={p.url ?? '#'} target="_blank" rel="noreferrer" className="t-body truncate" style={{ color: 'var(--series-1)', fontWeight: 600, display: 'block' }}>
              Proposta v{p.version}{p.file_name ? ` · ${p.file_name}` : ''}
            </a>
            <div className="t-xs muted">
              {p.file_size ? `${kb(Number(p.file_size))} · ` : ''}{p.sent_at ? new Date(p.sent_at).toLocaleDateString('pt-BR') : ''}
            </div>
          </div>
        </div>
        <Selo tipo={tipo as any} texto={p.status} forte />
      </div>
      <div className="flex flex-wrap gap-2" style={{ marginTop: 'var(--s-3)' }}>
        {p.status !== 'aceita' && (
          <button className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => start(async () => { await definirStatusProposta(p.id, oppId, 'aceita') })}>Marcar aceita</button>
        )}
        {p.status !== 'recusada' && (
          <button className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => start(async () => { await definirStatusProposta(p.id, oppId, 'recusada') })}>Marcar recusada</button>
        )}
        <button className="remover-x" disabled={pendente} style={{ marginLeft: 'auto' }} onClick={() => start(async () => { await removerProposta(p.id, oppId, p.file_path) })}>remover</button>
      </div>
    </div>
  )
}

/* ---------------- Produtos ---------------- */

function Produtos({ oppId, produtos, catalogo }: { oppId: string; produtos: any[]; catalogo: any[] }) {
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)
  const [temDesc, setTemDesc] = useState(false)
  const [pendente, start] = useTransition()

  // preço/recorrência sobem sozinhos do catálogo ao escolher o produto (editável)
  const [unit, setUnit] = useState(0)
  const [recorrencia, setRecorrencia] = useState('unico')
  const aoEscolher = (id: string) => {
    const p = catalogo.find(c => String(c.id) === id)
    if (p) { setUnit(Number(p.default_price ?? 0)); setRecorrencia(p.recurrence ?? 'unico') }
  }

  const linha = (p: any) => Math.max(0, Number(p.quantity ?? 1) * Number(p.mrr ?? 0) - Number(p.discount ?? 0))
  const total = produtos.reduce((s, p) => s + linha(p), 0)

  function enviar(fd: FormData) {
    setErro(null)
    const productId = Number(fd.get('product_id'))
    if (!productId) { setErro('Escolha um produto.'); return }
    start(async () => {
      const r = await adicionarProduto(oppId, {
        productId,
        quantity: Math.max(1, Number(fd.get('quantity') || 1)),
        unitValue: Number(fd.get('unit') || 0),
        recurrence: String(fd.get('recurrence') || 'unico'),
        discount: temDesc ? Number(fd.get('discount') || 0) : 0,
      })
      if (r.ok) { setAberto(false); setTemDesc(false) }
      else setErro(r.erro)
    })
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--s-4)' }}>
      {/* total */}
      <div className="inset flex items-center justify-between" style={{ padding: 'var(--s-3) var(--s-4)' }}>
        <span className="t-sm muted">Valor total dos produtos</span>
        <span className="t-h2 tabular">{brl(total)}</span>
      </div>

      <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAberto(true)}>+ Adicionar produto ou serviço</button>

      <Drawer
        titulo="Adicionar produto ou serviço"
        aberto={aberto}
        onClose={() => { setAberto(false); setTemDesc(false) }}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => { setAberto(false); setTemDesc(false) }}>Cancelar</button>
            <button type="submit" form="form-produto" className="btn btn-primary" disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar'}</button>
          </>
        }
      >
        <form id="form-produto" action={enviar} className="flex flex-col" style={{ gap: 'var(--s-4)' }}>
          <label className="flex flex-col gap-1">
            <span className="campo-label campo-req">Produto ou serviço</span>
            <select name="product_id" className="field" defaultValue="" required onChange={e => aoEscolher(e.target.value)}>
              <option value="" disabled>Selecione…</option>
              {catalogo.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="campo-label">Quantidade</span>
              <input name="quantity" type="number" min={1} defaultValue={1} className="field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="campo-label">Valor (R$)</span>
              <input name="unit" type="number" min={0} step="0.01" value={unit} onChange={e => setUnit(Number(e.target.value))} className="field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="campo-label">Recorrência</span>
              <select name="recurrence" className="field" value={recorrencia} onChange={e => setRecorrencia(e.target.value)}>
                <option value="unico">Único</option>
                <option value="mensal">Mensal</option>
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={temDesc} onChange={e => setTemDesc(e.target.checked)} />
            <span className="t-sm">Acrescentar desconto</span>
          </label>
          {temDesc && (
            <label className="flex flex-col gap-1" style={{ maxWidth: 220 }}>
              <span className="campo-label">Desconto (R$)</span>
              <input name="discount" type="number" min={0} step="0.01" defaultValue={0} className="field" />
            </label>
          )}

          {erro && <p className="t-sm" style={{ color: 'var(--critical)' }}>{erro}</p>}
        </form>
      </Drawer>

      {produtos.length ? (
        <div className="flex flex-col" style={{ gap: 'var(--s-2)' }}>
          {produtos.map(p => (
            <div key={p.id} className="linha-ficha flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="t-body" style={{ fontWeight: 600 }}>{p.products?.name}</div>
                <div className="t-sm muted">
                  {p.quantity}× {brl(Number(p.mrr ?? 0))}
                  {' · '}{p.recurrence === 'mensal' ? 'mensal' : 'único'}
                  {Number(p.discount ?? 0) > 0 && ` · −${brl(Number(p.discount))} desc.`}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="t-body tabular" style={{ fontWeight: 600 }}>{brl(linha(p))}{p.recurrence === 'mensal' ? '/mês' : ''}</span>
                <button className="remover-x" disabled={pendente} onClick={() => start(async () => { await removerProduto(p.id, oppId) })}>remover</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        !aberto && <Vazio texto="Nenhum produto associado a este negócio." icone={ICO.produtos} />
      )}
    </div>
  )
}

/* ---------------- Arquivos ---------------- */

function Arquivos({ oppId, arquivos }: { oppId: string; arquivos: any[] }) {
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, start] = useTransition()

  function enviar(fd: FormData) {
    setErro(null)
    start(async () => {
      const r = await subirArquivo(oppId, fd)
      if (!r.ok) setErro(r.erro)
    })
  }

  const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

  return (
    <div className="flex flex-col" style={{ gap: 'var(--s-4)' }}>
      <form action={enviar} className="composer flex flex-wrap items-center gap-2">
        <input name="file" type="file" className="field" style={{ width: 'auto', padding: '6px 8px', flex: 1, minWidth: 180 }} required />
        <button className="btn btn-primary btn-sm" disabled={pendente}>{pendente ? 'Enviando…' : 'Enviar arquivo'}</button>
        {erro && <p className="t-sm" style={{ color: 'var(--critical)', width: '100%' }}>{erro}</p>}
      </form>

      {arquivos.length ? (
        <div className="flex flex-col" style={{ gap: 'var(--s-2)' }}>
          {arquivos.map(f => (
            <div key={f.id} className="linha-ficha flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span aria-hidden className="grid place-items-center shrink-0" style={{ width: 34, height: 34, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', color: 'var(--series-1)' }}>
                  <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M11 3v4h4M6 3h6l3 3v11H6z" /></svg>
                </span>
                <div className="min-w-0">
                  <a href={f.url ?? '#'} target="_blank" rel="noreferrer" className="t-body truncate" style={{ color: 'var(--series-1)', fontWeight: 500, display: 'block' }}>{f.name}</a>
                  <div className="t-xs muted">{kb(Number(f.size ?? 0))} · {dia(f.created_at)}</div>
                </div>
              </div>
              <RemoverArquivo id={f.id} oppId={oppId} path={f.path} />
            </div>
          ))}
        </div>
      ) : (
        <Vazio texto="Nenhum arquivo anexado." icone={ICO.arquivos} />
      )}
    </div>
  )
}

function RemoverArquivo({ id, oppId, path }: { id: number; oppId: string; path: string }) {
  const [pendente, start] = useTransition()
  return (
    <button className="remover-x shrink-0" disabled={pendente} onClick={() => start(async () => { await removerArquivo(id, oppId, path) })}>remover</button>
  )
}
