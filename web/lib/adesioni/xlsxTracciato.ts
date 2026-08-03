// Scrittura/append del tracciato AXA (exceljs) lato server, come buffer.
// Porta xlsxFlussoWriter.js e xlsxAppend.js: le date restano testo GG/MM/AAAA
// (numFmt '@') per preservare il formato richiesto dalla compagnia.
import ExcelJS from 'exceljs'
import { TRACCIATO_HEADERS, iddPairCapacity, trackHeadersFor } from './tracciato.js'
import { buildTrackRow } from './recordMapper.js'
import type { AdesioniConfig } from './config'

type Rec = Record<string, unknown>
const dataOf = (entry: Rec): Rec => (entry && (entry as { data?: Rec }).data ? (entry as { data: Rec }).data : entry)

/** Crea un nuovo file tracciato con tutte le righe passate. Ritorna un Buffer .xlsx. */
export async function writeTrackBuffer(records: Rec[], config: AdesioniConfig, headers?: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CSA Adesioni — ThinkPink Studio'
  wb.created = new Date()
  const ws = wb.addWorksheet('flusso')
  // Le colonne del questionario seguono il numero di domande configurate: con
  // intestazioni più corte le risposte in eccesso sparirebbero dal tracciato.
  const cols: string[] = headers && headers.length ? headers : (trackHeadersFor(config.idd) as string[])
  ws.addRow(cols)
  for (const entry of records || []) {
    const row = buildTrackRow(dataOf(entry), config.fields, config.idd, cols)
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

  // Il file scelto detta le colonne: se ha meno coppie CODICE DOMANDA/RISPOSTA
  // delle domande configurate, le risposte in eccesso finirebbero nel nulla.
  // Meglio dirlo che consegnare in AXA un tracciato monco.
  const capacity = iddPairCapacity(headers) as number
  const questions = Array.isArray(config.idd) ? config.idd.length : 0
  if (questions > capacity) {
    throw new Error(
      `Il file selezionato ha spazio per ${capacity} domande del questionario IDD, ma ne sono configurate ${questions}: ` +
      'esporta un nuovo tracciato invece di accodare a questo file.'
    )
  }

  const list = Array.isArray(records) ? records : []
  for (const entry of list) {
    const row = buildTrackRow(dataOf(entry), config.fields, config.idd, headers)
    const added = ws.addRow(row)
    added.eachCell((cell) => { cell.numFmt = '@' })
  }
  const out = await wb.xlsx.writeBuffer()
  return { buffer: Buffer.from(out), appended: list.length, total: ws.actualRowCount - 1 }
}
