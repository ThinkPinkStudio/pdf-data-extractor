import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { fail, readSheets } from '@/lib/vita/server'
import { findVitaHeader } from '@/lib/vita/rules.js'

export const runtime = 'nodejs'

/**
 * Che cosa c'è nel file, PRIMA di scegliere il programma: anno delle RAL, fogli
 * e numeri di polizza. Non salva niente e non serve un programma.
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return fail(401, 'Unauthorized', 'unauthorized')
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return fail(400, 'File mancante', 'invalid')
  const sheets = readSheets(Buffer.from(await file.arrayBuffer()))
  const out: { sheets: string[]; years: number[]; policies: Record<string, string>; names: string[] } =
    { sheets: Object.keys(sheets), years: [], policies: {}, names: [] }
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
    // Numero di polizza più frequente del foglio, per riconoscere il contraente.
    if (h.map.polizza != null) {
      const freq = new Map<string, number>()
      for (const r of rows.slice(h.row + 1)) {
        const p = String((r || [])[h.map.polizza] ?? '').trim()
        if (/^\d{4,}$/.test(p)) freq.set(p, (freq.get(p) || 0) + 1)
      }
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]
      if (top) out.policies[name] = top[0]
    }
  }
  out.years = [...years].sort()
  return NextResponse.json(out)
}
