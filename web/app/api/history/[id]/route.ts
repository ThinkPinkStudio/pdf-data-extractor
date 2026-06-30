import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { loadSession, deleteSession } from '@/lib/historyStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const data = await loadSession(session.email, params.id)
  if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true, session: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await deleteSession(session.email, params.id)
  return NextResponse.json({ success: true })
}
