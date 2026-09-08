// Consulta somente metadados. --rehearse ensaia a migration numa transação
// que termina obrigatoriamente em ROLLBACK: nenhum registro/DDL fica persistido.
// Sequências PostgreSQL podem avançar (gaps de IDs não são revertidos).
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const env = { ...parseEnv(readFileSync(new URL('.env.local', root), 'utf8')), ...process.env }
const token = env.SUPABASE_ACCESS_TOKEN
const ref = env.SUPABASE_PROJECT_REF
if (!token || !ref) throw new Error('Preflight requer SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF.')

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(90000),
  })
  if (!response.ok) {
    // SQL contém somente metadados, mas não mostramos corpo arbitrário do serviço.
    const body = await response.json().catch(() => ({}))
    throw new Error(`Preflight HTTP ${response.status}: ${String(body.message ?? 'consulta recusada').slice(0, 1000)}`)
  }
  return response.json()
}

const checks = `
select 'anon_table_grants' as check_name, count(*)::int as count from pg_class c
join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v')
and has_table_privilege('anon',c.oid,'SELECT')
union all
select 'anon_business_rpc',count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and left(p.proname,3)='fn_' and has_function_privilege('anon',p.oid,'EXECUTE')
union all
select 'profile_role_update',has_column_privilege('authenticated','public.profiles','role','UPDATE')::int
union all
select 'owner_security_views',count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='v' and not coalesce(c.reloptions @> array['security_invoker=true'],false)
union all
select 'security_rate_limit_rpc_present', (to_regprocedure('public.fn_security_rate_limit(text,integer,integer)') is not null)::int
union all
select 'security_manual_lead_rpc_present', (to_regprocedure('public.fn_create_lead_for_user(jsonb,uuid)') is not null)::int
union all
select 'security_whatsapp_receipts_present', (to_regclass('public.security_webhook_receipts') is not null)::int
union all
select 'private_audio_bucket_present', count(*)::int from storage.buckets where id='wa-audio' and public=false
union all
select 'service_role_tables_missing_crud',count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and not (
  has_table_privilege('service_role',c.oid,'SELECT') and has_table_privilege('service_role',c.oid,'INSERT')
  and has_table_privilege('service_role',c.oid,'UPDATE') and has_table_privilege('service_role',c.oid,'DELETE'))
union all
select 'service_role_sequences_missing_usage',count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and case when c.relkind='S' then not has_sequence_privilege('service_role',c.oid,'USAGE') else false end;
`

if (!process.argv.includes('--rehearse')) {
  console.log(JSON.stringify(await query(checks), null, 2))
} else {
  const path = new URL('supabase/migrations/0046_security_access_boundaries.sql', root)
  const migration = readFileSync(path,'utf8').replace(/^begin;\s*$/mi,'').replace(/^commit;\s*$/mi,'')
  const assertions = `
do $$ declare failures integer; begin
  select count(*) into failures from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','v') and has_table_privilege('anon',c.oid,'SELECT');
  if failures <> 0 then raise exception 'Ainda existem tabelas/views anônimas: %', failures; end if;
  if has_column_privilege('authenticated','public.profiles','role','UPDATE') then
    raise exception 'Role ainda pode ser alterada por authenticated'; end if;
  select count(*) into failures from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and left(p.proname,3)='fn_' and has_function_privilege('anon',p.oid,'EXECUTE');
  if failures <> 0 then raise exception 'Ainda existem RPCs anônimos: %', failures; end if;
  if not has_function_privilege('service_role','public.fn_ingest_lead(jsonb)','EXECUTE') then
    raise exception 'Ingestão interna sem permissão'; end if;
  if not has_function_privilege('service_role','public.fn_outreach_disparar()','EXECUTE') then
    raise exception 'Outreach interno sem permissão'; end if;
  if not public.fn_security_rate_limit('security-rehearsal',2,60) then raise exception 'Rate limit recusou primeira chamada'; end if;
  if not public.fn_security_rate_limit('security-rehearsal',2,60) then raise exception 'Rate limit recusou segunda chamada'; end if;
  if public.fn_security_rate_limit('security-rehearsal',2,60) then raise exception 'Rate limit aceitou terceira chamada'; end if;
end $$;
-- EXPLAIN valida as dependências das views no contexto de um cliente real,
-- sem executar leitura de dados pessoais.
set local role authenticated;
select public.fn_my_role();
explain select * from public.v_contatos_lista limit 0;
explain select * from public.v_sla_breaches limit 0;
explain select * from public.v_empresas_lista limit 0;
reset role;
`
  const fixtures = readFileSync(new URL('supabase/tests/security_access.sql', root), 'utf8')
  await query(`begin;\n${migration}\n${assertions}\n${fixtures}\nrollback;`)
  console.log(`Ensaio de ${fileURLToPath(path)}: assertions OK; ROLLBACK executado.`)
  console.log('Estado persistido (não alterado):', JSON.stringify(await query(checks)))
}
