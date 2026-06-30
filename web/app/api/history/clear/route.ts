import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { clearAll } from '@/lib/historyStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await clearAll(session.email)
  return NextResponse.json({ success: true })
}
