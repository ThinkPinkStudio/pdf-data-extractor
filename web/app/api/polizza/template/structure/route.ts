import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { templateStructure } from '@/lib/polizzaService'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const form = await req.formData().catch(() => null)
  const file = form?.get('template')
  if (!(file instanceof File)) return NextResponse.json({ success: false, error: 'Template mancante' }, { status: 400 })
  const buf = Buffer.from(await file.arrayBuffer())
  return NextResponse.json(await templateStructure(buf))
}
