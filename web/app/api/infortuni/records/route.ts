import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { listRecords, createRecord, getConfig } from '@/lib/infortuni/store'
import { validateAdesione, normalizeAdesione } from '@/lib/infortuni/rules.js'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = req.nextUrl.searchParams.get('q') || undefined
  const st = req.nextUrl.searchParams.get('status')
  const status = st === 'pending' || st === 'sent' ? st : undefined
  return NextResponse.json({ records: await listRecords(q, status) })
}

// Nuova adesione: il numero IAH0015842/NNN lo assegna il server al salvataggio.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { record?: Record<string, unknown> }
  if (!body.record) return NextResponse.json({ error: 'Adesione mancante', code: 'missing' }, { status: 400 })
  const config = await getConfig()
  const record = normalizeAdesione(body.record, config)
  const { valid, errors } = validateAdesione(record, config)
  if (!valid) return NextResponse.json({ error: 'Dati non validi', code: 'invalid', errors }, { status: 400 })
  const row = await createRecord(session.email, record)
  await logAction({ email: session.email, action: 'infortuni.record.create', resource: row.id, metadata: { numero: row.numero } })
  return NextResponse.json({ record: row })
}
