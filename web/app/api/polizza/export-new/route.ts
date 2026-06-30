import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { buildSimpleXlsx } from '@/lib/simpleExcel'
import { getPolizzaFields } from '@/lib/polizzaFields'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Esporta i dati estratti in un nuovo Excel (foglio Polizza, Campo/Valore) —
// come "Esporta nuovo Excel" dell'app (exportToNewExcel).
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const data: Record<string, string> = body?.data || {}
  const { all } = await getPolizzaFields()
  const xlsx = await buildSimpleXlsx(data, all)

  return new NextResponse(new Uint8Array(xlsx), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="polizza_rc.xlsx"',
    },
  })
}
