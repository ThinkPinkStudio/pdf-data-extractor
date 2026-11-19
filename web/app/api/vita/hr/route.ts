import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { applyHrPlan, getProgram, listInsured, listPrograms } from '@/lib/vita/store'
import { computeInsured, fmtDate, movementOf, parseHrMonthly, planHrEvents, yearEndOf } from '@/lib/vita/rules.js'
import { canEdit, clientOf } from '@/lib/vita/types'
import type { VitaInsured, VitaProgram } from '@/lib/vita/types'
import { fail, readSheets } from '@/lib/vita/server'

export const runtime = 'nodejs'

interface Change { kind: string; date: string; who: string; cf: string; sheet: string; id: string; text: string; amount?: number | null }
interface Diff { key: string; id: string; field: string; current: string | null; expected: string; who: string; text: string }
interface Plan {
  inserts: (Partial<VitaInsured> & { id: string })[]
  updates: { id: string; set: Partial<VitaInsured> }[]
  changes: Change[]
  diffs: Diff[]
  skipped: Record<string, number>
  warnings: string[]
}

/** Importo di ogni movimento (rateo di chi entra, rimborso di chi esce) con le regole del programma. */
function withAmounts(program: VitaProgram, insured: VitaInsured[], plan: Plan) {
  const cfg = program.config
  const ye = yearEndOf(cfg)
  const rows = new Map<string, Partial<VitaInsured>>(insured.map((p) => [p.id, p]))
  for (const u of plan.updates) rows.set(u.id, { ...rows.get(u.id), ...u.set })
  for (const p of plan.inserts) rows.set(p.id, p)
  for (const c of plan.changes) {
    const p = rows.get(c.id)
    if (!p) continue
    const k = computeInsured(p, cfg.rates, p.entryDate || cfg.periodStart, cfg.rules) as { capital: number; rate: number | null }
    const kind = c.kind === 'uscita' ? 'ESCLUSIONE' : 'INCLUSIONE'
    const m = movementOf({ kind, date: c.date, capital: k.capital, rate: k.rate, paid: { capital: k.capital, rate: k.rate as number } }, ye, cfg.rules) as { gross: number | null }
    c.amount = c.kind === 'correzione' ? null : m.gross
  }
}

/**
 * File mensile del cliente (assunti, cessati, passaggi di livello). Senza
 * `confirm` è una PROVA: per ogni polizza del cliente e dell'anno che si
 * aggiorna col file mensile (o per quella aperta) dice che cosa entrerebbe e
 * che cosa non torna. Con `confirm` registra nelle polizze `targets`, con le
 * correzioni di data `fix` scelte dall'operatore: una operazione annullabile
 * per polizza. Lo stesso file ricaricato non registra niente due volte.
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return fail(401, 'Unauthorized', 'unauthorized')
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return fail(400, 'File mancante', 'invalid')
  const current = await getProgram(String(form?.get('programId') || ''))
  if (!current) return fail(404, 'Programma non trovato', 'not-found')
  const confirm = String(form?.get('confirm') || '') === '1'
  const parse = (k: string) => { try { const v = JSON.parse(String(form?.get(k) || '[]')); return Array.isArray(v) ? v.map(String) : [] } catch { return [] } }
  const fix = parse('fix')
  const targets = parse('targets')
  // file di un solo contraente (es. Agos Renting a parte): tutte le righe sono sue
  const company = String(form?.get('company') || '').trim() || undefined

  const sheets = readSheets(Buffer.from(await file.arrayBuffer()))
  const hr = parseHrMonthly(sheets) as { events: unknown[]; months: string[]; warnings: string[] }
  const all = await listPrograms()
  const client = clientOf(current)
  let programs = all.filter((p) => clientOf(p) === client && p.year === current.year && p.config.hrMonthly)
  if (!programs.some((p) => p.id === current.id)) programs = [current, ...programs]

  if (!confirm) {
    const out = []
    for (const p of programs) {
      const insured = await listInsured(p.id)
      const plan = planHrEvents(p.config, insured, hr.events, { company }) as Plan
      withAmounts(p, insured, plan)
      out.push({
        id: p.id, name: p.name, editor: canEdit(p.config, session.email), hrMonthly: !!p.config.hrMonthly,
        byCategory: p.config.rules?.capitalMode === 'categoria', insured: insured.length,
        changes: plan.changes, diffs: plan.diffs, skipped: plan.skipped, warnings: plan.warnings,
      })
    }
    return NextResponse.json({ months: hr.months, events: hr.events.length, warnings: hr.warnings, programs: out })
  }

  const results = []
  for (const id of targets) {
    const p = programs.find((x) => x.id === id)
    if (!p) return fail(400, 'Polizza non prevista per questo file', 'invalid')
    if (!canEdit(p.config, session.email)) return fail(403, `Sola consultazione su «${p.name}»`, 'read-only')
  }
  for (const id of targets) {
    const p = programs.find((x) => x.id === id)!
    const insured = await listInsured(p.id)
    const plan = planHrEvents(p.config, insured, hr.events, { fix, company }) as Plan
    if (!plan.inserts.length && !plan.updates.length) { results.push({ id, name: p.name, added: 0, updated: 0, opId: null }); continue }
    const n = (k: string) => plan.changes.filter((c) => c.kind === k).length
    const parts = [n('entrata') && `${n('entrata')} ${n('entrata') === 1 ? 'entrata' : 'entrate'}`, n('uscita') && `${n('uscita')} ${n('uscita') === 1 ? 'uscita' : 'uscite'}`, n('passaggio') && `${n('passaggio')} ${n('passaggio') === 1 ? 'passaggio' : 'passaggi'}`, n('correzione') && `${n('correzione')} ${n('correzione') === 1 ? 'data corretta' : 'date corrette'}`].filter(Boolean)
    const label = `File mensile «${file.name}» in ${p.name}: ${parts.join(', ')}`
    const inserts = plan.inserts.map(({ id: tmp, ...rest }) => { void tmp; return rest })
    const r = await applyHrPlan(p.id, { inserts, updates: plan.updates }, session.email, label)
    await logAction({ email: session.email, action: 'vita.hr.apply', resource: p.id, metadata: { file: file.name, ...r, fix: fix.length } })
    results.push({ id, name: p.name, ...r, label })
  }
  void fmtDate
  return NextResponse.json({ ok: true, results })
}
