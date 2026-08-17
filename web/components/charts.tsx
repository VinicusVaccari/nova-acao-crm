'use client'

import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, LabelList, LineChart, Line, Legend,
} from 'recharts'

/* -----------------------------------------------------------------
   Regras aplicadas em todos os gráficos:
   · marcas finas, ponta de dado arredondada em 4px, linhas de 2px
   · grade e eixos recessivos; texto sempre em tinta, nunca na cor da série
   · rótulo direto onde o valor importa, nunca em todo ponto
   · uma escala por gráfico — jamais dois eixos Y
   ----------------------------------------------------------------- */

const EIXO = { fontSize: 11, fill: 'var(--ink-muted)' }
const GRADE = { stroke: 'var(--grid)', strokeDasharray: '0' }

const tooltipBase = {
  cursor: { fill: 'var(--grid)', fillOpacity: 0.35 },
  contentStyle: { fontSize: 12 },
  labelStyle: { color: 'var(--ink-2)' },
}

/* ---------------- Funil de conversão ---------------- */

export function FunilBarras({
  dados,
}: {
  dados: { etapa: string; valor: number; conv: string | null }[]
}) {
  const ramp = ['var(--ord-7)', 'var(--ord-6)', 'var(--ord-5)', 'var(--ord-4)', 'var(--ord-3)', 'var(--ord-2)']
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 0 }} barCategoryGap={6}>
        <CartesianGrid {...GRADE} horizontal={false} />
        <XAxis type="number" tick={EIXO} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="etapa"
          tick={{ ...EIXO, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={132}
        />
        <Tooltip
          {...tooltipBase}
          formatter={(v: unknown, _n: unknown, p: unknown) => {
            const c = ((p as { payload?: { conv?: string | null } })?.payload)?.conv
            return [c ? `${Number(v)} · ${c} da etapa anterior` : `${Number(v)}`, 'Oportunidades']
          }}
        />
        <Bar dataKey="valor" radius={[0, 4, 4, 0]} maxBarSize={26} isAnimationActive={false}>
          {dados.map((_, i) => (
            <Cell key={i} fill={ramp[i % ramp.length]} />
          ))}
          {/* rótulo direto: o valor da etapa é o dado que se lê primeiro */}
          <LabelList
            dataKey="valor"
            position="right"
            offset={8}
            style={{ fontSize: 12, fill: 'var(--ink)', fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/* ---------------- Duas medidas na MESMA escala (contagens) ---------------- */

export function SerieDuasContagens({
  dados,
  a,
  b,
}: {
  dados: { bucket: string; [k: string]: string | number }[]
  a: { chave: string; rotulo: string }
  b: { chave: string; rotulo: string }
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 4, left: -18 }} barGap={2}>
        <CartesianGrid {...GRADE} vertical={false} />
        <XAxis dataKey="bucket" tick={EIXO} axisLine={false} tickLine={false} />
        <YAxis tick={EIXO} axisLine={false} tickLine={false} width={44} />
        <Tooltip {...tooltipBase} />
        <Legend
          verticalAlign="top"
          align="left"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: 'var(--ink-2)', paddingBottom: 4 }}
        />
        <Bar dataKey={a.chave} name={a.rotulo} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
        <Bar dataKey={b.chave} name={b.rotulo} fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/* ---------------- Taxa ao longo do tempo, com linha de meta ---------------- */

export function SerieTaxa({
  dados,
  chave,
  rotulo,
  meta,
}: {
  dados: { bucket: string; [k: string]: string | number }[]
  chave: string
  rotulo: string
  meta?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={dados} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
        <CartesianGrid {...GRADE} vertical={false} />
        <XAxis dataKey="bucket" tick={EIXO} axisLine={false} tickLine={false} />
        <YAxis tick={EIXO} axisLine={false} tickLine={false} width={44} unit="%" domain={[0, 100]} />
        <Tooltip {...tooltipBase} formatter={(v: unknown) => [`${Number(v)}%`, rotulo]} />
        {meta !== undefined && (
          <Line
            dataKey={() => meta}
            name={`meta ${meta}%`}
            stroke="var(--ink-muted)"
            strokeWidth={1}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
            legendType="none"
          />
        )}
        <Line
          type="monotone"
          dataKey={chave}
          name={rotulo}
          stroke="var(--series-1)"
          strokeWidth={2}
          dot={{ r: 3, strokeWidth: 0, fill: 'var(--series-1)' }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/* ---------------- Ranking horizontal (objeções, campanhas) ---------------- */

export function RankingBarras({
  dados,
  unidade = 'R$',
  alturaPorItem = 34,
}: {
  dados: { rotulo: string; valor: number; detalhe?: string }[]
  unidade?: string
  alturaPorItem?: number
}) {
  const fmt = (v: number) =>
    unidade === 'R$'
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
      : `${new Intl.NumberFormat('pt-BR').format(v)}${unidade}`

  return (
    <ResponsiveContainer width="100%" height={Math.max(140, dados.length * alturaPorItem)}>
      <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 96, bottom: 0, left: 0 }} barCategoryGap={6}>
        <CartesianGrid {...GRADE} horizontal={false} />
        <XAxis type="number" tick={EIXO} axisLine={false} tickLine={false} tickFormatter={fmt} />
        <YAxis
          type="category"
          dataKey="rotulo"
          tick={{ ...EIXO, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={150}
        />
        <Tooltip
          {...tooltipBase}
          formatter={(v: unknown, _n: unknown, p: unknown) => {
            const d = ((p as { payload?: { detalhe?: string } })?.payload)?.detalhe
            return [d ? `${fmt(Number(v))} · ${d}` : fmt(Number(v)), '']
          }}
        />
        <Bar dataKey="valor" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
          <LabelList
            dataKey="valor"
            position="right"
            offset={8}
            formatter={(v: unknown) => fmt(Number(v))}
            style={{ fontSize: 12, fill: 'var(--ink)', fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
