import 'server-only'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { checkServerIdentity } from 'node:tls'

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export function publicIPv4(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false
  const [a, b, c, d] = ip.split('.').map(Number)
  if ([a,b,c,d].some(n => n > 255)) return false
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113))
}

export function allowedAudioUrl(input: string): URL {
  const url = new URL(input)
  const configured = (process.env.WHATSAPP_MEDIA_HOSTS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const provider = ['backblazeb2.com', 'z-api.io'].some(d => url.hostname.endsWith(`.${d}`))
  const allowed = configured.length ? configured.includes(url.hostname) : provider
  if (!allowed || url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) throw new Error('Origem de áudio não autorizada.')
  return url
}

export function audioFormat(bytes: Uint8Array): { mime: string; ext: string } {
  const b = Buffer.from(bytes)
  if (b.subarray(0,4).toString() === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' }
  if (b.subarray(0,3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3' }
  if (b.subarray(4,8).toString() === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' }
  if (b.subarray(0,4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WAVE') return { mime: 'audio/wav', ext: 'wav' }
  throw new Error('Formato de áudio não permitido.')
}

export async function downloadAudio(input: string): Promise<{ bytes: Buffer; mime: string; ext: string }> {
  const url = allowedAudioUrl(input)
  const addresses = await lookup(url.hostname, { all: true, family: 4 })
  if (!addresses.length || addresses.some(a => !publicIPv4(a.address))) throw new Error('Endereço de áudio não autorizado.')
  // Conecta ao IP já validado (sem segunda resolução DNS/rebinding), mantendo
  // SNI, Host e validação TLS para o hostname original. Redirects são rejeitados.
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const req = request({
      hostname: addresses[0].address, family: 4, servername: url.hostname, port: 443,
      path: url.pathname + url.search, method: 'GET', headers: { Host: url.hostname },
      rejectUnauthorized: true, checkServerIdentity: (_host, cert) => checkServerIdentity(url.hostname, cert),
      signal: AbortSignal.timeout(15000),
    }, res => {
      if (res.statusCode !== 200 || Number(res.headers['content-length']) > MAX_AUDIO_BYTES) {
        res.destroy(); reject(new Error('Resposta de mídia inválida.')); return
      }
      const parts: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_AUDIO_BYTES) { req.destroy(new Error('Áudio acima de 25 MB.')); return }
        parts.push(chunk)
      })
      res.on('error', reject)
      res.on('end', () => resolve(Buffer.concat(parts)))
    })
    req.on('error', reject)
    req.end()
  })
  return { bytes, ...audioFormat(bytes) }
}
