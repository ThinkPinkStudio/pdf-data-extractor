import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getBatch } from '@/lib/polizzaJobStore'
import { flattenRollingState } from '@/lib/polizzaRolling'
import ExcelJS from 'exceljs'
import { isLegacySetAside, isNotValidJob } from '@/lib/jobValidity'

export const runtime = 'nodejs'

// Export CONSOLIDATO del batch: un foglio «Risultati» con UNA RIGA PER DOSSIER e
// una colonna per campo (unione dei field_defs di tutti i job, nell'ordine del
// primo che li dichiara), più profilo, stato e pertinenza. È la risposta a "dove
// scarico/elaboro i risultati del bulk" senza aprire i dossier uno per uno.
// In più UN FOGLIO PER PROFILO con le sole colonne dei suoi campi: nello stesso
// batch job su profili diversi finivano sotto le stesse intestazioni e chi
// verificava leggeva i valori di un profilo sotto le etichette dell'altro
// (LUCCHESE: «42,06 sono le imposte» sotto «Tacito Rinnovo»).
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
  const STATUS_IT: Record<string, string> = {
    queued: 'in coda', running: 'in corso', done: 'estratto', error: 'errore', canceled: 'annullato',
    mismatch: 'non pertinente', matched: 'abbinato', review: 'da verificare',
  }
  const statusOf = (j: (typeof jobs)[number]) => {
    const e = j.error || ''
    // Nessuna polizza secondo il modello (26/09/2026): «non valido». I vecchi
    // «Accantonato» (anche dalla regex) restano tali: forzabili.
    if (isNotValidJob(j)) return 'non valido'
    if (j.status === 'mismatch' && e.startsWith('Scartato')) return 'scartato'
    if (isLegacySetAside(j)) return 'accantonato'
    return STATUS_IT[j.status] || j.status
  }
  const baseRow = (j: (typeof jobs)[number]): Record<string, unknown> => ({
    _dossier: j.dossier_name || j.id,
    _profile: j.profile_name || (j.profile_id ? j.profile_id : ''),
    _status: statusOf(j),
    _error: j.error || '',
    _precheck: typeof (j.precheck as any)?.summary === 'string' ? (j.precheck as any).summary : '',
  })
  const fixedCols = [
    { header: 'Dossier', key: '_dossier', width: 42 },
    { header: 'Profilo', key: '_profile', width: 22 },
    { header: 'Stato', key: '_status', width: 14 },
    { header: 'Errore', key: '_error', width: 30 },
    { header: 'Pertinenza', key: '_precheck', width: 48 },
  ]
  ws.columns = [
    ...fixedCols,
    ...fieldOrder.map((id) => ({ header: labelById.get(id) || id, key: id, width: 24 })),
  ]
  ws.getRow(1).font = { bold: true }

  for (const j of jobs) {
    const values = flattenRollingState(j.rolling_state)
    const row = baseRow(j)
    for (const id of fieldOrder) row[id] = values[id] ?? ''
    ws.addRow(row)
  }

  // Un foglio per profilo: solo i job di quel profilo, solo le sue colonne
  // (nell'ordine dei field_defs del primo job che lo usa).
  const byProfile = new Map<string, { name: string; jobs: typeof jobs }>()
  for (const j of jobs) {
    const key = j.profile_id || '__global'
    if (!byProfile.has(key)) byProfile.set(key, { name: j.profile_name || (j.profile_id ? j.profile_id : 'Campi globali'), jobs: [] })
    byProfile.get(key)!.jobs.push(j)
  }
  // Nomi di foglio validi per Excel: max 31 caratteri, senza \ / ? * [ ] :,
  // senza apostrofo in testa/coda, mai «History» (riservato), unici senza
  // distinzione di maiuscole. Un nome fuori regola faceva fallire l'export.
  const usedNames = new Set<string>(['risultati', 'history'])
  for (const [, grp] of byProfile) {
    if (byProfile.size < 2) break // un solo profilo: il foglio «Risultati» basta
    let title = grp.name.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 28) || 'Profilo'
    let n = 2
    while (usedNames.has(title.toLowerCase())) title = `${title.slice(0, 25).replace(/'+$/g, '')} ${n++}`
    usedNames.add(title.toLowerCase())
    const cols: string[] = []
    const labels = new Map<string, string>()
    for (const j of grp.jobs) for (const f of j.field_defs || []) if (!labels.has(f.id)) { labels.set(f.id, f.label || f.id); cols.push(f.id) }
    const sheet = wb.addWorksheet(title)
    sheet.columns = [...fixedCols, ...cols.map((id) => ({ header: labels.get(id) || id, key: id, width: 24 }))]
    sheet.getRow(1).font = { bold: true }
    for (const j of grp.jobs) {
      const values = flattenRollingState(j.rolling_state)
      const row = baseRow(j)
      for (const id of cols) row[id] = values[id] ?? ''
      sheet.addRow(row)
    }
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
