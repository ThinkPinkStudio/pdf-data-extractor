import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { replaceMembers } from '@/lib/rsm/store'
import type { NewMember } from '@/lib/rsm/store'
import { annualPremium, parseStatoWorkbook, tariffsFromWorkbook } from '@/lib/rsm/rules.js'
import { fail, guard, readSheets } from '@/lib/rsm/server'

export const runtime = 'nodejs'

// Import dello stato di rischio del cliente (fogli per categoria + fogli
// «Variazioni …»). Senza confirm=1 è una prova: conteggi e avvisi. Con
// confirm=1 SOSTITUISCE tutte le righe del programma, ma solo quando ogni
// anomalia del file (promozioni non segnate o senza controparte) ha una
// risposta in `resolutions` (JSON { chiave: scelta }): il programma non indovina.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return fail(400, 'File mancante', 'invalid')
  let parsed
  let fileTariffs: Record<string, { tariffs: Record<string, number>; policy: string }> = {}
  try {
    let resolutions: Record<string, string> = {}
    try { resolutions = JSON.parse(String(form.get('resolutions') || '{}')) } catch { resolutions = {} }
    const sheets = readSheets(Buffer.from(await file.arrayBuffer()))
    parsed = parseStatoWorkbook(g.program.config, sheets, resolutions)
    fileTariffs = tariffsFromWorkbook(g.program.config, sheets) as typeof fileTariffs
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
  // Tariffe a zero: i premi uscirebbero a 0 (programma nuovo non ancora compilato).
  const warnings = [...parsed.warnings]
  for (const c of g.program.config.categories) {
    if (counts[c.key] && !annualPremium(g.program.config, c.key, 'TI', false)) warnings.unshift(`Tariffa del titolare di ${c.label} a zero: compila le tariffe nelle Impostazioni, altrimenti i premi risultano 0.`)
  }
  const open = parsed.anomalies.filter((a: { choice: string | null }) => !a.choice)
  const body = { counts, warnings, anomalies: parsed.anomalies, total: parsed.members.length, tariffs: fileTariffs }
  if (String(form.get('confirm') || '') !== '1') return NextResponse.json({ dryRun: true, ...body })
  if (open.length) return NextResponse.json({ error: `Ci sono ${open.length} anomalie del file a cui rispondere prima di importare.`, code: 'anomalies', dryRun: true, ...body }, { status: 409 })
  const members = parsed.members.map((m) => ({ ...m, source: `${m.source} (${file.name})` })) as unknown as Partial<NewMember>[]
  await replaceMembers(params.id, members, g.email)
  await logAction({ email: g.email, action: 'rsm.import', resource: params.id, metadata: { file: file.name, total: members.length, warnings: warnings.length, anomalies: parsed.anomalies.map((a: { key: string; choice: string | null }) => [a.key, a.choice]) } })
  return NextResponse.json({ dryRun: false, ...body })
}
