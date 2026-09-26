import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getBatchRow, listMatchedBatchJobs, confirmMatchAndRequeue } from '@/lib/polizzaJobStore'
import { startBatch } from '@/lib/polizzaBatchWorker'

export const runtime = 'nodejs'

// ▶ AVVIA ESTRAZIONE su TUTTI i job ABBINATI di un batch (solo abbinamento
// concluso): ciascuno torna in coda con l'abbinamento confermato e
// l'orchestratore li estrae uno alla volta. Lavoro condiviso: nessun controllo
// di proprietà. Solo 'matched': un «Non valido» (nessuna polizza) non lo è mai;
// gli abbinati di prima della regola del 26/09/2026 (senza precheck.polizza)
// passano dalla guardia del worker, che verifica la polizza prima di estrarre.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const batch = await getBatchRow(params.id)
  if (!batch) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const matched = await listMatchedBatchJobs(params.id)
  let started = 0
  for (const id of matched) {
    if (await confirmMatchAndRequeue(id, session.email)) started++
  }
  if (started > 0) startBatch(params.id)

  await logAction({ email: session.email, action: 'polizza.batch.extract_all', resource: `${batch.label} (${started}/${matched.length} avviati)`, ip })
  return NextResponse.json({ ok: true, started, matched: matched.length })
}
