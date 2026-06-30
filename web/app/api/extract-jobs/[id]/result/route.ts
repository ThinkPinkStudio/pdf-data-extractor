import { NextRequest, NextResponse } from 'next/server'
import { checkServiceToken } from '@/lib/serviceAuth'
import { getJob } from '@/lib/extractJobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/extract-jobs/:id/result — scarica l'XLS (export semplice) a job concluso.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!checkServiceToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const job = getJob(params.id)
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  if (job.status !== 'done' || !job.result) {
    return NextResponse.json({ status: job.status }, { status: 409 })
  }

  const body = new Uint8Array(job.result)
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(job.name)}.xlsx"`,
      'Content-Length': String(body.byteLength),
    },
  })
}
