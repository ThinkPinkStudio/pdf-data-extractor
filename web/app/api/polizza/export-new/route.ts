import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { exportNewExcel } from '@/lib/polizzaService'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, suggestedName } = await req.json().catch(() => ({}))
  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Nessun dato da esportare' }, { status: 400 })
  }
  try {
    const buf = await exportNewExcel(data)
    await logAction({ email: session.email, action: 'polizza.export_new', resource: suggestedName || 'polizza_rc' })
    const name = `${(suggestedName || 'polizza_rc').replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name}"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
