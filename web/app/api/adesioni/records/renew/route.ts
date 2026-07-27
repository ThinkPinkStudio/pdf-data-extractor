import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { renewRecords } from '@/lib/adesioni/recordsStore'

export const runtime = 'nodejs'

// Rinnovo +N anni (default +1): muta IN PLACE i record indicati spostando in
// avanti SOLO le date di inizio/fine copertura e riportando lo stato a
// 'pending'. Parità con l'app desktop (recordsStore.renewRecords): NON crea
// nuovi record, NON tocca `data_rendicontazione` né l'identificativo.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { ids?: string[]; years?: number }
  const ids = body.ids || []
  const years = body.years || 1
  if (!ids.length) return NextResponse.json({ error: 'Nessun record selezionato' }, { status: 400 })

  const renewed = await renewRecords(ids, years)
  await logAction({ email: session.email, action: 'adesioni.record.renew', metadata: { count: renewed.length, years } })
  return NextResponse.json({ records: renewed })
}
