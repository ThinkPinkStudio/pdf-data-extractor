import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { replaceMembers } from '@/lib/rsm/store'
import type { NewMember } from '@/lib/rsm/store'
import { parseStatoWorkbook } from '@/lib/rsm/rules.js'
import { fail, guard, readSheets } from '@/lib/rsm/server'

export const runtime = 'nodejs'

// Import dello stato di rischio del cliente (fogli per categoria + fogli
// «Variazioni …»). Senza confirm=1 è una prova: conteggi e avvisi. Con
// confirm=1 SOSTITUISCE tutte le righe del programma.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return fail(400, 'File mancante', 'invalid')
  let parsed
  try {
    parsed = parseStatoWorkbook(g.program.config, readSheets(Buffer.from(await file.arrayBuffer())))
  } catch (e) {
    return fail(400, `File non leggibile: ${(e as Error).message}`, 'unreadable')
  }
  const counts: Record<string, { righe: number; titolari: number; entrate: number; uscite: number }> = {}
  for (const m of parsed.members) {
    const c = (counts[m.category] ||= { righe: 0, titolari: 0, entrate: 0, uscite: 0 })
    c.righe++
    if (m.legame === 'TI') c.titolari++
    if (m.entryKind !== 'iniziale') c.entrate++
    if (m.exitDate) c.uscite++
  }
  if (!parsed.members.length) return fail(400, 'Nessun assicurato trovato: servono fogli con il nome delle categorie (es. «IMPIEGATI», «Variazioni IMPIEGATI»).', 'empty')
  if (String(form.get('confirm') || '') !== '1') return NextResponse.json({ dryRun: true, counts, warnings: parsed.warnings, total: parsed.members.length })
  const members = parsed.members.map((m) => ({ ...m, source: `${m.source} (${file.name})` })) as unknown as Partial<NewMember>[]
  await replaceMembers(params.id, members, g.email)
  await logAction({ email: g.email, action: 'rsm.import', resource: params.id, metadata: { file: file.name, total: members.length, warnings: parsed.warnings.length } })
  return NextResponse.json({ dryRun: false, counts, warnings: parsed.warnings, total: members.length })
}
