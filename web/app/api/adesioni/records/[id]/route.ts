import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getRecord, updateRecord, deleteRecord } from '@/lib/adesioni/recordsStore'
import { getAdesioniConfig } from '@/lib/adesioni/serverConfig'
import { validateRecord } from '@/lib/adesioni/recordMapper.js'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await getRecord(params.id)
  if (!row) return NextResponse.json({ error: 'Non trovato' }, { status: 404 })
  return NextResponse.json({ record: row })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json()) as { record?: Record<string, unknown> }
  if (!body.record) return NextResponse.json({ error: 'Record mancante' }, { status: 400 })
  const config = await getAdesioniConfig()
  const { valid, errors } = validateRecord(body.record, config.fields) as { valid: boolean; errors: Record<string, string> }
  if (!valid) return NextResponse.json({ error: 'Dati non validi', errors }, { status: 400 })
  const row = await updateRecord(params.id, body.record)
  if (!row) return NextResponse.json({ error: 'Non trovato' }, { status: 404 })
  await logAction({ email: session.email, action: 'adesioni.record.update', resource: params.id })
  return NextResponse.json({ record: row })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ok = await deleteRecord(params.id)
  if (!ok) return NextResponse.json({ error: 'Non trovato' }, { status: 404 })
  await logAction({ email: session.email, action: 'adesioni.record.delete', resource: params.id })
  return NextResponse.json({ ok: true })
}
