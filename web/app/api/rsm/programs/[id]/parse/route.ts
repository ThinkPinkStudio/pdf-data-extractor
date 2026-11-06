import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { listMembers } from '@/lib/rsm/store'
import { parseCommunicationRows, prepareCommunication } from '@/lib/rsm/rules.js'
import { fail, guard, readSheets } from '@/lib/rsm/server'

export const runtime = 'nodejs'

// Legge uno o più file di comunicazione (multipart: files[], communicated =
// data di ricezione) e restituisce le righe pronte da confermare, con i
// controlli. Non registra nulla.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const form = await req.formData()
  const communicated = String(form.get('communicated') || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(communicated)) return fail(400, 'Data di ricezione mancante', 'invalid')
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (!files.length) return fail(400, 'Nessun file', 'invalid')
  const existing = await listMembers(params.id)
  const cfg = g.program.config
  const out = []
  for (const f of files) {
    try {
      const sheets = readSheets(Buffer.from(await f.arrayBuffer()))
      const first = Object.keys(sheets).find((n) => parseCommunicationRows(sheets[n], g.program.year).rows.length) || Object.keys(sheets)[0]
      const parsed = parseCommunicationRows(sheets[first] || [], g.program.year)
      if (parsed.error) { out.push({ name: f.name, error: parsed.error, rows: [] }); continue }
      out.push({ name: f.name, sheet: first, rows: prepareCommunication(cfg, parsed.rows, existing, communicated) })
    } catch (e) {
      out.push({ name: f.name, error: `File non leggibile: ${(e as Error).message}`, rows: [] })
    }
  }
  await logAction({ email: g.email, action: 'rsm.parse', resource: params.id, metadata: { files: files.map((f) => f.name) } })
  return NextResponse.json({ files: out })
}
