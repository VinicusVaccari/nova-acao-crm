export async function validateUpload(file: File, imageOnly = false): Promise<string> {
  if (!(file instanceof File) || !file.size || file.size > (imageOnly ? 2 : 25) * 1024 * 1024) throw new Error('Arquivo vazio ou acima do limite.')
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const prefix = (...expected: number[]) => expected.every((b,i) => bytes[i] === b)
  const text = new TextDecoder().decode(bytes)
  const extension = file.name.toLowerCase().split('.').pop()
  const images: Record<string, [string, boolean]> = {
    png: ['image/png',prefix(137,80,78,71,13,10,26,10)],
    jpg: ['image/jpeg',prefix(255,216,255)], jpeg: ['image/jpeg',prefix(255,216,255)],
    gif: ['image/gif',text.startsWith('GIF87a') || text.startsWith('GIF89a')],
    webp: ['image/webp',text.startsWith('RIFF') && text.slice(8,12)==='WEBP'],
  }
  if (extension && images[extension]?.[1]) return images[extension][0]
  if (imageOnly) throw new Error('Imagem inválida. Use PNG, JPG, GIF ou WebP.')
  if (extension==='pdf' && text.startsWith('%PDF-')) return 'application/pdf'
  const office: Record<string,string> = {
    docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip:'application/zip',
  }
  if (extension && office[extension] && (prefix(80,75,3,4) || prefix(80,75,5,6))) return office[extension]
  if (extension && ['doc','xls','ppt'].includes(extension) && prefix(208,207,17,224,161,177,26,225)) return 'application/octet-stream'
  if (extension && ['txt','csv'].includes(extension) && !bytes.includes(0)) return extension==='csv' ? 'text/csv' : 'text/plain'
  throw new Error('Formato de arquivo não permitido ou conteúdo incompatível.')
}
