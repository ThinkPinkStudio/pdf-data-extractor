import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getJob, getJobRuns } from '@/lib/polizzaJobStore'

export const runtime = 'nodejs'

// STORICO di un job: una riga per ogni run arrivata a un esito (estratto,
// abbinato, da verificare, non pertinente, errore), dalla più recente.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const job = await getJob(params.id)
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 }) // lavoro condiviso: nessun controllo di proprietà
  const runs = await getJobRuns(params.id)
  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id, finishedAt: r.finished_at, status: r.status, profileId: r.profile_id, profileName: r.profile_name,
      model: r.model, ctx: r.ctx, verdict: r.verdict, summary: r.summary, error: r.error,
      fields: r.fields || [], values: r.field_values || {}, filled: r.filled, total: r.total,
    })),
  })
}
