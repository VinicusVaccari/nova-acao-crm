// Importação pontual RD: prepare é somente leitura no banco; apply exige plano
// conferido, backup restaurado localmente e decisões explícitas de mapeamento.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { readRdCsv, eligible } from './rd-csv.mjs'

export const stageMap = {
  'Qualificado': 'qualificado',
  'Reunião de entendimento': 'reuniao_agendada',
  'Importante! Apresentação Institucional': 'apresentacao_institucional',
  'Envio da proposta': 'envio_proposta',
  'Apresentação da proposta': 'apresentacao_proposta',
  'Negociação': 'negociacao',
}
export function rdDate(date, time) {
  if (!date) { if (time) throw new Error('Hora sem data'); return null }
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date) || (time && !/^\d{2}:\d{2}$/.test(time))) throw new Error('Data RD inválida')
  const [d,m,y] = date.split('/')
  const value = `${y}-${m}-${d}T${time || '00:00'}:00-03:00`
  const parsed = new Date(value)
  if (Number.isNaN(+parsed) || new Date(+parsed - 10800000).toISOString().slice(0,10) !== `${y}-${m}-${d}`) throw new Error('Data RD impossível')
  return parsed.toISOString()
}
export function money(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Valor monetário inválido ou ausente')
  return Math.round(Number(value) * 100) / 100
}
export function phones(value) {
  return [...new Set(value.split(';').filter(s => s.trim()).map(s => {
    let digits = s.replace(/\D/g, '')
    if ([10,11].includes(digits.length)) digits = '55' + digits
    if (!/^55\d{10,11}$/.test(digits)) throw new Error('Telefone fora do padrão brasileiro esperado')
    return '+' + digits
  }))]
}
export function normalize(row, options) {
  if (!eligible(row)) throw new Error('Status não autorizado')
  const sold = row.Estado === 'Vendida'
  const stage = sold ? 'ganho' : row.Etapa === 'Venda' ? options.openSaleStage : stageMap[row.Etapa]
  if (!stage || stage === 'ganho' && !sold) throw new Error('Etapa de venda aberta exige decisão explícita; não inventar fechamento')
  const createdAt = rdDate(row['Data de criação'], row['Hora de criação'])
  const closedAt = rdDate(row['Data de fechamento'], row['Hora de fechamento'])
  if (!createdAt || sold && !closedAt || !sold && closedAt) throw new Error('Datas incompatíveis com status')
  if (closedAt && closedAt < createdAt) throw new Error('Fechamento anterior à criação')
  // O export usa este placeholder em três contatos distintos. Nunca deduplicar
  // por ele; o valor original permanece em raw para rastreabilidade.
  const sourceEmail = row.Email.trim().toLowerCase() || null
  const email = sourceEmail === 'oi@exemplo.com' ? null : sourceEmail
  if (email && !/^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/.test(email)) throw new Error('Email múltiplo ou inválido')
  return {
    id: randomUUID(), rdId: row.ID, stage, sold, createdAt, closedAt,
    firstContactAt: rdDate(row['Data do primeiro contato'], row['Hora do primeiro contato']),
    title: row.Nome.trim(), name: row.Contatos.trim() || row.Nome.trim(),
    phones: phones(row.Telefone), email,
    externalContact: 'rd:contact:' + (row['ID do Contato'] || 'deal:' + row.ID),
    company: row.Empresa.trim() || null, rdCompany: row['ID da Empresa'] || null,
    mrr: money(row['Valor Recorrente']), setup: money(row['Valor Único']),
    qualification: Number(row['Qualificação']), raw: row,
  }
}

