'use client'

import { memo, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  MeasuringStrategy,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { reordenarCard } from '@/lib/actions'
import { type CardPipeline, type Estagio } from '@/lib/estagios'
import { useEstagiosBoard } from '@/components/estagios-context'
import { Avatar } from '@/components/ui'
import { FiltrosDrawer, aplicarFiltros, contarFiltros, filtroVazio, type Filtros } from '@/components/filtros-pipeline'
import { brlCurto } from '@/lib/format'

/* -----------------------------------------------------------------
   Pipeline com dnd-kit sortable. Cada coluna é uma lista ordenável;
   arrastar abre espaço entre os cards e solta na posição exata. A
   ordem vive em opportunities.board_rank — inserir entre dois cards
   grava o ponto médio dos vizinhos.
   ----------------------------------------------------------------- */

const GAP = 65536

type Cols = Record<string, CardPipeline[]>

function agrupar(cards: CardPipeline[], ordem: string[]): Cols {
  const m: Cols = Object.fromEntries(ordem.map(id => [id, []]))
  for (const c of cards) if (m[c.stage]) m[c.stage].push(c)
  return m
}

/* ---------------- Conteúdo visual (reusado no overlay) ---------------- */

const CardVisual = memo(function CardVisual({ c, comLink = true }: { c: CardPipeline; comLink?: boolean }) {
  // "parado há": dias desde a última interação (qualquer atividade).
  // Cores: neutro 1d · âmbar 2–4d · vermelho 5d+ (só em negócios abertos).
  const paradoDias = c.ultima_interacao
    ? Math.floor((Date.now() - new Date(c.ultima_interacao).getTime()) / 86_400_000)
    : 0
  const mostrarParado = c.status === 'andamento' && paradoDias >= 1
  const corParado = paradoDias >= 5 ? 'var(--critical)' : paradoDias >= 2 ? 'var(--warning)' : 'var(--ink-muted)'

  const acaoAtrasada = c.next_step_due && new Date(c.next_step_due) < new Date()
  const mensal = Number(c.expected_value ?? 0)   // MRR configurado (o valor dos serviços mensais)
  const qual = Math.max(0, Math.min(5, c.qualificacao ?? 0))

  const statusInfo = {
    andamento: { label: 'Em andamento', cor: 'var(--brand-teal)' },
    vendido: { label: 'Vendido', cor: 'var(--good)' },
    perdido: { label: 'Perdido', cor: 'var(--critical)' },
  }[c.status]

  const temTarefa = !!c.next_step

  const corpo = (
    <>
      {/* status */}
      <div className="flex items-center gap-2" style={{ marginBottom: 'var(--s-2)' }}>
        <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: statusInfo.cor, flex: 'none' }} />
        <span className="t-sm" style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{statusInfo.label}</span>
        {mostrarParado && (
          <span className="chip" style={{ marginLeft: 'auto', background: `color-mix(in srgb, ${corParado} 14%, transparent)`, color: corParado }}>
            <span aria-hidden className="chip-dot" style={{ background: corParado }} />
            Parado há {paradoDias}d
          </span>
        )}
      </div>

      <div className="min-w-0">
        <div className="t-h2 truncate" style={{ fontSize: 'var(--text-md)', lineHeight: 1.3 }}>{c.nome}</div>
        {c.empresa && <div className="t-sm muted truncate">{c.empresa}</div>}
      </div>

      {/* estrelas + valor */}
      <div className="flex items-center gap-3" style={{ marginTop: 'var(--s-2)' }}>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map(n => (
            <svg key={n} width="15" height="15" viewBox="0 0 20 20" fill={n <= qual ? 'var(--accent)' : 'none'} stroke={n <= qual ? 'var(--accent)' : 'var(--hairline-2)'} strokeWidth="1.4" strokeLinejoin="round">
              <path d="M10 2.5l2.3 4.7 5.2.76-3.75 3.66.88 5.18L10 14.9l-4.63 2.4.88-5.18L2.5 7.96l5.2-.76z" />
            </svg>
          ))}
        </div>
        {mensal > 0 ? (
          <span className="t-body tabular ml-auto" style={{ fontWeight: 600 }}>
            {brlCurto(mensal)}<span className="t-2xs muted" style={{ fontWeight: 500, marginLeft: 2 }}>/mês</span>
          </span>
        ) : c.contractValue > 0 ? (
          <span className="t-body tabular ml-auto" style={{ fontWeight: 600 }}>{brlCurto(c.contractValue)}</span>
        ) : null}
      </div>

      {/* tarefa vinculada ou criar tarefa */}
      <div style={{ marginTop: 'var(--s-3)' }}>
        {temTarefa ? (
          <div
            className="flex items-center gap-2"
            style={{
              padding: '7px 10px', borderRadius: 'var(--r-md)',
              background: acaoAtrasada ? 'color-mix(in srgb, var(--critical) 12%, transparent)' : 'var(--surface-2)',
              color: acaoAtrasada ? 'var(--critical)' : 'var(--ink-2)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><rect x="3.5" y="3.5" width="13" height="13" rx="3" /><path d="M6.5 10l2.5 2.5 4.5-5" /></svg>
            <span className="t-sm truncate flex-1">{c.next_step}</span>
            {c.next_step_due && <span className="t-xs tabular shrink-0" style={{ opacity: 0.8 }}>{new Date(c.next_step_due).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>}
          </div>
        ) : (
          <div
            className="flex items-center justify-center gap-2"
            style={{ padding: '8px', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', color: 'var(--ink-2)', fontWeight: 600, fontSize: 'var(--text-sm)' }}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M10 5v10M5 10h10" /></svg>
            Criar tarefa
          </div>
        )}
      </div>
    </>
  )

  if (!comLink) return <>{corpo}</>
  return (
    <Link href={`/lead/${c.id}`} className="block" draggable={false}>
      {corpo}
    </Link>
  )
})

/* ---------------- Card ordenável ---------------- */

const SortableCard = memo(function SortableCard({ c }: { c: CardPipeline }) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: c.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="deal"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1, // fica invisível; o overlay mostra o card e a lacuna abre aqui
        touchAction: 'none',
      }}
    >
      <CardVisual c={c} />
    </div>
  )
})

