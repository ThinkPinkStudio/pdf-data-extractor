import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { listInsured, replaceInsured } from '@/lib/vita/store'
import { computeInsured, parseVitaWorkbook } from '@/lib/vita/rules.js'
import { checkPerson } from '@/lib/rsm/rules.js'
import { fail, guard, readSheets } from '@/lib/vita/server'

export const runtime = 'nodejs'

interface Parsed { company: string; cf: string; cognome: string; nome: string; birthDate: string | null; ral: number; keyFigure: boolean; sovrPct: number; doc: { visit: boolean; extra: boolean; ok: boolean; checkupDate: string | null }; entryDate: string; source: string; rowNumber?: number; sheet?: string }

/**
 * Carica lo stato di rischio dal file dell'Azienda. Senza `confirm` è una PROVA:
 * dice che cosa entrerebbe e che cosa non torna, senza salvare. Con `confirm`
 * SOSTITUISCE le righe del programma, in una operazione annullabile.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return fail(400, 'File mancante', 'invalid')
  const confirm = String(form?.get('confirm') || '') === '1'
  const ralYear = Number(form?.get('ralYear')) || g.program.year

  const sheets = readSheets(Buffer.from(await file.arrayBuffer()))
  const { insured, warnings } = parseVitaWorkbook(g.program.config, sheets, { ralYear }) as { insured: Parsed[]; warnings: string[] }
  if (!insured.length) return NextResponse.json({ n: 0, warnings: [...warnings, 'Nessun assicurato riconosciuto nel file.'], perCompany: {}, premium: 0, missingRal: 0 })

  // Controlli sui dati del file: il codice fiscale contro nome, cognome e nascita.
  const all = [...warnings]
  const seen = new Map<string, Parsed>()
  for (const p of insured) {
    const issues = checkPerson({ cognome: p.cognome, nome: p.nome, cf: p.cf, birthDate: p.birthDate }, g.program.year).issues as { level: string; text: string }[]
    for (const i of issues.filter((x) => x.level === 'error')) all.push(`«${p.sheet}» riga ${p.rowNumber} ${p.cognome} ${p.nome}: ${i.text}`)
    const key = `${p.company}:${p.cf}`
    if (seen.has(key)) all.push(`${p.cognome} ${p.nome} compare due volte sulla stessa polizza (righe ${seen.get(key)!.rowNumber} e ${p.rowNumber}): tenuta la prima.`)
    else seen.set(key, p)
  }
  const rows = [...seen.values()]
  const perCompany: Record<string, number> = {}
  let premium = 0
  let missingRal = 0
  let noRate = 0
  for (const p of rows) {
    perCompany[p.company] = (perCompany[p.company] || 0) + 1
    if (!(p.ral > 0) && !p.keyFigure) missingRal++
    const c = computeInsured(p, g.program.config.rates, p.entryDate, g.program.config.rules) as { gross: number | null; rate: number | null }
    if (c.rate == null) noRate++
    premium += c.gross || 0
  }
  if (missingRal) all.unshift(`${missingRal} ${missingRal === 1 ? 'assicurato è' : 'assicurati sono'} senza RAL: il capitale non si può calcolare.`)
  if (noRate) all.unshift(`${noRate} ${noRate === 1 ? 'assicurato ha' : 'assicurati hanno'} un'età fuori dalla tabella dei tassi: il premio va concordato con la compagnia.`)

  if (!confirm) {
    const existing = await listInsured(params.id)
    return NextResponse.json({ n: rows.length, perCompany, premium, warnings: all, missingRal, replaces: existing.length })
  }
  const label = `Import dello stato di rischio da «${file.name}» (${rows.length} assicurati)`
  const r = await replaceInsured(params.id, rows.map(({ rowNumber, sheet, ...m }) => { void rowNumber; void sheet; return m }), g.email, label)
  await logAction({ email: g.email, action: 'vita.import', resource: params.id, metadata: { file: file.name, n: rows.length, opId: r.opId } })
  return NextResponse.json({ ok: true, n: r.n, perCompany, premium, warnings: all, opId: r.opId, label })
}