export function resolveContacts(rows, context) {
  const ctx = structuredClone(context)
  const peopleToCreate = [], identitiesToCreate = [], companiesToCreate = [], links = []
  for (const row of rows) {
    const keys = [
      ['external',row.externalContact], ...row.phones.map(p=>['phone',p]),
      ...(row.email ? [['email',row.email]] : []),
    ]
    const matches = new Set(ctx.identities.filter(i => keys.some(([k,v]) => k === i.kind && v === i.value) ||
      i.kind === 'wa_id' && row.phones.some(p=>p.replace(/\D/g,'')===i.value.replace(/\D/g,''))).map(i=>i.person_id))
    for (const p of ctx.people) if (row.phones.includes(p.phone_primary) || row.email && p.email_primary?.toLowerCase() === row.email) matches.add(p.id)
    if (matches.size > 1) throw new Error(`Identidades conflitantes: ${row.title}; ` + JSON.stringify(ctx.people.filter(p=>matches.has(p.id)).map(p=>({id:p.id,name:p.full_name,phone:row.phones.includes(p.phone_primary),email:row.email&&p.email_primary?.toLowerCase()===row.email}))))
    row.personId = [...matches][0] || randomUUID()
    row.personCreated = !matches.size
    if (!matches.size) {
      const person = {id:row.personId,full_name:row.name,email_primary:row.email,phone_primary:row.phones[0]||null,created_at:row.createdAt}
      peopleToCreate.push(person);ctx.people.push(person)
    }
    for (const [kind,value] of keys) {
      const found=ctx.identities.find(i=>i.kind===kind&&i.value===value)
      if (found && found.person_id !== row.personId) throw new Error('Conflito de identidade na importação')
      if (!found) {const identity={person_id:row.personId,kind,value};identitiesToCreate.push(identity);ctx.identities.push(identity)}
    }
    row.companyId = null
    if (row.company) {
      const matching=ctx.companies.filter(c=>row.rdCompany && c.enrichment?.rd_company_id === row.rdCompany ||
        [c.trade_name,c.legal_name].some(n=>n?.trim().toLowerCase() === row.company.toLowerCase()))
      if (matching.length>1) throw new Error(`Empresa ambígua: ${row.company}`)
      row.companyId=matching[0]?.id || randomUUID()
      if (!matching.length) {
        const company={id:row.companyId,trade_name:row.company,created_at:row.createdAt,enrichment:{rd_company_id:row.rdCompany}}
        companiesToCreate.push(company);ctx.companies.push(company)
      }
      if (!links.some(l=>l.person_id===row.personId && l.company_id===row.companyId)) links.push({person_id:row.personId,company_id:row.companyId,role_title:row.raw.Cargo || null})
    }
  }
  return {rows,peopleToCreate,identitiesToCreate,companiesToCreate,links}
}

const childTables = ['activities','stage_history','meetings','proposals','contracts','objection_occurrences','notes','tasks','opportunity_products','deal_files']
const backupTables = ['opportunities', ...childTables, 'custom_field_values', 'outbox']
const hash = value => createHash('sha256').update(value).digest('hex')
const root = resolve(import.meta.dirname, '..')
const folder = join(root, '.security-local', 'rd-import-20260908')
const planPath = join(folder, 'plan.json')
const sourcePath = join(root, 'planilha deals atuais.csv')
const backupPath = join(root, '.security-local', 'backups', '2026-09-08T20-36-06-567Z')
const literal = v => v == null ? 'null' : "'" + String(v).replaceAll("'", "''") + "'"
const json = v => literal(JSON.stringify(v)) + '::jsonb'

