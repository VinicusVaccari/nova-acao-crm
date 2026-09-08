// Backup lógico local, sem alterar dados de negócio. A CLI pode emitir uma
// credencial temporária de acesso ao Postgres; não redefine a senha existente.
// Não é considerado restaurável até um ensaio separado. Objetos do Storage
// (bytes dos arquivos) não fazem parte destes dumps de banco.
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { getCACertificates } from 'node:tls'

const root = fileURLToPath(new URL('../', import.meta.url))
const env = { ...process.env, ...parseEnv(readFileSync(join(root, '.env.local'), 'utf8')) }
if (!env.SUPABASE_ACCESS_TOKEN || !/^[a-z]{20}$/.test(env.SUPABASE_PROJECT_REF ?? '')) throw new Error('Credenciais de gerenciamento ausentes.')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const destination = join(root, '.security-local', 'backups', stamp)
mkdirSync(destination, { recursive: true })
// Propaga as CAs já confiadas pelo sistema para a CLI/Bun. Não desabilita TLS.
const trustedCaFile = join(destination, 'trusted-ca.pem')
writeFileSync(trustedCaFile, [...new Set([...getCACertificates('system'), ...getCACertificates('extra')])].join('\n'))
env.NODE_EXTRA_CA_CERTS = trustedCaFile
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const manifest = { created_at: new Date().toISOString(), project_ref: env.SUPABASE_PROJECT_REF, cli_version: '2.116.0', complete: false, restore_verified: false, storage_bytes_included: false, files: [] }
const saveManifest = () => writeFileSync(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2))
saveManifest()

async function dump(name, flags) {
  console.log(`Exportando ${name} para diretório local ignorado pelo Git...`)
  const args = [npmCli, 'exec', '--yes', '--package=supabase@2.116.0', '--', 'supabase', 'db', 'dump', '--project-ref', env.SUPABASE_PROJECT_REF, '--file', join(destination, name), ...flags]
  let diagnostic = ''
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    // A CLI também emite diagnósticos em stdout. Buffer limitado, redigido
    // antes de qualquer exibição; nunca salvar log bruto com credenciais.
    const capture = chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-8000) }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000)
    child.on('error', error => { clearTimeout(timer); reject(new Error(`Falha ao iniciar CLI: ${error.code ?? 'desconhecida'}`)) })
    child.on('close', status => { clearTimeout(timer); resolve(status) })
  })
  if (code !== 0) {
    for (const value of Object.values(env)) if (typeof value === 'string' && value.length > 6) diagnostic = diagnostic.replaceAll(value, '[REDACTED]')
    diagnostic = diagnostic.replace(/postgres(?:ql)?:\/\/\S+/gi, '[CONNECTION REDACTED]')
      .replace(/(?:sbp_|sb_secret_)[\w-]+/g, '[TOKEN REDACTED]')
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[JWT REDACTED]')
      .replace(/(password|secret|token)(["']?\s*[:=]\s*["']?)[^\s"']+/gi, '$1$2[REDACTED]')
    console.error(diagnostic.slice(-1500))
    throw new Error(`Backup interrompido em ${name}; código ${code}. Diretório parcial: ${destination}`)
  }
  const file = join(destination, name)
  const bytes = statSync(file).size
  if (!bytes) throw new Error(`Dump vazio: ${name}`)
  manifest.files.push({ name, bytes, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') })
  saveManifest()
  console.log(`${name}: ${bytes} bytes exportados.`)
}

await dump('roles.sql', ['--role-only'])
await dump('schema.sql', ['--schema', 'public,auth,storage'])
await dump('data.sql', ['--schema', 'public,auth,storage', '--data-only', '--use-copy'])
manifest.complete = true
saveManifest()
console.log(`Dump lógico gerado: ${destination}. Restauração e backup dos arquivos Storage AINDA PENDENTES.`)
