import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getBatchRow, listFailedBatchJobs, resetJobForRetry } from '@/lib/polizzaJobStore'
import { startBatch } from '@/lib/polizzaBatchWorker'

export const runtime = 'nodejs'

// Rilancia TUTTI i job in errore di un batch, meno le esclusioni scelte
// dall'utente (body: { excludeJobIds?: string[] }). Lavoro condiviso: nessun
// controllo di proprietà.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const batch = await getBatchRow(params.id)
  if (!batch) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const exclude = new Set<string>(Array.isArray(body.excludeJobIds) ? body.excludeJobIds.map(String) : [])

  const failed = await listFailedBatchJobs(params.id)
  const toRetry = failed.filter((id) => !exclude.has(id))
  let retried = 0
  for (const id of toRetry) {
    if (await resetJobForRetry(id, session.email)) retried++
  }
  if (retried > 0) startBatch(params.id)

  await logAction({
    email: session.email, action: 'polizza.batch.retry_failed',
    resource: `${batch.label} (${retried}/${failed.length} rilanciati${exclude.size ? `, ${exclude.size} esclusi` : ''})`, ip,
  })
  return NextResponse.json({ ok: true, retried, failed: failed.length, excluded: exclude.size })
}
