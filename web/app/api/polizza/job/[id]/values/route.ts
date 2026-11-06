import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { correctJobValues } from '@/lib/polizzaJobStore'
import type { ValueCorrection } from '@/lib/valueCorrections'
import { logAction } from '@/lib/logger'

export const runtime = 'nodejs'

// VALORI CORRETTI di un dossier estratto: sostituiscono quelli del motore e il
// salvataggio chiude una run nello Storico (prima/dopo). Body:
// { values: [{ fieldId, value, fonte?: { file, page } }] } — value '' = vuoto.
// Solo dossier estratti (done): 409 `not-done` se è in coda, in corso o fermo.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { values?: ValueCorrection[] } = {}
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON non valido', code: 'bad-input' }, { status: 400 }) }
  const r = await correctJobValues(params.id, Array.isArray(body.values) ? body.values : [])
  if (!r.ok) {
    const status = r.code === 'not-found' ? 404 : r.code === 'not-done' ? 409 : 400
    return NextResponse.json({ error: r.code, code: r.code, fieldId: r.fieldId }, { status })
  }
  if (r.changed.length) {
    await logAction({ email: session.email, action: 'polizza.job.values', resource: `${params.id}: ${r.changed.map((c) => c.label).join(', ')}`, ip })
  }
  return NextResponse.json({ ok: true, changed: r.changed })
}
