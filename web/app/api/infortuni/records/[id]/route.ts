import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getRecord, updateRecord, deleteRecord, getConfig } from '@/lib/infortuni/store'
import { validateAdesione, normalizeAdesione } from '@/lib/infortuni/rules.js'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await getRecord(params.id)
  return row ? NextResponse.json({ record: row }) : NextResponse.json({ error: 'Non trovata', code: 'not-found' }, { status: 404 })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = params
  const body = (await req.json().catch(() => ({}))) as { record?: Record<string, unknown> }
  if (!body.record) return NextResponse.json({ error: 'Adesione mancante', code: 'missing' }, { status: 400 })
  const config = await getConfig()
  const record = normalizeAdesione(body.record, config)
  const { valid, errors } = validateAdesione(record, config)
  if (!valid) return NextResponse.json({ error: 'Dati non validi', code: 'invalid', errors }, { status: 400 })
  const row = await updateRecord(id, record)
  if (!row) return NextResponse.json({ error: 'Non trovata', code: 'not-found' }, { status: 404 })
  await logAction({ email: session.email, action: 'infortuni.record.update', resource: id, metadata: { numero: row.numero } })
  return NextResponse.json({ record: row })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = params
  const row = await getRecord(id)
  if (!row) return NextResponse.json({ error: 'Non trovata', code: 'not-found' }, { status: 404 })
  await deleteRecord(id)
  await logAction({ email: session.email, action: 'infortuni.record.delete', resource: id, metadata: { numero: row.numero } })
  return NextResponse.json({ ok: true })
}
