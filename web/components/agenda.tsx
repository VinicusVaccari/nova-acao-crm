'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import type { EventoAgenda } from '@/lib/google'
import { criarReuniaoAgenda, desconectarAgenda, excluirEventoAgenda } from '@/lib/actions'
import { Drawer } from '@/components/drawer'

type NegocioOpcao = { id: string; nome: string }

/* ---------- helpers de data (BRT fixo = UTC−3) ---------- */

function addDias(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

const fmtBRT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})
function partesBRT(iso: string): { ymd: string; hora: number; min: number } {
  const p = Object.fromEntries(fmtBRT.formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  let hora = Number(p.hour)
  if (hora === 24) hora = 0
  return { ymd: `${p.year}-${p.month}-${p.day}`, hora, min: Number(p.minute) }
}

// cor estável do avatar a partir do e-mail
function corEmail(s: string): string {
  const cores = ['#009E9B', '#FAB800', '#412257', '#0e8ecf', '#8b5cf6', '#16a34a']
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return cores[h % cores.length]
}

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const H_INI = 0
const H_FIM = 24
const ROW_H = 48 // px por hora

/* ================= conectar / desconectar ================= */

export function AgendaConectar({ conectada, aviso }: { conectada: boolean; email: string | null; aviso: string | null }) {
  const router = useRouter()
  const [pend, start] = useTransition()

  const msg =
    aviso === 'ok' ? { txt: 'Agenda conectada!', cor: 'var(--brand-teal)' }
    : aviso === 'config' ? { txt: 'Faltam as credenciais do Google (GOOGLE_CLIENT_ID/SECRET).', cor: 'var(--critical)' }
    : aviso === 'negado' ? { txt: 'Autorização cancelada.', cor: 'var(--ink-muted)' }
    : aviso === 'state' || aviso === 'troca' ? { txt: 'Falha ao conectar. Tente de novo.', cor: 'var(--critical)' }
    : null

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {msg && <span className="t-sm" style={{ color: msg.cor }}>{msg.txt}</span>}
      {conectada ? (
        <>
          <a href="/api/calendar/connect" className="btn btn-ghost btn-sm">Reconectar</a>
          <button
            className="btn btn-ghost btn-sm"
            disabled={pend}
            onClick={() => start(async () => { await desconectarAgenda(); router.refresh() })}
          >Desconectar</button>
        </>
      ) : (
        <a href="/api/calendar/connect" className="btn btn-primary">Conectar Google Calendar</a>
      )}
    </div>
  )
}

/* ===================== visão de semana ===================== */

