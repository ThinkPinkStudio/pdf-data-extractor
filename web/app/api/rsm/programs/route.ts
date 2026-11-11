import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { createProgram, getProgram, listPrograms } from '@/lib/rsm/store'
import { defaultProgramConfig } from '@/lib/rsm/rules.js'
import { canEdit } from '@/lib/rsm/types'
import type { RsmConfig } from '@/lib/rsm/types'
import { fail } from '@/lib/rsm/server'

export const runtime = 'nodejs'

// Programmi RSM (un cliente per un anno). GET: elenco; POST { name, year,
// copyFrom? }: nuovo programma, con la configurazione di `copyFrom` portata
// all'anno nuovo (tariffe e regole da rivedere) o quella vuota di default.
export async function GET() {
  const session = await getSession()
  if (!session.email) return fail(401, 'Unauthorized', 'unauthorized')
  const programs = await listPrograms()
  return NextResponse.json({ programs: programs.map((p) => ({ ...p, editor: canEdit(p.config, session.email!) })) })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return fail(401, 'Unauthorized', 'unauthorized')
  const body = (await req.json().catch(() => ({}))) as { name?: string; year?: number; copyFrom?: string }
  const year = Number(body.year)
  const name = String(body.name || '').trim()
  if (!name || !(year >= 2000 && year <= 2100)) return fail(400, 'Nome e anno obbligatori', 'invalid')
  let config = defaultProgramConfig(year) as RsmConfig
  if (body.copyFrom) {
    const src = await getProgram(body.copyFrom)
    if (!src) return fail(404, 'Programma di partenza non trovato', 'not-found')
    if (!canEdit(src.config, session.email)) return fail(403, 'Sola consultazione', 'read-only')
    const shift = (iso: string) => `${Number(iso.slice(0, 4)) + (year - src.year)}${iso.slice(4)}`
    config = { ...src.config, periodStart: shift(src.config.periodStart), periodEnd: shift(src.config.periodEnd) }
  }
  const p = await createProgram(name, year, config, session.email)
  await logAction({ email: session.email, action: 'rsm.program.create', resource: p.id, metadata: { name, year, copyFrom: body.copyFrom || null } })
  return NextResponse.json({ program: p })
}
