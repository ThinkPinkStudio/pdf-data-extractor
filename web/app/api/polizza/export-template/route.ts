import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { templateExport, type Change } from '@/lib/polizzaTemplate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('template')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Nessun template' }, { status: 400 })

  const approvedChanges = JSON.parse((form?.get('approvedChanges') as string) || '[]') as Change[]
  const bytes = Buffer.from(await file.arrayBuffer())
  const out = await templateExport(bytes, approvedChanges)

  return new NextResponse(new Uint8Array(out), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name || 'gestionale.xlsx')}"`,
    },
  })
}
