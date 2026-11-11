import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { fail, readSheets } from '@/lib/vita/server'
import { findVitaHeader, parseVitaRates } from '@/lib/vita/rules.js'

export const runtime = 'nodejs'

/**
 * Che cosa c'è nel file, PRIMA di scegliere il programma: anno delle RAL, fogli,
 * numeri di polizza, nomi dei contraenti e tassi per età. Serve all'import
 * guidato per proporre (o creare) il programma dell'anno giusto da solo.
 * Non salva niente e non serve un programma.
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return fail(401, 'Unauthorized', 'unauthorized')
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return fail(400, 'File mancante', 'invalid')
  const sheets = readSheets(Buffer.from(await file.arrayBuffer()))
  const out: {
    sheets: string[]; years: number[]; policies: Record<string, string>; names: string[]
    companies: { name: string; policy: string; sheet: string }[]
    rates: Record<string, number>; ratesFrom: string; ratesN: number; ratesMin: number | null; ratesMax: number | null
  } = { sheets: Object.keys(sheets), years: [], policies: {}, names: [], companies: [], rates: {}, ratesFrom: '', ratesN: 0, ratesMin: null, ratesMax: null }
  const years = new Set<number>()
  for (const name of out.sheets) {
    if (/^(MOVIMENT|VARIAZ)/i.test(name.trim())) continue
    const rows = sheets[name] || []
    const h = findVitaHeader(rows) as { row: number; map: Record<string, number | undefined> } | null
    if (!h) continue
    out.names.push(name)
    // Anni nominati dalle colonne RAL: «RAL ANNUA 2025», «RAL 2026 FULL TIME».
    for (const c of rows[h.row] || []) {
      const s = String(c ?? '').toUpperCase()
      if (!/RAL/.test(s)) continue
      for (const m of s.matchAll(/(20\d{2})/g)) years.add(Number(m[1]))
    }
    // Numero di polizza e nome del contraente più frequenti del foglio: così il
    // programma nuovo nasce già con i contraenti giusti, senza scriverli a mano.
    const top = (col: number | undefined, ok: (v: string) => boolean) => {
      if (col == null) return ''
      const freq = new Map<string, number>()
      for (const r of rows.slice(h.row + 1)) {
        const v = String((r || [])[col] ?? '').replace(/\s+/g, ' ').trim()
        if (v && ok(v)) freq.set(v, (freq.get(v) || 0) + 1)
      }
      return [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    }
    const policy = top(h.map.polizza, (v) => /^\d{4,}$/.test(v))
    const azienda = top(h.map.azienda, (v) => /[A-Za-z]/.test(v) && v.length < 60)
    if (policy) out.policies[name] = policy
    if (policy || azienda) out.companies.push({ name: azienda || name, policy, sheet: name })
  }
  out.years = [...years].sort()
  // Tassi per età: se il file porta il foglio TASSI il programma nuovo nasce già completo.
  const r = parseVitaRates(sheets) as { rates: Record<string, number>; n: number; from: string; minAge: number | null; maxAge: number | null }
  out.rates = r.rates; out.ratesFrom = r.from; out.ratesN = r.n; out.ratesMin = r.minAge; out.ratesMax = r.maxAge
  return NextResponse.json(out)
}
