import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { overridePrecheckAndRequeue } from '@/lib/polizzaJobStore'
import { startBatch } from '@/lib/polizzaBatchWorker'
import { startJob } from '@/lib/polizzaJobWorker'

export const runtime = 'nodejs'

// "PROCEDI COMUNQUE": sblocca un job fermato dal pre-check di pertinenza
// (status 'mismatch'). L'override viene persistito nel precheck del job: al
// run successivo il worker salta il controllo e l'estrazione parte davvero.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await overridePrecheckAndRequeue(params.id, session.email)
  if (!job) return NextResponse.json({ error: 'Job non trovato o non in stato "da confermare"' }, { status: 409 })

  if (job.batch_id) startBatch(job.batch_id)
  else startJob(job.id)

  await logAction({ email: session.email, action: 'polizza.job.proceed', resource: job.dossier_name || job.id, ip })
  return NextResponse.json({ ok: true })
}
