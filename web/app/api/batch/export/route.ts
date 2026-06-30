import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

// Export XLSX dei risultati batch (File × campi).
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rows, keys } = await req.json().catch(() => ({ rows: [], keys: [] }))
  if (!Array.isArray(rows)) return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Batch')
  ws.addRow(['File', 'Stato', ...keys])
  ws.getRow(1).font = { bold: true }
  for (const r of rows) {
    ws.addRow([r.name, r.success ? 'OK' : 'Errore', ...keys.map((k: string) => r.fields?.[k] ?? '')])
  }
  ws.columns.forEach((c) => { c.width = 24 })

  const buf = Buffer.from(await wb.xlsx.writeBuffer())
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="estrazione_batch.xlsx"',
    },
  })
}
