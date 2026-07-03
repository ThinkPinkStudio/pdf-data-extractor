import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { initBatch, listBatches } from '@/lib/polizzaJobStore'

export const runtime = 'nodejs'

// Inizializza un batch (senza file): il client carica poi un dossier alla volta via
// POST /api/polizza/batch/[id]/dossier, così una connessione caduta a metà perde solo
// il dossier in corso, non l'intero batch caricato in un'unica richiesta gigante.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const label = String(body.label || 'Cartella')

  const batchId = await initBatch({ email: session.email, label })
  await logAction({ email: session.email, action: 'polizza.batch.init', resource: label, ip })
  return NextResponse.json({ batchId })
}

// Elenco dei batch dell'utente (con conteggio stati aggregati dei job figli), per
// la dashboard "torno più tardi a controllare".
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const batches = await listBatches(session.email)
  return NextResponse.json({ batches })
}
