import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { templateStructure } from '@/lib/polizzaTemplate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('template')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Nessun template' }, { status: 400 })

  const bytes = Buffer.from(await file.arrayBuffer())
  const result = await templateStructure(bytes)
  return NextResponse.json(result)
}
