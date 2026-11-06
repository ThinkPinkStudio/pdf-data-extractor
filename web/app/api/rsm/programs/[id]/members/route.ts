import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { clearExit, deleteMembers, listMembers, registerChanges, setExit, updateMember } from '@/lib/rsm/store'
import type { MemberPatch } from '@/lib/rsm/store'
import { fmtDate } from '@/lib/rsm/rules.js'
import { cleanNewMember, fail, guard } from '@/lib/rsm/server'

export const runtime = 'nodejs'

const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const who = (m: { cognome: string; nome: string }) => `${m.cognome} ${m.nome}`.trim()
const plus = (n: number) => (n > 1 ? ` (${n} persone)` : '')

// POST { members: [...], source? }: registra entrate (righe dei file confermate,
// inserimenti a mano) e uscite comunicate in un file (azione U: chiude la riga
// aperta della persona). Tutto in UNA operazione annullabile.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as { members?: Record<string, unknown>[]; source?: string }
  const raw = Array.isArray(body.members) ? body.members : []
  if (!raw.length) return fail(400, 'Nessuna riga da registrare', 'invalid')
  const cats = new Set(g.program.config.categories.map((c) => c.key))
  const existing = await listMembers(params.id)
  const entries = []
  const exits: { ids: string[]; date: string; comm: string | null; note: string | null }[] = []
  for (const m of raw) {
    const c = cleanNewMember(m)
    if (!c.cf || !c.legame) return fail(400, 'Ogni riga deve avere codice fiscale e legame', 'invalid')
    if (c.exitKind === 'cessazione' && !c.entryDate) {
      const open = existing.filter((x) => x.cf === c.cf && !x.exitKind)
      if (!open.length || !c.exitDate) return fail(400, `Uscita di ${who(c)}: persona non trovata tra gli assicurati`, 'not-found')
      exits.push({ ids: open.map((x) => x.id), date: c.exitDate, comm: c.exitCommunicated || c.communicatedDate, note: c.note })
      continue
    }
    if (!cats.has(c.category)) return fail(400, `Categoria «${c.category}» non prevista dal programma`, 'invalid')
    if (!c.entryDate) return fail(400, `Data di entrata mancante per ${who(c)}`, 'invalid')
    entries.push({ ...c, legame: c.legame, source: c.source || body.source || 'Inserimento' })
  }
  const label = raw.length === 1 && entries.length === 1
    ? `Inclusione di ${who(entries[0])} dal ${fmtDate(entries[0].entryDate)}`
    : `Registrate ${entries.length} entrate e ${exits.length} uscite${body.source ? ` (${body.source})` : ''}`
  const opId = await registerChanges(params.id, entries, exits, g.email, label)
  await logAction({ email: g.email, action: 'rsm.members.add', resource: params.id, metadata: { entries: entries.length, exits: exits.length, source: body.source || null, opId } })
  return NextResponse.json({ entries: entries.length, exits: exits.length, opId, label })
}

// PATCH { action: 'exit', ids, exitDate, exitCommunicated?, note? }   cessazione
//       { action: 'clear-exit', id }                                   annulla cessazione
//       { action: 'update', id, patch }                                correzione
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const all = await listMembers(params.id)
  const byId = new Map(all.map((m) => [m.id, m]))
  if (body.action === 'exit') {
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((x) => byId.has(x))
    const date = iso(body.exitDate)
    if (!ids.length || !date) return fail(400, 'Persone e data di cessazione obbligatorie', 'invalid')
    const label = `Cessazione di ${who(byId.get(ids[0])!)}${plus(ids.length)} dal ${fmtDate(date)}`
    const r = await setExit(params.id, ids, date, iso(body.exitCommunicated), body.note ? String(body.note) : null, g.email, label)
    await logAction({ email: g.email, action: 'rsm.members.exit', resource: params.id, metadata: { ids, date, opId: r.opId } })
    return NextResponse.json({ updated: r.updated, opId: r.opId, label })
  }
  const id = String(body.id || '')
  const row = byId.get(id)
  if (!row) return fail(404, 'Riga non trovata', 'not-found')
  if (body.action === 'clear-exit') {
    const label = `Annullata la cessazione di ${who(row)}`
    const opId = await clearExit(params.id, id, g.email, label)
    await logAction({ email: g.email, action: 'rsm.members.clear-exit', resource: id, metadata: { opId } })
    return NextResponse.json({ opId, label })
  }
  if (body.action === 'update') {
    const p = (body.patch || {}) as Record<string, unknown>
    const c = cleanNewMember({ ...p })
    const patch: MemberPatch = {}
    if ('cognome' in p) patch.cognome = c.cognome
    if ('nome' in p) patch.nome = c.nome
    if ('cf' in p && c.cf) patch.cf = c.cf
    if ('birthDate' in p) patch.birthDate = c.birthDate
    if ('legame' in p && c.legame) patch.legame = c.legame
    if ('cfTitolare' in p) patch.cfTitolare = c.cfTitolare
    if ('quiescente' in p) patch.quiescente = c.quiescente
    if ('entryDate' in p && c.entryDate) { patch.entryDate = c.entryDate; patch.entryForced = !!p.entryForced }
    if ('note' in p) patch.note = c.note
    const label = `Modifica di ${who(row)}`
    const r = await updateMember(params.id, id, patch, g.email, label)
    await logAction({ email: g.email, action: 'rsm.members.update', resource: id, metadata: { fields: Object.keys(patch), opId: r.opId } })
    return NextResponse.json({ member: r.member, opId: r.opId, label })
  }
  return fail(400, 'Azione non prevista', 'invalid')
}

// DELETE { ids }: elimina righe registrate per errore.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] }
  const all = await listMembers(params.id)
  const byId = new Map(all.map((m) => [m.id, m]))
  const ids = (body.ids || []).map(String).filter((x) => byId.has(x))
  if (!ids.length) return fail(404, 'Riga non trovata', 'not-found')
  if (ids.some((x) => byId.get(x)!.promotionId)) return fail(409, 'Righe di una promozione: annulla la promozione invece di eliminarle.', 'promotion')
  const label = `Eliminata la riga di ${who(byId.get(ids[0])!)}${ids.length > 1 ? ` e altre ${ids.length - 1}` : ''}`
  const r = await deleteMembers(params.id, ids, g.email, label)
  await logAction({ email: g.email, action: 'rsm.members.delete', resource: params.id, metadata: { ids, opId: r.opId } })
  return NextResponse.json({ deleted: r.deleted, opId: r.opId, label })
}
