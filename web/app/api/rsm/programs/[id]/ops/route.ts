import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { listOps, undoLastOp } from '@/lib/rsm/store'
import { fail, guard } from '@/lib/rsm/server'

export const runtime = 'nodejs'

// Registro delle operazioni del programma (ultime 30) e annullamento
// dell'ultima: POST { opId }.
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
    const text = r.reason === 'not-last' ? 'Si può annullare solo l\'ultima operazione: dopo questa ne sono state fatte altre.'
      : r.reason === 'already' ? 'Operazione già annullata.' : 'Operazione non trovata.'
    return fail(409, text, r.reason)
  }
  await logAction({ email: g.email, action: 'rsm.undo', resource: params.id, metadata: { opId: body.opId, label: r.label } })
  return NextResponse.json({ ok: true, label: r.label })
}
