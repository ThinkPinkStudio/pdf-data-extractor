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
  if (!result || result.batch.email !== session.email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    batchId: result.batch.id,
    label: result.batch.label,
    createdAt: result.batch.created_at,
    updatedAt: result.batch.updated_at,
    jobs: result.jobs.map(jobSnapshot),
  })
}
