import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { expiringRecords } from '@/lib/infortuni/store'
import { groupByExpiry, todayRome } from '@/lib/infortuni/rules.js'

export const runtime = 'nodejs'

// Scadenze: adesioni che scadono il mese scorso, questo mese e il mese
// prossimo (come la prima versione di CSA Adesioni), ognuna col numero
// dell'adesione che l'ha rinnovata, se c'è.
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const today = todayRome()
  const [y, m] = today.split('-').map(Number)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const from = iso(new Date(Date.UTC(y, m - 2, 1)))
  const to = iso(new Date(Date.UTC(y, m + 1, 0)))
  const rows = await expiringRecords(from, to)
  return NextResponse.json({ today, ...groupByExpiry(rows, today) })
}
