import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { listRecords } from '@/lib/adesioni/recordsStore'
import { groupByExpiry } from '@/lib/adesioni/scadenze.js'

export const runtime = 'nodejs'

// Scadenze: raggruppa i record per fine copertura (mese scorso / corrente / prossimo).
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rows = await listRecords(session.email)
  const groups = groupByExpiry(rows) as { past: unknown[]; current: unknown[]; next: unknown[] }
  return NextResponse.json(groups)
}
