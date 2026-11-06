// ANAGRAFICHE RSM — guardie comuni delle route: sessione, programma, diritto
// di modifica (config.editors: chi carica; gli altri consultano).
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getSession } from '../auth'
import { getProgram } from './store'
import { canEdit } from './types'
import type { RsmProgram } from './types'

export type Guard =
  | { ok: true; email: string; program: RsmProgram; editor: boolean }
  | { ok: false; res: NextResponse }

export const fail = (status: number, error: string, code: string) => NextResponse.json({ error, code }, { status })

export async function guard(programId: string, needEdit: boolean): Promise<Guard> {
  const session = await getSession()
  if (!session.email) return { ok: false, res: fail(401, 'Unauthorized', 'unauthorized') }
  const program = await getProgram(programId)
  if (!program) return { ok: false, res: fail(404, 'Programma non trovato', 'not-found') }
  const editor = canEdit(program.config, session.email)
  if (needEdit && !editor) return { ok: false, res: fail(403, 'Sola consultazione: chiedi a chi gestisce il programma.', 'read-only') }
  return { ok: true, email: session.email, program, editor }
}

/** Fogli di un file Excel come righe grezze (date come Date, come le scrive Excel). */
export function readSheets(buf: Buffer): Record<string, unknown[][]> {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
  const out: Record<string, unknown[][]> = {}
  for (const name of wb.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, blankrows: true, defval: null }) as unknown[][]
  }
  return out
}

/** Solo i campi di una riga che il client può impostare. */
export function cleanNewMember(m: Record<string, unknown>) {
  const s = (v: unknown) => (v == null || v === '' ? null : String(v).trim())
  const d = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  const legame = s(m.legame)
  return {
    category: s(m.category) || '',
    quiescente: !!m.quiescente,
    cf: (s(m.cf) || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    cognome: (s(m.cognome) || '').toUpperCase(),
    nome: (s(m.nome) || '').toUpperCase(),
    birthDate: d(m.birthDate),
    legame: (legame === 'TI' || legame === 'CO' || legame === 'FI' ? legame : null) as 'TI' | 'CO' | 'FI' | null,
    cfTitolare: (s(m.cfTitolare) || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null,
    entryDate: d(m.entryDate),
    entryKind: (m.entryKind === 'iniziale' ? 'iniziale' : 'inclusione') as 'iniziale' | 'inclusione',
    requestedDate: d(m.requestedDate),
    communicatedDate: d(m.communicatedDate),
    entryForced: !!m.entryForced,
    exitDate: d(m.exitDate),
    exitKind: (m.exitKind === 'cessazione' ? 'cessazione' : null) as 'cessazione' | null,
    exitCommunicated: d(m.exitCommunicated),
    promotionId: null,
    exitPromotionId: null,
    source: s(m.source),
    note: s(m.note),
  }
}
