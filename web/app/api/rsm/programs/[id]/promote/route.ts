import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { listMembers, promote, undoPromotion } from '@/lib/rsm/store'
import { statusAt, isCovered } from '@/lib/rsm/rules.js'
import { fail, guard } from '@/lib/rsm/server'

export const runtime = 'nodejs'

// POST { memberIds, toCategory, date, note? }: promozione del nucleo (le righe
// indicate escono dalla loro categoria ed entrano in toCategory dal giorno).
// DELETE { promotionId }: annulla la promozione.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as { memberIds?: string[]; toCategory?: string; date?: string; note?: string }
  const cfg = g.program.config
  const date = String(body.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= cfg.periodStart || date >= cfg.periodEnd) return fail(400, 'Data della promozione fuori dal periodo di polizza', 'invalid')
  const to = cfg.categories.find((c) => c.key === body.toCategory)
  if (!to) return fail(400, 'Categoria di arrivo non prevista', 'invalid')
  const all = await listMembers(params.id)
  const ids = (body.memberIds || []).map(String)
  const rows = all.filter((m) => ids.includes(m.id))
  if (!rows.length || rows.length !== ids.length) return fail(400, 'Persone non trovate', 'invalid')
  if (rows.some((m) => m.category === to.key)) return fail(400, 'Le persone sono già in quella categoria', 'invalid')
  if (rows.some((m) => !isCovered(statusAt(cfg, m, date)) || m.exitKind)) return fail(409, 'Una delle persone non è in copertura a quella data o ha già un\'uscita registrata', 'not-active')
  const pid = await promote(params.id, ids, to.key, date, body.note ? String(body.note) : null, g.email)
  await logAction({ email: g.email, action: 'rsm.promote', resource: params.id, metadata: { ids, to: to.key, date, promotionId: pid } })
  return NextResponse.json({ promotionId: pid })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as { promotionId?: string }
  if (!body.promotionId) return fail(400, 'Promozione mancante', 'invalid')
  await undoPromotion(params.id, String(body.promotionId))
  await logAction({ email: g.email, action: 'rsm.promote.undo', resource: params.id, metadata: { promotionId: body.promotionId } })
  return NextResponse.json({ ok: true })
}
