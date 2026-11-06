// BDX delle inclusioni (Excel da mandare per email): il file del cliente
// «BDX Inclusioni CSA» è il modello (assets/infortuni/bdx_template.xlsx, righe
// d'esempio tolte): intestazioni in riga 2, una riga per adesione dalla 3 con
// la formattazione della riga 3 (date, euro).
import path from 'path'
import ExcelJS from 'exceljs'
import { bdxRow, FIELDS } from './rules.js'
import type { Rec } from './store'

export function infortuniAssetPath(...parts: string[]): string {
  return path.join(process.cwd(), 'assets', 'infortuni', ...parts)
}

const FIRST_ROW = 3

export async function buildBdx(records: Rec[], config: Parameters<typeof bdxRow>[1]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(infortuniAssetPath('bdx_template.xlsx'))
  const ws = wb.getWorksheet('BDX') || wb.worksheets[0]
  const styles = FIELDS.map((_, c) => ({ ...ws.getRow(FIRST_ROW).getCell(c + 1).style }))
  const height = ws.getRow(FIRST_ROW).height
  // Righe del modello oltre quelle scritte: svuotate cella per cella
  // (spliceRows di exceljs lascia righe indietro).
  const last = ws.rowCount
  for (let r = FIRST_ROW + records.length; r <= last; r++) {
    for (let c = 1; c <= FIELDS.length; c++) ws.getRow(r).getCell(c).value = null
  }
  records.forEach((rec, i) => {
    const row = ws.getRow(FIRST_ROW + i)
    if (height) row.height = height
    bdxRow(rec, config).forEach((v: unknown, c: number) => {
      const cell = row.getCell(c + 1)
      cell.style = { ...styles[c] }
      if (FIELDS[c].id === 'email' && v) cell.value = { text: String(v), hyperlink: `mailto:${v}` }
      else cell.value = v as ExcelJS.CellValue
    })
    row.commit()
  })
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export function bdxFileName(date = new Date()): string {
  const d = date.toISOString().slice(0, 10)
  return `BDX Inclusioni CSA ${d}.xlsx`
}
