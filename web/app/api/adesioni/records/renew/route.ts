import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getRecordsByIds, createRecord } from '@/lib/adesioni/recordsStore'
import { addYearsIT } from '@/lib/adesioni/coverageDates.js'
import { nextIdentificativo } from '@/lib/adesioni/numbering.js'

export const runtime = 'nodejs'

// Rinnovo +N anni: crea nuovi record con le date di copertura spostate in avanti
// (default +1 anno) e l'identificativo incrementato.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { ids?: string[]; years?: number }
  const ids = body.ids || []
  const years = body.years || 1
  if (!ids.length) return NextResponse.json({ error: 'Nessun record selezionato' }, { status: 400 })

  const rows = await getRecordsByIds(ids, session.email)
  const created = []
  for (const row of rows) {
    const rec = { ...row.data } as Record<string, unknown>
    if (rec.data_inizio) rec.data_inizio = addYearsIT(rec.data_inizio, years)
    if (rec.data_fine) rec.data_fine = addYearsIT(rec.data_fine, years)
    if (rec.data_rendicontazione) rec.data_rendicontazione = addYearsIT(rec.data_rendicontazione, years)
    if (rec.identificativo) rec.identificativo = nextIdentificativo(String(rec.identificativo))
    created.push(await createRecord(session.email, rec))
  }
  await logAction({ email: session.email, action: 'adesioni.record.renew', metadata: { count: created.length, years } })
  return NextResponse.json({ records: created })
}