// Um snapshot SQL único cobre os registros removidos e todas as cascatas.
export function snapshotQuery(ids) {
  const old = ids ? `select value::uuid id from jsonb_array_elements_text(${json(ids)})` : 'select id from opportunities'
  const conditions = Object.fromEntries(backupTables.map(table => [table,
    table === 'opportunities' ? 't.id in (select id from old)' :
    table === 'custom_field_values' ? 't.entity_id in (select id from old)' :
    table === 'outbox' ? "t.payload->>'opportunity_id' in (select id::text from old)" :
    't.opportunity_id in (select id from old)']))
  return `with old as (${old}) select jsonb_build_object(${backupTables.map(table => `${literal(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t where ${conditions[table]})`).join(',')}) as snapshot`
}

function insert(table, records, extra = '') {
  if (!records.length) return ''
  const columns=Object.keys(records[0])
  return `insert into public.${table} (${columns.join(',')}) select ${columns.join(',')} from jsonb_populate_recordset(null::public.${table},${json(records)}) ${extra};`
}

export function buildImport(plan, options) {
  if (options.openSaleStage !== 'negociacao') throw new Error('Mapeamento de Venda aberta não suportado sem datas reais de fechamento')
  if (options.ownerId && !plan.context.profiles.some(p=>p.id===options.ownerId && p.active && p.role==='vendedor')) throw new Error('Responsável não é vendedor ativo')
  const data=resolveContacts(plan.rows.map(r=>normalize(r,options)),plan.context)
  const {rows}=data
  const importedAt=new Date().toISOString(), batch='rd-import-20260908'
  const oldIds=plan.snapshot.opportunities.map(o=>o.id)
  const singleProducts={'Catálogo Virtual':'sites','Hospedagem':'hospedagem','Artes Gráficas':'artes_redes','Identidade Visual':'identidade'}
  const productRows=[]
  for (const r of rows) {
    r.importedAt=importedAt
    const code=singleProducts[r.raw.Produtos]
    if (code && !(r.mrr && r.setup)) {
      const product=plan.context.products.find(p=>p.code===code)
      if (!product) throw new Error('Produto esperado ausente do catálogo')
      productRows.push({opportunity_id:r.id,product_id:product.id,mrr:r.mrr||r.setup,quantity:1,discount:0,recurrence:r.mrr?'mensal':'unico',note:`RD: ${r.raw.Produtos}. Valor do export.`,created_at:importedAt})
    }
  }
  const peopleBefore=plan.context.people.filter(p=>rows.some(r=>r.personId===p.id))
  const personUpdates=rows.filter(r=>!r.personCreated).map(r=>({id:r.personId,full_name:r.name,email_primary:r.email,phone_primary:r.phones[0]||null}))
  const opportunities=rows.map((r,i)=>({id:r.id,person_id:r.personId,company_id:r.companyId,owner_id:options.ownerId||null,
    stage:r.stage,stage_since:r.closedAt||importedAt,board_rank:i,title:r.title,product:r.raw.Produtos||null,
    expected_value:r.mrr,setup_value:r.setup,term_months:12,probability:plan.context.stages.find(s=>s.stage===r.stage)?.probability,
    qualificacao:r.qualification,created_at:r.createdAt,closed_at:r.closedAt,first_contact_at:r.firstContactAt,
    source:r.raw.Fonte||null,campaign:r.raw.Campanha||null,
    qualification:{rd_import:{batch,rd_deal_id:r.rdId,imported_at:importedAt,stage_date_known:!!r.closedAt,term_months_assumed:true,raw:r.raw}},
  }))
  if (opportunities.some(o=>!Number.isFinite(o.probability))) throw new Error('Etapa não encontrada no banco')
  const notes=rows.map(r=>({opportunity_id:r.id,created_at:importedAt,body:[
    `Importação RD em ${importedAt}. Negócio RD: ${r.rdId}.`,
    `Status original: ${r.raw.Estado}. Etapa original: ${r.raw.Etapa}.`,
    `Responsável original: ${r.raw.Responsável}.`,
    `Produtos originais: ${r.raw.Produtos||'não informados'}.`,
    `Valor único: R$ ${r.setup.toFixed(2)}. Valor recorrente: R$ ${r.mrr.toFixed(2)}.`,
    r.raw.Produtos && !productRows.some(p=>p.opportunity_id===r.id) ? 'O export não discrimina preço por produto. Os totais foram preservados no negócio; detalhar os preços antes de editar os produtos.' : '',
    r.sold ? `Fechamento original: ${r.raw['Data de fechamento']} ${r.raw['Hora de fechamento']}.` : 'Data de entrada na etapa não consta no export. A data atual marca somente a importação; nenhum histórico de avanço foi inventado.',
    'Prazo de contrato não informado na RD; projeção utiliza o padrão de 12 meses do sistema.',
    r.raw.Email==='oi@exemplo.com' ? 'Email original oi@exemplo.com preservado apenas como referência por ser compartilhado por contatos distintos.' : '',
    r.raw['Data da próxima tarefa'] ? `Próxima tarefa na RD: ${r.raw['Data da próxima tarefa']} ${r.raw['Hora da próxima tarefa']}. O export não informa descrição nem tipo; referência preservada sem criar compromisso de calendário.` : '',
    !r.phones.length&&!r.email ? 'O export não possui telefone nem email deste contato.' : '',
  ].filter(Boolean).join('\n')}))
  const activityRows=rows.map(r=>({opportunity_id:r.id,person_id:r.personId,kind:'sistema',direction:'inbound',is_automated:false,occurred_at:importedAt,
    body:'Importação de cadastro da RD. Registro administrativo, sem mensagem enviada ou recebida.',meta:{batch,rd_deal_id:r.rdId,administrative:true}}))
  const stageRows=rows.filter(r=>r.sold).map(r=>({opportunity_id:r.id,from_stage:null,to_stage:'ganho',changed_at:r.closedAt,actor_type:'system',reason:'Fechamento histórico importado da RD; data presente no export.'}))
  const lockTables=[...backupTables,'people','identities','companies','person_company','touchpoints']
  const oldIdSql=`select value::uuid from jsonb_array_elements_text(${json(oldIds)})`
  const peopleIds=`select value::uuid from jsonb_array_elements_text(${json(peopleBefore.map(p=>p.id))})`
  const body=`begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
lock table ${lockTables.map(t=>'public.'+t).join(',')} in share row exclusive mode;
create temporary table rd_import_before on commit drop as select (select count(*) from opportunities) deals,(select count(*) from outbox) outbox;
do $guard$ declare current_snapshot jsonb; begin
  select snapshot into current_snapshot from (${snapshotQuery(oldIds)}) t;
  if current_snapshot <> ${json(plan.snapshot)} then raise exception 'Dados de corte alterados: atualizar backup antes de importar'; end if;
  if exists(select 1 from opportunities where qualification->'rd_import'->>'batch'=${literal(batch)}) then raise exception 'Lote já importado'; end if;
  if (select coalesce(jsonb_agg(p order by p.id),'[]') from people p where id in (${peopleIds})) <> (select coalesce(jsonb_agg(p order by p.id),'[]') from jsonb_populate_recordset(null::people,${json(peopleBefore)}) p) then raise exception 'Contato alterado após conferência'; end if;
end $guard$;
${insert('people',data.peopleToCreate)}
${insert('companies',data.companiesToCreate)}
${insert('identities',data.identitiesToCreate)}
${insert('person_company',data.links,'on conflict (person_id,company_id) do nothing')}
update people p set full_name=v.full_name,email_primary=coalesce(v.email_primary,nullif(p.email_primary,'oi@exemplo.com')::citext),phone_primary=coalesce(v.phone_primary,p.phone_primary),updated_at=now()
 from jsonb_populate_recordset(null::people,${json(personUpdates)}) v where p.id=v.id;
${insert('opportunities',opportunities)}
${insert('notes',notes)}
${insert('activities',activityRows)}
${insert('stage_history',stageRows)}
${insert('opportunity_products',productRows)}
update outbox set status='dead',last_error='Negócio de teste removido no corte de produção RD 2026-09-08.' where payload->>'opportunity_id' in (select id::text from opportunities where id in (${oldIdSql})) and status in ('pending','failed');
delete from custom_field_values where entity_id in (${oldIdSql});
delete from opportunities where id in (${oldIdSql});
do $verify$ begin
  if (select count(*) from opportunities where qualification->'rd_import'->>'batch'=${literal(batch)}) <> ${rows.length} then raise exception 'Contagem importada divergente'; end if;
  if exists(select 1 from opportunities where id in (${oldIdSql})) then raise exception 'Restaram negócios do corte'; end if;
  if exists(select 1 from jsonb_populate_recordset(null::opportunities,${json(opportunities)}) s left join opportunities o using(id)
    where o.id is null or o.stage<>s.stage or o.person_id<>s.person_id or o.owner_id is distinct from s.owner_id or o.created_at<>s.created_at or o.closed_at is distinct from s.closed_at or o.expected_value<>s.expected_value or o.setup_value<>s.setup_value or o.lost_at is not null or o.paused_at is not null) then raise exception 'Valores/status/datas divergentes'; end if;
  if exists(select 1 from fn_leads_para_outreach(0,100000) x join opportunities o on o.id=x.opportunity_id where o.qualification->'rd_import'->>'batch'=${literal(batch)}) then raise exception 'Importação elegível a disparo automático'; end if;
  if (select count(*) from stage_history where opportunity_id in (select id from opportunities where qualification->'rd_import'->>'batch'=${literal(batch)}))<>${stageRows.length} then raise exception 'Histórico divergente'; end if;
  if (select count(*) from opportunities) <> (select deals-${oldIds.length}+${rows.length} from rd_import_before) then raise exception 'Negócios fora do corte afetados'; end if;
  if (select count(*) from outbox) <> (select outbox from rd_import_before) then raise exception 'Conversão externa gerada indevidamente'; end if;
  if exists(select 1 from jsonb_populate_recordset(null::opportunities,${json(opportunities.filter(o=>o.closed_at))}) s join v_opp_journey j on j.id=s.id where j.ganho_at is distinct from s.closed_at) then raise exception 'Indicadores não preservaram o fechamento RD'; end if;
end $verify$;
insert into events(event_name,subject_type,subject_id,actor_type,source,idempotency_key,payload)
values('rd.production_cutover','import',${literal(randomUUID())}::uuid,'system','rd_csv',${literal(batch)},${json({batch,source_sha256:plan.sourceHash,removed:oldIds.length,imported:rows.length,excluded:plan.excludedRows,options})});
select jsonb_build_object('imported',${rows.length},'removed',${oldIds.length},'sold',${rows.filter(r=>r.sold).length},'open',${rows.filter(r=>!r.sold).length},'stages',(select jsonb_object_agg(stage,n) from (select stage,count(*) n from opportunities where qualification->'rd_import'->>'batch'=${literal(batch)} group by stage) s)) result;
`
  return {body,rows,peopleBefore,options,importedAt,counts:{people:data.peopleToCreate.length,companies:data.companiesToCreate.length,productLines:productRows.length}}
}

async function main() {
  const { sql } = await import('./sql.mjs')
  const command = process.argv[2]
  if (command === 'prepare') {
    if (existsSync(planPath)) throw new Error('Plano já existe; não sobrescrever backup ou IDs de corte')
    mkdirSync(folder, { recursive: true })
    const all = readRdCsv(sourcePath), rows = all.filter(eligible)
    if (new Set(rows.map(r => r.ID)).size !== rows.length) throw new Error('Negócio elegível duplicado')
    const [{ snapshot }] = await sql(snapshotQuery())
    const context = (await sql(`select jsonb_build_object('people',(select coalesce(jsonb_agg(p),'[]') from people p),'identities',(select coalesce(jsonb_agg(i),'[]') from identities i),'companies',(select coalesce(jsonb_agg(c),'[]') from companies c),'stages',(select jsonb_agg(s) from pipeline_stages s),'profiles',(select jsonb_agg(jsonb_build_object('id',id,'name',full_name,'role',role,'active',is_active)) from profiles),'products',(select jsonb_agg(p) from products p)) as context`))[0].context
    const plan = { createdAt: new Date().toISOString(), sourceHash: hash(readFileSync(sourcePath)), snapshot, context, rows, excludedRows: all.length - rows.length, options: null }
    writeFileSync(planPath, JSON.stringify(plan, null, 2))
    writeFileSync(join(folder, 'backup.sha256'), hash(readFileSync(planPath)))
    console.log(JSON.stringify({plan:planPath,eligible:rows.length,excluded:plan.excludedRows,backupCounts:Object.fromEntries(backupTables.map(t=>[t,snapshot[t].length]))},null,2))
    return
  }
  if (command === 'inspect') {
    const plan = JSON.parse(readFileSync(planPath,'utf8'))
    const data = resolveContacts(plan.rows.map(r=>normalize(r,{openSaleStage:'negociacao'})),plan.context)
    console.log(JSON.stringify({eligible:data.rows.length,newPeople:data.peopleToCreate.length,newCompanies:data.companiesToCreate.length,
      existingContacts:data.rows.filter(r=>!r.personCreated).map(r=>({deal:r.title,existingName:plan.context.people.find(p=>p.id===r.personId)?.full_name,rdName:r.name})),
      sourceOpenSale:data.rows.filter(r=>!r.sold&&r.raw.Etapa==='Venda').map(r=>r.title),
      totals:{mrr:data.rows.reduce((s,r)=>s+Math.round(r.mrr*100),0)/100,setup:data.rows.reduce((s,r)=>s+Math.round(r.setup*100),0)/100}},null,2))
    return
  }
  if (command === 'build') {
    const plan=JSON.parse(readFileSync(planPath,'utf8'))
    if (hash(readFileSync(planPath))!==readFileSync(join(folder,'backup.sha256'),'utf8')) throw new Error('Backup do corte modificado')
    if (hash(readFileSync(sourcePath))!==plan.sourceHash) throw new Error('CSV modificado')
    const options={openSaleStage:'negociacao',ownerId:plan.context.profiles.find(p=>p.role==='vendedor'&&p.active)?.id||null}
    const built=buildImport(plan,options)
    writeFileSync(join(folder,'candidate.json'),JSON.stringify(built,null,2))
    writeFileSync(join(folder,'rehearse.sql'),built.body+'rollback;')
    writeFileSync(join(folder,'candidate.sha256'),hash(readFileSync(join(folder,'candidate.json'))))
    console.log(JSON.stringify({candidate:true,decisionsPending:true,options,counts:built.counts,sourceRows:built.rows.length,sqlBytes:Buffer.byteLength(built.body)}))
    return
  }
  if (command === 'rehearse') {
    const manifest=JSON.parse(readFileSync(join(backupPath,'manifest.json'),'utf8'))
    if (!manifest.restore_verified || manifest.restore_test.network !== 'none') throw new Error('Backup ainda não restaurado em ambiente isolado')
    const run=(args,input='')=>new Promise((resolve,reject)=>{
      const child=spawn('docker',args,{stdio:['pipe','pipe','pipe'],windowsHide:true})
      let out='',err=''
      child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c)
      child.on('error',()=>reject(new Error('Docker indisponível')))
      child.stdin.on('error',()=>{})
      child.on('close',code=>code===0?resolve(out):reject(new Error(err.split('\n').filter(l=>/ERROR:|FATAL:/.test(l)).join('\n').slice(0,400)||'Ensaio local falhou')))
      child.stdin.end(input)
    })
    const info=JSON.parse(await run(['inspect',manifest.restore_test.container]))[0]
    if (info.HostConfig.NetworkMode!=='none'||Object.keys(info.HostConfig.PortBindings||{}).length) throw new Error('Container não isolado')
    const built=JSON.parse(readFileSync(join(folder,'candidate.json'),'utf8'))
    const candidateHash=hash(readFileSync(join(folder,'candidate.json')))
    if (candidateHash!==readFileSync(join(folder,'candidate.sha256'),'utf8')) throw new Error('Candidato alterado')
    const output=await run(['exec','-i',manifest.restore_test.container,'psql','-X','-U','supabase_admin','-d',manifest.restore_test.database,'-v','ON_ERROR_STOP=1','-Atq'],built.body+'rollback;')
    const result=JSON.parse(output.trim()).result || JSON.parse(output.trim())
    writeFileSync(join(folder,'rehearsal.json'),JSON.stringify({at:new Date().toISOString(),candidateHash,network:'none',rolledBack:true,result},null,2))
    console.log(JSON.stringify({localRehearsal:true,rolledBack:true,result}))
    return
  }
  if (command === 'apply') {
    const built=JSON.parse(readFileSync(join(folder,'candidate.json'),'utf8'))
    const candidateHash=hash(readFileSync(join(folder,'candidate.json')))
    const rehearsal=JSON.parse(readFileSync(join(folder,'rehearsal.json'),'utf8'))
    const plan=JSON.parse(readFileSync(planPath,'utf8'))
    if (!process.argv.includes('--confirmed-mapping') || !process.argv.includes(`--open-sale-stage=${built.options.openSaleStage}`) || !process.argv.includes(`--owner=${built.options.ownerId||'none'}`)) throw new Error('Informar somente o mapeamento explicitamente decidido pelo usuário')
    if (candidateHash!==rehearsal.candidateHash || !rehearsal.rolledBack || rehearsal.network!=='none') throw new Error('Candidato não validado no ensaio local')
    if (hash(readFileSync(sourcePath))!==plan.sourceHash || hash(readFileSync(planPath))!==readFileSync(join(folder,'backup.sha256'),'utf8')) throw new Error('Fonte/backup alterados')
    if (existsSync(join(folder,'applied.json'))) throw new Error('Lote já aplicado; consultar resultado, não repetir')
    const manifest=JSON.parse(readFileSync(join(backupPath,'manifest.json'),'utf8'))
    if (!manifest.complete||!manifest.restore_verified) throw new Error('Backup não verificado')
    for (const file of manifest.files) if(hash(readFileSync(join(backupPath,file.name)))!==file.sha256) throw new Error('Dump corrompido')
    const result=await sql(built.body+'commit;')
    writeFileSync(join(folder,'applied.json'),JSON.stringify({at:new Date().toISOString(),candidateHash,result},null,2))
    console.log(JSON.stringify({applied:true,result}))
    return
  }
  throw new Error('Comando inválido: prepare, inspect, build, rehearse ou apply')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message.split(/\\nLINE|\nLINE/)[0].slice(0,350)); process.exitCode = 1 })
}
