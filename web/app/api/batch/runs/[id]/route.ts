import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getRunDetail } from '@/lib/batchQueries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = parseInt(params.id, 10)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })
  }
  return NextResponse.json(await getRunDetail(id))
}