/* ---------------- Coluna ---------------- */

const Coluna = memo(function Coluna({ estagio, cards }: { estagio: Estagio; cards: CardPipeline[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: estagio.id })
  const total = cards.reduce((s, c) => s + Number(c.expected_value ?? 0), 0)

  return (
    <div className="coluna" data-alvo={isOver}>
      <div className="coluna-head">
        <div className="flex items-center gap-2">
          <span className="t-h3" style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>{estagio.curto}</span>
          <span className="chip tabular" style={{ marginLeft: 'auto', background: 'color-mix(in srgb, var(--ink) 7%, transparent)', color: 'var(--ink-2)' }}>
            {cards.length}
          </span>
        </div>
        {total > 0 && <div className="t-xs muted tabular" style={{ marginTop: 'var(--s-1)' }}>{brlCurto(total)}/mês em jogo</div>}
      </div>

      <div ref={setNodeRef} className="coluna-cards">
        <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map(c => (
            <SortableCard key={c.id} c={c} />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div
            className="t-xs muted"
            style={{ padding: 'var(--s-4)', textAlign: 'center', border: '1px dashed var(--hairline-2)', borderRadius: 'var(--r-md)' }}
          >
            solte aqui
          </div>
        )}
      </div>
    </div>
  )
})

/* ---------------- Quadro ---------------- */

