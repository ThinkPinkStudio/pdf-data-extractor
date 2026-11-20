// POLIZZA VITA — guardie comuni delle route: sessione, programma, diritto di
// modifica (config.editors: chi carica; gli altri consultano).
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getSession } from '../auth'
import { getProgram } from './store'
import { canEdit } from './types'
import type { VitaProgram } from './types'

export type Guard =
  | { ok: true; email: string; program: VitaProgram; editor: boolean }
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

/**
 * Fogli di un file Excel come righe grezze. Le date restano SERIALI (niente
 * `cellDates`): un oggetto Date costruito da SheetJS può cadere a mezzanotte UTC
 * o locale a seconda del file, e con il fuso italiano la data slitta di un giorno
 * (una nascita del 16/02 diventava il 17). Dal seriale la conversione è esatta.
 */
export function readSheets(buf: Buffer): Record<string, unknown[][]> {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const out: Record<string, unknown[][]> = {}
  for (const name of wb.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, blankrows: true, defval: null }) as unknown[][]
  }
  return out
}
