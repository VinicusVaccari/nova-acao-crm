// Inspeciona snapshots privados sem executar código dos workflows.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
const root = fileURLToPath(new URL('../', import.meta.url))
const folder = join(root, '.security-local', 'n8n-review')
const selected = process.argv[2] ?? 'all'
const mode = process.argv[3] ?? 'overview'
const nameFilter = process.argv[4]
let env = {}
for (const file of ['web/.env', 'web/.env.local', '.env', '.env.local']) if (existsSync(join(root,file))) env = {...env,...parseEnv(readFileSync(join(root,file),'utf8'))}
function clean(text) {
  for (const [key,value] of Object.entries(env)) if (/TOKEN|KEY|SECRET|PASSWORD/.test(key) && value?.length>8) text=text.replaceAll(value,'[SEGREDO]')
  return text.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[JWT]')
    .replace(/([?&](?:secret|token|api_key|apikey|key)=)[^&\s"'<>]+/gi,'$1[SEGREDO]')
    .replace(/(\/instances\/)[^/\s"']+(\/token\/)[^/\s"']+/gi,'$1[INSTANCE]$2[TOKEN]')
    .replace(/\b[0-9a-f]{32,}\b/gi,'[TOKEN OU ID]')
    .replace(/(\/webhook(?:-test)?\/)[a-zA-Z0-9_-]{20,}/g,'$1[ROTA]')
    .replace(/(["'](?:secret|token|api_key|apikey|authorization|client-token)["']\s*:\s*["'])[^"']+/gi,'$1[SEGREDO]')
    .replace(/\b55\d{10,11}\b/g,'[TELEFONE]')
}
function scrub(value,key='') {
  if (/^(credentials|pinData|staticData|runData)$/.test(key)) return '[OMITIDO]'
  if (key === 'path') return '[ROTA OMITIDA]'
  if (/^(password|secret|token|apiKey|accessToken|refreshToken|authorization|client-token)$/i.test(key)) return '[SEGREDO]'
  if(typeof value==='string')return clean(value)
  if(Array.isArray(value))return value.map(x=>scrub(x))
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='value'&&/authorization|token|secret|api.?key|password/i.test(String(value.name??''))?'[SEGREDO]':scrub(v,k)]))
  return value
}
if (selected === 'outreach-source') {
  console.log(scrub(readFileSync(join(root, 'supabase/migrations/0040_outreach_agendador.sql'), 'utf8')))
  process.exit(0)
}
for(const file of readdirSync(folder).filter(x=>x.endsWith('.json')&&(selected==='all'||x===`${selected}.json`))) {
  const document=JSON.parse(readFileSync(join(folder,file),'utf8'))
  const w=document.workflow
  const live=w.activeVersion?.nodes ? w.activeVersion : w
  const nodes=live.nodes ?? []
  const base={id:w.id,name:w.name,nodeCount:nodes.length,settings:w.settings,versionMatches:w.versionId===w.activeVersionId,usingActiveVersion:live!==w}
  if(mode==='overview') console.log(JSON.stringify(scrub({...base,nodes:nodes.filter(n=>!n.disabled&&!n.type.endsWith('.stickyNote')).map(n=>({name:n.name,type:n.type,operation:n.parameters?.operation,table:n.parameters?.tableId,url:n.parameters?.url,subworkflow:n.parameters?.workflowId,authentication:n.parameters?.authentication,retry:n.retryOnFail,onError:n.onError,continueOnFail:n.continueOnFail,credentialsPresent:!!n.credentials}))})))
  else if(mode==='connections')console.log(JSON.stringify(scrub({...base,connections:live.connections})))
  else if(mode==='prompt-excerpts')console.log(JSON.stringify(scrub({...base,prompts:nodes.filter(n=>!n.disabled).flatMap(n=>Object.entries(n.parameters?.options??{}).filter(([,v])=>typeof v==='string').map(([key,value])=>({name:n.name,key,lines:value.split('\n').filter(line=>new RegExp(nameFilter??'opportunityId|motivo_descarte|encerrar_conversa','i').test(line))})))})))
  else if(mode==='nodes')console.log(JSON.stringify(scrub({...base,nodes:nodes.filter(n=>!n.disabled&&!n.type.endsWith('.stickyNote')&&(!nameFilter||new RegExp(nameFilter,'i').test(n.name+' '+n.type))).map(n=>({name:n.name,type:n.type,parameters:n.parameters,retryOnFail:n.retryOnFail,maxTries:n.maxTries,waitBetweenTries:n.waitBetweenTries,onError:n.onError,continueOnFail:n.continueOnFail,alwaysOutputData:n.alwaysOutputData}))})))
  else throw new Error('Modo desconhecido.')
}
