import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

// Export XLSX dei dati estratti (JSON/CSV vengono gestiti lato client).
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { fields, fileName } = await req.json().catch(() => ({ fields: [] }))
  if (!Array.isArray(fields)) return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Dati')
  ws.addRow(['Campo', 'Valore'])
  ws.getRow(1).font = { bold: true }
  for (const f of fields) ws.addRow([f.name, f.value])
  ws.columns.forEach((c) => { c.width = 32 })

  const buf = Buffer.from(await wb.xlsx.writeBuffer())
  const name = (fileName || 'estrazione').replace(/[^a-zA-Z0-9_-]/g, '_') + '.xlsx'
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  })
}
