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

export function downloadRows(rows: Row[], filename: string, sheetName = 'Differenze'): void {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}
