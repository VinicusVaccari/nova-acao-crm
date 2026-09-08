'use client'

import { useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from 'react'
import Link from 'next/link'
import { Avatar } from '@/components/ui'
import { useEstagiosBoard, useCorEstagio } from '@/components/estagios-context'
import { brlCurto } from '@/lib/format'
import { adicionarNota, adicionarProduto, adicionarTarefa, atualizarContato, atualizarNegocio, contextoDeal, definirAtendimento, listarConversas, listarMensagens, moverEstagio, removerProduto, responderConversa, type ContextoDeal } from '@/lib/actions'
import type { Conversa, Mensagem } from '@/lib/mensagens'

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

function quandoCurto(iso: string) {
  const d = new Date(iso)
  const hoje = new Date()
  if (d.toDateString() === hoje.toDateString()) return hora(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

const mmss = (s: number) => {
  if (!isFinite(s) || s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

/* alturas das ondas: determinísticas a partir do src (cada áudio tem seu
   formato estável) — sem decodificar o arquivo, é leve e nunca falha. */
function ondas(src: string, n = 38): number[] {
  let h = 0
  for (let i = 0; i < src.length; i++) h = (Math.imul(h, 31) + src.charCodeAt(i)) >>> 0
  const bars: number[] = []
  for (let i = 0; i < n; i++) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0
    bars.push(0.28 + (h % 1000) / 1000 * 0.72) // 0.28..1
  }
  return bars
}

/* Player de áudio no estilo mensagem de voz (WhatsApp/RD): play/pause,
   barra arrastável e tempo. O <audio> nativo fica escondido. */
function AudioMsg({ src, accent }: { src: string; accent: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [tocando, setTocando] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)

  // ogg/opus no Chrome às vezes reporta duration = Infinity; força o cálculo.
  const lerDuracao = () => {
    const a = ref.current
    if (!a) return
    if (a.duration === Infinity || Number.isNaN(a.duration)) {
      const fix = () => {
        a.removeEventListener('timeupdate', fix)
        a.currentTime = 0
        setDur(Number.isFinite(a.duration) ? a.duration : 0)
      }
      a.addEventListener('timeupdate', fix)
      a.currentTime = 1e101
    } else {
      setDur(a.duration)
    }
  }

  const toggle = () => {
    const a = ref.current
    if (!a) return
    if (a.paused) { void a.play(); setTocando(true) } else { a.pause(); setTocando(false) }
  }

  const seek = (e: MouseEvent<HTMLDivElement>) => {
    const a = ref.current
    if (!a || !dur) return
    const r = e.currentTarget.getBoundingClientRect()
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    a.currentTime = p * dur
    setCur(p * dur)
  }

  const prog = dur ? cur / dur : 0
  const barras = useMemo(() => ondas(src), [src])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 300 }}>
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={lerDuracao}
        onTimeUpdate={() => { const a = ref.current; if (a) setCur(a.currentTime) }}
        onEnded={() => { setTocando(false); setCur(0) }}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={tocando ? 'Pausar' : 'Tocar'}
        style={{
          flexShrink: 0, width: 42, height: 42, borderRadius: '50%', border: 'none',
          background: accent, color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center',
        }}
      >
        {tocando ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div onClick={seek} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2, height: 34, cursor: 'pointer' }}>
          {barras.map((v, i) => {
            const tocado = (i + 0.5) / barras.length <= prog
            return (
              <div
                key={i}
                style={{
                  flex: 1, height: `${Math.round(v * 100)}%`, minHeight: 3, borderRadius: 2,
                  background: tocado ? accent : 'color-mix(in srgb, var(--ink) 20%, transparent)',
                  transition: 'background .12s',
                }}
              />
            )
          })}
          {/* bolinha (playhead) — começa no início e anda conforme toca */}
          <div
            style={{
              position: 'absolute', left: `${prog * 100}%`, top: '50%',
              width: 14, height: 14, borderRadius: '50%', background: accent,
              transform: 'translate(-50%, -50%)', boxShadow: '0 1px 3px rgba(0,0,0,.3)',
              border: '2px solid var(--surface)', pointerEvents: 'none',
            }}
          />
        </div>
        <span className="t-xs muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{mmss(cur)} / {mmss(dur)}</span>
      </div>
    </div>
  )
}

/* Status da conversa combina a TRAVA (quem responde) com quem já atendeu:
   - Naia    → não travado, a IA cuida
   - Travado → travado e ninguém do time pegou ainda (precisa assumir)
   - Você    → travado e o time já respondeu por aqui (em atendimento) */
