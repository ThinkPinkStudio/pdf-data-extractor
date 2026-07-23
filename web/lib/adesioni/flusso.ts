// Lettura del flusso Excel AXA lato server (exceljs) da un buffer caricato.
// Porta la logica di flussoService.js sostituendo readFile con un Buffer.
import ExcelJS from 'exceljs'
import { flussoRowToRecord } from './recordMapper.js'
import type { AdesioniConfig } from './config'

type CellVal = string | number | Date | null

function cellValue(cell: ExcelJS.Cell | undefined): CellVal {
  const v = cell ? (cell.value as unknown) : null
  if (v == null) return ''
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('text' in o) return o.text as string
    if ('result' in o) return o.result as CellVal
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('')
    if ('hyperlink' in o) return (o.text as string) || (o.hyperlink as string)
    return ''
  }
  return v as CellVal
}

export interface FlussoResult {
  headers: string[]
  rows: Record<string, CellVal>[]
  records: Record<string, unknown>[]
  count: number
}

export async function loadFlussoFromBuffer(buffer: Buffer | ArrayBuffer, config: AdesioniConfig): Promise<FlussoResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as ExcelJS.Buffer)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('Foglio non trovato nel file')

  const headers: string[] = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cellValue(cell) || '').trim()
  })
  while (headers.length && !headers[headers.length - 1]) headers.pop()

  const rows: Record<string, CellVal>[] = []
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const obj: Record<string, CellVal> = {}
    let any = false
    headers.forEach((h, i) => {
      if (!h) return
      const v = cellValue(row.getCell(i + 1))
      obj[h] = v
      if (v !== null && v !== '') any = true
    })
    if (any) rows.push(obj)
  })

  const records = rows.map((r) => flussoRowToRecord(r, config.fields, config.idd) as Record<string, unknown>)
  return { headers, rows, records, count: rows.length }
}
