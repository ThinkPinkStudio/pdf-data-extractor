import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { listInsured, setNextRal } from '@/lib/vita/store'
import { parseVitaRal } from '@/lib/vita/rules.js'
import { fail, guard, readSheets } from '@/lib/vita/server'

export const runtime = 'nodejs'

/**
 * RAL dell'anno dopo, dal file che l'Azienda rimanda a fine anno. Senza
 * `confirm` è una prova: dice quante RAL combaciano e chi resta scoperto.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return fail(400, 'File mancante', 'invalid')
  const confirm = String(form?.get('confirm') || '') === '1'
  const year = Number(form?.get('ralYear')) || g.program.year + 1

  const sheets = readSheets(Buffer.from(await file.arrayBuffer()))
  const { byCf, warnings } = parseVitaRal(g.program.config, sheets, year) as { byCf: Record<string, number>; warnings: string[] }
  const insured = await listInsured(params.id)
  const open = insured.filter((x) => !x.exitKind)
  const found = open.filter((x) => byCf[x.cf] != null)
  const missing = open.filter((x) => byCf[x.cf] == null)
  const extra = Object.keys(byCf).filter((cf) => !open.some((x) => x.cf === cf))
  const all = [...warnings]
  if (missing.length) all.push(`${missing.length} assicurati in copertura non hanno la RAL ${year} nel file: ${missing.slice(0, 5).map((x) => `${x.cognome} ${x.nome}`).join(', ')}${missing.length > 5 ? '…' : ''}`)
  if (extra.length) all.push(`${extra.length} persone del file non sono fra gli assicurati del programma: entrano con l'import dello stato di rischio, non da qui.`)

  if (!confirm) return NextResponse.json({ year, found: found.length, missing: missing.length, extra: extra.length, warnings: all })
  const label = `RAL ${year} da «${file.name}» (${found.length} assicurati)`
  const r = await setNextRal(params.id, byCf, g.email, label)
  await logAction({ email: g.email, action: 'vita.renewal.ral', resource: params.id, metadata: { file: file.name, year, n: r.n, opId: r.opId } })
  return NextResponse.json({ ok: true, year, found: r.n, missing: missing.length, warnings: all, opId: r.opId, label })
}
