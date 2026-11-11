import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { defaultProgramConfig, normCategory, tariffsFromWorkbook, workbookYear } from '@/lib/rsm/rules.js'
import { fail, readSheets } from '@/lib/rsm/server'

export const runtime = 'nodejs'

// Prima lettura del file dello stato di rischio, senza programma: anno di
// polizza, categorie trovate, tariffe e numeri di polizza scritti nel file.
// Serve all'import guidato per scegliere (o creare) il programma giusto.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return fail(401, 'Unauthorized', 'unauthorized')
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return fail(400, 'File mancante', 'invalid')
  try {
    const sheets = readSheets(Buffer.from(await file.arrayBuffer()))
    const year = workbookYear(sheets)
    const cfg = defaultProgramConfig(year || new Date().getFullYear())
    const categories = [...new Set(Object.keys(sheets).map((n) => normCategory(n.replace(/^VARIAZIONI\s*/i, ''), cfg.categories).key).filter(Boolean))]
    if (!categories.length) return fail(400, 'Nel file non ci sono fogli con il nome di una categoria (es. «IMPIEGATI», «Variazioni IMPIEGATI»).', 'empty')
    return NextResponse.json({ year, categories, tariffs: tariffsFromWorkbook(cfg, sheets), sheets: Object.keys(sheets) })
  } catch (e) {
    return fail(400, `File non leggibile: ${(e as Error).message}`, 'unreadable')
  }
}
