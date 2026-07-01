import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getJob, jobSnapshot } from '@/lib/polizzaJobStore'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const job = await getJob(params.id)
  if (!job || job.email !== session.email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(jobSnapshot(job))
}
