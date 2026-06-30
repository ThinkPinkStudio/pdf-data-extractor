import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { listSessions } from '@/lib/historyStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ sessions: await listSessions(session.email) })
}
