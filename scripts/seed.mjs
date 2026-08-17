// Popula o banco com 90 dias de operação simulada, para dar o que ver
// nos dashboards. Números calibrados em faixas realistas de agência.
//
//   node scripts/seed.mjs           cria usuários + dados de demonstração
//   node scripts/seed.mjs --purge   apaga TODOS os dados de negócio
//
// ATENÇÃO: o seed grava stage_history diretamente, sem passar pela
// fn_move_stage. Isso é proposital: evita enfileirar conversões falsas
// no outbox que um dia seriam enviadas de verdade para Meta e Google.

import { sql, env } from './sql.mjs'
import { randomBytes } from 'node:crypto'

const PURGE_SQL = `
truncate
  outbox, events, automation_runs, objection_occurrences, activities, meetings,
  proposals, contracts, stage_history, opportunities, touchpoints, person_company,
  identities, identity_conflicts, companies, people
restart identity cascade;
`

if (process.argv.includes('--purge')) {
  await sql(PURGE_SQL)
  console.log('Dados de negócio apagados. Usuários e schema preservados.')
  process.exit(0)
}

// ---------------------------------------------------------------
// 1. Usuários reais no Auth (o painel precisa deles para o login)
// ---------------------------------------------------------------
const TEAM = [
  { email: 'carlos.buchwitz@gmail.com',    name: 'Carlos Buchwitz', role: 'admin' },
  { email: 'rodrigues@novaacao.local',     name: 'Rodrigues',       role: 'vendedor' },
  { email: 'vendedor2@novaacao.local',     name: 'Marina Costa',    role: 'vendedor' },
  { email: 'sdr@novaacao.local',           name: 'SDR IA',          role: 'sdr' }
]

const authHeaders = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json'
}

const existing = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
  headers: authHeaders
}).then(r => r.json())

const byEmail = new Map((existing.users || []).map(u => [u.email, u.id]))
const creds = []

for (const m of TEAM) {
  if (byEmail.has(m.email)) {
    console.log(`usuário já existe: ${m.email}`)
    continue
  }
  const password = randomBytes(9).toString('base64url')
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      email: m.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: m.name }
    })
  })
  const body = await res.json()
  if (!res.ok) { console.error(`falhou ${m.email}:`, body); continue }
  byEmail.set(m.email, body.id)
  creds.push({ email: m.email, password })
  console.log(`usuário criado: ${m.email}`)
}

// papéis e capacidade
for (const m of TEAM) {
  const id = byEmail.get(m.email)
  if (!id) continue
  await sql(`
    insert into profiles (id, full_name, email, role)
    values ('${id}', '${m.name}', '${m.email}', '${m.role}')
    on conflict (id) do update set role = excluded.role, full_name = excluded.full_name`)
}

const ID = e => {
  const id = byEmail.get(e)
  if (!id) {
    console.error(`\nSem usuário para ${e}. O seed precisa dos perfis para atribuir dono aos deals.`)
    process.exit(1)
  }
  return id
}
const OWNERS = [ID('rodrigues@novaacao.local'), ID('vendedor2@novaacao.local')]
const SDR = ID('sdr@novaacao.local')

// ---------------------------------------------------------------
// 2. Dados de operação
// ---------------------------------------------------------------
await sql(PURGE_SQL)

