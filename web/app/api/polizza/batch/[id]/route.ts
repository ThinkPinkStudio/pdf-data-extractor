import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getBatch, jobSnapshot } from '@/lib/polizzaJobStore'

export const runtime = 'nodejs'

// Stato aggregato di un batch + snapshot di ogni job figlio (stato, campi estratti,
// progresso), per il drill-down nella dashboard.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await getBatch(params.id)
  // Lavoro condiviso: nessun controllo di proprietà, ogni utente autenticato vede il
  // batch di chiunque. L'owner è esposto per l'interfaccia.
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    batchId: result.batch.id,
    label: result.batch.label,
    owner: result.batch.email,
    createdAt: result.batch.created_at,
    updatedAt: result.batch.updated_at,
    jobs: result.jobs.map(jobSnapshot),
  })
}