export function Kanban({ cards, catalogo = [] }: { cards: CardPipeline[]; catalogo?: { id: number; name: string }[] }) {
  const [filtros, setFiltros] = useState<Filtros>(filtroVazio)
  const [filtroAberto, setFiltroAberto] = useState(false)

  const filtrados = useMemo(() => aplicarFiltros(cards, filtros), [cards, filtros])

  const board = useEstagiosBoard()
  const ordemIds = useMemo(() => board.map(e => e.id), [board])

  const [cols, setCols] = useState<Cols>(() => agrupar(filtrados, ordemIds))
  const colsRef = useRef(cols)
  colsRef.current = cols

  const [ativo, setAtivo] = useState<CardPipeline | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // Ressincroniza com o servidor/filtros SÓ quando o conteúdo muda de fato.
  const arrastando = useRef(false)
  const assinatura = JSON.stringify(filtros) + '|' + filtrados.map(c => `${c.id}:${c.stage}:${c.board_rank}`).join('|')
  const assinaturaRef = useRef(assinatura)
  useEffect(() => {
    if (arrastando.current) return
    if (assinatura === assinaturaRef.current && Object.keys(colsRef.current).length) return
    assinaturaRef.current = assinatura
    setCols(agrupar(filtrados, ordemIds))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const ehColuna = (id: string) => id in colsRef.current
  const acharColuna = (id: string) =>
    ehColuna(id) ? id : Object.keys(colsRef.current).find(k => colsRef.current[k].some(c => c.id === id))

  function onStart(e: DragStartEvent) {
    setErro(null)
    arrastando.current = true
    const id = String(e.active.id)
    for (const k of Object.keys(colsRef.current)) {
      const found = colsRef.current[k].find(c => c.id === id)
      if (found) { setAtivo(found); break }
    }
  }

  // move o card entre colunas ao vivo, abrindo a lacuna na coluna de destino
  function onOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const de = acharColuna(activeId)
    const para = acharColuna(overId)
    if (!de || !para || de === para) return

    setCols(prev => {
      const itensDe = prev[de]
      const itensPara = prev[para]
      const idx = itensDe.findIndex(c => c.id === activeId)
      if (idx < 0) return prev
      const card = itensDe[idx]
      const overIdx = ehColuna(overId) ? itensPara.length : itensPara.findIndex(c => c.id === overId)
      const at = overIdx < 0 ? itensPara.length : overIdx
      return {
        ...prev,
        [de]: itensDe.filter(c => c.id !== activeId),
        [para]: [...itensPara.slice(0, at), card, ...itensPara.slice(at)],
      }
    })
  }

  function onEnd(e: DragEndEvent) {
    const { active, over } = e
    const card = ativo
    setAtivo(null)
    arrastando.current = false
    if (!over || !card) { setCols(agrupar(cards, ordemIds)); return }

    const activeId = String(active.id)
    const container = acharColuna(activeId)
    if (!container) { setCols(agrupar(cards, ordemIds)); return }

    const itens = colsRef.current[container]
    const oldIndex = itens.findIndex(c => c.id === activeId)
    const overId = String(over.id)
    let newIndex = ehColuna(overId) ? itens.length - 1 : itens.findIndex(c => c.id === overId)
    if (newIndex < 0) newIndex = itens.length - 1

    const finais = oldIndex === newIndex ? itens : arrayMove(itens, oldIndex, newIndex)
    setCols({ ...colsRef.current, [container]: finais })

    const idx = finais.findIndex(c => c.id === activeId)
    const ant = finais[idx - 1]
    const prox = finais[idx + 1]
    const rank =
      ant && prox ? (ant.board_rank + prox.board_rank) / 2
        : ant ? ant.board_rank + GAP
        : prox ? prox.board_rank - GAP
        : GAP

    const estagioMudou = card.stage !== container
    if (!estagioMudou && oldIndex === newIndex) return

    startTransition(async () => {
      const r = await reordenarCard(activeId, container, rank, estagioMudou)
      if (!r.ok) { setErro(r.erro); setCols(agrupar(cards, ordemIds)) }
    })
  }

  const nFiltros = contarFiltros(filtros)
  const limpar = () => setFiltros(filtroVazio)

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      {/* barra de filtros */}
      <div className="flex items-center gap-2 shrink-0" style={{ marginBottom: 'var(--s-3)', padding: '0 var(--s-6)' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setFiltroAberto(true)}>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h14M6 10h8M9 15h2" /></svg>
          Filtros
          {nFiltros > 0 && <span className="chip" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{nFiltros}</span>}
        </button>
        {nFiltros > 0 && <button className="t-sm" style={{ color: 'var(--ink-muted)' }} onClick={limpar}>limpar</button>}
        <span className="ml-auto t-sm muted tabular">{filtrados.length} negócios</span>
      </div>

      {erro && (
        <div className="card shrink-0" style={{ marginBottom: 'var(--s-3)', padding: 'var(--s-3) var(--s-4)', borderColor: 'var(--critical)', color: 'var(--critical)' }}>
          <span className="t-sm">{erro}</span>
        </div>
      )}

      {filtros.status === 'perdido' && filtrados.length > 0 ? (
        <PerdidosView cards={filtrados} />
      ) : (
        <DndContext
          id="kanban-pipeline"
          sensors={sensors}
          collisionDetection={closestCorners}
          measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
          onDragStart={onStart}
          onDragOver={onOver}
          onDragEnd={onEnd}
          onDragCancel={() => { setAtivo(null); arrastando.current = false; setCols(agrupar(filtrados, ordemIds)) }}
        >
          <div className="kanban-scroll overflow-x-auto flex-1 min-h-0">
            <div className="flex" style={{ gap: 'var(--s-4)', minWidth: 'max-content', height: '100%', padding: '0 var(--s-6)' }}>
              {board.map(e => (
                <Coluna key={e.id} estagio={e} cards={cols[e.id] ?? []} />
              ))}
            </div>
          </div>

          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2,0,0,1)' }}>
            {ativo ? (
              <div className="deal deal--overlay" style={{ width: 290 }}>
                <CardVisual c={ativo} comLink={false} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <FiltrosDrawer
        aberto={filtroAberto}
        onClose={() => setFiltroAberto(false)}
        filtros={filtros}
        onAplicar={setFiltros}
        onLimpar={limpar}
        catalogo={catalogo}
      />
    </div>
  )
}

/* ---------------- Visão de perdidos (fora do funil) ---------------- */

function PerdidosView({ cards }: { cards: CardPipeline[] }) {
  if (!cards.length) {
    return <p className="t-sm muted" style={{ padding: 'var(--s-6)' }}>Nenhum negócio perdido com esses filtros.</p>
  }
  return (
    <div className="overflow-y-auto flex-1 min-h-0">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {cards.map(c => (
          <Link key={c.id} href={`/lead/${c.id}`} className="deal" style={{ ['--deal-cor' as string]: 'var(--critical)', cursor: 'pointer' }}>
            <div className="flex items-start gap-3">
              <Avatar nome={c.nome} tamanho={38} />
              <div className="min-w-0 flex-1">
                <div className="t-h2 truncate" style={{ fontSize: 'var(--text-md)' }}>{c.nome}</div>
                {c.empresa && <div className="t-sm muted truncate">{c.empresa}</div>}
              </div>
            </div>
            <div className="flex items-center justify-between" style={{ marginTop: 'var(--s-3)' }}>
              <span className="chip" style={{ background: 'color-mix(in srgb, var(--critical) 14%, transparent)', color: 'var(--critical)' }}>
                <span aria-hidden className="chip-dot" style={{ background: 'var(--critical)' }} />
                {c.lost_reason ?? 'perdido'}
              </span>
              {c.contractValue > 0 && <span className="t-sm tabular muted">{brlCurto(c.contractValue)}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
