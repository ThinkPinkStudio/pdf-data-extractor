import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { deleteSummary, loadDetail, patchSummary } from '@/lib/summaryStore'
import { parseViewQuery } from '@/lib/summaryCompose'

export const runtime = 'nodejs'

const NOT_FOUND = { error: 'Riepilogo non trovato', code: 'not-found' }
// Errore imprevisto: il dettaglio (anche del database) resta nel log del server.
function internal(e: unknown) {
  console.error('[riepiloghi] dettaglio:', e)
  return NextResponse.json({ error: 'Errore interno', code: 'internal' }, { status: 500 })
}

// Dettaglio con gli aggregati: ?anno=2025|none&gruppo=<chiave>&a=2024&b=2025&campo=<id>.
// Corpo = testata (summary), membri, avvisi e tutto l'esito di summarize.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const detail = await loadDetail(params.id, parseViewQuery(req.nextUrl.searchParams))
    if (!detail) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(detail)
  } catch (e) {
    return internal(e)
  }
}

// Modifica: name, prefs (parziale o null = ripristino), yearFieldId,
// dueFieldId (anche null), addJobIds, removeJobIds, mode, refreshSnapshot.
// Risposta = il dettaglio aggiornato (con i parametri di vista in query) più
// result: { added, already, removed, dropped, keptOld }.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Richiesta non valida', code: 'bad-body' }, { status: 400 }) }
  try {
    const out = await patchSummary(params.id, body, parseViewQuery(req.nextUrl.searchParams))
    if (!out.ok) return NextResponse.json(out.body, { status: out.status })
    const r = out.result
    await logAction({
      email: session.email,
      action: 'polizza.summary.update',
      resource: out.name,
      ip,
      // conteggi, non gli id: un riepilogo può avere 2000 polizze
      metadata: { id: params.id, keys: out.keys, added: r.added.length, already: r.already.length, removed: r.removed.length, dropped: r.dropped.length, keptOld: r.keptOld.length },
    })
    return NextResponse.json({ ...out.detail, result: out.result })
  } catch (e) {
    return internal(e)
  }
}

// Elimina il riepilogo: polizze ed estrazioni restano come sono.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const gone = await deleteSummary(params.id)
    if (!gone) return NextResponse.json(NOT_FOUND, { status: 404 })
    await logAction({ email: session.email, action: 'polizza.summary.delete', resource: gone.name, ip, metadata: { id: gone.id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return internal(e)
  }
}
