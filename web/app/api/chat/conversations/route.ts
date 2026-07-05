import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createConversation, listConversations } from '@/lib/chatStore'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const conversations = await listConversations(session.email)
  return NextResponse.json({ conversations })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { filters?: Record<string, unknown> } = {}
  try { body = await req.json() } catch { /* filtri opzionali */ }
  const id = await createConversation(session.email, (body.filters as never) || {})
  return NextResponse.json({ id })
}