export function AgendaSemana({ dias, hoje, eventos, segunda, negocios, colaboradores = [] }: {
  dias: string[]
  hoje: string
  eventos: EventoAgenda[]
  segunda: string
  negocios: NegocioOpcao[]
  colaboradores?: string[]
}) {
  const [sel, setSel] = useState<EventoAgenda | null>(null)
  const [novo, setNovo] = useState<{ dia?: string; hora?: string } | null>(null)
  const horas = Array.from({ length: H_FIM - H_INI }, (_, i) => H_INI + i)

  // linha do "agora" — só no cliente (evita mismatch de hidratação), atualiza a cada minuto
  const [agora, setAgora] = useState<{ ymd: string; min: number } | null>(null)
  useEffect(() => {
    const tick = () => { const p = partesBRT(new Date().toISOString()); setAgora({ ymd: p.ymd, min: p.hora * 60 + p.min }) }
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  // rola pra manhã/hora atual ao montar (o dia inteiro é grande demais pra ver tudo)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const p = partesBRT(new Date().toISOString())
    const alvoHora = Math.max(H_INI, Math.min(H_FIM - 1, p.hora - 1)) // 1h antes de agora, dentro dos limites
    el.scrollTop = (alvoHora - H_INI) * ROW_H
  }, [segunda])

  // clique num espaço vazio da coluna → abre o formulário já com dia/hora
  const clicarVazio = (dia: string) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return // ignora cliques em eventos
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    const totalMin = H_INI * 60 + (y / ROW_H) * 60
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60 < 30 ? '00' : '30'
    setNovo({ dia, hora: `${String(h).padStart(2, '0')}:${m}` })
  }

  // agrupa eventos por dia
  const doDia = (ymd: string) => eventos.filter(e => e.inicio && partesBRT(e.inicio).ymd === ymd)

  const rotuloMes = () => {
    const [ay, am] = dias[0].split('-').map(Number)
    const [by, bm] = dias[6].split('-').map(Number)
    const a = `${MESES[am - 1]}${ay !== by ? ` ${ay}` : ''}`
    const b = `${MESES[bm - 1]} ${by}`
    return am === bm && ay === by ? `${MESES[am - 1]} ${ay}` : `${a} – ${b}`
  }

  return (
    <div className="card ag" style={{ padding: 0, overflow: 'hidden' }}>
      {/* navegação */}
      <div className="ag-nav">
        <div className="flex items-center gap-2">
          <Link href={`/agenda?dia=${addDias(segunda, -7)}`} className="btn btn-ghost btn-sm" aria-label="Semana anterior">←</Link>
          <Link href={`/agenda?dia=${hoje}`} className="btn btn-ghost btn-sm">Hoje</Link>
          <Link href={`/agenda?dia=${addDias(segunda, 7)}`} className="btn btn-ghost btn-sm" aria-label="Próxima semana">→</Link>
        </div>
        <span className="t-body" style={{ fontWeight: 600, textTransform: 'capitalize' }}>{rotuloMes()}</span>
        <button className="btn btn-primary btn-sm" onClick={() => setNovo({})}>+ Nova reunião</button>
      </div>

      <div className="ag-scroll" ref={scrollRef}>
      {/* cabeçalho dos dias */}
      <div className="ag-grid ag-head">
        <div className="ag-corner" />
        {dias.map((d, i) => {
          const dd = d.split('-')[2]
          return (
            <div key={d} className="ag-dh" data-hoje={d === hoje}>
              <span className="t-xs muted">{DIAS_SEMANA[i]}</span>
              <span className="ag-dnum">{Number(dd)}</span>
            </div>
          )
        })}
      </div>

      {/* faixa "dia todo" (só aparece se houver) */}
      {dias.some(d => doDia(d).some(e => e.diaInteiro)) && (
        <div className="ag-grid ag-allday">
          <div className="ag-corner t-2xs muted" style={{ alignSelf: 'center', paddingRight: 6, textAlign: 'right' }}>dia todo</div>
          {dias.map(d => (
            <div key={d} className="ag-allday-cell">
              {doDia(d).filter(e => e.diaInteiro).map(e => (
                <EventoChip key={e.id} ev={e} inteiro onClick={() => setSel(e)} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* corpo com horas */}
      <div className="ag-grid ag-body">
        <div className="ag-gutter">
          {horas.map(h => <div key={h} className="ag-hour" style={{ height: ROW_H }}><span>{h}:00</span></div>)}
        </div>
        {dias.map(d => (
          <div
            key={d}
            className="ag-col"
            data-hoje={d === hoje}
            onClick={clicarVazio(d)}
            style={{ height: horas.length * ROW_H, backgroundSize: `100% ${ROW_H}px`, cursor: 'pointer' }}
          >
            {agora && agora.ymd === d && agora.min >= H_INI * 60 && agora.min <= H_FIM * 60 && (
              <div className="ag-now" style={{ top: (agora.min - H_INI * 60) / 60 * ROW_H }} aria-hidden>
                <span className="ag-now-dot" />
              </div>
            )}
            {doDia(d).filter(e => !e.diaInteiro && e.inicio).map(e => {
              const ini = partesBRT(e.inicio!)
              const fimP = e.fim ? partesBRT(e.fim) : { hora: ini.hora + 1, min: ini.min }
              const iniMin = ini.hora * 60 + ini.min
              const fimMin = Math.max(fimP.hora * 60 + fimP.min, iniMin + 20)
              const top = Math.max(0, (iniMin - H_INI * 60) / 60 * ROW_H)
              const altBruta = Math.min((fimMin - iniMin) / 60 * ROW_H, horas.length * ROW_H - top)
              const alt = Math.max(altBruta, 22)
              return (
                <div key={e.id} className="ag-ev" style={{ top, height: alt }}>
                  <EventoChip ev={e} curto={alt < 42} onClick={() => setSel(e)} />
                </div>
              )
            })}
          </div>
        ))}
      </div>
      </div>

      <EventoDrawer ev={sel} onClose={() => setSel(null)} />
      {novo && <NovaReuniaoDrawer prefill={novo} negocios={negocios} colaboradores={colaboradores} onClose={() => setNovo(null)} />}
    </div>
  )
}

function NovaReuniaoDrawer({ prefill, negocios, colaboradores = [], onClose }: {
  prefill: { dia?: string; hora?: string }
  negocios: NegocioOpcao[]
  colaboradores?: string[]
  onClose: () => void
}) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  const [titulo, setTitulo] = useState('')
  const [oppId, setOppId] = useState('')
  const [dia, setDia] = useState(prefill.dia ?? '')
  const [hora, setHora] = useState(prefill.hora ?? '09:00')
  const [dur, setDur] = useState('60')
  const [comMeet, setComMeet] = useState(true)
  const [convidados, setConvidados] = useState('')

  // adiciona um e-mail de colaborador ao campo (sem duplicar)
  const addConvidado = (em: string) => setConvidados(prev => {
    const set = new Set(prev.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean))
    if (set.has(em)) return prev
    set.add(em)
    return [...set].join(', ')
  })

  const criar = () => {
    setErro(null)
    if (!titulo.trim()) return setErro('Informe o título.')
    if (!dia) return setErro('Escolha a data.')
    start(async () => {
      const emails = convidados.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
      const r = await criarReuniaoAgenda({
        titulo, dia, hora, duracaoMin: Number(dur),
        oppId: oppId || null,
        convidados: emails.length ? emails : undefined,
        comMeet,
      })
      if (!r.ok) return setErro(r.erro)
      onClose()
      router.refresh()
    })
  }

  return (
    <Drawer titulo="Nova reunião" aberto onClose={onClose}
      footer={<button className="btn btn-primary" disabled={pend} onClick={criar} style={{ width: '100%' }}>{pend ? 'Criando…' : 'Criar reunião'}</button>}
    >
      <div className="flex flex-col" style={{ gap: 'var(--s-4)' }}>
        <label className="flex flex-col gap-1">
          <span className="ctx-rotulo">Título</span>
          <input className="field" value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex.: Diagnóstico · Fulano" autoFocus />
        </label>

        <label className="flex flex-col gap-1">
          <span className="ctx-rotulo">Negócio (opcional)</span>
          <select className="field" value={oppId} onChange={e => {
            setOppId(e.target.value)
            if (e.target.value && !titulo.trim()) {
              const n = negocios.find(x => x.id === e.target.value)
              if (n) setTitulo(`Diagnóstico · ${n.nome}`)
            }
          }}>
            <option value="">Evento avulso (sem negócio)</option>
            {negocios.map(n => <option key={n.id} value={n.id}>{n.nome}</option>)}
          </select>
          <span className="t-2xs muted">Se vincular, a reunião também entra na ficha do negócio.</span>
        </label>

        <div className="flex gap-2">
          <label className="flex flex-col gap-1" style={{ flex: 1 }}>
            <span className="ctx-rotulo">Data</span>
            <input className="field" type="date" value={dia} onChange={e => setDia(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1" style={{ width: 110 }}>
            <span className="ctx-rotulo">Hora</span>
            <input className="field" type="time" value={hora} onChange={e => setHora(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1" style={{ width: 110 }}>
            <span className="ctx-rotulo">Duração</span>
            <select className="field" value={dur} onChange={e => setDur(e.target.value)}>
              <option value="30">30 min</option>
              <option value="60">1 h</option>
              <option value="90">1h30</option>
              <option value="120">2 h</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="ctx-rotulo">Convidados (opcional)</span>
          <input className="field" list="ag-colabs" value={convidados} onChange={e => setConvidados(e.target.value)} placeholder="email1@..., email2@..." inputMode="email" />
          <datalist id="ag-colabs">
            {colaboradores.map(em => <option key={em} value={em} />)}
          </datalist>
          {colaboradores.length > 0 && (
            <div className="flex flex-col" style={{ gap: 6, marginTop: 6 }}>
              <span className="t-2xs muted">Colaboradores — clique pra adicionar</span>
              <div className="flex flex-wrap" style={{ gap: 6 }}>
                {colaboradores.map(em => (
                  <button key={em} type="button" className="colab-chip" title={`Adicionar ${em}`} onClick={() => addConvidado(em)}>
                    <span className="colab-av" style={{ background: corEmail(em) }}>{em[0]?.toUpperCase()}</span>
                    <span className="colab-em">{em}</span>
                    <span className="colab-add" aria-hidden>+</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </label>

        <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={comMeet} onChange={e => setComMeet(e.target.checked)} />
          <span className="t-sm">Gerar link do Google Meet</span>
        </label>

        {erro && <p className="t-sm" style={{ color: 'var(--critical)' }}>{erro}</p>}
      </div>
    </Drawer>
  )
}

function horaMin(iso: string): string {
  const p = partesBRT(iso)
  return `${String(p.hora).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`
}

function EventoChip({ ev, inteiro, curto, onClick }: { ev: EventoAgenda; inteiro?: boolean; curto?: boolean; onClick: () => void }) {
  const hora = !inteiro && ev.inicio ? horaMin(ev.inicio) : null
  // Em blocos curtos, hora e título dividem a MESMA linha — assim o nome
  // nunca some por falta de altura.
  return (
    <button className={`ag-ev-in${curto ? ' ag-ev-in--curto' : ''}`} title={ev.titulo} onClick={onClick}>
      {hora && <span className="ag-ev-h tabular">{hora}</span>}
      <span className="ag-ev-t">{ev.titulo}</span>
    </button>
  )
}

const STATUS_ROTULO: Record<string, string> = {
  accepted: 'confirmou', declined: 'recusou', tentative: 'talvez', needsAction: 'pendente',
}

function EventoDrawer({ ev, onClose }: { ev: EventoAgenda | null; onClose: () => void }) {
  const router = useRouter()
  const [pend, start] = useTransition()
  if (!ev) return null
  const excluir = () => {
    if (!confirm('Excluir este agendamento? Ele sai da agenda do Google e os convidados são avisados.')) return
    start(async () => { const r = await excluirEventoAgenda(ev.id); if (r.ok) { onClose(); router.refresh() } })
  }
  const data = ev.inicio
    ? new Date(ev.inicio).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long' })
    : null
  const faixa = ev.diaInteiro ? 'Dia todo' : ev.inicio ? `${horaMin(ev.inicio)}${ev.fim ? ` – ${horaMin(ev.fim)}` : ''}` : null

  return (
    <Drawer
      titulo={ev.titulo} aberto onClose={onClose}
      footer={<button className="btn btn-danger" onClick={excluir} disabled={pend} style={{ width: '100%' }}>{pend ? 'Excluindo…' : 'Excluir agendamento'}</button>}
    >
      <div className="flex flex-col" style={{ gap: 'var(--s-5)' }}>
        <div>
          {data && <div className="t-body" style={{ textTransform: 'capitalize', fontWeight: 600 }}>{data}</div>}
          {faixa && <div className="t-sm muted tabular">{faixa}</div>}
        </div>

        {ev.meetUrl && (
          <a href={ev.meetUrl} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
            Entrar com o Google Meet
          </a>
        )}

        {ev.local && (
          <div className="ctx-sec">
            <span className="ctx-rotulo">Local</span>
            <span className="t-sm">{ev.local}</span>
          </div>
        )}

        {ev.convidados.length > 0 && (
          <div className="ctx-sec">
            <span className="ctx-rotulo">Convidados ({ev.convidados.length})</span>
            <div className="flex flex-col gap-2">
              {ev.convidados.map(c => (
                <div key={c.email} className="flex items-baseline justify-between gap-3">
                  <span className="t-sm truncate">{c.nome || c.email}{c.organizador ? ' · organizador' : ''}</span>
                  {c.status && <span className="t-xs muted">{STATUS_ROTULO[c.status] ?? c.status}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {ev.descricao && (
          <div className="ctx-sec">
            <span className="ctx-rotulo">Descrição</span>
            <p className="t-sm" style={{ whiteSpace: 'pre-wrap' }}>{ev.descricao}</p>
          </div>
        )}

        {ev.htmlLink && (
          <a href={ev.htmlLink} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}>
            Abrir no Google Calendar
          </a>
        )}
      </div>
    </Drawer>
  )
}