const badgesStatus = {
  naia:    { texto: 'Naia',    cor: 'var(--brand-teal)' },
  travado: { texto: 'Travado', cor: 'var(--serious)' },
  voce:    { texto: 'Você',    cor: 'var(--series-3)' },
} as const

function statusConversa(c: Conversa): keyof typeof badgesStatus {
  if (c.atendimento === 'humano') return c.humanoRespondeu ? 'voce' : 'travado'
  return 'naia'
}

/* Mensagem já carregada não é substituída: a URL assinada do áudio muda a
   cada consulta, e trocá-la reiniciaria o player no meio da reprodução. */
function mesclar(atuais: Mensagem[], novas: Mensagem[]): Mensagem[] {
  const porId = new Map(atuais.map(m => [m.id, m]))
  for (const m of novas) if (!porId.has(m.id)) porId.set(m.id, m)
  return [...porId.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
}

export function Inbox({ conversas, selInicial }: { conversas: Conversa[]; selInicial?: string | null }) {
  const [convs, setConvs] = useState<Conversa[]>(conversas)
  const [selId, setSelId] = useState<string | null>(
    (selInicial && conversas.some(c => c.oppId === selInicial) ? selInicial : conversas[0]?.oppId) ?? null,
  )
  const [busca, setBusca] = useState('')
  const [ctx, setCtx] = useState(true)
  const [, startTop] = useTransition()
  const fioRef = useRef<HTMLDivElement>(null)

  // fio da conversa aberta: carregado sob demanda, do mais novo para trás
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [temMais, setTemMais] = useState(false)
  const [carregando, setCarregando] = useState(true)

  const recarregar = async () => {
    try {
      const [frescas, fio] = await Promise.all([
        listarConversas(),
        selId ? listarMensagens(selId) : Promise.resolve(null),
      ])
      setConvs(frescas)
      if (fio) { setMensagens(prev => mesclar(prev, fio.mensagens)); setTemMais(m => m || fio.temMais) }
    } catch { /* próximo tick */ }
  }

  /* Trocar de conversa zera o fio já na renderização. Limpar dentro do efeito
     pintaria a conversa nova com as mensagens da anterior por um quadro. */
  const [fioDe, setFioDe] = useState(selId)
  if (fioDe !== selId) {
    setFioDe(selId)
    setMensagens([])
    setTemMais(false)
    setCarregando(!!selId)
  }

  // e o efeito só busca a página mais recente da conversa aberta
  useEffect(() => {
    if (!selId) return
    let ativo = true
    listarMensagens(selId)
      .then(r => { if (!ativo) return; setMensagens(r.mensagens); setTemMais(r.temMais) })
      .catch(() => { /* o polling tenta de novo */ })
      .finally(() => { if (ativo) setCarregando(false) })
    return () => { ativo = false }
  }, [selId])

  // atualiza sozinho a cada 2s (só com a aba visível): a lista de conversas
  // e as mensagens novas da conversa aberta
  useEffect(() => {
    let ativo = true
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const [frescas, fio] = await Promise.all([
          listarConversas(),
          selId ? listarMensagens(selId) : Promise.resolve(null),
        ])
        if (!ativo) return
        setConvs(frescas)
        if (fio) setMensagens(prev => mesclar(prev, fio.mensagens))
      } catch { /* rede — tenta no próximo tick */ }
    }
    const id = setInterval(tick, 2000)
    // recarrega na hora quando a aba volta a ficar visível (sem esperar o tick)
    const onVis = () => { if (typeof document !== 'undefined' && !document.hidden) void tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => { ativo = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [selId])

  const carregarAnteriores = () => {
    const maisAntiga = mensagens[0]
    if (!selId || !maisAntiga || carregando) return
    setCarregando(true)
    listarMensagens(selId, maisAntiga.at)
      .then(r => { setMensagens(prev => mesclar(prev, r.mensagens)); setTemMais(r.temMais) })
      .catch(() => { /* mantém o que já está na tela */ })
      .finally(() => setCarregando(false))
  }

  // assumir a conversa (trava permanente — a Naia não volta pra esse lead)
  const assumir = (c: Conversa) =>
    startTop(async () => { await definirAtendimento(c.oppId, true); await recarregar() })

  const filtradas = busca.trim()
    ? convs.filter(c => `${c.nome} ${c.empresa ?? ''}`.toLowerCase().includes(busca.toLowerCase().trim()))
    : convs

  const sel = convs.find(c => c.oppId === selId) ?? null

  // rola pro fim quando chega mensagem nova ou troca de conversa. Depende do
  // id da ÚLTIMA mensagem: carregar histórico antigo não puxa a tela pra baixo.
  const ultimaId = mensagens[mensagens.length - 1]?.id
  useEffect(() => {
    const el = fioRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [selId, ultimaId])

  return (
    <div className={`inbox${ctx ? '' : ' inbox--sem-ctx'}`}>
      {/* ---------- lista de conversas ---------- */}
      <div className="inbox-lista">
        <div style={{ padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--hairline)' }}>
          <input className="field" placeholder="Buscar conversa…" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {filtradas.map(c => {
            const b = badgesStatus[statusConversa(c)]
            return (
              <div key={c.oppId} className="conversa-item" data-sel={c.oppId === selId} onClick={() => setSelId(c.oppId)}>
                <Avatar nome={c.nome} tamanho={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="t-body truncate" style={{ fontWeight: 600 }}>{c.nome}</span>
                    <span className="t-xs muted shrink-0">{quandoCurto(c.ultimaAt)}</span>
                  </div>
                  <div className="t-sm muted truncate">{c.ultima || 'sem mensagens'}</div>
                  <span className="chip" style={{ marginTop: 4, background: `color-mix(in srgb, ${b.cor} 14%, transparent)`, color: b.cor }}>
                    <span aria-hidden className="chip-dot" style={{ background: b.cor }} />
                    {b.texto}
                  </span>
                </div>
              </div>
            )
          })}
          {filtradas.length === 0 && <p className="t-sm muted" style={{ padding: 'var(--s-5)' }}>Nenhuma conversa.</p>}
        </div>
      </div>

      {/* ---------- fio da conversa ---------- */}
      <div className="inbox-fio">
        {sel ? (
          <>
            <div className="flex items-center gap-3" style={{ padding: 'var(--s-3) var(--s-5)', borderBottom: '1px solid var(--hairline)', background: 'var(--surface)' }}>
              <Avatar nome={sel.nome} tamanho={38} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="t-h3 truncate">{sel.nome}</span>
                  <span className="chip" style={{ background: sel.atendimento === 'humano' ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'color-mix(in srgb, var(--brand-teal) 16%, transparent)', color: sel.atendimento === 'humano' ? 'var(--accent-ink)' : 'var(--brand-teal-700)' }}>
                    {sel.atendimento === 'humano' ? 'Você atende' : 'Naia atende'}
                  </span>
                </div>
                <div className="t-sm muted truncate">{sel.telefone ?? ''}{sel.empresa ? ` · ${sel.empresa}` : ''}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => assumir(sel)} disabled={sel.atendimento === 'humano'}>
                {sel.atendimento === 'humano' ? 'Assumido' : 'Assumir'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setCtx(v => !v)}
                data-ativo={ctx}
                title={ctx ? 'Ocultar contexto' : 'Mostrar contexto'}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="14" height="12" rx="2" /><path d="M13 4v12" />
                </svg>
                Contexto
              </button>
              <Link href={`/lead/${sel.oppId}`} className="btn btn-ghost btn-sm">Abrir negócio</Link>
            </div>

            <div ref={fioRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--s-5)', display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
              {temMais && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ alignSelf: 'center', marginBottom: 'var(--s-2)' }}
                  onClick={carregarAnteriores}
                  disabled={carregando}
                >
                  {carregando ? 'Carregando…' : 'Carregar mensagens anteriores'}
                </button>
              )}
              {!temMais && mensagens.length === 0 && (
                <p className="t-sm muted" style={{ alignSelf: 'center' }}>
                  {carregando ? 'Carregando mensagens…' : 'Nenhuma mensagem nesta conversa.'}
                </p>
              )}
              {mensagens.map(m => {
                const tipo = m.direction === 'inbound' ? 'lead' : m.automatizada ? 'naia' : 'humano'
                return (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: tipo === 'lead' ? 'flex-start' : 'flex-end' }}>
                    {tipo === 'naia' && (
                      <span className="t-xs" style={{ color: 'var(--brand-teal)', fontWeight: 600, marginBottom: 2 }}>
                        Naia · IA
                      </span>
                    )}
                    {m.kind === 'audio' && m.audioUrl ? (
                      <div className={`bolha bolha--${tipo}`} style={{ padding: '8px 10px' }}>
                        <AudioMsg src={m.audioUrl} accent={tipo === 'humano' ? 'var(--accent)' : 'var(--brand-teal)'} />
                      </div>
                    ) : (
                      <div className={`bolha bolha--${tipo}`}>{m.body || <span className="muted">(sem texto)</span>}</div>
                    )}
                    <span className="t-xs muted" style={{ marginTop: 2 }}>{hora(m.at)}{m.outcome ? ` · ${m.outcome}` : ''}</span>
                  </div>
                )
              })}
            </div>

            <Composer oppId={sel.oppId} atendimento={sel.atendimento} onEnviou={recarregar} />
          </>
        ) : (
          <div className="grid place-items-center" style={{ height: '100%' }}>
            <p className="t-sm muted">Selecione uma conversa.</p>
          </div>
        )}
      </div>

      {/* ---------- contexto do negócio (editável) ---------- */}
      <div className="inbox-ctx">
        {sel ? <ContextoPainel key={sel.oppId} oppId={sel.oppId} /> : null}
      </div>
    </div>
  )
}