const SEED = `
do $seed$
declare
  v_owners uuid[] := array['${OWNERS[0]}','${OWNERS[1]}']::uuid[];
  v_sdr    uuid   := '${SDR}';

  i int; d int;
  v_person uuid; v_company uuid; v_opp uuid; v_tp bigint; v_meet uuid; v_acc uuid;
  v_created timestamptz; v_t timestamptz; v_owner uuid;
  v_prev opp_stage; v_final opp_stage;
  v_channel text; v_camp text; v_mrr numeric; v_seg text;
  v_qualified boolean; v_booked boolean; v_held boolean;
  v_proposed boolean; v_won boolean; v_meet_status text;
  v_fname text; v_lname text; v_email text; v_phone text;
  v_score int; v_lost text;

  f_names text[] := array['Ana','Bruno','Carla','Diego','Eduarda','Felipe','Gabriela','Henrique',
                          'Isabela','João','Karina','Lucas','Mariana','Nelson','Olívia','Paulo',
                          'Queila','Rafael','Sofia','Thiago','Ursula','Vinícius','Wagner','Yasmin'];
  l_names text[] := array['Silva','Souza','Oliveira','Costa','Pereira','Almeida','Ferreira','Rodrigues',
                          'Martins','Barbosa','Ribeiro','Carvalho','Gomes','Araújo','Lima','Monteiro'];
  segs    text[] := array['E-commerce','Clínica Odontológica','Imobiliária','Educação',
                          'SaaS B2B','Restaurante','Academia','Advocacia','Estética','Construtora'];
  lost_r  text[] := array['preco','timing','escolheu_concorrente','sem_verba','sumiu','sem_autoridade'];
  camps   text[] := array['1201','1202','1203','2301','2302','-'];
  chans   text[] := array['paid_social','paid_social','paid_social','paid_search','paid_search','indicacao'];
begin

-- ---------- leads ----------
for i in 1..430 loop
  v_created := now()
             - (floor(random()*90)::int  || ' days')::interval
             - (floor(random()*16)::int  || ' hours')::interval;

  d       := 1 + floor(random()*6)::int;
  v_camp  := camps[d];
  v_channel := chans[d];
  v_owner := v_owners[1 + floor(random()*2)::int];
  v_seg   := segs[1 + floor(random()*10)::int];
  v_fname := f_names[1 + floor(random()*24)::int];
  v_lname := l_names[1 + floor(random()*16)::int];
  v_email := lower(v_fname) || '.' || lower(v_lname) || i || '@exemplo.com.br';
  v_phone := '+5511' || (900000000 + floor(random()*99999999)::bigint)::text;
  v_mrr   := (case when random() < 0.55 then 2500 + random()*2500
                   when random() < 0.85 then 5000 + random()*4000
                   else 9000 + random()*9000 end)::numeric(12,2);
  v_score := (30 + random()*70)::int;

  insert into people (full_name, email_primary, phone_primary, created_at)
  values (v_fname || ' ' || v_lname, v_email, v_phone, v_created)
  returning id into v_person;

  insert into identities (person_id, kind, value, first_seen_at)
  values (v_person,'email',v_email,v_created), (v_person,'phone',v_phone,v_created);

  insert into companies (trade_name, segment, size_band)
  values (v_lname || ' ' || v_seg, v_seg,
          case when v_mrr < 5000 then '50k-150k' when v_mrr < 9000 then '150k-500k' else '500k+' end)
  returning id into v_company;

  insert into person_company (person_id, company_id, is_decision_maker)
  values (v_person, v_company, random() < 0.7);

  insert into touchpoints
    (person_id, occurred_at, channel, utm_source, utm_medium, utm_campaign,
     campaign_external_id, fbclid, gclid, landing_page)
  values
    (v_person, v_created, v_channel,
     case when v_channel='paid_social' then 'meta'
          when v_channel='paid_search' then 'google' else 'indicacao' end,
     case when v_channel like 'paid%' then 'cpc' else 'referral' end,
     'camp_' || v_camp, v_camp,
     case when v_channel='paid_social' then 'fb.'||md5(random()::text) end,
     case when v_channel='paid_search' then 'gcl.'||md5(random()::text) end,
     '/diagnostico')
  returning id into v_tp;

  insert into opportunities
    (person_id, company_id, owner_id, sdr_id, stage, stage_since, product,
     expected_value, term_months, probability, score, first_touchpoint_id,
     last_touchpoint_id, source_channel, created_at)
  values
    (v_person, v_company, v_owner, v_sdr, 'novo', v_created, 'Gestão de Tráfego',
     v_mrr, 12, 2, v_score, v_tp, v_tp, v_channel, v_created)
  returning id into v_opp;

  v_prev  := 'novo';
  v_final := 'novo';

  -- ----- primeiro contato (speed to lead) -----
  if random() < 0.90 then
    v_t := v_created + ((case when random() < 0.72 then 1 + random()*9
                              when random() < 0.93 then 10 + random()*50
                              else 60 + random()*400 end) || ' minutes')::interval;

    insert into activities (opportunity_id, person_id, kind, direction, occurred_at,
                            actor_id, is_automated, outcome, body)
    values (v_opp, v_person, 'whatsapp','outbound', v_t, v_sdr, true,'enviado',
            'Olá ' || v_fname || ', vi que você se interessou pelo diagnóstico.');

    update opportunities set first_contact_at = v_t where id = v_opp;

    insert into stage_history (opportunity_id, from_stage, to_stage, changed_at, actor_type)
    values (v_opp, v_prev, 'em_atendimento', v_t, 'ai');
    v_prev := 'em_atendimento'; v_final := 'em_atendimento';

    -- ----- qualificação -----
    v_qualified := random() < 0.36;
    if v_qualified then
      v_t := v_t + ((2 + random()*40) || ' hours')::interval;
      insert into stage_history (opportunity_id, from_stage, to_stage, changed_at, actor_type)
      values (v_opp, v_prev,'qualificado', v_t,'ai');
      v_prev := 'qualificado'; v_final := 'qualificado';

      -- ----- agendamento -----
      v_booked := random() < 0.63;
      if v_booked then
        v_t := v_t + ((3 + random()*20) || ' hours')::interval;
        insert into stage_history (opportunity_id, from_stage, to_stage, changed_at, actor_type)
        values (v_opp, v_prev,'reuniao_agendada', v_t,'ai');
        v_prev := 'reuniao_agendada'; v_final := 'reuniao_agendada';

        v_t := v_t + ((24 + random()*72) || ' hours')::interval;

        if v_t > now() then
          v_meet_status := 'agendada'; v_held := false;
        else
          v_held := random() < 0.74;
          v_meet_status := case when v_held then 'realizada' else 'no_show' end;
        end if;

        insert into meetings (opportunity_id, kind, scheduled_at, status, attended_at,
                              duration_minutes, host_id, booked_by, created_at)
        values (v_opp,'diagnostico', v_t, v_meet_status,
                case when v_held then v_t end,
                case when v_held then (35 + random()*30)::int end,
                v_owner, v_sdr, v_t - interval '2 days')
        returning id into v_meet;

        if v_held then
          insert into stage_history (opportunity_id, from_stage, to_stage, changed_at, actor_type)
          values (v_opp, v_prev,'diagnostico_realizado', v_t + interval '1 hour','user');
          v_prev := 'diagnostico_realizado'; v_final := 'diagnostico_realizado';

          -- objeções detectadas na call
          if random() < 0.62 then
            insert into objection_occurrences
              (meeting_id, opportunity_id, objection_id, verbatim, outcome, detected_at)
            select v_meet, v_opp, o.id,
                   case o.code
                     when 'preco'  then 'Achei o investimento acima do que eu tinha em mente.'
                     when 'timing' then 'Agora não é o melhor momento, talvez depois.'
                     when 'confianca' then 'Já tentei com outra agência e não deu certo.'
                     when 'autoridade' then 'Preciso conversar com meu sócio antes.'
                     else 'Estou avaliando outras opções.' end,
                   case when random() < 0.45 then 'superada'
                        when random() < 0.75 then 'parcial' else 'matou_o_deal' end,
                   v_t + interval '30 minutes'
              from objections o
             where o.code = (array['preco','preco','timing','confianca','autoridade','concorrente'])
                              [1 + floor(random()*6)::int];
          end if;

          -- ----- proposta -----
          v_proposed := random() < 0.67;
          if v_proposed then
            v_t := v_t + ((6 + random()*40) || ' hours')::interval;
            insert into stage_history (opportunity_id, from_stage, to_stage, changed_at, actor_type)
            values (v_opp, v_prev,'proposta_enviada', v_t,'user');
            v_prev := 'proposta_enviada'; v_final := 'proposta_enviada';

            insert into proposals (opportunity_id, mrr, setup, term_months, status,
                                   sent_at, first_viewed_at, view_count, valid_until, created_at)
            values (v_opp, v_mrr, (v_mrr*0.3)::numeric(12,2), 12,'enviada', v_t,
                    v_t + interval '4 hours', (1+random()*5)::int,
                    (v_t + interval '7 days')::date, v_t);

            -- ----- desfecho -----
            v_won := random() < 0.34;
            if v_won then
              v_t := v_t + ((1 + random()*10) || ' days')::interval;
              if v_t < now() then
                insert into stage_history (opportunity_id, from_stage, to_stage, changed_at, actor_type)
                values (v_opp, v_prev,'ganho', v_t,'user');
                v_prev := 'ganho'; v_final := 'ganho';
                update opportunities set closed_at = v_t where id = v_opp;
              end if;
            elsif random() < 0.75 then
              v_t := v_t + ((2 + random()*14) || ' days')::interval;
              if v_t < now() then
                v_lost := lost_r[1 + floor(random()*6)::int];
                insert into stage_history (opportunity_id, from_stage, to_stage, changed_at, actor_type, reason)
                values (v_opp, v_prev,'perdido', v_t,'user', v_lost);
                v_final := 'perdido';
                update opportunities set closed_at = v_t, lost_reason = v_lost where id = v_opp;
              end if;
            end if;
          end if;
        end if;
      end if;
    elsif random() < 0.5 then
      -- desqualificado
      v_t := v_t + ((1 + random()*9) || ' days')::interval;
      v_lost := case when random() < 0.5 then 'desqualificado' else 'sumiu' end;
      insert into stage_history (opportunity_id, from_stage, to_stage, changed_at, actor_type, reason)
      values (v_opp, v_prev,'perdido', v_t,'ai', v_lost);
      v_final := 'perdido';
      update opportunities set closed_at = v_t, lost_reason = v_lost where id = v_opp;
    end if;
  end if;

  update opportunities
     set stage = v_final,
         stage_since = coalesce(v_t, v_created),
         probability = fn_stage_probability(v_final)
   where id = v_opp;
end loop;

end $seed$;
`

