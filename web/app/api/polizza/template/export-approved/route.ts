import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { templateExportApproved } from '@/lib/polizzaService'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const form = await req.formData().catch(() => null)
  const file = form?.get('template')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Template mancante' }, { status: 400 })
  const approvedChanges = JSON.parse((form?.get('approvedChanges') as string) || '[]')
  const buf = Buffer.from(await file.arrayBuffer())
  try {
    const out = await templateExportApproved(buf, approvedChanges)
    await logAction({ email: session.email, action: 'polizza.export_template', resource: file.name })
    const name = file.name.replace(/\.xlsx?$/i, '') + '_aggiornato.xlsx'
    return new NextResponse(new Uint8Array(out), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name}"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
