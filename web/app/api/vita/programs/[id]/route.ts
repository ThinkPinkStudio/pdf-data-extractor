import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { deleteProgram, listInsured, updateProgram } from '@/lib/vita/store'
import { fail, guard } from '@/lib/vita/server'
import type { VitaConfig } from '@/lib/vita/types'

export const runtime = 'nodejs'

// GET: programma, assicurati e se chi guarda può modificare.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, false)
  if (!g.ok) return g.res
  const insured = await listInsured(params.id)
  return NextResponse.json({ program: g.program, insured, editor: g.editor })
}

// PUT { name, year, config }: cambia nome, anno e configurazione (tassi, regole,
// contraenti, mail, chi può registrare). Gli importi si ricalcolano da soli.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as { name?: string; year?: number; config?: VitaConfig; company?: string }
  const name = String(body.name ?? g.program.name).trim()
  const year = Number(body.year ?? g.program.year)
  if (!name || !(year >= 2000 && year <= 2100)) return fail(400, 'Nome e anno obbligatori', 'invalid')
  const cfg = body.config || g.program.config
  if (!Array.isArray(cfg.companies) || !cfg.companies.length) return fail(400, 'Serve almeno un contraente', 'invalid')
  if (!cfg.rules) return fail(400, 'Regole mancanti', 'invalid')
  if (cfg.rules.capitalMode === 'categoria') {
    const cats = cfg.rules.categories || []
    if (!cats.length) return fail(400, 'Serve almeno una categoria con il suo capitale', 'invalid')
    if (cats.some((c) => !String(c.name || '').trim() || !(Number(c.capital) > 0))) return fail(400, 'Ogni categoria deve avere un nome e un capitale', 'invalid')
    if (cats.some((c) => !(Number(c.premium) > 0) && !(Number(c.rate) > 0))) return fail(400, 'Ogni categoria deve avere un tasso o un premio annuo', 'invalid')
  } else if (!(Number(cfg.rules.multiplier) > 0)) return fail(400, 'Moltiplicatore della RAL mancante', 'invalid')
  const company = body.company == null ? undefined : String(body.company).trim()
  const p = await updateProgram(params.id, name, year, cfg, company)
  await logAction({ email: g.email, action: 'vita.program.update', resource: params.id, metadata: { name, year } })
  return NextResponse.json({ program: p })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const ok = await deleteProgram(params.id)
  await logAction({ email: g.email, action: 'vita.program.delete', resource: params.id, metadata: { name: g.program.name } })
  return NextResponse.json({ ok })
}