/* =============== composer (Rodrigues responde) =============== */

function Composer({ oppId, atendimento, onEnviou }: { oppId: string; atendimento: 'naia' | 'humano'; onEnviou: () => void }) {
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()

  const enviar = () => {
    if (!texto.trim()) return
    setErro(null)
    start(async () => {
      const r = await responderConversa(oppId, texto)
      if (!r.ok) { setErro(r.erro); return }
      setTexto('')
      onEnviou()
    })
  }

  return (
    <div style={{ padding: 'var(--s-3) var(--s-5)', borderTop: '1px solid var(--hairline)', background: 'var(--surface)' }}>
      {atendimento === 'naia' && (
        <p className="t-xs muted" style={{ marginBottom: 6 }}>
          A <b>Naia</b> está atendendo. Ao enviar, <b>você assume</b> a conversa e a Naia para de responder.
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          className="field"
          placeholder="Escreva uma mensagem…"
          value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
          disabled={pend}
        />
        <button className="btn btn-primary" onClick={enviar} disabled={pend || !texto.trim()}>{pend ? 'Enviando…' : 'Enviar'}</button>
      </div>
      {erro && <p className="t-xs" style={{ color: 'var(--critical)', marginTop: 4 }}>{erro}</p>}
    </div>
  )
}

/* =============== painel de contexto editável =============== */

function ContextoPainel({ oppId }: { oppId: string }) {
  const [ctx, setCtx] = useState<ContextoDeal | null>(null)
  const [pend, start] = useTransition()
  const ESTAGIOS = useEstagiosBoard()
  const corEstagio = useCorEstagio()

  const recarregar = () => contextoDeal(oppId).then(setCtx)
  useEffect(() => { recarregar() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [oppId])

  if (!ctx) return <p className="t-sm muted" style={{ padding: 'var(--s-2)' }}>Carregando…</p>

  const cor = corEstagio(ctx.stage)
  const acao = (fn: () => Promise<unknown>) => start(async () => { await fn(); await recarregar() })

  return (
    <div>
      {/* cabeçalho */}
      <div className="flex items-center gap-3" style={{ marginBottom: 'var(--s-5)' }}>
        <Avatar nome={ctx.nome} tamanho={46} cor={cor} />
        <div className="min-w-0">
          <div className="t-body truncate" style={{ fontWeight: 600 }}>{ctx.title || ctx.nome}</div>
          {ctx.empresa && <div className="t-sm muted truncate">{ctx.empresa}</div>}
        </div>
      </div>

      {/* Etapa + Responsável */}
      <div className="ctx-sec">
        <label className="flex flex-col gap-1">
          <span className="ctx-rotulo">Etapa</span>
          <select
            className="field"
            value={ctx.stage}
            disabled={pend}
            onChange={e => acao(() => moverEstagio(oppId, e.target.value))}
            style={{ fontWeight: 600 }}
          >
            {ESTAGIOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            {ctx.stage === 'perdido' && <option value="perdido">Perdido</option>}
            {ctx.stage === 'nutricao' && <option value="nutricao">Nutrição</option>}
          </select>
        </label>

        <div className="ctx-linha" style={{ marginTop: 'var(--s-2)' }}>
          <span className="ctx-rotulo">Qualificação</span>
          <div className="flex items-center">
            {[1, 2, 3, 4, 5].map(n => {
              const on = n <= ctx.qualificacao
              return (
                <button key={n} className="ctx-estrela" disabled={pend} onClick={() => acao(() => atualizarNegocio(oppId, { qualificacao: n === ctx.qualificacao ? 0 : n }))} aria-label={`${n} estrelas`}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill={on ? 'var(--accent)' : 'none'} stroke={on ? 'var(--accent)' : 'var(--ink-muted)'} strokeWidth="1.4" strokeLinejoin="round">
                    <path d="M10 2.5l2.3 4.7 5.2.76-3.75 3.66.88 5.18L10 14.9l-4.63 2.4.88-5.18L2.5 7.96l5.2-.76z" />
                  </svg>
                </button>
              )
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1" style={{ marginTop: 'var(--s-2)' }}>
          <span className="ctx-rotulo">Responsável</span>
          <select className="field" value={ctx.ownerId ?? ''} disabled={pend} onChange={e => acao(() => atualizarNegocio(oppId, { owner_id: e.target.value || null }))}>
            <option value="">Sem dono</option>
            {ctx.usuarios.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </label>
      </div>

      {/* Contato — telefone editável */}
      <div className="ctx-sec">
        <span className="ctx-rotulo">Telefone</span>
        <TelefoneRapido personId={ctx.personId} oppId={oppId} telefone={ctx.telefone} onFeito={recarregar} />
      </div>

      {/* Produtos + valor total */}
      <ProdutosRapidos oppId={oppId} produtos={ctx.produtos} catalogo={ctx.catalogo} valor={ctx.valor} onFeito={recarregar} />

      {/* Próxima tarefa */}
      <TarefaRapida oppId={oppId} nextStep={ctx.nextStep} nextStepDue={ctx.nextStepDue} usuarios={ctx.usuarios} onFeito={recarregar} />

      {/* Anotações */}
      <NotasRapidas oppId={oppId} notas={ctx.notas} onFeito={recarregar} />

      <div className="ctx-abrir">
        <Link href={`/lead/${oppId}`} className="btn btn-primary" style={{ width: '100%' }}>Abrir negociação</Link>
      </div>
    </div>
  )
}

function TelefoneRapido({ personId, oppId, telefone, onFeito }: { personId: string; oppId: string; telefone: string | null; onFeito: () => void }) {
  const [valor, setValor] = useState(telefone ?? '')
  const [pend, start] = useTransition()
  const mudou = valor.trim() !== (telefone ?? '')

  return (
    <div className="flex gap-2">
      <input className="field" placeholder="(00) 00000-0000" value={valor} onChange={e => setValor(e.target.value)} inputMode="tel" />
      {mudou && (
        <button
          className="btn btn-ghost"
          disabled={pend}
          onClick={() => start(async () => { await atualizarContato(personId, oppId, { phone_primary: valor.trim() || null }); onFeito() })}
        >Salvar</button>
      )}
    </div>
  )
}

function ProdutosRapidos({ oppId, produtos, catalogo, valor, onFeito }: {
  oppId: string
  produtos: ContextoDeal['produtos']
  catalogo: ContextoDeal['catalogo']
  valor: number
  onFeito: () => void
}) {
  const [abrir, setAbrir] = useState(false)
  const [prodId, setProdId] = useState('')
  const [preco, setPreco] = useState('')
  const [rec, setRec] = useState('mensal')
  const [pend, start] = useTransition()

  const rotuloRec = (r: string) => (r === 'mensal' ? '/mês' : r === 'anual' ? '/ano' : '')

  const adicionar = () => {
    if (!prodId) return
    start(async () => {
      await adicionarProduto(oppId, { productId: Number(prodId), quantity: 1, unitValue: Number(preco.replace(',', '.')) || 0, recurrence: rec, discount: 0 })
      setProdId(''); setPreco(''); setRec('mensal'); setAbrir(false); onFeito()
    })
  }

  return (
    <div className="ctx-sec">
      <div className="ctx-linha">
        <span className="ctx-rotulo">Produtos</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setAbrir(v => !v)}>{abrir ? 'Cancelar' : '+ Adicionar'}</button>
      </div>

      {produtos.length > 0 ? (
        <div className="inset" style={{ overflow: 'hidden' }}>
          {produtos.map((p, i) => (
            <div key={p.id} className="ctx-prod" style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}>
              <div className="min-w-0">
                <div className="t-sm truncate" style={{ fontWeight: 500 }}>{p.nome}</div>
                <div className="t-xs muted tabular">{brlCurto(p.mrr * p.quantity)}{rotuloRec(p.recurrence)}{p.quantity > 1 ? ` · ${p.quantity}×` : ''}</div>
              </div>
              <button className="ctx-prod-x" disabled={pend} onClick={() => start(async () => { await removerProduto(p.id, oppId); onFeito() })} aria-label="Remover produto">✕</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="t-xs muted">Nenhum produto neste negócio.</p>
      )}

      {abrir && (
        <div className="inset flex flex-col gap-2" style={{ padding: 'var(--s-3)', marginTop: 'var(--s-1)' }}>
          <select className="field" value={prodId} onChange={e => setProdId(e.target.value)}>
            <option value="">Escolha o produto…</option>
            {catalogo.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex gap-2">
            <input className="field" placeholder="Valor" value={preco} onChange={e => setPreco(e.target.value)} inputMode="decimal" />
            <select className="field" value={rec} onChange={e => setRec(e.target.value)} style={{ width: 120 }}>
              <option value="mensal">/mês</option>
              <option value="anual">/ano</option>
              <option value="unico">Único</option>
            </select>
          </div>
          <button className="btn btn-primary btn-sm" disabled={pend || !prodId} onClick={adicionar}>Adicionar produto</button>
        </div>
      )}

      <div className="ctx-linha" style={{ marginTop: 'var(--s-2)' }}>
        <span className="t-sm muted">Valor total</span>
        <span className="t-body tabular" style={{ fontWeight: 700 }}>{brlCurto(valor)}</span>
      </div>
    </div>
  )
}

function TarefaRapida({ oppId, nextStep, nextStepDue, usuarios, onFeito }: {
  oppId: string
  nextStep: string | null
  nextStepDue: string | null
  usuarios: ContextoDeal['usuarios']
  onFeito: () => void
}) {
  const [texto, setTexto] = useState('')
  const [data, setData] = useState('')
  const [pend, start] = useTransition()
  const atrasada = nextStepDue && new Date(nextStepDue) < new Date()

  const criar = () => {
    if (!texto.trim()) return
    start(async () => {
      await adicionarTarefa(oppId, { title: texto, kind: 'geral', date: data || undefined, ownerId: usuarios[0]?.id })
      setTexto(''); setData(''); onFeito()
    })
  }

  return (
    <div className="ctx-sec">
      <span className="ctx-rotulo">Próxima tarefa</span>
      {nextStep ? (
        <div className="inset" style={{ padding: 'var(--s-2) var(--s-3)' }}>
          <div className="t-sm">{nextStep}</div>
          {nextStepDue && <div className="t-xs tabular" style={{ color: atrasada ? 'var(--critical)' : 'var(--ink-muted)' }}>{new Date(nextStepDue).toLocaleDateString('pt-BR')}{atrasada ? ' · atrasada' : ''}</div>}
        </div>
      ) : (
        <p className="t-xs muted">Sem tarefa pendente.</p>
      )}
      <input className="field" placeholder="Nova tarefa…" value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') criar() }} />
      <div className="flex gap-2">
        <input className="field" type="date" value={data} onChange={e => setData(e.target.value)} />
        <button className="btn btn-ghost" disabled={pend || !texto.trim()} onClick={criar}>Criar</button>
      </div>
    </div>
  )
}

function NotasRapidas({ oppId, notas, onFeito }: { oppId: string; notas: { id: number; body: string; created_at: string }[]; onFeito: () => void }) {
  const [texto, setTexto] = useState('')
  const [pend, start] = useTransition()

  return (
    <div className="ctx-sec">
      <span className="ctx-rotulo">Anotações</span>
      <textarea className="field" rows={2} placeholder="Anotar algo…" value={texto} onChange={e => setTexto(e.target.value)} />
      <button
        className="btn btn-ghost btn-sm"
        style={{ alignSelf: 'flex-start' }}
        disabled={pend || !texto.trim()}
        onClick={() => start(async () => { await adicionarNota(oppId, texto); setTexto(''); onFeito() })}
      >Adicionar anotação</button>
      {notas.length > 0 && (
        <div className="flex flex-col gap-2" style={{ maxHeight: 200, overflowY: 'auto', marginTop: 'var(--s-1)' }}>
          {notas.map(n => (
            <div key={n.id} className="inset" style={{ padding: 'var(--s-2) var(--s-3)' }}>
              <div className="t-sm" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
              <div className="t-xs muted tabular" style={{ marginTop: 2 }}>{new Date(n.created_at).toLocaleDateString('pt-BR')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
