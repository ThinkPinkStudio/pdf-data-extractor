import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { listInsured } from '@/lib/vita/store'
import { vitaWorkbook } from '@/lib/vita/workbook'
import { guard } from '@/lib/vita/server'

export const runtime = 'nodejs'

// POST { kind: 'stato' | 'situazione', at?, ids? }: Excel come il file del cliente.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, false)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as { kind?: string; at?: string; ids?: string[] }
  const kind = body.kind === 'situazione' ? 'situazione' : 'stato'
  const at = /^\d{4}-\d{2}-\d{2}$/.test(String(body.at)) ? String(body.at) : new Date().toISOString().slice(0, 10)
  let insured = await listInsured(params.id)
  if (Array.isArray(body.ids) && body.ids.length) {
    const want = new Set(body.ids.map(String))
    insured = insured.filter((x) => want.has(x.id))
  }
  const buf = await vitaWorkbook(g.program, insured, kind, at)
  await logAction({ email: g.email, action: 'vita.export', resource: params.id, metadata: { kind, n: insured.length } })
  const name = `${g.program.name.replace(/[^\w\s-]/g, '')} ${kind === 'stato' ? 'stato di rischio' : `situazione al ${at}`}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  })
}
