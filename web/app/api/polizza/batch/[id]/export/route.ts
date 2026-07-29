import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getBatch } from '@/lib/polizzaJobStore'
import { flattenRollingState } from '@/lib/polizzaRolling'
import ExcelJS from 'exceljs'

export const runtime = 'nodejs'

// Export CONSOLIDATO del batch: un foglio con UNA RIGA PER DOSSIER e una colonna
// per campo (unione dei field_defs di tutti i job, nell'ordine del primo che li
// dichiara), più stato e fonte-riassunto. È la risposta a "dove scarico/elaboro
// i risultati del bulk" senza aprire i dossier uno per uno.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await getBatch(params.id)
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { batch, jobs } = result

  // Unione ordinata dei campi dichiarati dai job (profili diversi → colonne diverse)
  const fieldOrder: string[] = []
  const labelById = new Map<string, string>()
  for (const j of jobs) {
    for (const f of j.field_defs || []) {
      if (!labelById.has(f.id)) { labelById.set(f.id, f.label || f.id); fieldOrder.push(f.id) }
    }
  }

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Risultati')
  ws.columns = [
    { header: 'Dossier', key: '_dossier', width: 42 },
    { header: 'Stato', key: '_status', width: 14 },
    { header: 'Errore', key: '_error', width: 30 },
    ...fieldOrder.map((id) => ({ header: labelById.get(id) || id, key: id, width: 24 })),
  ]
  ws.getRow(1).font = { bold: true }

  for (const j of jobs) {
    const values = flattenRollingState(j.rolling_state)
    const row: Record<string, unknown> = {
      _dossier: j.dossier_name || j.id,
      _status: j.status,
      _error: j.error || '',
    }
    for (const id of fieldOrder) row[id] = values[id] ?? ''
    ws.addRow(row)
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer())
  await logAction({ email: session.email, action: 'polizza.batch.export', resource: batch.label })
  const name = `${batch.label.replace(/[^a-zA-Z0-9_-]/g, '_')}_risultati.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  })
}
