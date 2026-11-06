import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { deleteProgram, listMembers, updateProgram } from '@/lib/rsm/store'
import type { RsmConfig } from '@/lib/rsm/types'
import { fail, guard } from '@/lib/rsm/server'

export const runtime = 'nodejs'

// Un programma con tutte le sue righe. Gli importi li calcola la pagina con le
// stesse regole (lib/rsm/rules.js), così la «situazione al» cambia senza
// richieste al server.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, false)
  if (!g.ok) return g.res
  const members = await listMembers(params.id)
  return NextResponse.json({ program: g.program, members, editor: g.editor })
}

const num = (v: unknown) => (v === '' || v == null ? 0 : Math.max(0, Number(v) || 0))
const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

/** Configurazione dal client, ripulita: numeri, date, categorie con chiave. */
function cleanConfig(c: RsmConfig): RsmConfig | null {
  const periodStart = iso(c?.periodStart), periodEnd = iso(c?.periodEnd)
  if (!periodStart || !periodEnd || periodEnd <= periodStart) return null
  const categories = (c.categories || []).map((x, i) => ({
    key: String(x.key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || `cat${i + 1}`,
    label: String(x.label || x.key || '').trim(),
    policy: String(x.policy || '').trim(),
    mode: x.mode === 'persona' ? 'persona' as const : 'nucleo' as const,
    rank: Number(x.rank) || i + 1,
    tariffs: { titolare: num(x.tariffs?.titolare), quiescente: num(x.tariffs?.quiescente), coniuge: num(x.tariffs?.coniuge), figlio: num(x.tariffs?.figlio) },
    quota: num(x.quota),
  }))
  if (!categories.length || new Set(categories.map((x) => x.key)).size !== categories.length) return null
  const r = c.rules || ({} as RsmConfig['rules'])
  return {
    periodStart, periodEnd, categories,
    rules: {
      firstSemesterEnd: /^\d{2}-\d{2}$/.test(String(r.firstSemesterEnd)) ? r.firstSemesterEnd : '06-30',
      secondSemesterPct: Math.min(100, num(r.secondSemesterPct ?? 50)),
      prorata: r.prorata === 'mesi' ? 'mesi' : 'giorni',
      refundTaxPct: num(r.refundTaxPct),
      notifyDays: Math.round(num(r.notifyDays ?? 30)),
      coverUntilPeriodEnd: r.coverUntilPeriodEnd !== false,
    },
    mail: { cc: String(c.mail?.cc || '').trim(), signature: String(c.mail?.signature || '') },
    editors: (c.editors || []).map((e) => String(e).trim().toLowerCase()).filter((e) => /@/.test(e)),
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as { name?: string; year?: number; config?: RsmConfig }
  const config = cleanConfig(body.config as RsmConfig)
  if (!config) return fail(400, 'Configurazione non valida: periodo, categorie con chiavi diverse.', 'invalid')
  // chi salva non può togliersi da solo il diritto di modifica
  if (config.editors && config.editors.length && !config.editors.includes(g.email.toLowerCase())) config.editors.push(g.email.toLowerCase())
  const name = String(body.name || g.program.name).trim()
  const year = Number(body.year) || g.program.year
  const p = await updateProgram(params.id, name, year, config)
  await logAction({ email: g.email, action: 'rsm.program.update', resource: params.id })
  return NextResponse.json({ program: p })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  await deleteProgram(params.id)
  await logAction({ email: g.email, action: 'rsm.program.delete', resource: params.id, metadata: { name: g.program.name } })
  return NextResponse.json({ ok: true })
}
