import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { listMembers } from '@/lib/rsm/store'
import { rsmWorkbook } from '@/lib/rsm/workbook'
import { fail, guard } from '@/lib/rsm/server'

export const runtime = 'nodejs'

// POST { kind: 'stato' | 'situazione', at, ids? } → .xlsx. `ids` = le righe
// filtrate nella pagina (solo per 'situazione'); senza, tutte.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, false)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as { kind?: string; at?: string; ids?: string[] }
  const kind = body.kind === 'situazione' ? 'situazione' : 'stato'
  const at = typeof body.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.at) ? body.at : new Date().toISOString().slice(0, 10)
  let members = await listMembers(params.id)
  if (kind === 'situazione' && Array.isArray(body.ids)) {
    const order = new Map(body.ids.map((id, i) => [String(id), i]))
    members = members.filter((m) => order.has(m.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  }
  try {
    const buf = await rsmWorkbook(g.program, members, kind, at)
    await logAction({ email: g.email, action: 'rsm.export', resource: params.id, metadata: { kind, at, rows: members.length } })
    const file = `${g.program.name.replace(/[^\w\- ]+/g, '').trim() || 'RSM'} - ${kind === 'stato' ? 'stato di rischio' : 'situazione'} ${at}.xlsx`
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${file}"`,
      },
    })
  } catch (e) {
    console.error('[rsm] export:', e)
    return fail(500, 'Errore interno', 'internal')
  }
}
