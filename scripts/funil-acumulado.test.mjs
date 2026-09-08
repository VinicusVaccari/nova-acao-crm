// SELECT-only validation of the exact SQL in migration 0048, before deployment.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sql } from './sql.mjs'

const migration = readFileSync(new URL('../supabase/migrations/0048_funil_acumulado.sql', import.meta.url), 'utf8')
const view = migration.split('with (security_invoker = true) as\n')[1].split(';')[0]
const h = view.slice('with '.length, view.indexOf(' ), m as (') + 2)
const body = migration.split('as $$\n')[1].split('$$;')[0].trim().replace(/;$/, '')
const read = query => sql(`begin read only; ${query}; commit;`)

// No fixtures are inserted. A CTE shadows stage_history only for this SELECT.
const rows = await read(`with stage_history(opportunity_id,to_stage,changed_at) as (values
  ('direto','ganho','2026-09-08T15:00:00Z'::timestamptz),
  ('normal','qualificado','2026-09-01T15:00:00Z'::timestamptz),
  ('normal','reuniao_agendada','2026-09-02T15:00:00Z'::timestamptz),
  ('normal','apresentacao_institucional','2026-09-03T15:00:00Z'::timestamptz),
  ('normal','envio_proposta','2026-09-04T15:00:00Z'::timestamptz),
  ('normal','ganho','2026-09-05T15:00:00Z'::timestamptz),
  ('parcial','negociacao','2026-09-08T15:00:00Z'::timestamptz),
  ('agendamento','reuniao_agendada','2026-09-08T15:00:00Z'::timestamptz),
  ('desqualificado','desqualificado','2026-09-08T15:00:00Z'::timestamptz),
  ('perdido','perdido','2026-09-08T15:00:00Z'::timestamptz),
  ('nutricao','nutricao','2026-09-08T15:00:00Z'::timestamptz),
  ('retorno','ganho','2026-09-01T15:00:00Z'::timestamptz),
  ('retorno','novo','2026-09-02T15:00:00Z'::timestamptz),
  ('retorno','ganho','2026-09-03T15:00:00Z'::timestamptz),
  ('mes_anterior','qualificado','2026-08-31T15:00:00Z'::timestamptz),
  ('mes_anterior','ganho','2026-09-08T15:00:00Z'::timestamptz)
), ${h} select * from h`)
const byId = Object.fromEntries(rows.map(r => [r.opportunity_id, r]))
for (const campo of ['qualificado_at', 'agendado_at', 'diagnostico_at', 'proposta_at']) {
  assert.equal(byId.direto[campo], byId.direto.ganho_at)
  assert.ok(byId.parcial[campo])
  for (const ramo of ['desqualificado', 'perdido', 'nutricao']) assert.equal(byId[ramo][campo], null)
}
for (const marco of ['qualificado', 'agendado', 'diagnostico', 'proposta']) {
  assert.equal(byId.normal[`${marco}_at`], byId.normal[`${marco}_real_at`])
  assert.equal(byId.direto[`${marco}_real_at`], null)
}
assert.equal(byId.parcial.ganho_at, null)
assert.equal(byId.agendamento.qualificado_at, byId.agendamento.agendado_at)
assert.equal(byId.agendamento.diagnostico_at, null)
assert.equal(byId.agendamento.proposta_at, null)
assert.ok(byId.retorno.ganho_at.startsWith('2026-09-01'))
assert.ok(byId.mes_anterior.qualificado_at.startsWith('2026-08-31'))
console.log('PASS: salto direto, percurso normal, salto parcial, agendamento, ramos alternativos, retorno e limites de período.')

// Compile the entire future view and dashboard body in a read-only query.
const de = '2026-09-01', ate = '2026-09-08'
const futureBody = body.replace(/^with j as/, `with v_opp_journey as (${view}), j as`)
  .replace(/\bp_from\b/g, `'${de}'::date`).replace(/\bp_to\b/g, `'${ate}'::date`).replace(/\bp_owner\b/g, 'null::uuid')
const [future] = await read(`select (${futureBody}) as indicadores`)
const [current] = await read(`select public.fn_dash_comercial('${de}','${ate}',null) as indicadores`)
for (const campo of ['leads','vendas','receita_fechada','ticket_medio_contrato','ciclo_venda_dias','show_rate','reunioes_realizadas','reunioes_no_show','reunioes_pendentes']) {
  assert.equal(future.indicadores[campo], current.indicadores[campo], campo)
}
const [deal] = await read(`select qualificado_at,agendado_at,diagnostico_at,proposta_at,ganho_at,meetings_held,
  qualificado_por_avanco,agendado_por_avanco,diagnostico_por_avanco,proposta_por_avanco
  from (${view}) j where id='ca793dd2-215d-4ca1-b94a-bfc1847d13e1'`)
assert.ok(deal?.ganho_at)
assert.equal(deal.meetings_held, 0)
for (const marco of ['qualificado','agendado','diagnostico','proposta']) {
  assert.equal(deal[`${marco}_at`], deal.ganho_at)
  assert.equal(deal[`${marco}_por_avanco`], true)
}
console.log('PASS: SQL completo compila; venda de teste supera quatro marcos sem criar reuniões; valores financeiros e comparecimento preservados.')
console.log(JSON.stringify({antes:current.indicadores,depois:future.indicadores},null,2))
