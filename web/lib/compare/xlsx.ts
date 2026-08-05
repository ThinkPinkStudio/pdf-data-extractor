// Lettura/scrittura Excel lato client per Portafoglio Compare.
// Sostituisce gli handler IPC Electron (read-excel / save-xlsx) con SheetJS
// direttamente nel browser: input da File/ArrayBuffer, output come download.

import * as XLSX from 'xlsx'
import type { Row, Workbook } from './engine'

export async function readWorkbook(file: File): Promise<Workbook> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheets: Record<string, Row[]> = {}
  wb.SheetNames.forEach((name) => {
    sheets[name] = XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { defval: null, raw: false })
  })
  return { sheetNames: wb.SheetNames, sheets, length: sheets[wb.SheetNames[0]]?.length || 0 }
}

// Le righe lette con raw:false contengono SOLO stringhe (testo formattato):
// riesportate così, in Excel gli importi diventano testo e somme/filtri non
// funzionano. Dove la stringa è un numero puro la riconvertiamo. Restano testo
// gli identificativi con zeri iniziali ("007123") e le cifre oltre la
// precisione intera sicura, per non corromperli.
function cellValue(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if (!s || /^-?0\d/.test(s)) return v
  if (/^-?\d+$/.test(s)) {
    const n = Number(s)
    return Number.isSafeInteger(n) ? n : v
  }
  if (/^-?\d+\.\d+$/.test(s)) return Number(s)
  // formato con separatore migliaia ("1,858,751.25" — reso così da SheetJS)
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''))
  return v
}

export function downloadRows(rows: Row[], filename: string, sheetName = 'Differenze'): void {
  const wb = XLSX.utils.book_new()
  const numeric = rows.map((r) => {
    const out: Row = {}
    for (const k of Object.keys(r)) out[k] = cellValue(r[k])
    return out
  })
  const ws = XLSX.utils.json_to_sheet(numeric)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}
