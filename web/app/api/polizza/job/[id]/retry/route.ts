import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { resetJobForRetry } from '@/lib/polizzaJobStore'
import { startBatch } from '@/lib/polizzaBatchWorker'
import { startJob } from '@/lib/polizzaJobWorker'

export const runtime = 'nodejs'

// Rilancia UN job: falliti/annullati (riprova) ma anche COMPLETATI
// (rielaborazione con il motore corrente — i PDF sono già salvati nel DB).
// Il job torna in coda e riparte dall'orchestratore giusto (batch o singolo).
// Lavoro condiviso: nessun controllo di proprietà.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await resetJobForRetry(params.id, session.email)
  if (!job) return NextResponse.json({ error: 'Job non trovato o non rilanciabile (è ancora in esecuzione o in coda)' }, { status: 409 })

  if (job.batch_id) startBatch(job.batch_id)
  else startJob(job.id)

  await logAction({ email: session.email, action: 'polizza.job.retry', resource: job.dossier_name || job.id, ip })
  return NextResponse.json({ ok: true })
}
