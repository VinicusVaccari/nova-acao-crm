// Cliente MCP estritamente de leitura para a revisão NAIA <-> OS.
// Nunca invoca execute/update/publish, nem escreve na instância n8n.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))
let env = {}
for (const file of ['web/.env', 'web/.env.local', '.env', '.env.local']) {
  const path = join(root, file)
  if (existsSync(path)) env = { ...env, ...parseEnv(readFileSync(path, 'utf8')) }
}
const allowed = new Set(['search_projects','search_folders','search_workflows','get_workflow_details','search_executions','get_execution'])
const tool = process.argv[2]
if (!allowed.has(tool)) throw new Error('Somente ferramentas explicitamente de leitura são permitidas.')
const errorSummary = process.argv.includes('--error-summary')
const args = process.argv[3]?.startsWith('{') ? JSON.parse(process.argv[3]) : Object.fromEntries(process.argv.slice(3).filter(arg => !['--capture','--summary','--error-summary'].includes(arg)).map(arg => {
  const separator = arg.indexOf('=')
  if (separator < 1) throw new Error('Use campo=valor.')
  const key = arg.slice(0, separator).replace(/^--/, '')
  const value = arg.slice(separator + 1)
  return [key, ['limit','truncateData'].includes(key) ? Number(value) : key === 'includeData' ? value === 'true' : value]
}))
if (tool === 'get_execution' && args.includeData) throw new Error('Este cliente não exporta payloads de execução/PII.')
if (errorSummary) {
  if (tool !== 'get_execution' || process.argv.includes('--capture')) throw new Error('Resumo de erro restrito à leitura de execução, sem captura.')
  args.includeData = true
  args.truncateData = 1
}
const url = new URL(env.N8N_BASE_URL)
if (url.protocol !== 'https:' || url.hostname !== 'n8n.agencianovaacao.com.br' || !url.pathname.startsWith('/mcp') || url.username || url.password || url.search) throw new Error('Endpoint MCP inesperado.')
if (!env.N8N_API_KEY) throw new Error('Token MCP ausente.')
let session, requestId = 0
async function rpc(method, params, notification = false) {
  const id = notification ? undefined : ++requestId
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${env.N8N_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(session ? { 'Mcp-Session-Id': session } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), redirect: 'error', signal: AbortSignal.timeout(45000),
  })
  session = response.headers.get('mcp-session-id') || session
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}`)
  const text = await response.text()
  if (!text) return {}
  const result = text.trim().startsWith('{') ? JSON.parse(text) : text.split('\n').filter(line => line.startsWith('data:')).map(line => { try { return JSON.parse(line.slice(5)) } catch { return null } }).find(value => value?.id === id)
  if (result?.error) throw new Error(`MCP recusou ${method}: código ${result.error.code}`)
  return result?.result ?? {}
}

const secrets = Object.entries(env).filter(([key,value]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key) && value?.length > 8).map(([,value]) => value)
function scrubString(value) {
  for (const secret of secrets) value = value.replaceAll(secret, '[SEGREDO REDIGIDO]')
  return value.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[JWT REDIGIDO]')
    .replace(/(?:sbp_|sb_secret_|sk-proj-)[\w-]+/g, '[TOKEN REDIGIDO]')
    .replace(/(Bearer\s+)[A-Za-z0-9_.-]{10,}/gi, '$1[REDIGIDO]')
    .replace(/([?&](?:secret|token|api_key|apikey|key)=)[^&\s"'<>]+/gi, '$1[REDIGIDO]')
    .replace(/(\/instances\/)[^/\s"']+(\/token\/)[^/\s"']+/gi, '$1[INSTANCE]$2[TOKEN]')
    .replace(/(\/webhook(?:-test)?\/)[a-zA-Z0-9_-]{20,}/g, '$1[ROTA REDIGIDA]')
    .replace(/(["'](?:secret|token|api_key|apikey|authorization|client-token)["']\s*:\s*["'])[^"']+/gi, '$1[SEGREDO REDIGIDO]')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[TOKEN OU ID REDIGIDO]')
    .replace(/\b55\d{10,11}\b/g, '[TELEFONE REDIGIDO]')
}
function scrub(value, key = '') {
  if (/^(credentials|pinData|staticData|runData)$/.test(key)) return '[DADOS OMITIDOS]'
  if (key === 'path') return '[ROTA OMITIDA]'
  if (/^(password|secret|token|apiKey|accessToken|refreshToken|authorization|client-token)$/i.test(key)) return '[SEGREDO REDIGIDO]'
  if (typeof value === 'string') return scrubString(value)
  if (Array.isArray(value)) return value.map(item => scrub(item))
  if (value && typeof value === 'object') {
    const headerSecret = /authorization|token|secret|api.?key|password/i.test(String(value.name ?? ''))
    return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, headerSecret && k === 'value' ? '[SEGREDO REDIGIDO]' : scrub(v,k)]))
  }
  return value
}
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'security-readonly', version: '1.0' } })
await rpc('notifications/initialized', {}, true)
const result = await rpc('tools/call', { name: tool, arguments: args })
const content = result.structuredContent ?? result.content?.filter(block => block.type === 'text').map(block => { try { return JSON.parse(block.text) } catch { return block.text } }) ?? result
if (process.argv.includes('--capture') && !result.isError) {
  if (tool !== 'get_workflow_details' || !/^[A-Za-z0-9_-]{1,100}$/.test(args.workflowId ?? '')) throw new Error('Captura local restrita a detalhes de workflow identificado.')
  const target = join(root, '.security-local', 'n8n-review')
  mkdirSync(target, { recursive: true })
  // Pode conter segredos inline. Apenas na pasta privada já fora do Git;
  // não copiar este snapshot bruto para docs nem exibi-lo no terminal.
  writeFileSync(join(target, `${args.workflowId}.json`), JSON.stringify(content), { flag: 'wx' })
}
let output = content
if (errorSummary) {
  // Dados transitam apenas em memória. Nunca exportar inputs, outputs,
  // mensagem livre de erro, stack ou payloads com dados comerciais.
  const object = Array.isArray(content) ? content[0] : content
  const execution = object?.execution ?? object
  const executionData = object?.data ?? execution?.data ?? {}
  const data = executionData.resultData ?? execution?.resultData ?? executionData
  const error = data.error ?? execution?.error ?? {}
  const runErrors = Object.values(data.runData ?? {}).flatMap(runs => Array.isArray(runs) ? runs.filter(run => run.error).map(run => run.error) : [])
  const diagnosticStrings = []
  function collectDiagnostics(value, key = '') {
    if (['node','request','body','headers','stack','cause','context'].includes(key)) return
    if (typeof value === 'string' && ['message','description','error','code','type','rawErrorMessage'].includes(key)) diagnosticStrings.push(value)
    else if (Array.isArray(value)) value.forEach(item => collectDiagnostics(item,key))
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k,v]) => collectDiagnostics(v,k))
  }
  ;[error, ...runErrors].forEach(value => collectDiagnostics(value))
  const message = diagnosticStrings.join('\n')
  output = { keys: Object.keys(object ?? {}), executionKeys: Object.keys(execution ?? {}),
    dataKeys: Object.keys(executionData), resultDataKeys: Object.keys(data),
    lastNodeExecuted: data.lastNodeExecuted, errorNode: error.node?.name,
    categories: {
      unexecutedNode: /unexecuted|hasn.t been executed|not been executed/i.test(message),
      missingReference: /referenced node|no connection back/i.test(message),
      authentication: /unauthorized|forbidden|credential|401|403/i.test(message),
      badRequest: /bad request|400/i.test(message),
      invalidJson: /json|unexpected token/i.test(message),
      missingRelation: /relation .*does not exist|could not find.*table/i.test(message),
      timeout: /timeout|timed out/i.test(message),
      rateLimit: /rate.limit|too many requests|429/i.test(message),
      quota: /quota|billing|credit/i.test(message),
      insufficientQuotaCode: /insufficient_quota/.test(message),
      rateLimitExceededCode: /rate_limit_exceeded/.test(message),
      invalidToolName: /invalid.*(?:function|tool).*name|does not match.*pattern/i.test(message),
    },
    nodes: Object.entries(data.runData ?? {}).map(([name,runs]) => ({name,
      statuses: Array.isArray(runs) ? runs.map(run => ({status:run.executionStatus, hasError:!!run.error})) : []})),
  }
}
if (process.argv.includes('--summary') && !errorSummary) {
  const object = Array.isArray(content) ? content[0] : content
  const workflow = object?.workflow ?? object
  output = { keys: Object.keys(object ?? {}), workflowKeys: Object.keys(workflow ?? {}), id: workflow?.id, name: workflow?.name, active: workflow?.active, parentFolder: workflow?.parentFolder, parentFolderId: workflow?.parentFolderId,
    nodeCount: workflow?.nodes?.length, activeVersionId: workflow?.activeVersionId, draftVersionId: workflow?.versionId,
    nodeTypes: [...new Set(workflow?.nodes?.map(node => node.type) ?? [])] }
}
console.log(JSON.stringify(scrub({ tool, isError: result.isError ?? false, result: output }), null, 2))
