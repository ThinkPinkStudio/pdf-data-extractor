import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { addInsured, clearExit, listInsured, setExit, transfer, updateInsured } from '@/lib/vita/store'
import type { InsuredPatch } from '@/lib/vita/store'
import { fmtDate } from '@/lib/vita/rules.js'
import { fail, guard } from '@/lib/vita/server'
import { companyOf } from '@/lib/vita/types'

export const runtime = 'nodejs'

const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const str = (v: unknown) => (v == null ? '' : String(v).trim())
const who = (m: { cognome: string; nome: string }) => `${m.cognome} ${m.nome}`.trim()

// POST { insured: [...] }: registra inclusioni (dalla mail dell'Azienda o a mano).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as { insured?: Record<string, unknown>[]; source?: string }
  const raw = Array.isArray(body.insured) ? body.insured : []
  if (!raw.length) return fail(400, 'Nessuna riga da registrare', 'invalid')
  const cfg = g.program.config
  const rows = []
  for (const m of raw) {
    const cf = str(m.cf).toUpperCase().replace(/[^A-Z0-9]/g, '')
    const company = str(m.company)
    const entryDate = iso(m.entryDate)
    if (!cf) return fail(400, 'Ogni riga deve avere il codice fiscale', 'invalid')
    if (!companyOf(cfg, company)) return fail(400, `Contraente «${company}» non previsto dal programma`, 'invalid')
    if (!entryDate) return fail(400, `Data di decorrenza mancante per ${str(m.cognome)} ${str(m.nome)}`, 'invalid')
    if (entryDate < cfg.periodStart || entryDate >= cfg.periodEnd) return fail(400, `La data ${fmtDate(entryDate)} non cade nel programma ${g.program.year}`, 'out-of-period')
    rows.push({
      company, cf, cognome: str(m.cognome).toUpperCase(), nome: str(m.nome).toUpperCase(),
      birthDate: iso(m.birthDate), level: str(m.level), ral: Number(m.ral) || 0,
      keyFigure: !!m.keyFigure, sovrPct: Number(m.sovrPct) || 0,
      doc: { visit: !!(m.doc as Record<string, unknown>)?.visit, extra: !!(m.doc as Record<string, unknown>)?.extra, ok: !!(m.doc as Record<string, unknown>)?.ok, checkupDate: iso((m.doc as Record<string, unknown>)?.checkupDate) },
      remindedOn: null,
      entryDate, entryKind: (entryDate > cfg.periodStart ? 'inclusione' : 'iniziale') as 'inclusione' | 'iniziale',
      communicatedDate: iso(m.communicatedDate),
      exitDate: null, exitKind: null, exitCommunicated: null, transferId: null, exitTransferId: null,
      nextRal: null, source: str(m.source) || str(body.source) || 'Inserimento', note: str(m.note),
    })
  }
  const label = rows.length === 1 ? `Inclusione di ${who(rows[0])} dal ${fmtDate(rows[0].entryDate)}` : `Inclusione di ${rows.length} assicurati`
  const r = await addInsured(params.id, rows, g.email, label)
  await logAction({ email: g.email, action: 'vita.insured.add', resource: params.id, metadata: { n: rows.length, opId: r.opId } })
  return NextResponse.json({ ok: true, n: rows.length, opId: r.opId, label })
}

