import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getBatchRow, markUploadComplete } from '@/lib/polizzaJobStore'
import { startBatch } from '@/lib/polizzaBatchWorker'

export const runtime = 'nodejs'

// Chiude l'ingresso di un batch: nessun altro dossier arriverà, l'orchestratore può
// terminare non appena la coda dei job figli si svuota invece di restare in attesa.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const batch = await getBatchRow(params.id)
  if (!batch || batch.email !== session.email) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await markUploadComplete(params.id)
  startBatch(params.id) // idempotente: assicura che l'orchestratore sia partito anche se nessun dossier lo ha ancora avviato
  return NextResponse.json({ ok: true })
}