console.log('\ngerando 90 dias de operação...')
await sql(SEED)

// ---------------------------------------------------------------
const [d] = await sql(`select fn_dash_comercial(current_date - 89, current_date) as d`)
const [c] = await sql(`
  select (select count(*) from opportunities) opp,
         (select count(*) from meetings) reun,
         (select count(*) from proposals) props`)

console.log('\n== base criada ==')
console.log(`oportunidades: ${c.opp} | reuniões: ${c.reun} | propostas: ${c.props}`)
console.log('\n== dashboard comercial (90 dias) ==')
console.table({
  'Leads':                 d.d.leads,
  'Speed to lead (min)':   d.d.speed_to_lead_min,
  'TX qualificação %':     d.d.tx_qualificacao,
  'TX agendamento %':      d.d.tx_agendamento,
  'Show rate %':           d.d.show_rate,
  'Reunião→proposta %':    d.d.tx_reuniao_proposta,
  'Win rate %':            d.d.win_rate,
  'Ticket médio contrato': d.d.ticket_medio_contrato,
  'Ciclo de venda (dias)': d.d.ciclo_venda_dias,
  'Vendas':                d.d.vendas,
  'Receita fechada':       d.d.receita_fechada
})

if (creds.length) {
  console.log('\n== acessos criados (guarde e troque a senha) ==')
  for (const c2 of creds) console.log(`${c2.email}  ${c2.password}`)
}
