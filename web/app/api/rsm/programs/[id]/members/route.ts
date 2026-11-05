import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { clearExit, deleteMembers, getMember, insertMembers, listMembers, renameTitolare, setExit, updateMember } from '@/lib/rsm/store'
import type { MemberPatch } from '@/lib/rsm/store'
import { cleanNewMember, fail, guard } from '@/lib/rsm/server'

export const runtime = 'nodejs'

const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

// POST { members: [...] }: registra entrate (righe dei file confermate,
// inserimenti a mano) e uscite comunicate in un file (azione U: chiude la riga
// esistente della persona invece di crearne una).
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
      // uscita da file: chiude la riga aperta della persona
      const open = existing.filter((x) => x.cf === c.cf && !x.exitKind)
      if (!open.length || !c.exitDate) return fail(400, `Uscita di ${c.cognome} ${c.nome}: persona non trovata tra gli assicurati`, 'not-found')
      exits.push({ ids: open.map((x) => x.id), date: c.exitDate, comm: c.exitCommunicated || c.communicatedDate, note: c.note })
      continue
    }
    if (!cats.has(c.category)) return fail(400, `Categoria «${c.category}» non prevista dal programma`, 'invalid')
    if (!c.entryDate) return fail(400, `Data di entrata mancante per ${c.cognome} ${c.nome}`, 'invalid')
    entries.push({ ...c, legame: c.legame, source: c.source || body.source || 'Inserimento' })
  }
  if (entries.length) await insertMembers(params.id, entries, g.email)
  for (const x of exits) await setExit(x.ids, x.date, x.comm, x.note)
  await logAction({ email: g.email, action: 'rsm.members.add', resource: params.id, metadata: { entries: entries.length, exits: exits.length, source: body.source || null } })
  return NextResponse.json({ entries: entries.length, exits: exits.length })
}

// PATCH { action: 'exit', ids, exitDate, exitCommunicated?, note? }   cessazione
//       { action: 'clear-exit', id }                                   annulla cessazione
//       { action: 'update', id, patch }                                correzione
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const mine = new Set((await listMembers(params.id)).map((m) => m.id))
  if (body.action === 'exit') {
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((x) => mine.has(x))
    const date = iso(body.exitDate)
    if (!ids.length || !date) return fail(400, 'Persone e data di cessazione obbligatorie', 'invalid')
    const n = await setExit(ids, date, iso(body.exitCommunicated), body.note ? String(body.note) : null)
    await logAction({ email: g.email, action: 'rsm.members.exit', resource: params.id, metadata: { ids, date } })
    return NextResponse.json({ updated: n })
  }
  const id = String(body.id || '')
  if (!mine.has(id)) return fail(404, 'Riga non trovata', 'not-found')
  if (body.action === 'clear-exit') {
    const m = await clearExit(id)
    await logAction({ email: g.email, action: 'rsm.members.clear-exit', resource: id })
    return NextResponse.json({ member: m })
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
    const before = await getMember(id)
    if (before && before.legame === 'TI' && patch.cf && patch.cf !== before.cf) {
      patch.cfTitolare = patch.cf
      await renameTitolare(params.id, before.category, before.cf, patch.cf)
    }
    const m = await updateMember(id, patch)
    await logAction({ email: g.email, action: 'rsm.members.update', resource: id, metadata: { fields: Object.keys(patch) } })
    return NextResponse.json({ member: m })
  }
  return fail(400, 'Azione non prevista', 'invalid')
}

// DELETE { ids }: elimina righe registrate per errore.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] }
  const all = await listMembers(params.id)
  const mine = new Set(all.map((m) => m.id))
  const ids = (body.ids || []).map(String).filter((x) => mine.has(x))
  if (all.some((m) => ids.includes(m.id) && m.promotionId)) return fail(409, 'Righe di una promozione: annulla la promozione invece di eliminarle.', 'promotion')
  const n = await deleteMembers(ids)
  await logAction({ email: g.email, action: 'rsm.members.delete', resource: params.id, metadata: { ids } })
  return NextResponse.json({ deleted: n })
}
