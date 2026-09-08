import { readFileSync } from 'node:fs'

export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '').replace(/^sep=,\r?\n/, '')
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && c === ',') { row.push(cell); cell = '' }
    else if (!quoted && (c === '\r' || c === '\n')) {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); if (row.some(Boolean)) rows.push(row)
      row = []; cell = ''
    } else cell += c
  }
  if (quoted) throw new Error('CSV com aspas não fechadas')
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const headers = rows.shift()
  if (new Set(headers).size !== headers.length) throw new Error('Cabeçalhos duplicados')
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Registro ${index + 2}: ${values.length} colunas, esperado ${headers.length}`)
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]))
  })
}

export const readRdCsv = (path = 'planilha deals atuais.csv') => parseCsv(readFileSync(path, 'utf8'))
export const eligible = row => ['em andamento', 'vendida'].includes(row.Estado.trim().toLowerCase()) && row.Pausada.trim().toLowerCase() === 'não'
