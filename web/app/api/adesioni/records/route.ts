import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { listRecords, createRecord } from '@/lib/adesioni/recordsStore'
import { getAdesioniConfig } from '@/lib/adesioni/serverConfig'
import { validateRecord } from '@/lib/adesioni/recordMapper.js'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = req.nextUrl.searchParams.get('q') || undefined
  const rows = await listRecords(session.email, q)
  return NextResponse.json({ records: rows })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json()) as { record?: Record<string, unknown> }
  if (!body.record) return NextResponse.json({ error: 'Record mancante' }, { status: 400 })
  const config = await getAdesioniConfig()
  const { valid, errors } = validateRecord(body.record, config.fields) as { valid: boolean; errors: Record<string, string> }
  if (!valid) return NextResponse.json({ error: 'Dati non validi', errors }, { status: 400 })
  const row = await createRecord(session.email, body.record)
  await logAction({ email: session.email, action: 'adesioni.record.create', resource: row.id })
  return NextResponse.json({ record: row })
}
