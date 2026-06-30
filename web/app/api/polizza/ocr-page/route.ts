import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { ocrPage } from '@/lib/polizzaService'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { imageBase64 } = await req.json().catch(() => ({}))
  if (!imageBase64) return NextResponse.json({ success: false, error: 'imageBase64 mancante' }, { status: 400 })
  return NextResponse.json(await ocrPage(imageBase64))
}
