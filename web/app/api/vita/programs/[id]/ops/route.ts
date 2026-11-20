import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { listOps, undoLastOp } from '@/lib/vita/store'
import { fail, guard } from '@/lib/vita/server'

export const runtime = 'nodejs'

// GET: registro delle operazioni. POST { opId }: annulla l'ULTIMA operazione.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, false)
  if (!g.ok) return g.res
  return NextResponse.json({ ops: await listOps(params.id) })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as { opId?: string }
  if (!body.opId) return fail(400, 'Operazione mancante', 'invalid')
  const r = await undoLastOp(params.id, String(body.opId), g.email)
  if (!r.ok) {
    if (r.reason === 'not-last') return fail(409, 'Si annulla solo l\'ultima operazione: annulla prima quelle dopo.', 'not-last')
    if (r.reason === 'already') return fail(409, 'Operazione già annullata.', 'already')
    return fail(404, 'Operazione non trovata.', 'not-found')
  }
  await logAction({ email: g.email, action: 'vita.op.undo', resource: params.id, metadata: { opId: body.opId, label: r.label } })
  return NextResponse.json({ ok: true, label: r.label })
}
