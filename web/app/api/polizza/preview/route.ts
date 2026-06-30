import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { templatePreview } from '@/lib/polizzaTemplate'
import { getPolizzaFields } from '@/lib/polizzaFields'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('template')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Nessun template' }, { status: 400 })

  const data = JSON.parse((form?.get('data') as string) || '{}')
  const mapping = JSON.parse((form?.get('mapping') as string) || '{}')
  const { all } = await getPolizzaFields()

  const bytes = Buffer.from(await file.arrayBuffer())
  const result = await templatePreview(bytes, data, mapping, all)
  return NextResponse.json(result)
}
