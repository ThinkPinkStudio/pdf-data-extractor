import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { reuseResultsFromJob } from '@/lib/polizzaJobStore'

export const runtime = 'nodejs'

// Riusa i risultati di un fascicolo IDENTICO già completato (stesso insieme di
// file per hash contenuto, rilevato alla creazione → duplicate_of): copia valori,
// fonti e definizione campi senza rifare OCR né estrazione. Azione esplicita
// dell'utente, mai automatica. Lavoro condiviso: nessun controllo di proprietà.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await reuseResultsFromJob(params.id, session.email)
  if (!job) {
    return NextResponse.json(
      { error: 'Riuso non possibile: il job è in esecuzione/già completato, oppure il fascicolo identico di origine non è più disponibile.' },
      { status: 409 }
    )
  }

  await logAction({ email: session.email, action: 'polizza.job.reuse', resource: job.dossier_name || job.id, ip })
  return NextResponse.json({ ok: true, sourceJobId: job.duplicate_of })
}
