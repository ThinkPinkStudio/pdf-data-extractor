import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { categoriesFromWorkbook, defaultProgramConfig, inspectColumns, sheetCategory, tariffsFromWorkbook, workbookCompany, workbookYear } from '@/lib/rsm/rules.js'
import { fail, readSheets } from '@/lib/rsm/server'

export const runtime = 'nodejs'

// Prima lettura del file dello stato di rischio, senza programma: anno di
// polizza, società scritta nel file, categorie trovate, tariffe e numeri di polizza scritti nel file.
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
    const categories = [...new Set(Object.keys(sheets).map((n) => sheetCategory(n, cfg).key).filter(Boolean))]
    // categorie come le chiama il file (un foglio di assicurati = una categoria): l'import le propone
    const fileCategories = categoriesFromWorkbook(sheets, cfg)
    // Colonne del file per il tracciato della società: anche un file a un foglio
    // solo, con la categoria in colonna, va bene (i codici si indicano dopo).
    const layout = (() => { try { return JSON.parse(String(form.get('layout') || 'null')) } catch { return null } })()
    const columns = inspectColumns(sheets, layout)
    if (!categories.length && !fileCategories.length && !columns.columns.length) return fail(400, 'Nel file non c\'è un elenco di assicurati riconoscibile (serve una riga di intestazione).', 'empty')
    return NextResponse.json({ year, company: workbookCompany(sheets), categories, fileCategories, tariffs: tariffsFromWorkbook(cfg, sheets), sheets: Object.keys(sheets), columns })
  } catch (e) {
    return fail(400, `File non leggibile: ${(e as Error).message}`, 'unreadable')
  }
}
