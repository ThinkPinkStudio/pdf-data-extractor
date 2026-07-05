import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getConversation, getMessages, deleteConversation } from '@/lib/chatStore'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const conversation = await getConversation(params.id, session.email)
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const messages = await getMessages(params.id)
  return NextResponse.json({ conversation, messages })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ok = await deleteConversation(params.id, session.email)
  return NextResponse.json({ ok })
}
