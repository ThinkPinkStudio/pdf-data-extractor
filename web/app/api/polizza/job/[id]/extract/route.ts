import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { confirmMatchAndRequeue, getJob } from '@/lib/polizzaJobStore'
import { notValidRefusal } from '@/lib/jobValidity'
import { startBatch } from '@/lib/polizzaBatchWorker'
import { startJob } from '@/lib/polizzaJobWorker'

export const runtime = 'nodejs'

// ▶ ESTRAI: avvia l'estrazione di un job ABBINATO (stato 'matched', nato in
// «Solo abbinamento» o riabbinato). Il pre-check non si rifà: la motivazione
// dell'abbinamento resta nel job. Un «Non valido» (nessuna polizza) non si
// estrae mai: 409 con code 'not-valid' e il perché (regola del 26/09/2026).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const refused = notValidRefusal(await getJob(params.id))
  if (refused) return NextResponse.json(refused, { status: 409 })
  const job = await confirmMatchAndRequeue(params.id, session.email)
  if (!job) return NextResponse.json({ error: 'Job non trovato o non in stato "Abbinato"' }, { status: 409 })

  if (job.batch_id) startBatch(job.batch_id)
  else startJob(job.id)

  await logAction({ email: session.email, action: 'polizza.job.extract', resource: job.dossier_name || job.id, ip })
  return NextResponse.json({ ok: true })
}
