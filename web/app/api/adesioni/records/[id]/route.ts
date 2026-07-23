import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getRecord, updateRecord, deleteRecord } from '@/lib/adesioni/recordsStore'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await getRecord(params.id, session.email)
  if (!row) return NextResponse.json({ error: 'Non trovato' }, { status: 404 })
  return NextResponse.json({ record: row })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json()) as { record?: Record<string, unknown> }
  if (!body.record) return NextResponse.json({ error: 'Record mancante' }, { status: 400 })
  const row = await updateRecord(params.id, session.email, body.record)
  if (!row) return NextResponse.json({ error: 'Non trovato' }, { status: 404 })
  await logAction({ email: session.email, action: 'adesioni.record.update', resource: params.id })
  return NextResponse.json({ record: row })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ok = await deleteRecord(params.id, session.email)
  if (!ok) return NextResponse.json({ error: 'Non trovato' }, { status: 404 })
  await logAction({ email: session.email, action: 'adesioni.record.delete', resource: params.id })
  return NextResponse.json({ ok: true })
}