// PATCH { action: 'exit' | 'clear-exit' | 'update' | 'transfer', … }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = str(body.action)
  const all = await listInsured(params.id)
  const cfg = g.program.config
  const byId = new Map(all.map((x) => [x.id, x]))

  if (action === 'exit') {
    const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map(str).filter(Boolean)
    const rows = ids.map((i) => byId.get(i)).filter(Boolean) as typeof all
    if (!rows.length) return fail(404, 'Assicurato non trovato', 'not-found')
    const date = iso(body.exitDate)
    if (!date) return fail(400, 'Data di uscita mancante', 'invalid')
    if (date < cfg.periodStart || date > cfg.periodEnd) return fail(400, `La data ${fmtDate(date)} non cade nel programma ${g.program.year}`, 'out-of-period')
    if (rows.some((r) => r.exitKind)) return fail(409, 'Una delle persone ha già un\'uscita registrata', 'already-out')
    const label = `Uscita di ${who(rows[0])}${rows.length > 1 ? ` (${rows.length} persone)` : ''} dal ${fmtDate(date)}`
    const r = await setExit(params.id, ids, date, iso(body.exitCommunicated), str(body.note) || null, g.email, label)
    await logAction({ email: g.email, action: 'vita.insured.exit', resource: params.id, metadata: { ids, date, opId: r.opId } })
    return NextResponse.json({ ok: true, n: r.n, opId: r.opId, label })
  }

  if (action === 'clear-exit') {
    const row = byId.get(str(body.id))
    if (!row) return fail(404, 'Assicurato non trovato', 'not-found')
    if (row.exitKind !== 'cessazione') return fail(409, 'Si annulla solo una cessazione: i passaggi si annullano dal registro.', 'not-cessation')
    const label = `Annullata l'uscita di ${who(row)}`
    const r = await clearExit(params.id, row.id, g.email, label)
    await logAction({ email: g.email, action: 'vita.insured.clear-exit', resource: params.id, metadata: { id: row.id, opId: r.opId } })
    return NextResponse.json({ ok: r.ok, opId: r.opId, label })
  }

  if (action === 'transfer') {
    const row = byId.get(str(body.id))
    if (!row) return fail(404, 'Assicurato non trovato', 'not-found')
    const to = str(body.toCompany)
    const date = iso(body.date)
    if (!companyOf(cfg, to)) return fail(400, 'Contraente di arrivo non previsto', 'invalid')
    if (to === row.company) return fail(400, 'È già su quella polizza', 'invalid')
    if (!date) return fail(400, 'Data del passaggio mancante', 'invalid')
    if (date < cfg.periodStart || date >= cfg.periodEnd) return fail(400, `La data ${fmtDate(date)} non cade nel programma ${g.program.year}`, 'out-of-period')
    if (row.exitKind) return fail(409, 'Questa persona ha già un\'uscita registrata', 'already-out')
    const label = `Passaggio di ${who(row)} a ${companyOf(cfg, to)!.name} dal ${fmtDate(date)}`
    const r = await transfer(params.id, row.id, to, date, str(body.note) || null, g.email, label)
    await logAction({ email: g.email, action: 'vita.insured.transfer', resource: params.id, metadata: { id: row.id, to, date, opId: r.opId } })
    return NextResponse.json({ ok: true, opId: r.opId, transferId: r.transferId, label })
  }

  if (action === 'update') {
    const row = byId.get(str(body.id))
    if (!row) return fail(404, 'Assicurato non trovato', 'not-found')
    const p = (body.patch || {}) as Record<string, unknown>
    const patch: InsuredPatch = {}
    if ('cognome' in p) patch.cognome = str(p.cognome).toUpperCase()
    if ('nome' in p) patch.nome = str(p.nome).toUpperCase()
    if ('birthDate' in p) patch.birthDate = iso(p.birthDate)
    if ('level' in p) patch.level = str(p.level)
    if ('ral' in p) patch.ral = Number(p.ral) || 0
    if ('nextRal' in p) patch.nextRal = p.nextRal == null || p.nextRal === '' ? null : Number(p.nextRal) || 0
    if ('keyFigure' in p) patch.keyFigure = !!p.keyFigure
    if ('sovrPct' in p) patch.sovrPct = Number(p.sovrPct) || 0
    if ('remindedOn' in p) patch.remindedOn = iso(p.remindedOn)
    if ('note' in p) patch.note = str(p.note)
    if ('doc' in p) {
      const d = (p.doc || {}) as Record<string, unknown>
      patch.doc = { visit: !!d.visit, extra: !!d.extra, ok: !!d.ok, checkupDate: iso(d.checkupDate) }
    }
    if ('entryDate' in p) {
      const d = iso(p.entryDate)
      if (!d) return fail(400, 'Data di decorrenza non valida', 'invalid')
      if (row.entryKind === 'passaggio') return fail(409, 'La data di un passaggio si cambia annullando il passaggio.', 'transfer-row')
      if (d < cfg.periodStart || d >= cfg.periodEnd) return fail(400, `La data ${fmtDate(d)} non cade nel programma ${g.program.year}`, 'out-of-period')
      patch.entryDate = d
      patch.entryKind = d > cfg.periodStart ? 'inclusione' : 'iniziale'
    }
    if (!Object.keys(patch).length) return fail(400, 'Niente da modificare', 'invalid')
    const label = `Modifica di ${who(row)}`
    const r = await updateInsured(params.id, row.id, patch, g.email, label)
    await logAction({ email: g.email, action: 'vita.insured.update', resource: params.id, metadata: { id: row.id, campi: Object.keys(patch), opId: r.opId } })
    return NextResponse.json({ ok: r.ok, opId: r.opId, label })
  }

  return fail(400, 'Azione non riconosciuta', 'invalid')
}
