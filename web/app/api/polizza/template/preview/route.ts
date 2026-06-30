import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { templatePreview } from '@/lib/polizzaService'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const form = await req.formData().catch(() => null)
  const file = form?.get('template')
  if (!(file instanceof File)) return NextResponse.json({ success: false, error: 'Template mancante' }, { status: 400 })
  const data = JSON.parse((form?.get('data') as string) || '{}')
  const mapping = JSON.parse((form?.get('mapping') as string) || '{}')
  const buf = Buffer.from(await file.arrayBuffer())
  return NextResponse.json(await templatePreview(buf, data, mapping))
}
