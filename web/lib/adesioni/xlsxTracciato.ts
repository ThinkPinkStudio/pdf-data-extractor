// Scrittura/append del tracciato AXA (exceljs) lato server, come buffer.
// Porta xlsxFlussoWriter.js e xlsxAppend.js: le date restano testo GG/MM/AAAA
// (numFmt '@') per preservare il formato richiesto dalla compagnia.
import ExcelJS from 'exceljs'
import { TRACCIATO_HEADERS } from './tracciato.js'
import { buildTrackRow } from './recordMapper.js'
import type { AdesioniConfig } from './config'

type Rec = Record<string, unknown>
const dataOf = (entry: Rec): Rec => (entry && (entry as { data?: Rec }).data ? (entry as { data: Rec }).data : entry)

/** Crea un nuovo file tracciato con tutte le righe passate. Ritorna un Buffer .xlsx. */
export async function writeTrackBuffer(records: Rec[], config: AdesioniConfig, headers: string[] = TRACCIATO_HEADERS): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CSA Adesioni — ThinkPink Studio'
  wb.created = new Date()
  const ws = wb.addWorksheet('flusso')
  ws.addRow(headers)
  for (const entry of records || []) {
    const row = buildTrackRow(dataOf(entry), config.fields, config.idd, headers)
    const added = ws.addRow(row)
    added.eachCell((cell) => { cell.numFmt = '@' })
  }
  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out)
}

function readSheetHeaders(ws: ExcelJS.Worksheet): string[] {
  const headers: string[] = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    const v = cell && (cell.value as unknown)
    headers[col - 1] = String(v == null ? '' : typeof v === 'object' && v && 'text' in (v as object) ? (v as { text: string }).text : v).trim()
  })
  while (headers.length && !headers[headers.length - 1]) headers.pop()
  return headers
}

/** Aggiunge record in coda a un tracciato esistente (buffer). Ritorna il nuovo buffer e i conteggi. */
export async function appendTrackBuffer(records: Rec[], existing: Buffer | ArrayBuffer, config: AdesioniConfig): Promise<{ buffer: Buffer; appended: number; total: number }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(existing as ExcelJS.Buffer)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('Nessun foglio trovato nel file selezionato')

  const own = readSheetHeaders(ws)
  const headers = own.length ? own : TRACCIATO_HEADERS

  const list = Array.isArray(records) ? records : []
  for (const entry of list) {
    const row = buildTrackRow(dataOf(entry), config.fields, config.idd, headers)
    const added = ws.addRow(row)
    added.eachCell((cell) => { cell.numFmt = '@' })
  }
  const out = await wb.xlsx.writeBuffer()
  return { buffer: Buffer.from(out), appended: list.length, total: ws.actualRowCount - 1 }
}
