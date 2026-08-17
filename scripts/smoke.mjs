// Teste de ponta a ponta: leva um lead do clique no anúncio até virar cliente,
// e valida cada garantia do modelo. Limpa tudo no final.
import { sql } from './sql.mjs'

const ok = (label, cond, extra = '') =>
  console.log(`${cond ? 'OK  ' : 'FALHA'}  ${label}${extra ? '  -> ' + extra : ''}`)

let personId, oppId

try {
  console.log('\n== 1. Ingestão direta do lead (sem orquestrador) ==')
  const [ing] = await sql(`
    select fn_ingest_lead('{
      "name":"Teste Silva","email":"Teste.Silva+promo@Gmail.com","phone":"(11) 98765-4321",
      "company_name":"Loja Teste LTDA","cnpj":"99.999.999/0001-99",
      "utm_source":"meta","utm_medium":"cpc","utm_campaign":"aquisicao_diagnostico_ecommerce_2608",
      "utm_content":"video_dorprova_v3","fbclid":"IwAR_TESTE_123","fbp":"fb.1.1690000000.999",
      "campaign_id":"1200","landing_page":"/diagnostico","product":"Gestao de Trafego",
      "expected_value":"8000"
    }'::jsonb) as r`)
  const r = ing.r
  personId = r.person_id; oppId = r.opportunity_id
  ok('lead criado', r.created === true)

  const [p] = await sql(`select * from people where id = '${personId}'`)
  ok('e-mail normalizado (remove +alias e ponto do gmail)', p.email_primary === 'testesilva@gmail.com', p.email_primary)
  ok('telefone normalizado para E.164', p.phone_primary === '+5511987654321', p.phone_primary)

  const ids = await sql(`select kind from identities where person_id='${personId}' order by kind`)
  ok('identificadores gravados', ids.length >= 4, ids.map(i => i.kind).join(','))

  const [tp] = await sql(`select * from touchpoints where person_id='${personId}'`)
  ok('toque de origem com fbclid e campanha', tp.fbclid === 'IwAR_TESTE_123' && tp.channel === 'paid_social')

  console.log('\n== 2. Antiduplicação: mesmo lead voltando por outro canal ==')
  const [ing2] = await sql(`
    select fn_ingest_lead('{
      "name":"Teste Silva","phone":"+55 11 98765 4321","wa_id":"5511987654321",
      "utm_source":"google","gclid":"GCL_TESTE_456"
    }'::jsonb) as r`)
  ok('não criou card duplicado', ing2.r.created === false && ing2.r.opportunity_id === oppId)
  const [cnt] = await sql(`select count(*)::int n from people where full_name='Teste Silva'`)
  ok('não criou pessoa duplicada', cnt.n === 1, `${cnt.n} pessoa(s)`)
  const [gc] = await sql(`select count(*)::int n from identities where person_id='${personId}'`)
  ok('gclid e wa_id anexados à mesma pessoa', gc.n >= 6, `${gc.n} identificadores`)

  console.log('\n== 3. Speed to lead e avanço automático ==')
  await sql(`select fn_log_activity('${oppId}','whatsapp','outbound','Primeiro contato',null,true,'enviado')`)
  const [o1] = await sql(`select stage, first_contact_at is not null as tem_contato from opportunities where id='${oppId}'`)
  ok('primeira atividade marcou o first_contact_at', o1.tem_contato === true)
  ok('lead novo virou em_atendimento sozinho', o1.stage === 'em_atendimento')

  console.log('\n== 4. Máquina de estados ==')
  let erro = null
  try { await sql(`select fn_move_stage('${oppId}','perdido',null,'system',null)`) }
  catch (e) { erro = e.message }
  ok('bloqueia perda sem motivo', erro !== null)

  erro = null
  try { await sql(`select fn_move_stage('${oppId}','perdido',null,'system','motivo_inventado')`) }
  catch (e) { erro = e.message }
  ok('bloqueia motivo fora da lista fechada', erro !== null)

  for (const s of ['qualificado', 'reuniao_agendada']) {
    await sql(`select fn_move_stage('${oppId}','${s}',null,'system')`)
  }
  const hist = await sql(`select to_stage, duration_in_prev from stage_history where opportunity_id='${oppId}' order by changed_at`)
  ok('histórico de estágios gravado', hist.length >= 2, hist.map(h => h.to_stage).join(' > '))

  console.log('\n== 5. Reunião e show rate ==')
  await sql(`
    insert into meetings (opportunity_id, kind, scheduled_at, status, attended_at)
    values ('${oppId}','diagnostico', now() - interval '1 hour','realizada', now() - interval '1 hour')`)
  await sql(`select fn_move_stage('${oppId}','diagnostico_realizado',null,'system')`)
  const [j] = await sql(`select meetings_held, speed_to_lead_min, contract_value from v_opp_journey where id='${oppId}'`)
  ok('reunião contabilizada na jornada', j.meetings_held === 1)
  ok('valor de contrato calculado (MRR x meses)', Number(j.contract_value) === 96000, String(j.contract_value))

  console.log('\n== 6. Objeção detectada ==')
  await sql(`
    insert into objection_occurrences (opportunity_id, objection_id, verbatim, outcome)
    values ('${oppId}', (select id from objections where code='preco'),
            'Achei bem mais caro do que eu esperava','parcial')`)
  const [om] = await sql(`select ocorrencias from v_objection_map where code='preco'`)
  ok('mapa de objeções vivo', Number(om.ocorrencias) >= 1)

  console.log('\n== 7. Fechamento e conversão offline ==')
  await sql(`select fn_move_stage('${oppId}','proposta_enviada',null,'system')`)
  await sql(`select fn_move_stage('${oppId}','ganho',null,'system')`)

  const ob = await sql(`
    select destination, payload->>'event_name' ev, (payload->>'value')::numeric val,
           payload->>'fbclid' fbclid
      from outbox where payload->>'opportunity_id' = '${oppId}' order by id`)
  ok('conversões enfileiradas nas 3 plataformas', ob.filter(x => x.ev === 'Purchase').length === 3)
  ok('venda enviada com valor real do contrato', ob.some(x => x.ev === 'Purchase' && Number(x.val) === 96000))
  ok('fbclid preservado do primeiro toque', ob.every(x => x.fbclid === 'IwAR_TESTE_123'))
  const evs = [...new Set(ob.map(x => x.ev))]
  ok('sinal enviado em cada etapa do funil', evs.length === 5, evs.join(', '))

  console.log('\n== 8. Virada para cliente ==')
  const [acc] = await sql(`select fn_convert_to_account('${oppId}') as id`)
  const [tasks] = await sql(`select count(*)::int n from onboarding_tasks where account_id='${acc.id}'`)
  ok('conta criada com os 7 marcos de onboarding', tasks.n === 7)

  console.log('\n== 9. Dashboard comercial ==')
  const [d] = await sql(`select fn_dash_comercial(current_date - 30, current_date) as d`)
  const dash = d.d
  ok('função do dashboard responde', dash.leads >= 1)
  console.log(JSON.stringify({
    leads: dash.leads,
    speed_to_lead_min: dash.speed_to_lead_min,
    tx_qualificacao: dash.tx_qualificacao,
    tx_agendamento: dash.tx_agendamento,
    show_rate: dash.show_rate,
    tx_reuniao_proposta: dash.tx_reuniao_proposta,
    win_rate: dash.win_rate,
    ticket_medio_contrato: dash.ticket_medio_contrato,
    ciclo_venda_dias: dash.ciclo_venda_dias,
    vendas: dash.vendas
  }, null, 2))

  console.log('\n== 10. Auditoria ==')
  const ev = await sql(`select event_name from events where subject_id='${oppId}' order by id`)
  ok('trilha de eventos completa', ev.length >= 7, ev.map(e => e.event_name).join(' > '))

} finally {
  console.log('\n== limpeza ==')
  if (personId) {
    await sql(`delete from outbox where payload->>'person_id' = '${personId}'`)
    await sql(`delete from accounts where origin_opportunity_id = '${oppId}'`)
    await sql(`delete from events where subject_id in ('${oppId}')`)
    await sql(`delete from people where id = '${personId}'`)
  }
  const [left] = await sql(`select count(*)::int n from opportunities`)
  console.log(`oportunidades restantes no banco: ${left.n}`)
}
