import { NextRequest, NextResponse } from 'next/server'
import { checkServiceToken } from '@/lib/serviceAuth'
import { getJob, toPublic } from '@/lib/extractJobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/extract-jobs/:id — stato + avanzamento (sorgente della barra blu).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!checkServiceToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const job = getJob(params.id)
  if (!job) {
    // 404 anche se evicato per TTL: l'orchestratore lo tratta come "ri-sottometti".
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  return NextResponse.json(toPublic(job))
}
