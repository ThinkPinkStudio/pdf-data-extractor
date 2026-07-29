import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { cancelJob } from '@/lib/polizzaJobStore'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ok = await cancelJob(params.id) // lavoro condiviso: chiunque può annullare
  return NextResponse.json({ ok })
}
